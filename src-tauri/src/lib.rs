use rusqlite::{hooks::{AuthAction, AuthContext, Authorization}, params_from_iter, types::{Value as SqlValue, ValueRef}, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Number, Value as JsonValue};
use sha2::{Digest, Sha256};
use std::{io::{Read, Write}, os::unix::fs::MetadataExt, path::{Path, PathBuf}, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, time::Duration};
use tauri::{Manager, State};

mod cutover_startup;
mod production_cutover_state;
mod startup_exclusion;
mod wp02_preview_isolation;
#[cfg(feature = "wp03-preview")]
mod wp03_preview_isolation;
#[cfg(feature = "wp03-preview")]
mod wp03_preview_test_date;

#[cfg(any(all(feature = "wp02-preview", feature = "v4-acceptance"), all(feature = "wp02-preview", feature = "quiescence-tauri"), all(feature = "wp02-preview", feature = "quiescence-fixture")))]
compile_error!("wp02-preview cannot be combined with another dedicated runtime feature");

#[cfg(any(all(feature = "wp03-preview", feature = "wp02-preview"), all(feature = "wp03-preview", feature = "v4-acceptance"), all(feature = "wp03-preview", feature = "quiescence-tauri"), all(feature = "wp03-preview", feature = "quiescence-fixture")))]
compile_error!("wp03-preview cannot be combined with another dedicated runtime feature");

const PRODUCTION_IDENTIFIER: &str = "com.personalfinance.console";
const SMOKE_IDENTIFIER: &str = "com.personalfinance.console.smoke";
const ACCEPTANCE_IDENTIFIER: &str = "com.personalfinance.console.v4acceptance";
const ACCEPTANCE_DATABASE: &str = "personal-finance-console-v4-acceptance.sqlite3";
const PRODUCTION_DATABASE: &str = "personal-finance-console.sqlite3";
const CURRENT_SCHEMA_VERSION: i64 = 4;
const RUNTIME_COMPATIBILITY_MANIFEST: &str = "runtime-compatibility.json";
const PRODUCTION_MIGRATION_AUTHORIZATION: &str = "production-v4-migration-authorization.json";
const PRODUCTION_RELEASE_RECEIPT: &str = "production-v4-release-receipt.json";
const CONSUMED_AUTHORIZATION_LEDGER: &str = "production-v4-consumed-authorizations.json";
const PRODUCTION_APP_BUNDLE: &str = "/Applications/Personal Finance Console.app";
const PRODUCTION_EXECUTABLE: &str = "personal-finance-console";

fn ensure_no_unresolved_cutover(app_data: &Path) -> Result<(), String> {
    let decision = cutover_startup::inspect(app_data);
    if decision.ordinary_startup_allowed { return Ok(()); }
    Err(serde_json::to_string(&decision).unwrap_or_else(|_| "CUTOVER_STATE_UNKNOWN".into()))
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct DatabaseSchemaVersion { user_version: i64, migration_version: i64 }

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ProductionMigrationAuthorization {
    receipt_format_version: u32,
    status: String,
    synthetic_only: bool,
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
    sidecars_absent: bool,
    release_receipt_path: String,
    release_receipt_sha256: String,
    candidate_approval_sha256: String,
    migration_authorization_sha256: String,
    owner_authorization_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ConsumedAuthorization {
    authorization_id: String,
    nonce: String,
    consumed_at_unix: u64,
    candidate_executable_sha256: String,
    compatibility_manifest_sha256: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct ProductionCutoverTerminal {
    format_version: u32,
    domain: String,
    synthetic_only: bool,
    state: String,
    authorization_id: String,
    nonce: String,
    consumed_at_unix: u64,
    migration_authorization_sha256: String,
    migration_authorization_contract_sha256: String,
    release_receipt_path: String,
    release_receipt_sha256: String,
    consumed_ledger_path: String,
    consumed_ledger_sha256: String,
    candidate_executable_path: String,
    candidate_executable_sha256: String,
    compatibility_manifest_path: String,
    compatibility_manifest_sha256: String,
    database_path: String,
    database_device: u64,
    database_inode: u64,
    database_pre_migration_sha256: String,
    database_post_migration_sha256: String,
    backup_path: String,
    backup_device: u64,
    backup_inode: u64,
    backup_sha256: String,
    source_user_version: i64,
    source_migration_version: i64,
    target_user_version: i64,
    target_migration_version: i64,
    migration_rows: Vec<i64>,
    migration4_row_count: u32,
    integrity_check: String,
    foreign_key_violation_count: u64,
    sidecars_absent: bool,
}

#[derive(Clone, Debug)]
struct ProductionMigrationAuthority {
    authorization: ConsumedAuthorization,
    migration_authorization_sha256: String,
    migration_authorization_contract_sha256: String,
    release_receipt_path: PathBuf,
    release_receipt_sha256: String,
    consumed_ledger_path: PathBuf,
    consumed_ledger_sha256: String,
    candidate_executable_path: PathBuf,
    compatibility_manifest_path: PathBuf,
    database_path: PathBuf,
    database_device: u64,
    database_inode: u64,
    database_pre_migration_sha256: String,
    backup_path: PathBuf,
    backup_device: u64,
    backup_inode: u64,
    backup_sha256: String,
}

#[derive(Clone, Debug)]
struct ProductionMigrationReadback {
    schema: DatabaseSchemaVersion,
    migration_rows: Vec<i64>,
    migration4_row_count: u32,
    integrity_check: String,
    foreign_key_violation_count: u64,
    sidecars_absent: bool,
    database_sha256: String,
    database_device: u64,
    database_inode: u64,
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
    match std::fs::symlink_metadata(path) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(DatabaseSchemaVersion { user_version: 0, migration_version: 0 });
        }
        Err(error) => return Err(format!("Database metadata is unavailable: {error}")),
        Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.nlink() != 1 => {
            return Err("Database path is not a single-link regular file.".into());
        }
        Ok(_) => (),
    }
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

fn database_sidecars(database_path: &Path) -> Result<Vec<PathBuf>, String> {
    let mut found = Vec::new();
    for suffix in ["-wal", "-shm", "-journal"] {
        let path = PathBuf::from(format!("{}{}", database_path.display(), suffix));
        match std::fs::symlink_metadata(&path) {
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => (),
            Err(error) => return Err(format!("SQLite sidecar metadata is unavailable for {}: {error}", path.display())),
            Ok(metadata) if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.nlink() != 1 => {
                return Err(format!("SQLite sidecar has an unsafe identity: {}", path.display()));
            }
            Ok(_) => found.push(path),
        }
    }
    Ok(found)
}

fn production_schema_version_from_path(path: &Path) -> Result<DatabaseSchemaVersion, String> {
    if !database_sidecars(path)?.is_empty() {
        return Err("Production SQLite sidecar exists; database open is blocked.".into());
    }
    schema_version_from_path(path)
}

fn persist_consumed_authorization(ledger_path: &Path, consumed: ConsumedAuthorization) -> Result<(), String> {
    let lock_path = ledger_path.with_extension("json.lock");
    let mut lock_options = std::fs::OpenOptions::new();
    lock_options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        lock_options.mode(0o600);
    }
    let lock = lock_options.open(&lock_path).map_err(|error| format!("Consumed-authorization ledger lock unavailable: {error}"))?;
    let result = (|| {
        let mut records: Vec<ConsumedAuthorization> = if ledger_path.exists() {
            let metadata = std::fs::metadata(ledger_path).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if metadata.permissions().mode() & 0o077 != 0 { return Err("Consumed-authorization ledger permissions must be Owner-only.".into()); }
            }
            serde_json::from_slice(&std::fs::read(ledger_path).map_err(|error| error.to_string())?).map_err(|error| format!("Consumed-authorization ledger is unreadable: {error}"))?
        } else { Vec::new() };
        if records.iter().any(|record| record.authorization_id == consumed.authorization_id || record.nonce == consumed.nonce) {
            return Err("Production migration authorization or nonce was already consumed.".into());
        }
        records.push(consumed);
        let temporary_path = ledger_path.with_extension(format!("json.tmp-{}", std::process::id()));
        let mut options = std::fs::OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut temporary = options.open(&temporary_path).map_err(|error| error.to_string())?;
        serde_json::to_writer_pretty(&mut temporary, &records).map_err(|error| error.to_string())?;
        temporary.write_all(b"\n").map_err(|error| error.to_string())?;
        temporary.sync_all().map_err(|error| error.to_string())?;
        std::fs::rename(&temporary_path, ledger_path).map_err(|error| error.to_string())?;
        if let Some(parent) = ledger_path.parent() {
            std::fs::File::open(parent).and_then(|directory| directory.sync_all()).map_err(|error| error.to_string())?;
        }
        Ok(())
    })();
    drop(lock);
    let _ = std::fs::remove_file(lock_path);
    result
}

fn consume_production_migration_authorization_at(
    app_data: &Path,
    database_path: &Path,
    expected_app: &Path,
    expected_database: &Path,
    schema: DatabaseSchemaVersion,
    executable: &Path,
    runtime_executable: &Path,
    manifest_sha256: &str,
    allow_synthetic: bool,
) -> Result<ProductionMigrationAuthority, String> {
    if schema != (DatabaseSchemaVersion { user_version: 3, migration_version: 3 }) {
        return Err("Production V4 migration is supported only from a consistent V3 database.".into());
    }
    if app_data != expected_database.parent().unwrap_or(Path::new("")) || database_path != expected_database || database_path.file_name().and_then(|name| name.to_str()) != Some(PRODUCTION_DATABASE) {
        return Err("Production migration refused an unexpected app-data or database path.".into());
    }
    let expected_executable = expected_app.join("Contents/MacOS").join(PRODUCTION_EXECUTABLE);
    if executable != expected_executable {
        return Err("Production migration must start from the approved installed app path.".into());
    }
    if runtime_executable != expected_executable {
        return Err("Production runtime executable does not match the fixed installed executable path.".into());
    }

    let authorization_path = app_data.join(PRODUCTION_MIGRATION_AUTHORIZATION);
    let claim_nonce = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|error| error.to_string())?.as_nanos();
    let claimed_path = app_data.join(format!(".{PRODUCTION_MIGRATION_AUTHORIZATION}.claimed-{}-{claim_nonce}", std::process::id()));
    std::fs::rename(&authorization_path, &claimed_path).map_err(|_| "Production V4 migration is blocked: no unconsumed release-gate authorization is present.".to_string())?;
    let result = (|| {
        let claimed_name = claimed_path.file_name().and_then(|name| name.to_str()).ok_or("Production authorization claim name is invalid.")?;
        let authorization_bytes = production_cutover_state::read_authority_file(app_data, claimed_name)?
            .ok_or("Production migration authorization claim disappeared.")?;
        let migration_authorization_sha256 = format!("{:x}", Sha256::digest(&authorization_bytes));
        let authorization: ProductionMigrationAuthorization = serde_json::from_slice(&authorization_bytes).map_err(|error| error.to_string())?;
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|error| error.to_string())?.as_secs();
        let current_executable = runtime_executable;
        let current_executable_hash = sha256_file(&current_executable)?;
        let manifest_path = production_manifest_path(&current_executable)?;
        let current_database_hash = sha256_file(database_path)?;
        let backup_path = PathBuf::from(&authorization.backup_path);
        let expected_backup_root = app_data.join("production-v4-backups");
        let current_manifest_hash = sha256_file(&manifest_path)?;
        let sidecars = database_sidecars(database_path)?;
        let release_receipt_path = app_data.join(PRODUCTION_RELEASE_RECEIPT);
        let receipt_metadata = std::fs::symlink_metadata(&release_receipt_path).map_err(|error| format!("Persisted release receipt is missing: {error}"))?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if receipt_metadata.permissions().mode() & 0o077 != 0 { return Err("Release receipt permissions must be Owner-only.".into()); }
        }
        if !receipt_metadata.is_file() || receipt_metadata.file_type().is_symlink() || receipt_metadata.nlink() != 1 {
            return Err("Release receipt must be a single-link regular file.".into());
        }
        let receipt_bytes = std::fs::read(&release_receipt_path).map_err(|error| error.to_string())?;
        let receipt_hash = format!("{:x}", Sha256::digest(&receipt_bytes));
        let receipt: JsonValue = serde_json::from_slice(&receipt_bytes).map_err(|error| format!("Release receipt is invalid: {error}"))?;
        let synthetic_root = if allow_synthetic {
            let temporary = std::env::temp_dir().canonicalize().map_err(|error| error.to_string())?;
            let mut current = expected_app;
            let mut found = None;
            while let Some(parent) = current.parent() {
                if parent.join("SYNTHETIC_ONLY").exists() { found = Some(parent.to_path_buf()); break; }
                current = parent;
            }
            let root = found.ok_or("Synthetic gate root marker is missing.")?;
            if root == temporary || !root.starts_with(&temporary) || root.to_string_lossy().contains(PRODUCTION_IDENTIFIER) {
                return Err("Synthetic gate root is outside the isolated temporary namespace.".into());
            }
            let marker = std::fs::read(root.join("SYNTHETIC_ONLY")).map_err(|error| error.to_string())?;
            if marker != b"PFC_WP04R2A_GATE_SYNTHETIC_V1\n" { return Err("Synthetic gate marker is invalid.".into()); }
            Some(root)
        } else { None };
        if authorization.synthetic_only != allow_synthetic ||
            authorization.release_receipt_path != release_receipt_path.to_string_lossy() ||
            authorization.release_receipt_sha256 != receipt_hash ||
            receipt.get("status").and_then(JsonValue::as_str) != Some("PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION") ||
            receipt.get("syntheticOnly").and_then(JsonValue::as_bool) != Some(allow_synthetic) ||
            receipt.get("releaseReceiptPath").and_then(JsonValue::as_str) != Some(release_receipt_path.to_string_lossy().as_ref()) ||
            receipt.get("candidateApprovalSha256").and_then(JsonValue::as_str) != Some(authorization.candidate_approval_sha256.as_str()) ||
            receipt.get("migrationAuthorizationSha256").and_then(JsonValue::as_str) != Some(authorization.migration_authorization_sha256.as_str()) ||
            receipt.get("productionDatabasePreMigrationSha256").and_then(JsonValue::as_str) != Some(authorization.production_database_pre_migration_sha256.as_str()) ||
            receipt.get("candidateExecutableSha256").and_then(JsonValue::as_str) != Some(authorization.candidate_executable_sha256.as_str()) ||
            receipt.get("compatibilityManifestSha256").and_then(JsonValue::as_str) != Some(authorization.compatibility_manifest_sha256.as_str()) {
            return Err("Migration permit is not bound to the exact persisted release receipt or authorization domain.".into());
        }
        if let Some(root) = synthetic_root {
            if !release_receipt_path.starts_with(&root) || !database_path.starts_with(&root) || !expected_app.starts_with(&root) {
                return Err("Synthetic gate artifacts escaped their marked root.".into());
            }
        }
        if authorization.receipt_format_version != 1 || authorization.status != "ONE_TIME_PRODUCTION_V4_MIGRATION_AUTHORIZATION" ||
            authorization.nonce.is_empty() ||
            authorization.issued_at_unix > now || authorization.expires_at_unix < now || authorization.expires_at_unix - authorization.issued_at_unix > 120 ||
            authorization.production_bundle_id != PRODUCTION_IDENTIFIER || authorization.installed_app_path != expected_app.to_string_lossy() ||
            authorization.candidate_executable_path != current_executable.to_string_lossy() || authorization.candidate_executable_sha256 != current_executable_hash ||
            authorization.compatibility_manifest_sha256 != current_manifest_hash || authorization.compatibility_manifest_sha256 != manifest_sha256 ||
            authorization.max_supported_schema_version != CURRENT_SCHEMA_VERSION || authorization.production_database_path != database_path.to_string_lossy() ||
            authorization.production_database_pre_migration_sha256 != current_database_hash ||
            !authorization.sidecars_absent || !sidecars.is_empty() ||
            authorization.production_schema.user_version != schema.user_version || authorization.production_schema.migration_version != schema.migration_version ||
            !backup_path.starts_with(&expected_backup_root) || backup_path == database_path ||
            !backup_path.is_file() || sha256_file(&backup_path)? != authorization.backup_sha256 || authorization.backup_sha256 != current_database_hash ||
            authorization.owner_authorization_id.as_deref().unwrap_or("").is_empty() {
            return Err("Production V4 migration authorization facts no longer match the runtime, database, backup, manifest, or Owner authorization.".into());
        }
        let authorization_id = authorization.owner_authorization_id.clone().filter(|value| !value.trim().is_empty()).ok_or("Owner migration authorization ID is missing.")?;
        let consumed = ConsumedAuthorization {
            authorization_id,
            nonce: authorization.nonce.clone(),
            consumed_at_unix: now,
            candidate_executable_sha256: current_executable_hash,
            compatibility_manifest_sha256: current_manifest_hash,
        };
        let ledger_path = app_data.join(CONSUMED_AUTHORIZATION_LEDGER);
        persist_consumed_authorization(&ledger_path, consumed.clone())?;
        let consumed_ledger_sha256 = sha256_file(&ledger_path)?;
        let database_metadata = std::fs::symlink_metadata(database_path).map_err(|error| error.to_string())?;
        let backup_metadata = std::fs::symlink_metadata(&backup_path).map_err(|error| error.to_string())?;
        Ok(ProductionMigrationAuthority {
            authorization: consumed,
            migration_authorization_sha256,
            migration_authorization_contract_sha256: authorization.migration_authorization_sha256,
            release_receipt_path: release_receipt_path.canonicalize().map_err(|error| error.to_string())?,
            release_receipt_sha256: receipt_hash,
            consumed_ledger_path: ledger_path,
            consumed_ledger_sha256,
            candidate_executable_path: current_executable.to_path_buf(),
            compatibility_manifest_path: manifest_path,
            database_path: database_path.to_path_buf(),
            database_device: database_metadata.dev(),
            database_inode: database_metadata.ino(),
            database_pre_migration_sha256: current_database_hash,
            backup_path: backup_path.canonicalize().map_err(|error| error.to_string())?,
            backup_device: backup_metadata.dev(),
            backup_inode: backup_metadata.ino(),
            backup_sha256: authorization.backup_sha256,
        })
    })();
    let _ = std::fs::remove_file(&claimed_path);
    result
}

#[cfg(feature = "quiescence-fixture")]
pub fn consume_synthetic_gate_authorization(root: &Path) -> Result<JsonValue, String> {
    let root = root.canonicalize().map_err(|error| error.to_string())?;
    let temporary = std::env::temp_dir().canonicalize().map_err(|error| error.to_string())?;
    if root == temporary || !root.starts_with(&temporary) || root.to_string_lossy().contains(PRODUCTION_IDENTIFIER) {
        return Err("Synthetic gate root must be an isolated temporary child.".into());
    }
    let marker_path = root.join("SYNTHETIC_ONLY");
    let marker_meta = std::fs::symlink_metadata(&marker_path).map_err(|error| error.to_string())?;
    if !marker_meta.is_file() || marker_meta.file_type().is_symlink() || marker_meta.nlink() != 1 ||
        std::fs::read(&marker_path).map_err(|error| error.to_string())? != b"PFC_WP04R2A_GATE_SYNTHETIC_V1\n" {
        return Err("Synthetic gate marker is unsafe or invalid.".into());
    }
    let app_data = root.join("Library/Application Support").join(PRODUCTION_IDENTIFIER);
    let database_path = app_data.join(PRODUCTION_DATABASE);
    let expected_app = root.join("Applications").join("Personal Finance Console.app");
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let expected_executable = expected_app.join("Contents/MacOS").join(PRODUCTION_EXECUTABLE);
    if executable != expected_executable {
        return Err("Synthetic consumer must run from the exact marked candidate bundle.".into());
    }
    let (_, manifest_hash) = validate_runtime_compatibility_manifest(&executable)?;
    let schema = production_schema_version_from_path(&database_path)?;
    let _ = consume_production_migration_authorization_at(
        &app_data, &database_path, &expected_app, &database_path, schema,
        &executable, &executable, &manifest_hash, true,
    )?;
    Ok(serde_json::json!({
        "event": "gate_permit_consumed",
        "status": "AUTHORIZATION_CONSUMED_NATIVE_MIGRATION_PENDING",
        "syntheticOnly": true,
        "migration4Executed": false,
        "ledgerPath": app_data.join(CONSUMED_AUTHORIZATION_LEDGER),
    }))
}

fn read_production_v4_readback(database_path: &Path) -> Result<ProductionMigrationReadback, String> {
    let sidecars = database_sidecars(database_path)?;
    if !sidecars.is_empty() { return Err("SQLite sidecar appeared after native Migration 4.".into()); }
    let metadata = std::fs::symlink_metadata(database_path).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || metadata.nlink() != 1 {
        return Err("Production database identity is unsafe after Migration 4.".into());
    }
    let connection = Connection::open_with_flags(database_path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_NOFOLLOW)
        .map_err(|error| error.to_string())?;
    let schema = schema_version_from_connection(&connection)?;
    let migration_rows = {
        let mut statement = connection.prepare("SELECT version FROM schema_migrations ORDER BY version")
            .map_err(|error| error.to_string())?;
        let values = statement.query_map([], |row| row.get::<_, i64>(0)).map_err(|error| error.to_string())?;
        values.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?
    };
    let migration4_row_count: u32 = connection.query_row("SELECT COUNT(*) FROM schema_migrations WHERE version=4", [], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?.try_into().map_err(|_| "Migration 4 row count is invalid.")?;
    let integrity_check: String = connection.query_row("PRAGMA integrity_check", [], |row| row.get(0)).map_err(|error| error.to_string())?;
    let foreign_key_violation_count = {
        let mut statement = connection.prepare("PRAGMA foreign_key_check").map_err(|error| error.to_string())?;
        let rows = statement.query_map([], |_| Ok(())).map_err(|error| error.to_string())?;
        rows.collect::<Result<Vec<_>, _>>().map_err(|error| error.to_string())?.len() as u64
    };
    drop(connection);
    if schema != (DatabaseSchemaVersion { user_version: 4, migration_version: 4 }) || migration_rows != [1, 2, 3, 4]
        || migration4_row_count != 1 || integrity_check != "ok" || foreign_key_violation_count != 0 {
        return Err("Production Migration 4 readback did not satisfy the durable V4 terminal contract.".into());
    }
    let final_metadata = std::fs::symlink_metadata(database_path).map_err(|error| error.to_string())?;
    if !database_sidecars(database_path)?.is_empty() {
        return Err("SQLite sidecar appeared during post-migration readback.".into());
    }
    if (metadata.dev(), metadata.ino(), metadata.nlink()) != (final_metadata.dev(), final_metadata.ino(), final_metadata.nlink()) {
        return Err("Production database identity changed during post-migration readback.".into());
    }
    Ok(ProductionMigrationReadback {
        schema, migration_rows, migration4_row_count, integrity_check, foreign_key_violation_count,
        sidecars_absent: true, database_sha256: sha256_file(database_path)?,
        database_device: final_metadata.dev(), database_inode: final_metadata.ino(),
    })
}

fn native_migration4(database_path: &Path, expected_sha256: &str) -> Result<ProductionMigrationReadback, String> {
    if !database_sidecars(database_path)?.is_empty() {
        return Err("Production SQLite sidecar exists before native Migration 4.".into());
    }
    let before = std::fs::symlink_metadata(database_path).map_err(|error| error.to_string())?;
    if !before.is_file() || before.file_type().is_symlink() || before.nlink() != 1 || sha256_file(database_path)? != expected_sha256 {
        return Err("Native Migration 4 refused a changed database identity or byte hash.".into());
    }
    let connection = Connection::open_with_flags(
        database_path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    ).map_err(|error| error.to_string())?;
    connection.busy_timeout(Duration::ZERO).map_err(|error| error.to_string())?;
    connection.set_db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, true).map_err(|error| error.to_string())?;
    if !connection.db_config(rusqlite::config::DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE).map_err(|error| error.to_string())? {
        return Err("SQLite checkpoint-on-close protection could not be established.".into());
    }
    connection.execute_batch("PRAGMA wal_autocheckpoint=0; PRAGMA foreign_keys=ON; PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON;")
        .map_err(|error| error.to_string())?;
    for (pragma, expected) in [("busy_timeout", 0), ("wal_autocheckpoint", 0), ("foreign_keys", 1), ("synchronous", 2), ("fullfsync", 1)] {
        let actual: i64 = connection.query_row(&format!("PRAGMA {pragma}"), [], |row| row.get(0)).map_err(|error| error.to_string())?;
        if actual != expected { return Err(format!("SQLite migration profile mismatch for {pragma}: {actual}")); }
    }
    let journal: String = connection.query_row("PRAGMA journal_mode", [], |row| row.get(0)).map_err(|error| error.to_string())?;
    let locking: String = connection.query_row("PRAGMA locking_mode", [], |row| row.get(0)).map_err(|error| error.to_string())?;
    if journal != "delete" || locking != "exclusive" { return Err("Native Migration 4 requires DELETE journal and EXCLUSIVE locking.".into()); }
    connection.execute_batch("BEGIN EXCLUSIVE").map_err(|error| error.to_string())?;
    let result = (|| {
        let after_lock = std::fs::symlink_metadata(database_path).map_err(|error| error.to_string())?;
        if (before.dev(), before.ino(), before.nlink()) != (after_lock.dev(), after_lock.ino(), after_lock.nlink()) ||
            sha256_file(database_path)? != expected_sha256 ||
            schema_version_from_connection(&connection)? != (DatabaseSchemaVersion { user_version: 3, migration_version: 3 }) {
            return Err("Native Migration 4 locked revalidation did not match the authorized V3 database.".into());
        }
        connection.execute_batch(include_str!("../../migrations/004.sql")).map_err(|error| error.to_string())?;
        connection.execute("INSERT INTO schema_migrations(version, applied_at) VALUES(4, strftime('%Y-%m-%dT%H:%M:%fZ','now'))", [])
            .map_err(|error| error.to_string())?;
        if schema_version_from_connection(&connection)? != (DatabaseSchemaVersion { user_version: 4, migration_version: 4 }) {
            return Err("Native Migration 4 did not reach consistent V4 schema authorities.".into());
        }
        connection.execute_batch("COMMIT").map_err(|error| error.to_string())?;
        Ok(())
    })();
    if let Err(error) = result {
        if !connection.is_autocommit() { let _ = connection.execute_batch("ROLLBACK"); }
        return Err(error);
    }
    drop(connection);
    read_production_v4_readback(database_path)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProductionMigrationCheckpoint { AfterPostReadbackBeforeTerminal, BeforeTerminalWrite, BeforeTerminalFileSync, BeforeTerminalDirectorySync, AfterTerminalDurableReadback }

fn make_production_terminal(authority: &ProductionMigrationAuthority, post: &ProductionMigrationReadback, synthetic_only: bool) -> ProductionCutoverTerminal {
    ProductionCutoverTerminal {
        format_version: 1, domain: "PRODUCTION".into(), synthetic_only, state: "V4_VERIFIED".into(),
        authorization_id: authority.authorization.authorization_id.clone(), nonce: authority.authorization.nonce.clone(),
        consumed_at_unix: authority.authorization.consumed_at_unix,
        migration_authorization_sha256: authority.migration_authorization_sha256.clone(),
        migration_authorization_contract_sha256: authority.migration_authorization_contract_sha256.clone(),
        release_receipt_path: authority.release_receipt_path.to_string_lossy().into_owned(),
        release_receipt_sha256: authority.release_receipt_sha256.clone(),
        consumed_ledger_path: authority.consumed_ledger_path.to_string_lossy().into_owned(),
        consumed_ledger_sha256: authority.consumed_ledger_sha256.clone(),
        candidate_executable_path: authority.candidate_executable_path.to_string_lossy().into_owned(),
        candidate_executable_sha256: authority.authorization.candidate_executable_sha256.clone(),
        compatibility_manifest_path: authority.compatibility_manifest_path.to_string_lossy().into_owned(),
        compatibility_manifest_sha256: authority.authorization.compatibility_manifest_sha256.clone(),
        database_path: authority.database_path.to_string_lossy().into_owned(),
        database_device: post.database_device, database_inode: post.database_inode,
        database_pre_migration_sha256: authority.database_pre_migration_sha256.clone(),
        database_post_migration_sha256: post.database_sha256.clone(),
        backup_path: authority.backup_path.to_string_lossy().into_owned(),
        backup_device: authority.backup_device, backup_inode: authority.backup_inode, backup_sha256: authority.backup_sha256.clone(),
        source_user_version: 3, source_migration_version: 3,
        target_user_version: post.schema.user_version, target_migration_version: post.schema.migration_version,
        migration_rows: post.migration_rows.clone(), migration4_row_count: post.migration4_row_count,
        integrity_check: post.integrity_check.clone(), foreign_key_violation_count: post.foreign_key_violation_count,
        sidecars_absent: post.sidecars_absent,
    }
}

fn validate_production_terminal(
    app_data: &Path, database_path: &Path, executable: &Path, terminal: &ProductionCutoverTerminal, synthetic_only: bool,
) -> Result<(), String> {
    if terminal.format_version != 1 || terminal.domain != "PRODUCTION" || terminal.synthetic_only != synthetic_only
        || terminal.state != "V4_VERIFIED" || terminal.authorization_id.is_empty() || terminal.nonce.is_empty()
        || terminal.source_user_version != 3 || terminal.source_migration_version != 3
        || terminal.target_user_version != 4 || terminal.target_migration_version != 4
        || terminal.migration_rows != [1, 2, 3, 4] || terminal.migration4_row_count != 1
        || terminal.integrity_check != "ok" || terminal.foreign_key_violation_count != 0 || !terminal.sidecars_absent {
        return Err("PRODUCTION_TERMINAL_CONTRACT_INVALID".into());
    }
    let canonical_app_data = app_data.canonicalize().map_err(|error| error.to_string())?;
    if canonical_app_data != app_data || terminal.database_path != database_path.to_string_lossy()
        || database_path.parent() != Some(app_data) || database_path.file_name().and_then(|name| name.to_str()) != Some(PRODUCTION_DATABASE) {
        return Err("PRODUCTION_TERMINAL_DATABASE_PATH_MISMATCH".into());
    }
    let expected_manifest = production_manifest_path(executable)?;
    if terminal.candidate_executable_path != executable.to_string_lossy()
        || terminal.compatibility_manifest_path != expected_manifest.to_string_lossy()
        || sha256_file(executable)? != terminal.candidate_executable_sha256
        || sha256_file(&expected_manifest)? != terminal.compatibility_manifest_sha256 {
        return Err("PRODUCTION_TERMINAL_CANDIDATE_BINDING_MISMATCH".into());
    }
    let receipt_path = app_data.join(PRODUCTION_RELEASE_RECEIPT);
    if terminal.release_receipt_path != receipt_path.to_string_lossy() {
        return Err("PRODUCTION_TERMINAL_RECEIPT_PATH_MISMATCH".into());
    }
    let receipt_bytes = production_cutover_state::read_authority_file(app_data, PRODUCTION_RELEASE_RECEIPT)?
        .ok_or("PRODUCTION_TERMINAL_RELEASE_RECEIPT_MISSING")?;
    if format!("{:x}", Sha256::digest(&receipt_bytes)) != terminal.release_receipt_sha256 {
        return Err("PRODUCTION_TERMINAL_RELEASE_RECEIPT_STALE".into());
    }
    let receipt: JsonValue = serde_json::from_slice(&receipt_bytes).map_err(|_| "PRODUCTION_TERMINAL_RELEASE_RECEIPT_CORRUPT")?;
    let installed_app_path = executable.parent().and_then(Path::parent).and_then(Path::parent)
        .ok_or("PRODUCTION_TERMINAL_CANDIDATE_APP_PATH_INVALID")?;
    let expected_backup_path = app_data.join("production-v4-backups").join(PRODUCTION_DATABASE);
    for (field, expected) in [
        ("productionBundleId", PRODUCTION_IDENTIFIER),
        ("installedAppPath", installed_app_path.to_string_lossy().as_ref()),
        ("candidateExecutablePath", executable.to_string_lossy().as_ref()),
        ("productionDatabasePath", database_path.to_string_lossy().as_ref()),
        ("releaseReceiptPath", receipt_path.to_string_lossy().as_ref()),
        ("backupPath", expected_backup_path.to_string_lossy().as_ref()),
        ("candidateExecutableSha256", terminal.candidate_executable_sha256.as_str()),
        ("compatibilityManifestSha256", terminal.compatibility_manifest_sha256.as_str()),
        ("productionDatabasePreMigrationSha256", terminal.database_pre_migration_sha256.as_str()),
        ("backupSha256", terminal.backup_sha256.as_str()),
        ("migrationAuthorizationSha256", terminal.migration_authorization_contract_sha256.as_str()),
        ("ownerAuthorizationId", terminal.authorization_id.as_str()),
    ] {
        if receipt.get(field).and_then(JsonValue::as_str) != Some(expected) {
            return Err(format!("PRODUCTION_TERMINAL_RECEIPT_BINDING_MISMATCH:{field}"));
        }
    }
    if receipt.get("syntheticOnly").and_then(JsonValue::as_bool) != Some(synthetic_only)
        || receipt.get("sidecarsAbsent").and_then(JsonValue::as_bool) != Some(true)
        || receipt["productionSchema"]["userVersion"].as_i64() != Some(3)
        || receipt["productionSchema"]["migrationVersion"].as_i64() != Some(3)
    {
        return Err("PRODUCTION_TERMINAL_RELEASE_RECEIPT_SCOPE_MISMATCH".into());
    }
    let ledger_path = app_data.join(CONSUMED_AUTHORIZATION_LEDGER);
    if terminal.consumed_ledger_path != ledger_path.to_string_lossy() {
        return Err("PRODUCTION_TERMINAL_LEDGER_PATH_MISMATCH".into());
    }
    let ledger_bytes = production_cutover_state::read_authority_file(app_data, CONSUMED_AUTHORIZATION_LEDGER)?
        .ok_or("PRODUCTION_TERMINAL_CONSUMED_LEDGER_MISSING")?;
    if format!("{:x}", Sha256::digest(&ledger_bytes)) != terminal.consumed_ledger_sha256 {
        return Err("PRODUCTION_TERMINAL_CONSUMED_LEDGER_STALE".into());
    }
    let ledger: Vec<ConsumedAuthorization> = serde_json::from_slice(&ledger_bytes).map_err(|_| "PRODUCTION_TERMINAL_CONSUMED_LEDGER_CORRUPT")?;
    if ledger.len() != 1 || ledger[0] != (ConsumedAuthorization {
        authorization_id: terminal.authorization_id.clone(), nonce: terminal.nonce.clone(),
        consumed_at_unix: terminal.consumed_at_unix,
        candidate_executable_sha256: terminal.candidate_executable_sha256.clone(),
        compatibility_manifest_sha256: terminal.compatibility_manifest_sha256.clone(),
    }) {
        return Err("PRODUCTION_TERMINAL_CONSUMED_LEDGER_BINDING_MISMATCH".into());
    }
    if production_cutover_state::read_authority_file(app_data, PRODUCTION_MIGRATION_AUTHORIZATION)?.is_some() {
        return Err("PRODUCTION_TERMINAL_PERMIT_RESURRECTED".into());
    }
    let backup_path = expected_backup_path;
    if terminal.backup_path != backup_path.canonicalize().map_err(|error| error.to_string())?.to_string_lossy() {
        return Err("PRODUCTION_TERMINAL_BACKUP_PATH_MISMATCH".into());
    }
    let backup_meta = std::fs::symlink_metadata(&backup_path).map_err(|_| "PRODUCTION_TERMINAL_BACKUP_MISSING")?;
    if !backup_meta.is_file() || backup_meta.file_type().is_symlink() || backup_meta.nlink() != 1
        || backup_meta.dev() != terminal.backup_device || backup_meta.ino() != terminal.backup_inode
        || sha256_file(&backup_path)? != terminal.backup_sha256
        || terminal.backup_sha256 != terminal.database_pre_migration_sha256 {
        return Err("PRODUCTION_TERMINAL_BACKUP_BINDING_MISMATCH".into());
    }
    let database_meta = std::fs::symlink_metadata(database_path).map_err(|_| "PRODUCTION_TERMINAL_DATABASE_MISSING")?;
    if !database_meta.is_file() || database_meta.file_type().is_symlink() || database_meta.nlink() != 1
        || database_meta.dev() != terminal.database_device || database_meta.ino() != terminal.database_inode {
        return Err("PRODUCTION_TERMINAL_DATABASE_IDENTITY_MISMATCH".into());
    }
    let current = read_production_v4_readback(database_path)?;
    if current.schema.user_version != terminal.target_user_version || current.schema.migration_version != terminal.target_migration_version
        || current.migration_rows != terminal.migration_rows || current.migration4_row_count != terminal.migration4_row_count
        || current.integrity_check != terminal.integrity_check || current.foreign_key_violation_count != terminal.foreign_key_violation_count
        || !current.sidecars_absent {
        return Err("PRODUCTION_TERMINAL_DATABASE_READBACK_MISMATCH".into());
    }
    Ok(())
}

fn ensure_production_cutover_startup(app_data: &Path, database_path: &Path, executable: &Path, synthetic_only: bool) -> Result<(), String> {
    let claimed = production_cutover_state::claimed_authorization_present(app_data)?;
    let terminal_bytes = production_cutover_state::read_terminal(app_data)?;
    let ledger = production_cutover_state::read_authority_file(app_data, CONSUMED_AUTHORIZATION_LEDGER)?;
    let has_permit = production_cutover_state::read_authority_file(app_data, PRODUCTION_MIGRATION_AUTHORIZATION)?.is_some();
    if claimed { return Err("PRODUCTION_CUTOVER_AUTHORIZATION_CLAIM_UNRESOLVED".into()); }
    if let Some(bytes) = terminal_bytes {
        if ledger.is_none() || has_permit { return Err("PRODUCTION_CUTOVER_TERMINAL_AUTHORITY_INCOMPLETE".into()); }
        let terminal: ProductionCutoverTerminal = serde_json::from_slice(&bytes).map_err(|_| "PRODUCTION_CUTOVER_TERMINAL_CORRUPT")?;
        return validate_production_terminal(app_data, database_path, executable, &terminal, synthetic_only);
    }
    if ledger.is_some() { return Err("PRODUCTION_CUTOVER_TERMINAL_MISSING_AFTER_AUTHORIZATION_CONSUMPTION".into()); }
    let schema = production_schema_version_from_path(database_path)?;
    if schema.user_version != schema.migration_version || schema.user_version > 3 || schema.user_version < 0 {
        return Err("PRODUCTION_CUTOVER_TERMINAL_REQUIRED_FOR_V4_OR_UNKNOWN_DATABASE".into());
    }
    Ok(())
}

fn run_production_migration_at<F>(
    app_data: &Path, database_path: &Path, expected_app: &Path, executable: &Path, allow_synthetic: bool,
    mut inject: F,
) -> Result<JsonValue, String>
where F: FnMut(ProductionMigrationCheckpoint) -> Result<(), String> {
    let _migration_guard = startup_exclusion::acquire(app_data, startup_exclusion::LockMode::Exclusive)?;
    if ensure_no_unresolved_cutover(app_data).is_err() { return Err("Existing cutover state blocks a new Production migration.".into()); }
    ensure_production_cutover_startup(app_data, database_path, executable, allow_synthetic)?;
    let (_, manifest_sha256) = validate_runtime_compatibility_manifest(executable)?;
    let schema = production_schema_version_from_path(database_path)?;
    let permit_path = app_data.join(PRODUCTION_MIGRATION_AUTHORIZATION);
    let permit_meta = std::fs::symlink_metadata(&permit_path).map_err(|_| "REFUSE_NO_AUTHORIZATION: no unconsumed gate permit is present.".to_string())?;
    // SAFETY: geteuid only reads the current process owner id.
    let effective_uid = unsafe { libc::geteuid() };
    if !permit_meta.is_file() || permit_meta.file_type().is_symlink() || permit_meta.nlink() != 1
        || permit_meta.uid() != effective_uid || permit_meta.mode() & 0o077 != 0 {
        return Err("REFUSE_NO_AUTHORIZATION: gate permit has an unsafe identity.".into());
    }
    let authority = consume_production_migration_authorization_at(
        app_data, database_path, expected_app, database_path, schema, executable, executable, &manifest_sha256, allow_synthetic,
    )?;
    let post = native_migration4(database_path, &authority.database_pre_migration_sha256)?;
    if (post.database_device, post.database_inode) != (authority.database_device, authority.database_inode) {
        return Err("PRODUCTION_DATABASE_IDENTITY_CHANGED_DURING_MIGRATION".into());
    }
    inject(ProductionMigrationCheckpoint::AfterPostReadbackBeforeTerminal)?;
    let terminal = make_production_terminal(&authority, &post, allow_synthetic);
    let mut bytes = serde_json::to_vec_pretty(&terminal).map_err(|error| error.to_string())?;
    bytes.push(b'\n');
    let readback = production_cutover_state::write_terminal(app_data, &bytes, |checkpoint| match checkpoint {
        production_cutover_state::WriteCheckpoint::BeforeWrite => inject(ProductionMigrationCheckpoint::BeforeTerminalWrite),
        production_cutover_state::WriteCheckpoint::BeforeFileSync => inject(ProductionMigrationCheckpoint::BeforeTerminalFileSync),
        production_cutover_state::WriteCheckpoint::BeforeDirectorySync => inject(ProductionMigrationCheckpoint::BeforeTerminalDirectorySync),
        production_cutover_state::WriteCheckpoint::AfterDurableReadback => inject(ProductionMigrationCheckpoint::AfterTerminalDurableReadback),
    })?;
    if readback != bytes { return Err("PRODUCTION_TERMINAL_EXACT_READBACK_MISMATCH".into()); }
    validate_production_terminal(app_data, database_path, executable, &terminal, allow_synthetic)?;
    Ok(serde_json::json!({
        "event": "gate_permit_consumed", "status": "V4_MIGRATION_VERIFIED_NATIVE", "syntheticOnly": allow_synthetic,
        "migrationOwner": "native-rusqlite-runner", "terminalState": terminal.state,
        "terminalPath": app_data.join(production_cutover_state::TERMINAL_NAME),
        "terminalSha256": format!("{:x}", Sha256::digest(&readback)),
        "schema": {"userVersion": post.schema.user_version, "migrationVersion": post.schema.migration_version,
            "migrationRows": post.migration_rows, "migration4RowCount": post.migration4_row_count},
        "databaseSha256": post.database_sha256,
    }))
}

fn run_production_migration_command() -> Result<JsonValue, String> {
    let args: Vec<String> = std::env::args().collect();
    if args.len() != 2 || args[1] != "--pfc-internal-v4-migrate" {
        return Err("Internal Production migration accepts only the fixed native role.".into());
    }
    let executable = std::env::current_exe().map_err(|error| error.to_string())?;
    let expected_executable = Path::new(PRODUCTION_APP_BUNDLE).join("Contents/MacOS").join(PRODUCTION_EXECUTABLE);
    if executable != expected_executable { return Err("Native migration role must run from the exact installed Production executable.".into()); }
    let home = PathBuf::from(std::env::var_os("HOME").ok_or("Home directory is unavailable.")?);
    let app_data = startup_exclusion::production_authority(&home, PRODUCTION_IDENTIFIER)?;
    let database_path = app_data.join(PRODUCTION_DATABASE);
    run_production_migration_at(&app_data, &database_path, &PathBuf::from(PRODUCTION_APP_BUNDLE), &executable, false, |_| Ok(()))
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
        connection.pragma_update(None, "foreign_keys", "ON").map_err(|error| error.to_string())?;
        let enabled: i64 = connection.query_row("PRAGMA foreign_keys", [], |row| row.get(0)).map_err(|error| error.to_string())?;
        if enabled != 1 { return Err("SQLite foreign key enforcement could not be enabled.".into()); }
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
                        if migration { false } else {
                            let read_only = ["user_version", "schema_version", "foreign_keys", "integrity_check", "foreign_key_check", "table_info", "table_xinfo", "index_list", "index_info", "index_xinfo"];
                            pragma_value.is_some() || !read_only.iter().any(|allowed| pragma_name.eq_ignore_ascii_case(allowed))
                        }
                    },
                    AuthAction::Attach { .. } | AuthAction::Detach { .. } => true,
                    AuthAction::Unknown { .. } => true,
                    _ => false,
                };
                if denied { Authorization::Deny } else { Authorization::Allow }
            }));
        }
        Ok(Self { connection: Mutex::new(connection), transaction_id: Mutex::new(None), path, acceptance_runtime, production_runtime, migration_permitted, migration_active, schema_ready })
    }

    fn begin_schema_migration(&self) -> Result<(), String> {
        if !self.production_runtime { return Ok(()); }
        if !database_sidecars(&self.path)?.is_empty() {
            return Err("Production SQLite sidecar appeared after authorization; migration is blocked.".into());
        }
        let connection = self.connection.lock().map_err(|_| "Database connection is unavailable.".to_string())?;
        let schema = schema_version_from_connection(&connection)?;
        if schema != (DatabaseSchemaVersion { user_version: 3, migration_version: 3 }) {
            return Err("Production V3 schema changed after gate authorization.".into());
        }
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

    #[test]
    fn cutover_outcome_blocks_startup_before_any_database_access() {
        let root = temp_db_path().with_extension("cutover-startup-test");
        fs::create_dir(&root).unwrap();
        assert!(ensure_no_unresolved_cutover(&root).is_ok());
        for name in ["outcome.json", "outcome.json.pending", "permit.claimed.json", "consumed.json", "consumed.json.pending", "cutover-state.json", "cutover-outcome.json", "quiescence-state.json"] {
            for payload in ["corrupt", r#"{"state":"COMMIT_OUTCOME_UNKNOWN"}"#, r#"{"state":"V4_VERIFIED"}"#] {
                fs::write(root.join(name), payload).unwrap();
                assert!(ensure_no_unresolved_cutover(&root).is_err());
                assert!(!root.join(PRODUCTION_DATABASE).exists());
                fs::remove_file(root.join(name)).unwrap();
            }
        }
        #[cfg(unix)] {
            std::os::unix::fs::symlink(root.join("absent"), root.join("cutover-state.json")).unwrap();
            assert!(ensure_no_unresolved_cutover(&root).is_err());
            fs::remove_file(root.join("cutover-state.json")).unwrap();
        }
        fs::remove_dir(root).unwrap();
    }

    #[test]
    fn native_schema_artifacts_match_accepted_migration_source() {
        let connection = Connection::open_in_memory().unwrap();
        connection.execute_batch(include_str!("../../migrations/003-bootstrap.sql")).unwrap();
        for (expected, migration) in [
            (include_str!("../../migrations/v3-schema.json"), ""),
            (include_str!("../../migrations/v4-schema.json"), include_str!("../../migrations/004.sql")),
        ] {
            connection.execute_batch(migration).unwrap();
            let mut statement = connection.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name").unwrap();
            let actual = statement.query_map([], |row| Ok(serde_json::json!({
                "type": row.get::<_, String>(0)?, "name": row.get::<_, String>(1)?,
                "tbl_name": row.get::<_, String>(2)?, "sql": row.get::<_, String>(3)?
            }))).unwrap().collect::<Result<Vec<_>, _>>().unwrap();
            assert_eq!(JsonValue::Array(actual), serde_json::from_str::<JsonValue>(expected).unwrap());
        }
    }

    #[test]
    fn missing_database_is_distinct_from_unsafe_or_unreadable_metadata() {
        let root = temp_db_path().with_extension("metadata-test");
        fs::create_dir(&root).unwrap();
        let missing = root.join(PRODUCTION_DATABASE);
        assert_eq!(schema_version_from_path(&missing).unwrap(), DatabaseSchemaVersion { user_version: 0, migration_version: 0 });
        assert!(schema_version_from_path(&root).is_err());
        #[cfg(unix)] {
            let link = root.join("linked.sqlite3");
            std::os::unix::fs::symlink(&missing, &link).unwrap();
            assert!(schema_version_from_path(&link).is_err());
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn sidecar_metadata_is_fail_closed_and_rejects_redirected_objects() {
        let root = temp_db_path().with_extension("sidecar-metadata-test");
        fs::create_dir(&root).unwrap();
        let database = root.join(PRODUCTION_DATABASE);
        fs::write(&database, b"synthetic only").unwrap();
        assert!(database_sidecars(&database).unwrap().is_empty());
        let wal = PathBuf::from(format!("{}-wal", database.display()));
        fs::write(&wal, b"synthetic sidecar").unwrap();
        assert_eq!(database_sidecars(&database).unwrap(), vec![wal.clone()]);
        let blocked = production_schema_version_from_path(&database).unwrap_err();
        assert!(blocked.contains("sidecar exists"));
        fs::remove_file(&wal).unwrap();
        #[cfg(unix)] {
            std::os::unix::fs::symlink(root.join("absent"), &wal).unwrap();
            assert!(database_sidecars(&database).is_err());
        }
        fs::remove_dir_all(root).unwrap();
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
        assert!(db.select("PRAGMA incremental_vacuum", vec![], None).is_err());
        assert!(db.select("PRAGMA user_version", vec![], None).is_ok());
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

    #[test]
    fn p_production_internal_role_is_fixed_and_has_no_user_supplied_paths() {
        let error = run_production_migration_command().unwrap_err();
        assert!(error.contains("Internal Production migration accepts only the fixed native role"));
    }

    #[test]
    fn r_consumed_ledger_persistence_failure_is_fail_closed() {
        let root = std::env::temp_dir().join(format!("pf-v4-missing-ledger-parent-{}", std::process::id()));
        let result = persist_consumed_authorization(&root.join("missing/consumed.json"), ConsumedAuthorization {
            authorization_id: "fixture-id".into(), nonce: "fixture-nonce".into(), consumed_at_unix: 1,
            candidate_executable_sha256: "candidate-hash".into(), compatibility_manifest_sha256: "manifest-hash".into(),
        });
        assert!(result.is_err());
        assert!(!root.exists());
    }

    #[test]
    fn s_only_new_authorization_id_and_nonce_can_extend_consumed_ledger() {
        let root = std::env::temp_dir().join(format!("pf-v4-ledger-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        fs::create_dir_all(&root).unwrap();
        let ledger = root.join(CONSUMED_AUTHORIZATION_LEDGER);
        let record = |id: &str, nonce: &str| ConsumedAuthorization {
            authorization_id: id.into(), nonce: nonce.into(), consumed_at_unix: 1,
            candidate_executable_sha256: "candidate-hash".into(), compatibility_manifest_sha256: "manifest-hash".into(),
        };
        persist_consumed_authorization(&ledger, record("auth-1", "nonce-1")).unwrap();
        assert!(persist_consumed_authorization(&ledger, record("auth-1", "nonce-2")).is_err());
        assert!(persist_consumed_authorization(&ledger, record("auth-2", "nonce-1")).is_err());
        persist_consumed_authorization(&ledger, record("auth-2", "nonce-2")).unwrap();
        let entries: Vec<ConsumedAuthorization> = serde_json::from_slice(&fs::read(&ledger).unwrap()).unwrap();
        assert_eq!(entries.len(), 2);
        fs::remove_dir_all(root).unwrap();
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
    let command_args: Vec<String> = std::env::args().collect();
    if command_args.get(1).map(String::as_str) == Some("--pfc-internal-v4-migrate") {
        match run_production_migration_command() {
            Ok(result) => { println!("{result}"); std::process::exit(0); }
            Err(error) => { eprintln!("{}", serde_json::json!({"event":"blocked","error":error})); std::process::exit(2); }
        }
    }
    let context = acceptance_context();
    let startup_guard = if context.config().identifier == PRODUCTION_IDENTIFIER {
        let home = PathBuf::from(std::env::var_os("HOME").expect("Production home directory is unavailable"));
        let authority = startup_exclusion::production_authority(&home, &context.config().identifier)
            .expect("Production startup authority is unavailable");
        let guard = startup_exclusion::acquire(&authority, startup_exclusion::LockMode::Shared)
            .expect("Production startup is excluded by the native migration lease");
        // Preserve the durable crash boundary while still before Tauri can
        // construct any configured WebViewWindow.
        ensure_no_unresolved_cutover(&authority).expect("Unresolved cutover state blocks Production startup");
        let executable = std::env::current_exe().expect("Production executable path is unavailable");
        let expected_executable = Path::new(PRODUCTION_APP_BUNDLE).join("Contents/MacOS").join(PRODUCTION_EXECUTABLE);
        if executable != expected_executable { panic!("Production identity may run only from the verified normal installed app path."); }
        ensure_production_cutover_startup(&authority, &authority.join(PRODUCTION_DATABASE), &executable, false)
            .expect("Production durable cutover terminal check failed before Builder");
        Some(guard)
    } else { None };
    let builder = tauri::Builder::default()
        .setup(|app| {
            let app_data = app.path().app_data_dir()?;
            let home = app.path().home_dir()?;
            let acceptance_runtime = app.config().identifier == ACCEPTANCE_IDENTIFIER;
            let production_runtime = app.config().identifier == PRODUCTION_IDENTIFIER;
            let wp02_runtime = app.config().identifier == wp02_preview_isolation::IDENTIFIER;
            #[cfg(feature = "wp03-preview")]
            let wp03_runtime = app.config().identifier == wp03_preview_isolation::IDENTIFIER;
            #[cfg(not(feature = "wp03-preview"))]
            let wp03_runtime = false;
            if cfg!(feature = "wp02-preview") && !wp02_runtime {
                return Err(std::io::Error::other(
                    "WP-02 preview build refused to start with a non-WP-02 runtime identity.",
                )
                .into());
            }
            #[cfg(feature = "wp03-preview")]
            if !wp03_runtime {
                return Err(std::io::Error::other(
                    "WP-03 preview build refused to start with a non-WP-03 runtime identity.",
                )
                .into());
            }
            if cfg!(feature = "v4-acceptance") && !acceptance_runtime {
                return Err(std::io::Error::other(
                    "V4 acceptance build refused to start with a non-acceptance runtime identity.",
                )
                .into());
            }
            #[cfg(feature = "wp03-preview")]
            if wp03_runtime {
                wp03_preview_isolation::ensure_isolated(&app.config().identifier, &app_data, &home)
                    .map_err(std::io::Error::other)?;
                std::fs::create_dir_all(&app_data)?;
                wp03_preview_isolation::ensure_isolated(&app.config().identifier, &app_data, &home)
                    .map_err(std::io::Error::other)?;
                app.manage(wp03_preview_test_date::SessionDate::default());
            } else if wp02_runtime {
                wp02_preview_isolation::ensure_isolated(&app.config().identifier, &app_data, &home)
                    .map_err(std::io::Error::other)?;
            } else if acceptance_runtime {
                ensure_acceptance_data_dir_isolated(&app.config().identifier, &app_data, &home).map_err(std::io::Error::other)?;
            } else {
                ensure_smoke_data_dir_isolated(&app.config().identifier, &app_data, &home).map_err(std::io::Error::other)?;
            }
            #[cfg(not(feature = "wp03-preview"))]
            if wp02_runtime {
                wp02_preview_isolation::ensure_isolated(&app.config().identifier, &app_data, &home)
                    .map_err(std::io::Error::other)?;
            } else if acceptance_runtime {
                ensure_acceptance_data_dir_isolated(&app.config().identifier, &app_data, &home).map_err(std::io::Error::other)?;
            } else {
                ensure_smoke_data_dir_isolated(&app.config().identifier, &app_data, &home).map_err(std::io::Error::other)?;
            }
            let database_path = if acceptance_runtime { app_data.join(ACCEPTANCE_DATABASE) } else { app_data.join(PRODUCTION_DATABASE) };
            let migration_permitted = false;
            let schema_ready = true;
            // This gate precedes every ordinary runtime's first SQLite access.
            // The dedicated synthetic maintenance binary is a separate entry.
            ensure_no_unresolved_cutover(&app_data).map_err(std::io::Error::other)?;
            if production_runtime {
                if app_data != home.join("Library/Application Support").join(PRODUCTION_IDENTIFIER) {
                    return Err(std::io::Error::other("Production runtime refused an unexpected application-data path.").into());
                }
                let executable = std::env::current_exe()?;
                let expected_executable = Path::new(PRODUCTION_APP_BUNDLE).join("Contents/MacOS").join(PRODUCTION_EXECUTABLE);
                if executable != expected_executable {
                    return Err(std::io::Error::other("Production identity may run only from the verified normal installed app path.").into());
                }
                ensure_production_cutover_startup(&app_data, &database_path, &executable, false).map_err(std::io::Error::other)?;
                validate_runtime_compatibility_manifest(&executable).map_err(std::io::Error::other)?;
                let schema = production_schema_version_from_path(&database_path).map_err(std::io::Error::other)?;
                ensure_supported_schema(schema).map_err(std::io::Error::other)?;
                if schema.user_version > 0 && schema.user_version < CURRENT_SCHEMA_VERSION {
                    return Err(std::io::Error::other("QUIESCENCE_IMPLEMENTATION_NOT_PRODUCTION_AUTHORIZED: legacy TS-driven Production migration is disabled; isolated verification is not Production cutover authority.").into());
                } else if schema.user_version == 0 {
                    return Err(std::io::Error::other("Production runtime refuses an uninitialized database; use an approved, separately gated bootstrap.").into());
                }
            }
            if !wp03_runtime { std::fs::create_dir_all(&app_data)?; }
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
        });
    #[cfg(feature = "wp03-preview")]
    let builder = builder.invoke_handler(tauri::generate_handler![
        database_open,
        database_execute,
        database_select,
        database_begin,
        database_commit,
        database_rollback,
        database_schema_migration_begin,
        database_schema_migration_end,
        acceptance_runtime_info,
        acceptance_reset,
        wp03_preview_test_date::wp03_preview_get_test_date,
        wp03_preview_test_date::wp03_preview_set_test_date,
    ]);
    #[cfg(not(feature = "wp03-preview"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        database_open,
        database_execute,
        database_select,
        database_begin,
        database_commit,
        database_rollback,
        database_schema_migration_begin,
        database_schema_migration_end,
        acceptance_runtime_info,
        acceptance_reset,
    ]);
    builder
        .run(context)
        .expect("failed to run Personal Finance Console");
    drop(startup_guard);
}

#[cfg(test)]
mod production_terminal_tests {
    use super::*;
    use std::{fs, os::unix::fs::PermissionsExt, process::{Command, Stdio}, time::{SystemTime, UNIX_EPOCH}};
    use std::sync::atomic::{AtomicU64, Ordering};
    static FIXTURE_COUNTER: AtomicU64 = AtomicU64::new(0);

    struct Fixture { root: PathBuf, app_data: PathBuf, database: PathBuf, app: PathBuf, executable: PathBuf }
    impl Fixture {
        fn new() -> Self {
            let nonce = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos();
            let root = std::env::temp_dir().join(format!("pfc-r2c3c1-terminal-{}-{nonce}-{}", std::process::id(), FIXTURE_COUNTER.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir(&root).unwrap();
            let root = root.canonicalize().unwrap();
            let marker = root.join("SYNTHETIC_ONLY"); fs::write(&marker, b"PFC_WP04R2A_GATE_SYNTHETIC_V1\n").unwrap();
            fs::set_permissions(&marker, fs::Permissions::from_mode(0o600)).unwrap();
            let app = root.join("Applications").join("Personal Finance Console.app");
            let executable = app.join("Contents/MacOS").join(PRODUCTION_EXECUTABLE);
            fs::create_dir_all(executable.parent().unwrap()).unwrap();
            let current = std::env::current_exe().unwrap();
            if fs::hard_link(&current, &executable).is_err() { fs::copy(&current, &executable).unwrap(); }
            let manifest_path = production_manifest_path(&executable).unwrap();
            fs::create_dir_all(manifest_path.parent().unwrap()).unwrap();
            fs::write(&manifest_path, serde_json::to_vec(&serde_json::json!({
                "manifestFormatVersion":1,"runtimeGeneration":4,"minSupportedSchemaVersion":1,
                "maxSupportedSchemaVersion":4,"bundleId":PRODUCTION_IDENTIFIER,
                "executable":format!("Contents/MacOS/{PRODUCTION_EXECUTABLE}")
            })).unwrap()).unwrap();
            fs::set_permissions(&manifest_path, fs::Permissions::from_mode(0o600)).unwrap();
            let app_data = root.join("Library/Application Support").join(PRODUCTION_IDENTIFIER);
            fs::create_dir_all(&app_data).unwrap();
            let database = app_data.join(PRODUCTION_DATABASE);
            let connection = Connection::open(&database).unwrap();
            connection.execute_batch("CREATE TABLE profiles(id TEXT PRIMARY KEY); CREATE TABLE income_records(id TEXT PRIMARY KEY); CREATE TABLE cash_accounts(id TEXT PRIMARY KEY); CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); INSERT INTO schema_migrations VALUES(1,'fixture'),(2,'fixture'),(3,'fixture'); PRAGMA user_version=3;").unwrap();
            drop(connection);
            let backup = app_data.join("production-v4-backups").join(PRODUCTION_DATABASE);
            fs::create_dir_all(backup.parent().unwrap()).unwrap(); fs::copy(&database, &backup).unwrap();
            let candidate_hash = sha256_file(&executable).unwrap();
            let manifest_hash = sha256_file(&manifest_path).unwrap();
            let db_hash = sha256_file(&database).unwrap();
            let backup_hash = sha256_file(&backup).unwrap();
            let receipt_path = app_data.join(PRODUCTION_RELEASE_RECEIPT);
            let receipt = serde_json::json!({
                "status":"PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION", "syntheticOnly":true,
                "productionBundleId":PRODUCTION_IDENTIFIER,"installedAppPath":app.to_string_lossy(),
                "candidateExecutablePath":executable.to_string_lossy(),"productionDatabasePath":database.to_string_lossy(),
                "releaseReceiptPath":receipt_path.to_string_lossy(), "candidateApprovalSha256":"approval-bytes-sha",
                "migrationAuthorizationSha256":"migration-authorization-contract-sha", "productionDatabasePreMigrationSha256":db_hash,
                "candidateExecutableSha256":candidate_hash,"compatibilityManifestSha256":manifest_hash,
                "backupPath":backup.to_string_lossy(),"backupSha256":backup_hash,"ownerAuthorizationId":"owner-auth-r2c3c1",
                "sidecarsAbsent":true,"productionSchema":{"userVersion":3,"migrationVersion":3}
            });
            Self::write_owner_json(&receipt_path, &receipt);
            let receipt_hash = sha256_file(&receipt_path).unwrap();
            let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs();
            let permit_path = app_data.join(PRODUCTION_MIGRATION_AUTHORIZATION);
            let permit = serde_json::json!({
                "receiptFormatVersion":1,"status":"ONE_TIME_PRODUCTION_V4_MIGRATION_AUTHORIZATION","syntheticOnly":true,
                "nonce":"nonce-r2c3c1", "issuedAtUnix":now,"expiresAtUnix":now+60,
                "productionBundleId":PRODUCTION_IDENTIFIER,"installedAppPath":app.to_string_lossy(),
                "candidateExecutablePath":executable.to_string_lossy(),"candidateExecutableSha256":candidate_hash,
                "compatibilityManifestSha256":manifest_hash,"maxSupportedSchemaVersion":4,
                "productionDatabasePath":database.to_string_lossy(),"productionDatabasePreMigrationSha256":db_hash,
                "productionSchema":{"userVersion":3,"migrationVersion":3},
                "backupPath":backup.to_string_lossy(),"backupSha256":backup_hash,"sidecarsAbsent":true,
                "releaseReceiptPath":receipt_path.to_string_lossy(),"releaseReceiptSha256":receipt_hash,
                "candidateApprovalSha256":"approval-bytes-sha","migrationAuthorizationSha256":"migration-authorization-contract-sha",
                "ownerAuthorizationId":"owner-auth-r2c3c1"
            });
            Self::write_owner_json(&permit_path, &permit);
            Self { root, app_data, database, app, executable }
        }

        fn open_existing(root: PathBuf) -> Self {
            let root = root.canonicalize().unwrap();
            let app_data = root.join("Library/Application Support").join(PRODUCTION_IDENTIFIER);
            let database = app_data.join(PRODUCTION_DATABASE);
            let app = root.join("Applications").join("Personal Finance Console.app");
            let executable = app.join("Contents/MacOS").join(PRODUCTION_EXECUTABLE);
            Self { root, app_data, database, app, executable }
        }

        fn write_owner_json(path: &Path, value: &JsonValue) {
            fs::write(path, serde_json::to_vec_pretty(value).unwrap()).unwrap();
            fs::set_permissions(path, fs::Permissions::from_mode(0o600)).unwrap();
        }

        fn migrate(&self) -> Result<JsonValue, String> {
            run_production_migration_at(&self.app_data, &self.database, &self.app, &self.executable, true, |_| Ok(()))
        }

        fn startup(&self) -> Result<(), String> {
            ensure_production_cutover_startup(&self.app_data, &self.database, &self.executable, true)
        }

        fn m4_count(&self) -> i64 {
            Connection::open_with_flags(&self.database, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()
                .query_row("SELECT COUNT(*) FROM schema_migrations WHERE version=4", [], |row| row.get(0)).unwrap()
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); } }

    #[test]
    fn never_started_v3_is_distinguished_and_remains_eligible() {
        let fixture = Fixture::new();
        assert!(fixture.startup().is_ok());
        assert!(!fixture.app_data.join(CONSUMED_AUTHORIZATION_LEDGER).exists());
        assert!(!fixture.app_data.join(production_cutover_state::TERMINAL_NAME).exists());
    }

    #[test]
    fn normal_success_durably_binds_terminal_before_guard_release() {
        let fixture = Fixture::new();
        assert!(startup_exclusion::acquire(&fixture.app_data, startup_exclusion::LockMode::Shared).is_ok());
        let order_path = PathBuf::from("../evidence/wp04-release-cutover-readiness/53-r2c3c1-production-durable-terminal/10-ordering/GUARD_TERMINAL_ORDERING.json");
        let mut events = Vec::<JsonValue>::new();
        let result = run_production_migration_at(&fixture.app_data, &fixture.database, &fixture.app, &fixture.executable, true, |point| {
            if point == ProductionMigrationCheckpoint::AfterTerminalDurableReadback {
                assert!(startup_exclusion::acquire(&fixture.app_data, startup_exclusion::LockMode::Shared).is_err());
                events.push(serde_json::json!({"sequence":1,"event":"terminal_durable_exact_readback","exclusiveGuard":"held"}));
            }
            Ok(())
        }).unwrap();
        assert_eq!(result["terminalState"], "V4_VERIFIED");
        assert_eq!(result["schema"]["migration4RowCount"], 1);
        assert_eq!(fixture.m4_count(), 1);
        let ui_guard = startup_exclusion::acquire(&fixture.app_data, startup_exclusion::LockMode::Shared).unwrap();
        assert!(fixture.startup().is_ok());
        events.push(serde_json::json!({"sequence":2,"event":"exclusiveGuardReleased_and_UI_sharedGuardAcquired"}));
        drop(ui_guard);
        fs::write(&order_path, serde_json::to_vec_pretty(&serde_json::json!({
            "format_version":1,"synthetic_only":true,"terminalDurableAt":1,"guardReleasedAt":2,
            "terminalDurableBeforeGuardRelease":true,"migration4Rows":1,"startupAllowedAfterRelease":true,"events":events
        })).unwrap()).unwrap();
    }

    #[test]
    fn preterminal_process_exit_and_terminal_write_failures_remain_blocked() {
        let fixture = Fixture::new();
        let failure = run_production_migration_at(&fixture.app_data, &fixture.database, &fixture.app, &fixture.executable, true, |point| {
            if point == ProductionMigrationCheckpoint::AfterPostReadbackBeforeTerminal { Err("synthetic process stopped before terminal".into()) } else { Ok(()) }
        });
        assert!(failure.is_err()); assert_eq!(fixture.m4_count(), 1);
        assert!(fixture.app_data.join(CONSUMED_AUTHORIZATION_LEDGER).exists());
        assert!(production_cutover_state::read_terminal(&fixture.app_data).unwrap().is_none());
        assert!(fixture.startup().is_err());

        let fixture = Fixture::new();
        let failure = run_production_migration_at(&fixture.app_data, &fixture.database, &fixture.app, &fixture.executable, true, |point| {
            if point == ProductionMigrationCheckpoint::BeforeTerminalWrite { Err("injected terminal write failure".into()) } else { Ok(()) }
        });
        assert!(failure.is_err()); assert_eq!(fixture.m4_count(), 1);
        assert!(production_cutover_state::read_terminal(&fixture.app_data).unwrap().is_none());
        assert!(fixture.startup().is_err());

        let fixture = Fixture::new();
        let failure = run_production_migration_at(&fixture.app_data, &fixture.database, &fixture.app, &fixture.executable, true, |point| {
            if point == ProductionMigrationCheckpoint::BeforeTerminalFileSync { Err("injected terminal fsync failure".into()) } else { Ok(()) }
        });
        assert!(failure.is_err()); assert_eq!(fixture.m4_count(), 1);
        assert!(production_cutover_state::read_terminal(&fixture.app_data).unwrap().is_none());
        assert!(fixture.startup().is_err());

        let fixture = Fixture::new();
        let failure = run_production_migration_at(&fixture.app_data, &fixture.database, &fixture.app, &fixture.executable, true, |point| {
            if point == ProductionMigrationCheckpoint::BeforeTerminalDirectorySync { Err("injected terminal directory fsync failure".into()) } else { Ok(()) }
        });
        assert!(failure.is_err()); assert_eq!(fixture.m4_count(), 1);
        assert!(production_cutover_state::read_terminal(&fixture.app_data).unwrap().is_none());
        assert!(fixture.startup().is_err());
    }

    #[test]
    fn child_process_exits_after_commit_before_terminal_and_restart_is_blocked() {
        if let Ok(root) = std::env::var("PFC_R2C3C1_CRASH_CHILD_ROOT") {
            let fixture = Fixture::open_existing(PathBuf::from(root));
            let _ = run_production_migration_at(&fixture.app_data, &fixture.database, &fixture.app, &fixture.executable, true, |point| {
                if point == ProductionMigrationCheckpoint::AfterPostReadbackBeforeTerminal { std::process::exit(86); }
                Ok(())
            });
            panic!("crash child did not reach the injected process-exit boundary");
        }
        let fixture = Fixture::new();
        let test_binary = std::env::current_exe().unwrap();
        let child = Command::new(test_binary)
            .args(["--exact", "production_terminal_tests::child_process_exits_after_commit_before_terminal_and_restart_is_blocked", "--nocapture"])
            .env("PFC_R2C3C1_CRASH_CHILD_ROOT", &fixture.root)
            .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null()).status().unwrap();
        assert_eq!(child.code(), Some(86));
        assert_eq!(schema_version_from_path(&fixture.database).unwrap(), DatabaseSchemaVersion { user_version: 4, migration_version: 4 });
        assert!(fixture.app_data.join(CONSUMED_AUTHORIZATION_LEDGER).exists());
        assert!(production_cutover_state::read_terminal(&fixture.app_data).unwrap().is_none());
        assert!(fixture.startup().is_err());
    }

    #[test]
    fn corrupt_or_stale_terminal_fails_closed() {
        let fixture = Fixture::new(); fixture.migrate().unwrap();
        let terminal_path = fixture.app_data.join(production_cutover_state::TERMINAL_NAME);
        fs::write(&terminal_path, b"{corrupt").unwrap();
        fs::set_permissions(&terminal_path, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(fixture.startup().is_err());

        let fixture = Fixture::new(); fixture.migrate().unwrap();
        fs::write(production_manifest_path(&fixture.executable).unwrap(), b"stale manifest").unwrap();
        assert!(fixture.startup().is_err());

        let fixture = Fixture::new(); fixture.migrate().unwrap();
        fs::write(fixture.app_data.join("production-v4-backups").join(PRODUCTION_DATABASE), b"stale backup").unwrap();
        assert!(fixture.startup().is_err());

        let fixture = Fixture::new(); fixture.migrate().unwrap();
        let permit = fixture.app_data.join(PRODUCTION_MIGRATION_AUTHORIZATION);
        assert!(!permit.exists());
        fs::write(&permit, b"resurrected permit").unwrap();
        fs::set_permissions(&permit, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(fixture.startup().is_err());

        let fixture = Fixture::new(); fixture.migrate().unwrap();
        let terminal = fixture.app_data.join(production_cutover_state::TERMINAL_NAME);
        let connection = Connection::open(&fixture.database).unwrap();
        connection.execute("DELETE FROM schema_migrations WHERE version=4", []).unwrap();
        connection.pragma_update(None, "user_version", 3).unwrap();
        drop(connection);
        assert!(fixture.startup().is_err());
        assert!(terminal.exists());

        let fixture = Fixture::new(); fixture.migrate().unwrap();
        let candidate = fixture.executable.clone();
        fs::remove_file(&candidate).unwrap();
        fs::write(&candidate, b"different candidate identity").unwrap();
        fs::set_permissions(&candidate, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(fixture.startup().is_err());
    }

    #[test]
    fn verified_v4_restart_does_not_replay_migration_and_reply_loss_keeps_terminal() {
        let fixture = Fixture::new(); fixture.migrate().unwrap();
        assert!(fixture.startup().is_ok());
        assert!(fixture.migrate().is_err());
        assert_eq!(fixture.m4_count(), 1);

        let fixture = Fixture::new();
        let lost_reply = run_production_migration_at(&fixture.app_data, &fixture.database, &fixture.app, &fixture.executable, true, |point| {
            if point == ProductionMigrationCheckpoint::AfterTerminalDurableReadback { Err("synthetic caller reply lost after durable terminal".into()) } else { Ok(()) }
        });
        assert!(lost_reply.is_err());
        assert!(fixture.startup().is_ok());
        assert_eq!(fixture.m4_count(), 1);
    }

    #[test]
    fn stale_or_missing_terminal_authority_blocks_before_database_mutation() {
        let fixture = Fixture::new();
        let claimed = fixture.app_data.join(format!("{}fixture", production_cutover_state::CLAIMED_AUTHORIZATION_PREFIX));
        fs::write(&claimed, b"{}").unwrap(); fs::set_permissions(&claimed, fs::Permissions::from_mode(0o600)).unwrap();
        assert!(fixture.startup().is_err()); assert_eq!(schema_version_from_path(&fixture.database).unwrap().user_version, 3);
        fs::remove_file(claimed).unwrap();

        let fixture = Fixture::new(); fixture.migrate().unwrap();
        fs::remove_file(fixture.app_data.join(production_cutover_state::TERMINAL_NAME)).unwrap();
        assert!(fixture.startup().is_err()); assert_eq!(fixture.m4_count(), 1);
    }
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
