//! Read-only, pre-SQLite gate for ordinary application startup.
//!
//! This deliberately cannot authorize a Production handoff. A successful
//! isolated cutover is not authority to open an installed Production database.
use serde::Serialize;
use serde_json::Value;
use std::{fs::{self, OpenOptions}, io::Read, os::unix::fs::{MetadataExt, OpenOptionsExt}, path::Path};

pub const RECORDS: &[&str] = &[
    "outcome.json", "permit.json", "permit.claimed.json", "consumed.json",
    "cutover-state.json", "cutover-outcome.json", "quiescence-state.json",
    "managed-contract.json", "managed-state.json", "authorization.json",
    "managed-progress.json", "native-launch.json",
    "handoff.json", "handoff-authorization.json", "recovery.json",
    "recovery-authorization.json", "integration-state.json",
    "recovery-consumed.json", "recovery-result.json",
    "managed-state-S0_VERIFIED_CANDIDATE.json",
    "managed-state-S1_MANAGED_ISOLATED.json",
    "managed-state-S2_OWNER_AUTHORIZED.json",
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartupDecision {
    pub state: String,
    pub ordinary_startup_allowed: bool,
    pub recovery_required: bool,
    pub required_action: String,
    pub records: Vec<String>,
    pub reason_codes: Vec<String>,
    pub database_accessed: bool,
}

fn read_record(path: &Path) -> Result<Value, &'static str> {
    let before = fs::symlink_metadata(path).map_err(|_| "RECORD_UNREADABLE")?;
    if !before.is_file() || before.file_type().is_symlink() || before.nlink() != 1 || before.len() > 1_048_576 {
        return Err("RECORD_UNSAFE_IDENTITY");
    }
    let mut file = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
        .open(path).map_err(|_| "RECORD_UNREADABLE")?;
    let key = |m: &fs::Metadata| (m.dev(), m.ino(), m.len(), m.nlink(), m.mtime(), m.mtime_nsec());
    if key(&file.metadata().map_err(|_| "RECORD_UNREADABLE")?) != key(&before) { return Err("RECORD_IDENTITY_CHANGED"); }
    let mut bytes = Vec::new();
    (&mut file).take(1_048_577).read_to_end(&mut bytes).map_err(|_| "RECORD_UNREADABLE")?;
    if bytes.len() > 1_048_576 || key(&file.metadata().map_err(|_| "RECORD_UNREADABLE")?) != key(&before)
        || key(&fs::symlink_metadata(path).map_err(|_| "RECORD_UNREADABLE")?) != key(&before) {
        return Err("RECORD_IDENTITY_CHANGED");
    }
    let value: Value = serde_json::from_slice(&bytes).map_err(|_| "RECORD_CORRUPT")?;
    if !value.is_object() { return Err("RECORD_CORRUPT"); }
    Ok(value)
}

pub fn inspect(app_data: &Path) -> StartupDecision {
    let mut decision = StartupDecision {
        state: "NOT_STARTED".into(), ordinary_startup_allowed: true, recovery_required: false,
        required_action: "NORMAL_STARTUP".into(), records: Vec::new(), reason_codes: Vec::new(),
        database_accessed: false,
    };
    match fs::symlink_metadata(app_data) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return decision,
        Ok(m) if m.is_dir() && !m.file_type().is_symlink() => (),
        _ => decision.reason_codes.push("APP_DATA_IDENTITY_UNKNOWN".into()),
    }
    let mut names: Vec<String> = RECORDS.iter().flat_map(|name| [name.to_string(), format!("{name}.pending")]).collect();
    match fs::read_dir(app_data) {
        Ok(entries) => for entry in entries {
            match entry {
                Ok(entry) => {
                    let name = entry.file_name().to_string_lossy().into_owned();
                    if name.starts_with("native-state-") || name.starts_with("managed-state-") {
                        names.push(name);
                    }
                }
                Err(_) => decision.reason_codes.push("STATE_DIRECTORY_UNREADABLE".into()),
            }
        },
        Err(_) => decision.reason_codes.push("STATE_DIRECTORY_UNREADABLE".into()),
    }
    // Receipt names are finite and fixed by the integration state machine.
    for phase in 0..=10 {
        for prefix in ["state-S", "phase-S"] {
            names.push(format!("{prefix}{phase}.json"));
            names.push(format!("{prefix}{phase}.json.pending"));
        }
    }
    names.sort(); names.dedup();
    let mut bindings = std::collections::BTreeMap::<String, String>::new();
    let mut observed_states = Vec::new();
    for name in names {
        match fs::symlink_metadata(app_data.join(&name)) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => { decision.records.push(name); decision.reason_codes.push("RECORD_UNREADABLE".into()); continue; }
            Ok(_) => decision.records.push(name.clone()),
        }
        if name.ends_with(".pending") { decision.reason_codes.push("PENDING_DURABLE_WRITE".into()); continue; }
        match read_record(&app_data.join(&name)) {
            Err(code) => decision.reason_codes.push(code.into()),
            Ok(value) => {
                if let Some(state) = value.get("state").and_then(Value::as_str) {
                    observed_states.push((name.clone(), state.to_string()));
                }
                for field in ["session", "nonce", "authorization_id", "managed_contract_sha256", "authorization_sha256"] {
                    if let Some(observed) = value.get(field) {
                        match observed.as_str().filter(|s| !s.is_empty()) {
                            Some(text) => {
                                if let Some(prior) = bindings.insert(field.into(), text.into()) {
                                    if prior != text { decision.reason_codes.push("RECORD_BINDING_MISMATCH".into()); }
                                }
                            }
                            None => decision.reason_codes.push("RECORD_BINDING_INVALID".into()),
                        }
                    }
                }
            }
        }
    }
    if !decision.records.is_empty() || !decision.reason_codes.is_empty() {
        decision.ordinary_startup_allowed = false;
        decision.recovery_required = true;
        decision.required_action = "AUTHORIZED_DIAGNOSTIC_OR_HANDOFF_REQUIRED".into();
        decision.state = observed_states.iter().find(|(name, _)| name == "outcome.json")
            .map(|(_, state)| state.clone()).unwrap_or_else(|| "CUTOVER_STATE_UNRESOLVED".into());
        if decision.state == "V4_VERIFIED" {
            decision.reason_codes.push("SEPARATE_AUTHORIZED_COMPATIBLE_HANDOFF_REQUIRED".into());
        } else { decision.reason_codes.push("UNRESOLVED_CUTOVER_BLOCKS_ORDINARY_STARTUP".into()); }
        if !decision.reason_codes.iter().all(|code| code.ends_with("REQUIRED") || code == "UNRESOLVED_CUTOVER_BLOCKS_ORDINARY_STARTUP") {
            decision.state = "GUARD_LOST_OR_UNPROVEN".into();
        }
    }
    decision.reason_codes.sort();
    decision.reason_codes.dedup();
    decision
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    struct Fixture(std::path::PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!("pfc-startup-gate-{}-{}-{}", std::process::id(),
                std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos(), NEXT.fetch_add(1, Ordering::Relaxed)));
            fs::create_dir(&path).unwrap(); Self(path)
        }
    }
    impl Drop for Fixture { fn drop(&mut self) { fs::remove_dir_all(&self.0).unwrap(); } }
    #[test]
    fn absence_is_not_started_without_database_access() {
        let f = Fixture::new(); let d = inspect(&f.0);
        assert_eq!(d.state, "NOT_STARTED"); assert!(d.ordinary_startup_allowed); assert!(!d.database_accessed);
    }
    #[test]
    fn every_unresolved_phase_and_plain_schema_four_stays_blocked() {
        let f = Fixture::new();
        // Deliberately not SQLite: the startup gate must not even inspect it.
        fs::write(f.0.join("personal-finance-console.sqlite3"), b"schema=4; not a valid database").unwrap();
        for state in ["VERIFIED_CANDIDATE", "MANAGED_ISOLATED", "OWNER_AUTHORIZED", "PERMIT_CONSUMED",
            "CONNECTION_PREPARED", "QUIESCENCE_ACQUIRED", "V3_REVALIDATED", "MIGRATION_IN_PROGRESS",
            "COMMIT_OUTCOME_UNKNOWN", "V4_COMMITTED_PENDING_VERIFICATION", "FAILED_V3_CONFIRMED", "GUARD_LOST_OR_UNPROVEN"] {
            fs::write(f.0.join("outcome.json"), serde_json::to_vec(&serde_json::json!({"format_version":2,"state":state,"session":"s","nonce":"n","authorization_id":"a"})).unwrap()).unwrap();
            let d = inspect(&f.0); assert_eq!(d.state, state); assert!(!d.ordinary_startup_allowed); assert!(!d.database_accessed);
        }
    }
    #[test]
    fn verified_does_not_self_authorize_handoff() {
        let f = Fixture::new(); fs::write(f.0.join("outcome.json"), br#"{"state":"V4_VERIFIED"}"#).unwrap();
        let d = inspect(&f.0); assert!(!d.ordinary_startup_allowed);
        assert!(d.reason_codes.contains(&"SEPARATE_AUTHORIZED_COMPATIBLE_HANDOFF_REQUIRED".into()));
    }
    #[test]
    fn corrupt_pending_mismatch_and_redirected_records_fail_closed() {
        let f = Fixture::new();
        for bytes in [b"{broken".as_slice(), b"null", b"[]"] {
            fs::write(f.0.join("outcome.json"), bytes).unwrap();
            assert_eq!(inspect(&f.0).state, "GUARD_LOST_OR_UNPROVEN");
        }
        fs::write(f.0.join("outcome.json"), br#"{"state":"V4_VERIFIED","session":"one"}"#).unwrap();
        fs::write(f.0.join("consumed.json"), br#"{"session":"two"}"#).unwrap();
        assert!(inspect(&f.0).reason_codes.contains(&"RECORD_BINDING_MISMATCH".into()));
        std::os::unix::fs::symlink(f.0.join("missing"), f.0.join("outcome.json.pending")).unwrap();
        assert!(inspect(&f.0).reason_codes.contains(&"PENDING_DURABLE_WRITE".into()));
        fs::remove_file(f.0.join("outcome.json.pending")).unwrap();
        fs::remove_file(f.0.join("outcome.json")).unwrap();
        std::os::unix::fs::symlink(f.0.join("missing"), f.0.join("outcome.json")).unwrap();
        assert!(inspect(&f.0).reason_codes.contains(&"RECORD_UNSAFE_IDENTITY".into()));
    }
    #[test]
    fn all_contract_and_phase_records_block_even_without_outcome() {
        let f = Fixture::new();
        for name in RECORDS.iter().map(|s| s.to_string()).chain((0..=10).map(|n| format!("state-S{n}.json"))) {
            fs::write(f.0.join(&name), b"{}").unwrap();
            assert!(!inspect(&f.0).ordinary_startup_allowed, "{name}");
            fs::remove_file(f.0.join(name)).unwrap();
        }
    }
    #[test]
    fn hardlinked_or_oversized_state_is_never_trusted() {
        let f = Fixture::new();
        fs::write(f.0.join("record-source"), b"{}").unwrap();
        fs::hard_link(f.0.join("record-source"), f.0.join("outcome.json")).unwrap();
        assert!(inspect(&f.0).reason_codes.contains(&"RECORD_UNSAFE_IDENTITY".into()));
        fs::remove_file(f.0.join("outcome.json")).unwrap();
        fs::write(f.0.join("outcome.json"), vec![b' '; 1_048_577]).unwrap();
        assert!(inspect(&f.0).reason_codes.contains(&"RECORD_UNSAFE_IDENTITY".into()));
    }
    #[test]
    fn redirected_app_data_is_blocked_before_records_are_trusted() {
        let f = Fixture::new();
        let directory = f.0.join("real"); fs::create_dir(&directory).unwrap();
        std::os::unix::fs::symlink(&directory, f.0.join("alias")).unwrap();
        let d = inspect(&f.0.join("alias"));
        assert!(!d.ordinary_startup_allowed);
        assert!(d.reason_codes.contains(&"APP_DATA_IDENTITY_UNKNOWN".into()));
    }
}
