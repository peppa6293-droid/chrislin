//! Explicitly authorized synthetic diagnosis / handoff. Never executes M4,
//! revives a permit, restores a runtime, or restores a database.
use super::*;

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RecoveryAuthorization {
    format_version:u32,synthetic_only:bool,scope:String,authorization_id:String,
    session:String,nonce:String,managed_contract_sha256:String,consumed_sha256:String,
    outcome_sha256:String,action:String,expected_database_sha256:String,
}
fn blocked(state:&str,reason:Value,outcome:Value)->Value {
    json!({"format_version":2,"synthetic_only":true,"state":state,"phase":outcome["phase"],"startupBlocked":true,"startup_allowed":false,"recovery_required":true,"reason":reason,"outcome":outcome})
}
fn consumed(root:&Path)->Result<Permit> {
    let p:Permit=serde_json::from_value(contract::read_json(&root.join("consumed.json"))?)?;
    let claimed:Permit=serde_json::from_value(contract::read_json(&root.join("permit.claimed.json"))?)?;
    require(serde_json::to_value(&p)?==serde_json::to_value(&claimed)?&&p.format_version==2,"CONSUMED_CLAIM_MISMATCH")?;
    Ok(p)
}
pub(super) fn diagnostic(raw:&str)->Result<Value> {
    let root=root_checked(raw)?;
    let exists=["native-launch.json","permit.json","permit.claimed.json","consumed.json","outcome.json","managed-progress.json","managed-contract.json","authorization.json","recovery-consumed.json","recovery-history.jsonl","recovery-active.json","recovery-result.json"].iter().any(|n|present_or_unreadable(&root.join(n))) || fs::read_dir(&root)?.any(|entry|entry.map(|e|{let name=e.file_name().to_string_lossy().to_string();name.starts_with("managed-state-")||name.starts_with("native-state-")||name.starts_with("recovery-preterminal-")}).unwrap_or(true));
    let pending=fs::read_dir(&root)?.any(|entry|entry.map(|e|e.file_name().to_string_lossy().ends_with(".pending")).unwrap_or(true));
    if !exists&&!pending {return Ok(json!({"format_version":2,"synthetic_only":true,"state":"NOT_STARTED","phase":Value::Null,"startupBlocked":false,"startup_allowed":true,"recovery_required":false,"outcome":Value::Null}));}
    let outcome=contract::read_json(&root.join("outcome.json")).unwrap_or(Value::Null);
    if pending {return Ok(blocked("GUARD_LOST_OR_UNPROVEN",json!("DURABLE_STATE_PENDING"),outcome));}
    let checked=(||->Result<Value>{let p=consumed(&root)?;contract::verify_chain(&root,&p)})();
    match checked {
        Ok(record)=>{
            let state=record["state"].as_str().unwrap_or("GUARD_LOST_OR_UNPROVEN");
            let reason=if state=="V4_VERIFIED"{"SEPARATE_HANDOFF_AUTHORIZATION_REQUIRED"}else{"UNRESOLVED_CUTOVER_REQUIRES_EXPLICIT_RECOVERY"};
            Ok(blocked(state,json!(reason),record.clone()))
        },
        Err(error)=>Ok(blocked("GUARD_LOST_OR_UNPROVEN",serde_json::to_value(error)?,outcome)),
    }
}

fn acquire_recovery_lease(root:&Path,p:&Permit)->Result<Lease> {
    let path=root.join("maintenance.lock");let initial=regular(&path)?;
    require(Some(initial.dev)==p.lease_dev&&Some(initial.inode)==p.lease_inode,"LEASE_RECOVERY_IDENTITY_MISMATCH")?;
    let fd=OpenOptions::new().read(true).write(true).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC).open(&path)?;
    require(identity(&fd.metadata()?)==initial,"LEASE_RECOVERY_IDENTITY_MISMATCH")?;
    require(unsafe{libc::flock(fd.as_raw_fd(),libc::LOCK_EX|libc::LOCK_NB)}==0,"RECOVERY_LEASE_BUSY")?;
    let session_body=Some(contract::read_json(&path)?);
    let lease=Lease{_fd:fd,path,initial,session_body};lease.validate()?;Ok(lease)
}
fn backup_snapshot(root:&Path,p:&Permit)->Result<Value> {
    require(hash_file(&root.join("backup.sqlite3"))?==p.backup_sha256,"RECOVERY_BACKUP_DRIFT")?;
    let c=Connection::open_with_flags(root.join("backup.sqlite3"),OpenFlags::SQLITE_OPEN_READ_ONLY|OpenFlags::SQLITE_OPEN_NO_MUTEX|OpenFlags::SQLITE_OPEN_PRIVATE_CACHE|OpenFlags::SQLITE_OPEN_NOFOLLOW)?;
    c.busy_timeout(Duration::ZERO)?;schema(&c,3)?;let result=business_snapshot(&c)?;drop(c);
    require(hash_file(&root.join("backup.sqlite3"))?==p.backup_sha256,"RECOVERY_BACKUP_DRIFT")?;Ok(result)
}

const HISTORY: &str = "recovery-history.jsonl";
const ACTIVE: &str = "recovery-active.json";

fn recovery_history(root:&Path)->Result<Vec<Value>> {
    require(!fs::read_dir(root)?.any(|entry|entry.map(|e|e.file_name().to_string_lossy().ends_with(".pending")).unwrap_or(true)),"RECOVERY_HISTORY_PENDING")?;
    let path=root.join(HISTORY);
    if !present_or_unreadable(&path) { return Ok(Vec::new()); }
    let bytes=fs::read(&path)?;
    require(bytes.is_empty() || bytes.ends_with(b"\n"),"RECOVERY_HISTORY_CORRUPT")?;
    let mut rows:Vec<Value>=Vec::new();
    for line in bytes.split(|b|*b==b'\n').filter(|line|!line.is_empty()) {
        rows.push(serde_json::from_slice(line).map_err(|_|Failure::new("RECOVERY_HISTORY_CORRUPT","invalid ledger row"))?);
    }
    let mut open=std::collections::HashMap::<String,Value>::new();
    for row in &rows {
        let key=row["attempt_key"].as_str().ok_or_else(||Failure::new("RECOVERY_HISTORY_CORRUPT","missing attempt key"))?;
        match row["record_type"].as_str() {
            Some("STARTED")=>require(open.insert(key.to_owned(),row.clone()).is_none(),"RECOVERY_HISTORY_CORRUPT")?,
            Some("FAILED")|Some("OUTCOME_UNKNOWN")|Some("SUCCEEDED")=>require(open.remove(key).is_some(),"RECOVERY_HISTORY_CORRUPT")?,
            Some("TERMINAL_PENDING")=>require(open.contains_key(key),"RECOVERY_HISTORY_CORRUPT")?,
            _=>return Err(Failure::new("RECOVERY_HISTORY_CORRUPT","unknown record type")),
        }
    }
    if !open.is_empty() {
        let terminal=durable_terminal_readback(root).ok();
        let preterminal=terminal.as_ref().and_then(|value|value["attempt_key"].as_str()).and_then(|key|contract::read_json(&root.join(format!("recovery-preterminal-{key}.json"))).ok());
        let terminal_bytes=terminal.as_ref().and_then(|value|serde_json::to_vec(value).ok());
        let terminal_hash=terminal_bytes.as_ref().map(|bytes|format!("{:x}",Sha256::digest(bytes)));
        let bound=terminal.as_ref().is_some_and(|value|{
            value["format_version"]==2&&value["synthetic_only"]==true&&
            ["V4_VERIFIED","FAILED_V3_CONFIRMED"].contains(&value["state"].as_str().unwrap_or(""))&&
            value["attempt_key"].as_str().is_some_and(|key|open.get(key).is_some_and(|start|value["authorization_id"]==start["authorization_id"]&&value["nonce"]==start["nonce"]))&&
            preterminal.as_ref().is_some_and(|record|record["attempt_key"]==value["attempt_key"]&&record["terminal_sha256"]==terminal_hash.clone().unwrap_or_default())
        });
        require(bound,"RECOVERY_HISTORY_PENDING")?;
    }
    Ok(rows)
}

fn append_history(root:&Path,row:&Value)->Result<()> {
    let path=root.join(HISTORY);
    let mut file=OpenOptions::new().create(true).append(true).read(true).mode(0o600).open(&path)?;
    require(unsafe{libc::flock(file.as_raw_fd(),libc::LOCK_EX|libc::LOCK_NB)}==0,"RECOVERY_HISTORY_BUSY")?;
    // Validate the complete existing ledger while holding the append lock.
    let mut bytes=Vec::new();file.read_to_end(&mut bytes)?;
    require(bytes.is_empty()||bytes.ends_with(b"\n"),"RECOVERY_HISTORY_CORRUPT")?;
    for line in bytes.split(|b|*b==b'\n').filter(|line|!line.is_empty()) {
        serde_json::from_slice::<Value>(line).map_err(|_|Failure::new("RECOVERY_HISTORY_CORRUPT","invalid ledger row"))?;
    }
    file.write_all(serde_json::to_string(row)?.as_bytes())?;file.write_all(b"\n")?;file.sync_all()?;sync_dir(root)
}

fn durable_terminal_readback(root:&Path)->Result<Value> {
    let path=root.join("recovery-result.json");
    let file=OpenOptions::new().read(true).open(&path)?;file.sync_all()?;drop(file);
    sync_dir(root)?;contract::read_json(&path)
}

fn attempt_key(a:&RecoveryAuthorization)->String {
    let mut h=Sha256::new();h.update(a.authorization_id.as_bytes());h.update([0]);h.update(a.nonce.as_bytes());format!("{:x}",h.finalize())
}
fn authorization_replayed(history:&[Value],a:&RecoveryAuthorization)->bool {
    history.iter().any(|row|row["authorization_id"]==a.authorization_id||row["nonce"]==a.nonce)
}

fn terminal_result(root:&Path,result:&Value)->Result<Value> {
    if failpoint("recovery_before_terminal") { return Err(Failure::new("INJECTED_RECOVERY_FAILURE","before terminal publication")); }
    durable(root,"recovery-result.json",result)?;
    // After a terminal durable write, any uncertainty is handled by startup's
    // independent binding/readback check. Never mutate the terminal on error.
    if failpoint("recovery_after_terminal") { return Err(Failure::new("INJECTED_RECOVERY_OUTCOME_UNKNOWN","after terminal publication")); }
    let readback=contract::read_json(&root.join("recovery-result.json"))?;
    require(readback==*result,"RECOVERY_TERMINAL_READBACK_MISMATCH")?;
    Ok(readback)
}

pub(super) fn recover(raw:&str,authorization_path:&str,event:&EventCallback)->Result<Value> {
    let root=root_checked(raw)?;
    require(Path::new(authorization_path)==root.join("recovery-authorization.json"),"RECOVERY_AUTHORIZATION_PATH_INVALID")?;
    let a:RecoveryAuthorization=serde_json::from_value(contract::read_json(Path::new(authorization_path))?)?;
    require(a.format_version==2&&a.synthetic_only&&a.scope=="synthetic-recovery-handoff-only"&&!a.authorization_id.is_empty()&&!a.nonce.is_empty(),"RECOVERY_AUTHORIZATION_INVALID")?;
    require(["diagnose","verify-v4-handoff","verify-v3-terminal"].contains(&a.action.as_str()),"RECOVERY_ACTION_FORBIDDEN")?;
    let p=consumed(&root)?;let old=contract::verify_chain(&root,&p)?;
    require(a.authorization_id!=p.authorization_id&&a.nonce!=p.nonce&&a.session==p.session&&Some(a.managed_contract_sha256.as_str())==p.managed_contract_sha256.as_deref()&&a.consumed_sha256==hash_file(&root.join("consumed.json"))?&&a.outcome_sha256==hash_file(&root.join("outcome.json"))?,"RECOVERY_AUTHORIZATION_BINDING_MISMATCH")?;
    if a.action=="diagnose" {return diagnostic(raw);}
    require(contract::digest_ok(&a.expected_database_sha256),"RECOVERY_EXPECTED_HASH_INVALID")?;
    let history=recovery_history(&root)?;
    let key=attempt_key(&a);
    require(!authorization_replayed(&history,&a),"RECOVERY_AUTHORIZATION_REPLAY")?;
    if present_or_unreadable(&root.join("recovery-consumed.json")) {
        let legacy:RecoveryAuthorization=serde_json::from_value(contract::read_json(&root.join("recovery-consumed.json"))?)
            .map_err(|_|Failure::new("RECOVERY_AUTHORIZATION_REPLAY","legacy consumption marker is present or corrupt"))?;
        require(legacy.authorization_id!=a.authorization_id&&legacy.nonce!=a.nonce,"RECOVERY_AUTHORIZATION_REPLAY")?;
    }
    require(!present_or_unreadable(&root.join("recovery-consumed.json.pending")),"RECOVERY_HISTORY_PENDING")?;
    require(!present_or_unreadable(&root.join("recovery-result.json")),"RECOVERY_TERMINAL_ALREADY_PUBLISHED")?;
    let claim=json!({"format_version":1,"synthetic_only":true,"attempt_key":key,"authorization_id":a.authorization_id,"session":p.session});
    // create_new is the single-writer admission point. A crash leaves the
    // marker behind and ordinary startup remains blocked.
    let mut active=OpenOptions::new().write(true).create_new(true).mode(0o600).open(root.join(ACTIVE))?;
    serde_json::to_writer(&mut active,&claim)?;active.write_all(b"\n")?;active.sync_all()?;sync_dir(&root)?;
    append_history(&root,&json!({"record_type":"STARTED","attempt_key":key,"authorization_id":a.authorization_id,"nonce":a.nonce,"session":p.session,"action":a.action}))?;
    let result=(||->Result<Value>{
    let lease=acquire_recovery_lease(&root,&p)?;
    contract::validate(&root,&p)?;
    let id=regular(&root.join(DB))?;candidate(&root,&p,&id)?;
    // No journal recovery, WAL probing, or automatic retry is performed by this
    // read-only entrypoint. Such unresolved sidecars require another authority.
    sidecars(&root,false,&id)?;
    let before=safe_hash(&root,&p)?;require(before.sha256==a.expected_database_sha256,"RECOVERY_DATABASE_HASH_MISMATCH")?;
    let backup=backup_snapshot(&root,&p)?;
    // The append-only ledger is the consumption record; retain the legacy
    // single-authorization file as historical evidence without replacing it.
    if !present_or_unreadable(&root.join("recovery-consumed.json")) {
        durable(&root,"recovery-consumed.json",&serde_json::to_value(&a)?)?;
    }
    let c=Connection::open_with_flags(root.join(DB),OpenFlags::SQLITE_OPEN_READ_ONLY|OpenFlags::SQLITE_OPEN_NO_MUTEX|OpenFlags::SQLITE_OPEN_PRIVATE_CACHE|OpenFlags::SQLITE_OPEN_NOFOLLOW)?;
    c.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE,true)?;
    same_object(&c,&root,&id)?;c.busy_timeout(Duration::ZERO)?;
    c.execute_batch("PRAGMA query_only=ON; PRAGMA foreign_keys=ON; BEGIN")?;
    let want=if a.action=="verify-v4-handoff" {4}else{3};
    schema(&c,want)?;
    let mode:String=c.query_row("PRAGMA journal_mode",[],|r|r.get(0))?;require(mode=="delete","RECOVERY_MODE_UNSUPPORTED")?;
    require(file_control(&c,rusqlite::ffi::SQLITE_FCNTL_LOCKSTATE)?>=1,"RECOVERY_READ_GUARD_UNPROVEN")?;
    require(business_snapshot(&c)?==backup,"RECOVERY_BUSINESS_DATA_MISMATCH")?;
    let after=safe_hash(&root,&p)?;
    require(after.sha256==before.sha256&&after.identity==before.identity,"RECOVERY_DB_CHANGED_DURING_VERIFICATION")?;
    contract::validate(&root,&p)?;lease.validate()?;same_object(&c,&root,&id)?;
    let terminal=if want==4 {
        require(old["phase"].as_u64().is_some_and(|phase|phase>=8),"NO_PERSISTED_COMMIT_LINEAGE")?;
        // A recovery read is a new protected verification, not an assertion
        // that the lost migration guard was continuously held after a crash.
        let mut record=old.clone();
        record["recovery"] = json!({"authorization_id":a.authorization_id,"nonce":a.nonce,"database_sha256":after.sha256,"guard":"new-read-only-transaction; original guard not claimed","runtime":"independently-reenumerated","business_data":"exact-backup-legacy-snapshot","original_state":old["state"]});
        json!({"format_version":2,"synthetic_only":true,"state":"V4_VERIFIED","handoff_authorized":true,"startupBlocked":false,"attempt_key":key,"authorization_id":a.authorization_id,"nonce":a.nonce,"session":p.session,"managed_contract_sha256":p.managed_contract_sha256,"outcome_sha256":a.outcome_sha256,"database_sha256":after.sha256,"evidence":record})
    } else {
        json!({"format_version":2,"synthetic_only":true,"state":"FAILED_V3_CONFIRMED","safe_terminal":true,"handoff_authorized":false,"startupBlocked":true,"attempt_key":key,"authorization_id":a.authorization_id,"nonce":a.nonce,"session":p.session,"managed_contract_sha256":p.managed_contract_sha256,"outcome_sha256":a.outcome_sha256,"database_sha256":after.sha256,"runtime":"V4 maintenance isolated; no old runtime restored","original_state":old["state"]})
    };
    // Every fallible operation and evidence callback precedes final publication.
    lease.validate()?;same_object(&c,&root,&id)?;
    c.execute_batch("ROLLBACK")?;
    lease.validate()?;same_object(&c,&root,&id)?;drop(c);
    event("authorized_recovery_verified",terminal.clone())?;
    durable(&root,&format!("recovery-preterminal-{key}.json"),&json!({"format_version":1,"synthetic_only":true,"attempt_key":key,"state":"VERIFIED_PENDING_TERMINAL","terminal_sha256":Sha256::digest(serde_json::to_vec(&terminal)?).iter().map(|b|format!("{b:02x}")).collect::<String>()}))?;
    append_history(&root,&json!({"record_type":"TERMINAL_PENDING","attempt_key":key,"authorization_id":a.authorization_id,"nonce":a.nonce}))?;
    drop(lease);
    fs::remove_file(root.join(ACTIVE))?;sync_dir(&root)?;
    terminal_result(&root,&terminal)
    })();
    match result {
        Ok(value)=>{
            Ok(value)
        },
        Err(error)=>{
            // A possibly-published terminal is an unknown outcome: preserve the
            // active marker so startup fails closed until it independently binds it.
            if !present_or_unreadable(&root.join("recovery-result.json")) {
                append_history(&root,&json!({"record_type":"FAILED","attempt_key":key,"authorization_id":a.authorization_id,"nonce":a.nonce,"error":error.code}))?;
                fs::remove_file(root.join(ACTIVE))?;sync_dir(&root)?;
            } else {
                // Terminal exists: leave TERMINAL_PENDING untouched. The next
                // startup must validate its full binding and durable readback.
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64,Ordering};
    static SEQ:AtomicU64=AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture { fn new()->Self {let n=SEQ.fetch_add(1,Ordering::Relaxed);let path=std::env::temp_dir().join(format!("pfc-recovery-ledger-{}-{n}",std::process::id()));fs::create_dir(&path).unwrap();Self(path)} }
    impl Drop for Fixture {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    fn start(key:&str,id:&str,nonce:&str)->Value {json!({"record_type":"STARTED","attempt_key":key,"authorization_id":id,"nonce":nonce,"session":"fixture","action":"verify-v3-terminal"})}
    fn auth(id:&str,nonce:&str)->RecoveryAuthorization {serde_json::from_value(json!({"format_version":2,"synthetic_only":true,"scope":"synthetic-recovery-handoff-only","authorization_id":id,"session":"fixture","nonce":nonce,"managed_contract_sha256":"a","consumed_sha256":"b","outcome_sha256":"c","action":"verify-v3-terminal","expected_database_sha256":"d"})).unwrap()}
    #[test] fn recovery_does_not_accept_restore_or_missing_authority(){
        assert!(serde_json::from_value::<RecoveryAuthorization>(json!({"action":"restore","schema":4})).is_err());
    }
    #[test] fn recovery_ledger_preserves_failed_consumption_and_allows_a_distinct_authorization(){
        let f=Fixture::new();
        append_history(&f.0,&start("key-a","auth-a","nonce-a")).unwrap();
        append_history(&f.0,&json!({"record_type":"FAILED","attempt_key":"key-a","authorization_id":"auth-a","nonce":"nonce-a","error":"RECOVERY_LEASE_BUSY"})).unwrap();
        let rows=recovery_history(&f.0).unwrap();
        assert_eq!(rows.len(),2);assert_eq!(rows[0]["authorization_id"],"auth-a");assert_eq!(rows[1]["record_type"],"FAILED");
        assert!(authorization_replayed(&rows,&auth("auth-a","nonce-a")));
        assert!(!authorization_replayed(&rows,&auth("auth-b","nonce-b")));
        append_history(&f.0,&start("key-b","auth-b","nonce-b")).unwrap();
        append_history(&f.0,&json!({"record_type":"FAILED","attempt_key":"key-b","authorization_id":"auth-b","nonce":"nonce-b","error":"synthetic test"})).unwrap();
        assert_eq!(recovery_history(&f.0).unwrap().len(),4);
    }
    #[test] fn pending_or_corrupt_recovery_history_fails_closed(){
        let f=Fixture::new();append_history(&f.0,&start("pending","auth-p","nonce-p")).unwrap();
        assert_eq!(recovery_history(&f.0).unwrap_err().code,"RECOVERY_HISTORY_PENDING");
        fs::write(f.0.join(HISTORY),b"{not-json}\n").unwrap();
        assert_eq!(recovery_history(&f.0).unwrap_err().code,"RECOVERY_HISTORY_CORRUPT");
        fs::write(f.0.join(HISTORY),b"{\"record_type\":\"STARTED\"").unwrap();
        assert_eq!(recovery_history(&f.0).unwrap_err().code,"RECOVERY_HISTORY_CORRUPT");
    }
    #[test] fn terminal_recovery_must_match_attempt_and_preterminal_digest(){
        let f=Fixture::new();
        append_history(&f.0,&start("key-a","auth-a","nonce-a")).unwrap();
        append_history(&f.0,&json!({"record_type":"TERMINAL_PENDING","attempt_key":"key-a","authorization_id":"auth-a","nonce":"nonce-a"})).unwrap();
        let wrong=json!({"format_version":2,"synthetic_only":true,"state":"V4_VERIFIED","attempt_key":"key-a","authorization_id":"wrong","nonce":"nonce-a"});
        durable(&f.0,"recovery-result.json",&wrong).unwrap();
        let wrong_hash=format!("{:x}",Sha256::digest(serde_json::to_vec(&wrong).unwrap()));
        durable(&f.0,"recovery-preterminal-key-a.json",&json!({"attempt_key":"key-a","terminal_sha256":wrong_hash})).unwrap();
        assert_eq!(recovery_history(&f.0).unwrap_err().code,"RECOVERY_HISTORY_PENDING");
        let bound=json!({"format_version":2,"synthetic_only":true,"state":"V4_VERIFIED","attempt_key":"key-a","authorization_id":"auth-a","nonce":"nonce-a"});
        fs::remove_file(f.0.join("recovery-result.json")).unwrap();
        durable(&f.0,"recovery-result.json",&bound).unwrap();
        fs::remove_file(f.0.join("recovery-preterminal-key-a.json")).unwrap();
        let bound_hash=format!("{:x}",Sha256::digest(serde_json::to_vec(&bound).unwrap()));
        durable(&f.0,"recovery-preterminal-key-a.json",&json!({"attempt_key":"key-a","terminal_sha256":bound_hash})).unwrap();
        assert_eq!(recovery_history(&f.0).unwrap().len(),2);
    }
    #[test] fn concurrent_recovery_claim_has_at_most_one_active_owner(){
        let f=Fixture::new();
        let first=OpenOptions::new().write(true).create_new(true).open(f.0.join(ACTIVE)).unwrap();
        assert!(OpenOptions::new().write(true).create_new(true).open(f.0.join(ACTIVE)).is_err());
        drop(first);assert!(present_or_unreadable(&f.0.join(ACTIVE)));
    }
    #[test] fn terminal_fault_boundaries_fail_closed_and_read_back(){
        let f=Fixture::new();let result=json!({"format_version":2,"synthetic_only":true,"state":"V4_VERIFIED","attempt_key":"k","authorization_id":"a","nonce":"n"});
        std::env::set_var("PFC_Q_FAIL","recovery_before_terminal");
        assert_eq!(terminal_result(&f.0,&result).unwrap_err().code,"INJECTED_RECOVERY_FAILURE");
        assert!(!present_or_unreadable(&f.0.join("recovery-result.json")));
        std::env::set_var("PFC_Q_FAIL","recovery_after_terminal");
        assert_eq!(terminal_result(&f.0,&result).unwrap_err().code,"INJECTED_RECOVERY_OUTCOME_UNKNOWN");
        std::env::remove_var("PFC_Q_FAIL");
        assert_eq!(contract::read_json(&f.0.join("recovery-result.json")).unwrap(),result);
    }
    #[test] fn unresolved_diagnostic_never_claims_startup_permission(){
        for state in ["PERMIT_CONSUMED","QUIESCENCE_ACQUIRED","MIGRATION_IN_PROGRESS","COMMIT_OUTCOME_UNKNOWN","V4_COMMITTED_PENDING_VERIFICATION","FAILED_V3_CONFIRMED","GUARD_LOST_OR_UNPROVEN","V4_VERIFIED"] {
            let value=blocked(state,json!("test"),json!({"state":state}));assert_eq!(value["startupBlocked"],true);assert_eq!(value["recovery_required"],true);
        }
    }
}
