use rusqlite::{params_from_iter, types::{Value as SqlValue, ValueRef}, Connection};
use serde::Serialize;
use serde_json::{Map, Number, Value as JsonValue};
use std::{path::{Path, PathBuf}, sync::Mutex};
use tauri::{Manager, State};

const PRODUCTION_IDENTIFIER: &str = "com.personalfinance.console";
const SMOKE_IDENTIFIER: &str = "com.personalfinance.console.smoke";
const ACCEPTANCE_IDENTIFIER: &str = "com.personalfinance.console.v4acceptance";
const ACCEPTANCE_DATABASE: &str = "personal-finance-console-v4-acceptance.sqlite3";

fn ensure_smoke_data_dir_isolated(identifier: &str, data_dir: &Path, home_dir: &Path) -> Result<(), String> {
    if identifier == SMOKE_IDENTIFIER {
        let production_data_dir: PathBuf = home_dir.join("Library/Application Support").join(PRODUCTION_IDENTIFIER);
        if data_dir == production_data_dir {
            return Err("Smoke runtime refused the Production application-data directory.".into());
        }
    }
    Ok(())
}

fn ensure_acceptance_data_dir_isolated(identifier: &str, data_dir: &Path, home_dir: &Path) -> Result<(), String> {
    if identifier != ACCEPTANCE_IDENTIFIER {
        return Err("V4 acceptance runtime refused an unexpected application identity.".into());
    }
    let expected = home_dir.join("Library/Application Support").join(ACCEPTANCE_IDENTIFIER);
    if data_dir != expected {
        return Err("V4 acceptance runtime refused an unexpected application-data directory.".into());
    }
    if data_dir == home_dir.join("Library/Application Support").join(PRODUCTION_IDENTIFIER) {
        return Err("V4 acceptance runtime refused the Production application-data directory.".into());
    }
        if data_dir.exists() {
        let canonical = data_dir.canonicalize().map_err(|error| error.to_string())?;
        let canonical_parent = expected.parent().ok_or("V4 acceptance path has no parent.")?
            .canonicalize().map_err(|error| error.to_string())?;
        if canonical != canonical_parent.join(ACCEPTANCE_IDENTIFIER) {
            return Err("V4 acceptance runtime refused a redirected application-data directory.".into());
        }
    }
    Ok(())
}

pub struct DatabaseState {
    connection: Mutex<Connection>,
    transaction_id: Mutex<Option<String>>,
    path: PathBuf,
    acceptance_runtime: bool,
}

impl DatabaseState {
    pub fn open(path: &Path) -> Result<Self, String> {
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        Self::from_connection(connection, path.to_path_buf(), false)
    }

    fn from_connection(connection: Connection, path: PathBuf, acceptance_runtime: bool) -> Result<Self, String> {
        connection.pragma_update(None, "foreign_keys", "ON").map_err(|error| error.to_string())?;
        let enabled: i64 = connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0)).map_err(|error| error.to_string())?;
        if enabled != 1 { return Err("SQLite foreign key enforcement could not be enabled.".into()); }
        Ok(Self { connection: Mutex::new(connection), transaction_id: Mutex::new(None), path, acceptance_runtime })
    }

    fn check_transaction(&self, requested: &Option<String>) -> Result<(), String> {
        let active = self.transaction_id.lock().map_err(|_| "Database transaction state is unavailable.".to_string())?;
        match (active.as_ref(), requested.as_ref()) {
            (None, None) => Ok(()),
            (Some(active), Some(requested)) if active == requested => Ok(()),
            (Some(_), _) => Err("The database is busy in another transaction.".into()),
            (None, Some(_)) => Err("The requested database transaction is no longer active.".into()),
        }
    }

    fn execute(&self, sql: &str, bind_values: Vec<JsonValue>, transaction_id: Option<String>) -> Result<ExecuteResult, String> {
        let values = bind_values.into_iter().map(convert_bind).collect::<Result<Vec<_>, _>>()?;
        let connection = self.connection.lock().map_err(|_| "Database connection is unavailable.".to_string())?;
        self.check_transaction(&transaction_id)?;
        let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
        let rows_affected = statement.execute(params_from_iter(values.iter())).map_err(|error| error.to_string())?;
        Ok(ExecuteResult { rows_affected, last_insert_id: connection.last_insert_rowid() })
    }

    fn select(&self, sql: &str, bind_values: Vec<JsonValue>, transaction_id: Option<String>) -> Result<Vec<Map<String, JsonValue>>, String> {
        let values = bind_values.into_iter().map(convert_bind).collect::<Result<Vec<_>, _>>()?;
        let connection = self.connection.lock().map_err(|_| "Database connection is unavailable.".to_string())?;
        self.check_transaction(&transaction_id)?;
        let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
        let column_names = statement.column_names().iter().map(|name| name.to_string()).collect::<Vec<_>>();
        let rows = statement.query_map(params_from_iter(values.iter()), |row| {
            let mut record = Map::new();
            for (index, name) in column_names.iter().enumerate() {
                let value = match row.get_ref(index)? {
                    ValueRef::Null => JsonValue::Null,
                    ValueRef::Integer(value) => JsonValue::from(value),
                    ValueRef::Real(value) => Number::from_f64(value).map(JsonValue::Number).unwrap_or(JsonValue::Null),
                    ValueRef::Text(value) => JsonValue::String(String::from_utf8_lossy(value).into_owned()),
                    ValueRef::Blob(_) => return Err(rusqlite::Error::InvalidColumnType(index, name.clone(), rusqlite::types::Type::Blob)),
                };
                record.insert(name.clone(), value);
            }
            Ok(record)
        }).map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())
    }

    fn begin(&self, transaction_id: String) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|_| "Database connection is unavailable.".to_string())?;
        let mut active = self.transaction_id.lock().map_err(|_| "Database transaction state is unavailable.".to_string())?;
        if active.is_some() { return Err("A database transaction is already active.".into()); }
        connection.execute_batch("BEGIN IMMEDIATE").map_err(|error| error.to_string())?;
        *active = Some(transaction_id);
        Ok(())
    }

    fn commit(&self, transaction_id: &str) -> Result<(), String> { self.finish_transaction(transaction_id, "COMMIT") }

    fn rollback(&self, transaction_id: &str) -> Result<(), String> { self.finish_transaction(transaction_id, "ROLLBACK") }

    fn finish_transaction(&self, transaction_id: &str, command: &str) -> Result<(), String> {
        let connection = self.connection.lock().map_err(|_| "Database connection is unavailable.".to_string())?;
        let mut active = self.transaction_id.lock().map_err(|_| "Database transaction state is unavailable.".to_string())?;
        if active.as_deref() != Some(transaction_id) { return Err("Database transaction token does not match.".into()); }
        connection.execute_batch(command).map_err(|error| error.to_string())?;
        *active = None;
        Ok(())
    }

    fn reset_acceptance_data(&self, identifier: &str, home_dir: &Path) -> Result<(), String> {
        if !self.acceptance_runtime || identifier != ACCEPTANCE_IDENTIFIER {
            return Err("Reset refused: this is not the V4 acceptance runtime.".into());
        }
        let expected_dir = home_dir.join("Library/Application Support").join(ACCEPTANCE_IDENTIFIER);
        let expected_path = expected_dir.join(ACCEPTANCE_DATABASE);
        if self.path != expected_path || self.path.file_name().and_then(|name| name.to_str()) != Some(ACCEPTANCE_DATABASE) {
            return Err("Reset refused: acceptance database path validation failed.".into());
        }
        let connection = self.connection.lock().map_err(|_| "Database connection is unavailable.".to_string())?;
        let active = self.transaction_id.lock().map_err(|_| "Database transaction state is unavailable.".to_string())?;
        if active.is_some() { return Err("Reset refused while a database transaction is active.".into()); }
        connection.execute_batch("PRAGMA foreign_keys=OFF; BEGIN IMMEDIATE;").map_err(|error| error.to_string())?;
        let result: Result<(), String> = (|| {
            let mut statement = connection.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'").map_err(|error| error.to_string())?;
            let tables = statement.query_map([], |row| row.get::<_, String>(0)).map_err(|error| error.to_string())?
                .collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?;
            drop(statement);
            for table in tables {
                let escaped = table.replace('"', "\"\"");
                connection.execute(&format!("DELETE FROM \"{escaped}\""), []).map_err(|error| error.to_string())?;
            }
            connection.execute_batch("COMMIT;").map_err(|error| error.to_string())?;
            Ok(())
        })();
        if result.is_err() { let _ = connection.execute_batch("ROLLBACK;"); }
        let fk_result = connection.execute_batch("PRAGMA foreign_keys=ON;").map_err(|error| error.to_string());
        result?;
        fk_result
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AcceptanceRuntimeInfo { identifier: String, app_data_dir: String, database_path: String }

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExecuteResult { rows_affected: usize, last_insert_id: i64 }

fn convert_bind(value: JsonValue) -> Result<SqlValue, String> {
    match value {
        JsonValue::Null => Ok(SqlValue::Null),
        JsonValue::Bool(value) => Ok(SqlValue::Integer(i64::from(value))),
        JsonValue::Number(value) => value.as_i64().map(SqlValue::Integer)
            .or_else(|| value.as_f64().map(SqlValue::Real))
            .ok_or_else(|| "Invalid numeric SQLite bind value.".to_string()),
        JsonValue::String(value) => Ok(SqlValue::Text(value)),
        JsonValue::Array(_) | JsonValue::Object(_) => Err("SQLite bind values must be scalar.".into()),
    }
}

#[tauri::command]
fn database_open() -> Result<(), String> { Ok(()) }

#[tauri::command]
fn acceptance_runtime_info(state: State<'_, DatabaseState>, app: tauri::AppHandle) -> Result<AcceptanceRuntimeInfo, String> {
    let identifier = app.config().identifier.clone();
    if identifier != ACCEPTANCE_IDENTIFIER || !state.acceptance_runtime {
        return Err("V4 acceptance runtime identity is unavailable.".into());
    }
    let data_dir = app.path().app_data_dir().map_err(|error| error.to_string())?;
    Ok(AcceptanceRuntimeInfo { identifier, app_data_dir: data_dir.display().to_string(), database_path: state.path.display().to_string() })
}

#[tauri::command]
fn acceptance_reset(state: State<'_, DatabaseState>, app: tauri::AppHandle) -> Result<(), String> {
    let home = app.path().home_dir().map_err(|error| error.to_string())?;
    state.reset_acceptance_data(&app.config().identifier, &home)
}

#[tauri::command]
fn database_execute(
    state: State<'_, DatabaseState>, sql: String, bind_values: Vec<JsonValue>, transaction_id: Option<String>,
) -> Result<ExecuteResult, String> {
    state.execute(&sql, bind_values, transaction_id)
}

#[tauri::command]
fn database_select(
    state: State<'_, DatabaseState>, sql: String, bind_values: Vec<JsonValue>, transaction_id: Option<String>,
) -> Result<Vec<Map<String, JsonValue>>, String> {
    state.select(&sql, bind_values, transaction_id)
}

#[tauri::command]
fn database_begin(state: State<'_, DatabaseState>, transaction_id: String) -> Result<(), String> {
    state.begin(transaction_id)
}

#[tauri::command]
fn database_commit(state: State<'_, DatabaseState>, transaction_id: String) -> Result<(), String> {
    state.commit(&transaction_id)
}

#[tauri::command]
fn database_rollback(state: State<'_, DatabaseState>, transaction_id: String) -> Result<(), String> {
    state.rollback(&transaction_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{fs, time::{SystemTime, UNIX_EPOCH}};

    fn memory_db() -> DatabaseState {
        DatabaseState::from_connection(Connection::open_in_memory().unwrap(), PathBuf::from(":memory:"), false).unwrap()
    }

    fn temp_db_path() -> std::path::PathBuf {
        let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
        std::env::temp_dir().join(format!("personal-finance-transaction-{}-{nonce}.sqlite3", std::process::id()))
    }

    fn count(db: &DatabaseState, table: &str) -> i64 {
        db.select(&format!("SELECT COUNT(*) AS count FROM {table}"), vec![], None).unwrap()[0]["count"].as_i64().unwrap()
    }

    #[test]
    fn a_begin_write_commit_persists_after_reopen() {
        let path = temp_db_path();
        {
            let db = DatabaseState::open(&path).unwrap();
            db.execute("CREATE TABLE entries (id INTEGER PRIMARY KEY, value TEXT NOT NULL)", vec![], None).unwrap();
            db.begin("persist-token".into()).unwrap();
            db.execute("INSERT INTO entries (value) VALUES (?1)", vec![JsonValue::String("saved".into())], Some("persist-token".into())).unwrap();
            db.commit("persist-token").unwrap();
        }
        let reopened = DatabaseState::open(&path).unwrap();
        let rows = reopened.select("SELECT value FROM entries", vec![], None).unwrap();
        assert_eq!(rows[0]["value"], "saved");
        drop(reopened);
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn b_second_operation_failure_then_rollback_removes_first_write() {
        let db = memory_db();
        db.execute("CREATE TABLE entries (value TEXT NOT NULL)", vec![], None).unwrap();
        db.begin("rollback-token".into()).unwrap();
        db.execute("INSERT INTO entries VALUES (?1)", vec![JsonValue::String("first".into())], Some("rollback-token".into())).unwrap();
        assert!(db.execute("INSERT INTO missing_table VALUES (?1)", vec![JsonValue::String("second".into())], Some("rollback-token".into())).is_err());
        db.rollback("rollback-token").unwrap();
        assert_eq!(count(&db, "entries"), 0);
    }

    #[test]
    fn c_token_cannot_commit_or_rollback_another_transaction() {
        let db = memory_db();
        db.execute("CREATE TABLE entries (value TEXT NOT NULL)", vec![], None).unwrap();
        db.begin("owner-token".into()).unwrap();
        db.execute("INSERT INTO entries VALUES (?1)", vec![JsonValue::String("inside".into())], Some("owner-token".into())).unwrap();
        assert!(db.commit("other-token").unwrap_err().contains("token does not match"));
        assert!(db.rollback("other-token").unwrap_err().contains("token does not match"));
        let still_active = db.select("SELECT COUNT(*) AS count FROM entries", vec![], Some("owner-token".into())).unwrap();
        assert_eq!(still_active[0]["count"].as_i64(), Some(1));
        db.commit("owner-token").unwrap();
        assert_eq!(count(&db, "entries"), 1);
    }

    #[test]
    fn d_invalid_and_expired_tokens_return_explicit_errors() {
        let db = memory_db();
        db.execute("CREATE TABLE entries (value TEXT NOT NULL)", vec![], None).unwrap();
        db.begin("live-token".into()).unwrap();
        let err = db.execute("INSERT INTO entries VALUES ('x')", vec![], Some("wrong-token".into())).unwrap_err();
        assert!(err.contains("busy in another transaction"), "{err}");
        db.commit("live-token").unwrap();
        let err = db.select("SELECT 1", vec![], Some("live-token".into())).unwrap_err();
        assert!(err.contains("no longer active"), "{err}");
    }

    #[test]
    fn e_foreign_key_violation_and_rollback_remove_preceding_write() {
        let db = memory_db();
        db.execute("CREATE TABLE parents (id INTEGER PRIMARY KEY)", vec![], None).unwrap();
        db.execute("CREATE TABLE children (parent_id INTEGER NOT NULL REFERENCES parents(id))", vec![], None).unwrap();
        db.begin("fk-token".into()).unwrap();
        db.execute("INSERT INTO parents VALUES (1)", vec![], Some("fk-token".into())).unwrap();
        let err = db.execute("INSERT INTO children VALUES (99)", vec![], Some("fk-token".into())).unwrap_err();
        assert!(err.contains("FOREIGN KEY constraint failed"), "{err}");
        db.rollback("fk-token").unwrap();
        assert_eq!(count(&db, "parents"), 0);
        assert_eq!(count(&db, "children"), 0);
    }

    #[test]
    fn f_smoke_identity_and_data_path_are_separate_from_production() {
        let home = Path::new("/Users/tester");
        let production = home.join("Library/Application Support").join(PRODUCTION_IDENTIFIER);
        let smoke = home.join("Library/Application Support").join(SMOKE_IDENTIFIER);
        assert_ne!(PRODUCTION_IDENTIFIER, SMOKE_IDENTIFIER);
        assert_ne!(production, smoke);
        assert!(ensure_smoke_data_dir_isolated(SMOKE_IDENTIFIER, &smoke, home).is_ok());
        assert!(ensure_smoke_data_dir_isolated(SMOKE_IDENTIFIER, &production, home).is_err());
    }

    #[test]
    fn g_production_fresh_data_directory_is_allowed() {
        let home = Path::new("/Users/tester");
        let production = home.join("Library/Application Support").join(PRODUCTION_IDENTIFIER);
        assert!(ensure_smoke_data_dir_isolated(PRODUCTION_IDENTIFIER, &production, home).is_ok());
    }

    #[test]
    fn h_acceptance_identity_is_bound_to_its_separate_app_data_path() {
        let home = Path::new("/Users/tester");
        let acceptance = home.join("Library/Application Support").join(ACCEPTANCE_IDENTIFIER);
        let production = home.join("Library/Application Support").join(PRODUCTION_IDENTIFIER);
        assert!(ensure_acceptance_data_dir_isolated(ACCEPTANCE_IDENTIFIER, &acceptance, home).is_ok());
        assert!(ensure_acceptance_data_dir_isolated(ACCEPTANCE_IDENTIFIER, &production, home).is_err());
        assert!(ensure_acceptance_data_dir_isolated(PRODUCTION_IDENTIFIER, &acceptance, home).is_err());
    }

    #[test]
    fn i_acceptance_database_name_is_distinct_from_production_database_name() {
        assert_ne!(ACCEPTANCE_DATABASE, "personal-finance-console.sqlite3");
    }

    #[test]
    fn j_acceptance_reset_clears_only_business_rows_and_keeps_migrations() {
        let home = std::env::temp_dir().join(format!("acceptance-reset-test-{}", std::process::id()));
        let app_data = home.join("Library/Application Support").join(ACCEPTANCE_IDENTIFIER);
        fs::create_dir_all(&app_data).unwrap();
        let path = app_data.join(ACCEPTANCE_DATABASE);
        let connection = Connection::open(&path).unwrap();
        connection.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(1),(2),(3),(4); CREATE TABLE sample(value TEXT); INSERT INTO sample VALUES('synthetic');").unwrap();
        let state = DatabaseState::from_connection(connection, path, true).unwrap();
        state.reset_acceptance_data(ACCEPTANCE_IDENTIFIER, &home).unwrap();
        assert_eq!(count(&state, "sample"), 0);
        assert_eq!(count(&state, "schema_migrations"), 4);
        assert!(state.reset_acceptance_data(PRODUCTION_IDENTIFIER, &home).is_err());
        drop(state);
        fs::remove_dir_all(home).unwrap();
    }

    #[cfg(feature = "v4-acceptance")]
    #[test]
    fn k_acceptance_context_uses_isolated_identity_window_and_frontend() {
        let context = acceptance_context();
        assert_eq!(context.config().identifier, ACCEPTANCE_IDENTIFIER);
        let window = context.config().app.windows.first().expect("acceptance window");
        assert_eq!(window.title, "小钱家 V4 验收版");
        assert_eq!(window.width, 1040.0);
        assert_eq!(window.height, 900.0);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let home = app.path().home_dir()?;
            let acceptance_runtime = app.config().identifier == ACCEPTANCE_IDENTIFIER;
            if cfg!(feature = "v4-acceptance") && !acceptance_runtime {
                return Err(std::io::Error::other(
                    "V4 acceptance build refused to start with a non-acceptance runtime identity.",
                )
                .into());
            }
            if acceptance_runtime {
                ensure_acceptance_data_dir_isolated(&app.config().identifier, &app_data, &home).map_err(std::io::Error::other)?;
            } else {
                ensure_smoke_data_dir_isolated(&app.config().identifier, &app_data, &home).map_err(std::io::Error::other)?;
            }
            std::fs::create_dir_all(&app_data)?;
            let database_path = if acceptance_runtime { app_data.join(ACCEPTANCE_DATABASE) } else { app_data.join("personal-finance-console.sqlite3") };
            if acceptance_runtime && database_path.exists() {
                let canonical_data = app_data.canonicalize()?;
                let canonical_db = database_path.canonicalize()?;
                if canonical_db != canonical_data.join(ACCEPTANCE_DATABASE) {
                    return Err(std::io::Error::other("V4 acceptance runtime refused a redirected database file.").into());
                }
            }
            let connection = Connection::open(&database_path).map_err(std::io::Error::other)?;
            let database = DatabaseState::from_connection(connection, database_path, acceptance_runtime).map_err(std::io::Error::other)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![database_open, database_execute, database_select, database_begin, database_commit, database_rollback, acceptance_runtime_info, acceptance_reset])
        .run(acceptance_context())
        .expect("failed to run Personal Finance Console");
}

#[cfg(feature = "v4-acceptance")]
fn acceptance_context() -> tauri::Context<tauri::Wry> {
    let context = tauri::generate_context!("tauri.v4acceptance.conf.json");
    assert_eq!(
        context.config().identifier,
        ACCEPTANCE_IDENTIFIER,
        "V4 acceptance build refused a non-acceptance Tauri context"
    );
    context
}

#[cfg(not(feature = "v4-acceptance"))]
fn acceptance_context() -> tauri::Context<tauri::Wry> {
    tauri::generate_context!()
}
