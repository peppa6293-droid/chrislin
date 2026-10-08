use rusqlite::{hooks::{AuthAction, AuthContext, Authorization}, params_from_iter, types::{Value as SqlValue, ValueRef}, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::{io::Read, path::{Path, PathBuf}, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}};
use tauri::{Manager, State};

const PRODUCTION_IDENTIFIER: &str = "com.personalfinance.console";
const SMOKE_IDENTIFIER: &str = "com.personalfinance.console.smoke";
const ACCEPTANCE_IDENTIFIER: &str = "com.personalfinance.console.v4acceptance";
const ACCEPTANCE_DATABASE: &str = "personal-finance-console-v4-acceptance.sqlite3";
const PRODUCTION_DATABASE: &str = "personal-finance-console.sqlite3";
const CURRENT_SCHEMA_VERSION: i64 = 4;
const RUNTIME_COMPATIBILITY_MANIFEST: &str = "runtime-compatibility.json";
const PRODUCTION_MIGRATION_AUTHORIZATION: &str = "production-v4-migration-authorization.json";
const PRODUCTION_APP_BUNDLE: &str = "/Applications/Personal Finance Console.app";
const PRODUCTION_EXECUTABLE: &str = "personal-finance-console";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DatabaseSchemaVersion { user_version: i64, migration_version: i64 }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductionMigrationAuthorization {
    receipt_format_version: u32,
    status: String,
    nonce: String,
    issued_at_unix: u64,
    expires_at_unix: u64,
    production_bundle_id: String,
    installed_app_path: String,
    candidate_executable_path: String,
    candidate_executable_sha256: String,
    compatibility_manifest_sha256: String,
    max_supported_schema_version: i64,
    production_database_path: String,
    production_database_pre_migration_sha256: String,
    production_schema: ProductionSchemaVersion,
    backup_path: String,
    backup_sha256: String,
    owner_authorization_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductionSchemaVersion { user_version: i64, migration_version: i64 }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeCompatibilityManifest {
    manifest_format_version: u32,
    runtime_generation: u32,
    min_supported_schema_version: i64,
    max_supported_schema_version: i64,
    bundle_id: String,
    executable: String,
}

fn schema_version_from_connection(connection: &Connection) -> Result<DatabaseSchemaVersion, String> {
    let user_version: i64 = connection.query_row("PRAGMA user_version", [], |row| row.get(0)).map_err(|error| error.to_string())?;
    let has_migrations: bool = connection.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migrations')",
        [], |row| row.get(0),
    ).map_err(|error| error.to_string())?;
    let migration_version = if has_migrations {
        connection.query_row("SELECT COALESCE(MAX(version),0) FROM schema_migrations", [], |row| row.get(0)).map_err(|error| error.to_string())?
    } else { 0 };
    Ok(DatabaseSchemaVersion { user_version, migration_version })
}

fn schema_version_from_path(path: &Path) -> Result<DatabaseSchemaVersion, String> {
    if !path.exists() { return Ok(DatabaseSchemaVersion { user_version: 0, migration_version: 0 }); }
    let connection = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX).map_err(|error| error.to_string())?;
    schema_version_from_connection(&connection)
}

fn ensure_supported_schema(schema: DatabaseSchemaVersion) -> Result<(), String> {
    if schema.user_version > CURRENT_SCHEMA_VERSION || schema.migration_version > CURRENT_SCHEMA_VERSION {
        return Err(format!("Database schema is newer than this runtime (user_version={}, schema_migrations={}, supported={}).", schema.user_version, schema.migration_version, CURRENT_SCHEMA_VERSION));
    }
    if schema.user_version != schema.migration_version {
        return Err(format!("Database schema version authorities disagree (user_version={}, schema_migrations={}).", schema.user_version, schema.migration_version));
    }
    Ok(())
}

fn is_schema_preflight_select(sql: &str) -> bool {
    let normalized = sql.split_whitespace().collect::<Vec<_>>().join(" ").to_ascii_lowercase();
    matches!(normalized.trim_end_matches(';'),
        "pragma user_version" |
        "select name from sqlite_master where type='table' and name='schema_migrations'" |
        "select coalesce(max(version), 0) as version from schema_migrations")
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    loop {
        let count = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn production_manifest_path(executable: &Path) -> Result<PathBuf, String> {
    let macos_dir = executable.parent().ok_or("Production executable has no parent directory.")?;
    let contents_dir = macos_dir.parent().ok_or("Production executable is outside an app bundle.")?;
    Ok(contents_dir.join("Resources").join(RUNTIME_COMPATIBILITY_MANIFEST))
}

fn validate_runtime_compatibility_manifest(executable: &Path) -> Result<(PathBuf, String), String> {
    let manifest_path = production_manifest_path(executable)?;
    let bytes = std::fs::read(&manifest_path).map_err(|error| format!("Production runtime compatibility manifest is missing: {error}"))?;
    let manifest: RuntimeCompatibilityManifest = serde_json::from_slice(&bytes).map_err(|error| error.to_string())?;
    if manifest.manifest_format_version != 1 || manifest.runtime_generation != 4 ||
        manifest.min_supported_schema_version < 1 || manifest.min_supported_schema_version > 3 ||
        manifest.max_supported_schema_version != CURRENT_SCHEMA_VERSION || manifest.bundle_id != PRODUCTION_IDENTIFIER ||
        manifest.executable != format!("Contents/MacOS/{PRODUCTION_EXECUTABLE}") {
        return Err("Production runtime compatibility manifest does not declare the supported V4 Production runtime.".into());
    }
    let digest = sha256_file(&manifest_path)?;
    Ok((manifest_path, digest))
}

fn consume_production_migration_authorization(
    app_data: &Path,
    database_path: &Path,
    home: &Path,
    schema: DatabaseSchemaVersion,
    executable: &Path,
    manifest_sha256: &str,
) -> Result<(), String> {
    if schema != (DatabaseSchemaVersion { user_version: 3, migration_version: 3 }) {
        return Err("Production V4 migration is supported only from a consistent V3 database.".into());
    }
    let expected_data = home.join("Library/Application Support").join(PRODUCTION_IDENTIFIER);
    let expected_database = expected_data.join(PRODUCTION_DATABASE);
    let expected_app = Path::new(PRODUCTION_APP_BUNDLE);
    let expected_executable = expected_app.join("Contents/MacOS").join(PRODUCTION_EXECUTABLE);
    if app_data != expected_data || database_path != expected_database || database_path.file_name().and_then(|name| name.to_str()) != Some(PRODUCTION_DATABASE) {
        return Err("Production migration refused an unexpected app-data or database path.".into());
    }
    if executable != expected_executable {
        return Err("Production migration must start from the approved installed app path.".into());
    }

    let authorization_path = app_data.join(PRODUCTION_MIGRATION_AUTHORIZATION);
    let claimed_path = app_data.join(format!(".{PRODUCTION_MIGRATION_AUTHORIZATION}.claimed-{}", std::process::id()));
    std::fs::rename(&authorization_path, &claimed_path).map_err(|_| "Production V4 migration is blocked: no unconsumed release-gate authorization is present.".to_string())?;
    let result = (|| {
        let metadata = std::fs::metadata(&claimed_path).map_err(|error| error.to_string())?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o077 != 0 { return Err("Production migration authorization file permissions must be Owner-only.".into()); }
        }
        let authorization: ProductionMigrationAuthorization = serde_json::from_slice(&std::fs::read(&claimed_path).map_err(|error| error.to_string())?).map_err(|error| error.to_string())?;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|error| error.to_string())?.as_secs();
        let environment_nonce = std::env::var("PF_V4_RELEASE_GATE_NONCE").unwrap_or_default();
        let current_executable = std::env::current_exe().map_err(|error| error.to_string())?;
        let current_executable_hash = sha256_file(&current_executable)?;
        let manifest_path = production_manifest_path(&current_executable)?;
        let current_database_hash = sha256_file(database_path)?;
        let backup_path = PathBuf::from(&authorization.backup_path);
        let expected_backup_root = expected_data.join("production-v4-backups");
        let current_manifest_hash = sha256_file(&manifest_path)?;
        if authorization.receipt_format_version != 1 || authorization.status != "ONE_TIME_PRODUCTION_V4_MIGRATION_AUTHORIZATION" ||
            authorization.nonce.is_empty() || environment_nonce != authorization.nonce ||
            authorization.issued_at_unix > now || authorization.expires_at_unix < now || authorization.expires_at_unix - authorization.issued_at_unix > 120 ||
            authorization.production_bundle_id != PRODUCTION_IDENTIFIER || authorization.installed_app_path != expected_app.to_string_lossy() ||
            authorization.candidate_executable_path != current_executable.to_string_lossy() || authorization.candidate_executable_sha256 != current_executable_hash ||
            authorization.compatibility_manifest_sha256 != current_manifest_hash || authorization.compatibility_manifest_sha256 != manifest_sha256 ||
            authorization.max_supported_schema_version != CURRENT_SCHEMA_VERSION || authorization.production_database_path != database_path.to_string_lossy() ||
            authorization.production_database_pre_migration_sha256 != current_database_hash ||
            authorization.production_schema.user_version != schema.user_version || authorization.production_schema.migration_version != schema.migration_version ||
            !backup_path.starts_with(&expected_backup_root) || backup_path == database_path ||
            !backup_path.is_file() || sha256_file(&backup_path)? != authorization.backup_sha256 || authorization.backup_sha256 != current_database_hash ||
            authorization.owner_authorization_id.as_deref().unwrap_or("").is_empty() {
            return Err("Production V4 migration authorization facts no longer match the runtime, database, backup, manifest, or Owner authorization.".into());
        }
        Ok(())
    })();
    let _ = std::fs::remove_file(&claimed_path);
    result
}

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
    production_runtime: bool,
    migration_permitted: Arc<AtomicBool>,
    migration_active: Arc<AtomicBool>,
    schema_ready: Arc<AtomicBool>,
}

impl DatabaseState {
    pub fn open(path: &Path) -> Result<Self, String> {
        if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
            let production_path = home.join("Library/Application Support").join(PRODUCTION_IDENTIFIER).join(PRODUCTION_DATABASE);
            let is_production_path = path == production_path || path.canonicalize().ok().is_some_and(|actual| {
                production_path.canonicalize().ok().as_ref() == Some(&actual)
            });
            if is_production_path {
                return Err("Direct database open is disabled for Production; use the gated runtime entrypoint.".into());
            }
        }
        let connection = Connection::open(path).map_err(|error| error.to_string())?;
        Self::from_connection(connection, path.to_path_buf(), false)
    }

    fn from_connection(connection: Connection, path: PathBuf, acceptance_runtime: bool) -> Result<Self, String> {
        Self::from_connection_with_runtime(connection, path, acceptance_runtime, false, false, true)
    }

    fn from_connection_with_runtime(connection: Connection, path: PathBuf, acceptance_runtime: bool, production_runtime: bool, migration_permitted: bool, schema_ready: bool) -> Result<Self, String> {
        let migration_permitted = Arc::new(AtomicBool::new(migration_permitted));
        let migration_active = Arc::new(AtomicBool::new(false));
        let schema_ready = Arc::new(AtomicBool::new(schema_ready));
        if production_runtime {
            let migration_active_for_hook = Arc::clone(&migration_active);
            let schema_ready_for_hook = Arc::clone(&schema_ready);
            connection.authorizer(Some(move |context: AuthContext<'_>| {
                let migration = migration_active_for_hook.load(Ordering::SeqCst);
                let ready = schema_ready_for_hook.load(Ordering::SeqCst);
                let denied = match context.action {
                    AuthAction::CreateIndex { .. } | AuthAction::CreateTable { .. } | AuthAction::CreateTempIndex { .. } |
                    AuthAction::CreateTempTable { .. } | AuthAction::CreateTempTrigger { .. } | AuthAction::CreateTempView { .. } |
                    AuthAction::CreateTrigger { .. } | AuthAction::CreateView { .. } | AuthAction::DropIndex { .. } |
                    AuthAction::DropTable { .. } | AuthAction::DropTempIndex { .. } | AuthAction::DropTempTable { .. } |
                    AuthAction::DropTempTrigger { .. } | AuthAction::DropTempView { .. } | AuthAction::DropTrigger { .. } |
                    AuthAction::DropView { .. } | AuthAction::AlterTable { .. } | AuthAction::Reindex { .. } |
                    AuthAction::Analyze { .. } | AuthAction::CreateVtable { .. } | AuthAction::DropVtable { .. } => !migration,
                    AuthAction::Insert { table_name } | AuthAction::Update { table_name, .. } | AuthAction::Delete { table_name } =>
                        !migration && (table_name == "schema_migrations" || !ready),
                    AuthAction::Pragma { pragma_name, pragma_value } => {
                        pragma_value.is_some() && !migration && !(pragma_name.eq_ignore_ascii_case("foreign_keys") && pragma_value.is_some_and(|value| value.eq_ignore_ascii_case("ON")))
                    },
                    AuthAction::Attach { .. } | AuthAction::Detach { .. } => true,
                    AuthAction::Unknown { .. } => true,
                    _ => false,
                };
                if denied { Authorization::Deny } else { Authorization::Allow }
            }));
        }
        connection.pragma_update(None, "foreign_keys", "ON").map_err(|error| error.to_string())?;
        let enabled: i64 = connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0)).map_err(|error| error.to_string())?;
        if enabled != 1 { return Err("SQLite foreign key enforcement could not be enabled.".into()); }
        Ok(Self { connection: Mutex::new(connection), transaction_id: Mutex::new(None), path, acceptance_runtime, production_runtime, migration_permitted, migration_active, schema_ready })
    }

    fn begin_schema_migration(&self) -> Result<(), String> {
        if !self.production_runtime { return Ok(()); }
        if !self.migration_permitted.swap(false, Ordering::SeqCst) {
            return Err("Production schema migration is not authorized by the release gate.".into());
        }
        if self.migration_active.swap(true, Ordering::SeqCst) {
            return Err("Production schema migration is not authorized by the release gate.".into());
        }
        self.schema_ready.store(false, Ordering::SeqCst);
        Ok(())
    }

    fn end_schema_migration(&self, succeeded: bool) -> Result<(), String> {
        if !self.production_runtime { return Ok(()); }
        if !self.migration_active.swap(false, Ordering::SeqCst) { return Err("No authorized Production schema migration is active.".into()); }
        let connection = self.connection.lock().map_err(|_| "Database connection is unavailable.".to_string())?;
        let schema = schema_version_from_connection(&connection)?;
        ensure_supported_schema(schema)?;
        if succeeded && schema == (DatabaseSchemaVersion { user_version: CURRENT_SCHEMA_VERSION, migration_version: CURRENT_SCHEMA_VERSION }) {
            self.schema_ready.store(true, Ordering::SeqCst);
            return Ok(());
        }
        Err("Production schema migration did not reach the approved V4 version.".into())
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
        if self.production_runtime && !self.schema_ready.load(Ordering::SeqCst) && !self.migration_active.load(Ordering::SeqCst) {
            return Err("Production database is not at the supported schema version.".into());
        }
        let values = bind_values.into_iter().map(convert_bind).collect::<Result<Vec<_>, _>>()?;
        let connection = self.connection.lock().map_err(|_| "Database connection is unavailable.".to_string())?;
        self.check_transaction(&transaction_id)?;
        let mut statement = connection.prepare(sql).map_err(|error| error.to_string())?;
        let rows_affected = statement.execute(params_from_iter(values.iter())).map_err(|error| error.to_string())?;
        Ok(ExecuteResult { rows_affected, last_insert_id: connection.last_insert_rowid() })
    }

    fn select(&self, sql: &str, bind_values: Vec<JsonValue>, transaction_id: Option<String>) -> Result<Vec<Map<String, JsonValue>>, String> {
        if self.production_runtime && !self.schema_ready.load(Ordering::SeqCst) && !self.migration_active.load(Ordering::SeqCst) && !is_schema_preflight_select(sql) {
            return Err("Production business reads are blocked until the schema migration is authorized and complete.".into());
        }
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
        if self.production_runtime && !self.schema_ready.load(Ordering::SeqCst) && !self.migration_active.load(Ordering::SeqCst) {
            return Err("Production database is not at the supported schema version.".into());
        }
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
fn database_schema_migration_begin(state: State<'_, DatabaseState>) -> Result<(), String> { state.begin_schema_migration() }

#[tauri::command]
fn database_schema_migration_end(state: State<'_, DatabaseState>, succeeded: bool) -> Result<(), String> { state.end_schema_migration(succeeded) }

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

    #[test]
    fn k_forward_schema_guard_rejects_newer_and_mismatched_versions() {
        assert!(ensure_supported_schema(DatabaseSchemaVersion { user_version: 5, migration_version: 5 }).is_err());
        assert!(ensure_supported_schema(DatabaseSchemaVersion { user_version: 5, migration_version: 4 }).is_err());
        assert!(ensure_supported_schema(DatabaseSchemaVersion { user_version: 4, migration_version: 5 }).is_err());
        assert!(ensure_supported_schema(DatabaseSchemaVersion { user_version: 4, migration_version: 4 }).is_ok());
    }

    #[test]
    fn l_production_authorizer_blocks_schema_and_metadata_mutations_outside_gate() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(4); PRAGMA user_version=4; CREATE TABLE sample(value TEXT);").unwrap();
        let db = DatabaseState::from_connection_with_runtime(connection, PathBuf::from(":memory:"), false, true, false, true).unwrap();
        assert!(db.execute("CREATE TABLE forbidden(value TEXT)", vec![], None).is_err());
        assert!(db.execute("UPDATE schema_migrations SET version=5", vec![], None).is_err());
        assert!(db.execute("PRAGMA user_version=5", vec![], None).is_err());
        assert!(db.execute("ATTACH DATABASE ':memory:' AS forbidden", vec![], None).is_err());
        db.execute("INSERT INTO sample(value) VALUES('allowed business DML')", vec![], None).unwrap();
    }

    #[test]
    fn m_authorized_production_migration_window_is_single_use_and_requires_exact_v4() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(3); PRAGMA user_version=3;").unwrap();
        let db = DatabaseState::from_connection_with_runtime(connection, PathBuf::from(":memory:"), false, true, true, false).unwrap();
        assert!(db.select("SELECT version FROM schema_migrations", vec![], None).is_err());
        assert_eq!(db.select("PRAGMA user_version", vec![], None).unwrap()[0]["user_version"], 3);
        db.begin_schema_migration().unwrap();
        db.execute("CREATE TABLE v4_only(value TEXT)", vec![], None).unwrap();
        db.execute("PRAGMA user_version=4", vec![], None).unwrap();
        db.execute("INSERT INTO schema_migrations(version) VALUES(4)", vec![], None).unwrap();
        db.end_schema_migration(true).unwrap();
        assert!(db.begin_schema_migration().is_err());
        assert!(db.execute("CREATE TABLE second_attempt(value TEXT)", vec![], None).is_err());
    }

    #[test]
    fn n_production_migration_window_cannot_mark_an_incomplete_migration_ready() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch("CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(3); PRAGMA user_version=3;").unwrap();
        let db = DatabaseState::from_connection_with_runtime(connection, PathBuf::from(":memory:"), false, true, true, false).unwrap();
        db.begin_schema_migration().unwrap();
        db.execute("CREATE TABLE incomplete(value TEXT)", vec![], None).unwrap();
        assert!(db.end_schema_migration(true).is_err());
        assert!(db.execute("INSERT INTO incomplete VALUES('blocked')", vec![], None).is_err());
        assert!(db.begin_schema_migration().is_err());
    }

    #[test]
    fn o_direct_database_open_refuses_the_production_identity_path_before_opening_it() {
        let home = PathBuf::from(std::env::var_os("HOME").expect("HOME"));
        let path = home.join("Library/Application Support").join(PRODUCTION_IDENTIFIER).join(PRODUCTION_DATABASE);
        assert!(matches!(DatabaseState::open(&path), Err(error) if error.contains("Direct database open is disabled for Production")));
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
            let production_runtime = app.config().identifier == PRODUCTION_IDENTIFIER;
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
            let database_path = if acceptance_runtime { app_data.join(ACCEPTANCE_DATABASE) } else { app_data.join("personal-finance-console.sqlite3") };
            let mut migration_permitted = false;
            let mut schema_ready = true;
            if production_runtime {
                if app_data != home.join("Library/Application Support").join(PRODUCTION_IDENTIFIER) {
                    return Err(std::io::Error::other("Production runtime refused an unexpected application-data path.").into());
                }
                let executable = std::env::current_exe()?;
                let expected_executable = Path::new(PRODUCTION_APP_BUNDLE).join("Contents/MacOS").join(PRODUCTION_EXECUTABLE);
                if executable != expected_executable {
                    return Err(std::io::Error::other("Production identity may run only from the verified normal installed app path.").into());
                }
                let (_, manifest_hash) = validate_runtime_compatibility_manifest(&executable).map_err(std::io::Error::other)?;
                let schema = schema_version_from_path(&database_path).map_err(std::io::Error::other)?;
                ensure_supported_schema(schema).map_err(std::io::Error::other)?;
                if schema.user_version > 0 && schema.user_version < CURRENT_SCHEMA_VERSION {
                    consume_production_migration_authorization(&app_data, &database_path, &home, schema, &executable, &manifest_hash).map_err(std::io::Error::other)?;
                    migration_permitted = true;
                    schema_ready = false;
                } else if schema.user_version == 0 {
                    return Err(std::io::Error::other("Production runtime refuses an uninitialized database; use an approved, separately gated bootstrap.").into());
                }
            }
            std::fs::create_dir_all(&app_data)?;
            if acceptance_runtime && database_path.exists() {
                let canonical_data = app_data.canonicalize()?;
                let canonical_db = database_path.canonicalize()?;
                if canonical_db != canonical_data.join(ACCEPTANCE_DATABASE) {
                    return Err(std::io::Error::other("V4 acceptance runtime refused a redirected database file.").into());
                }
            }
            let connection = Connection::open(&database_path).map_err(std::io::Error::other)?;
            let database = DatabaseState::from_connection_with_runtime(connection, database_path, acceptance_runtime, production_runtime, migration_permitted, schema_ready).map_err(std::io::Error::other)?;
            app.manage(database);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![database_open, database_execute, database_select, database_begin, database_commit, database_rollback, database_schema_migration_begin, database_schema_migration_end, acceptance_runtime_info, acceptance_reset])
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
