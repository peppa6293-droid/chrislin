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
    let exists=["native-launch.json","permit.json","permit.claimed.json","consumed.json","outcome.json","managed-progress.json","managed-contract.json","authorization.json","recovery-consumed.json","recovery-result.json"].iter().any(|n|present_or_unreadable(&root.join(n))) || fs::read_dir(&root)?.any(|entry|entry.map(|e|{let name=e.file_name().to_string_lossy().to_string();name.starts_with("managed-state-")||name.starts_with("native-state-")}).unwrap_or(true));
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
    require(!present_or_unreadable(&root.join("recovery-consumed.json"))&&!present_or_unreadable(&root.join("recovery-consumed.json.pending")),"RECOVERY_AUTHORIZATION_REPLAY")?;
    let lease=acquire_recovery_lease(&root,&p)?;
    contract::validate(&root,&p)?;
    let id=regular(&root.join(DB))?;candidate(&root,&p,&id)?;
    // No journal recovery, WAL probing, or automatic retry is performed by this
    // read-only entrypoint. Such unresolved sidecars require another authority.
    sidecars(&root,false,&id)?;
    let before=safe_hash(&root,&p)?;require(before.sha256==a.expected_database_sha256,"RECOVERY_DATABASE_HASH_MISMATCH")?;
    let backup=backup_snapshot(&root,&p)?;
    durable(&root,"recovery-consumed.json",&serde_json::to_value(&a)?)?;
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
    if want==4 {
        require(old["phase"].as_u64().is_some_and(|phase|phase>=8),"NO_PERSISTED_COMMIT_LINEAGE")?;
        // A recovery read is a new protected verification, not an assertion
        // that the lost migration guard was continuously held after a crash.
        let mut record=old.clone();
        record["recovery"] = json!({"authorization_id":a.authorization_id,"nonce":a.nonce,"database_sha256":after.sha256,"guard":"new-read-only-transaction; original guard not claimed","runtime":"independently-reenumerated","business_data":"exact-backup-legacy-snapshot","original_state":old["state"]});
        durable(&root,"recovery-result.json",&json!({"format_version":2,"synthetic_only":true,"state":"V4_VERIFIED","handoff_authorized":true,"startupBlocked":false,"authorization_id":a.authorization_id,"session":p.session,"managed_contract_sha256":p.managed_contract_sha256,"outcome_sha256":a.outcome_sha256,"database_sha256":after.sha256,"evidence":record}))?;
    } else {
        durable(&root,"recovery-result.json",&json!({"format_version":2,"synthetic_only":true,"state":"FAILED_V3_CONFIRMED","safe_terminal":true,"handoff_authorized":false,"startupBlocked":true,"authorization_id":a.authorization_id,"session":p.session,"managed_contract_sha256":p.managed_contract_sha256,"outcome_sha256":a.outcome_sha256,"database_sha256":after.sha256,"runtime":"V4 maintenance isolated; no old runtime restored","original_state":old["state"]}))?;
    }
    let result=contract::read_json(&root.join("recovery-result.json"))?;
    event("authorized_recovery_verified",result.clone())?;
    lease.validate()?;same_object(&c,&root,&id)?;
    c.execute_batch("ROLLBACK")?;drop(c);drop(lease);
    // Original outcome / immutable chain stay preserved. Authorization and
    // independent recovery result are a separate, exactly bound handoff layer.
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn recovery_does_not_accept_restore_or_missing_authority(){
        assert!(serde_json::from_value::<RecoveryAuthorization>(json!({"action":"restore","schema":4})).is_err());
    }
    #[test] fn unresolved_diagnostic_never_claims_startup_permission(){
        for state in ["PERMIT_CONSUMED","QUIESCENCE_ACQUIRED","MIGRATION_IN_PROGRESS","COMMIT_OUTCOME_UNKNOWN","V4_COMMITTED_PENDING_VERIFICATION","FAILED_V3_CONFIRMED","GUARD_LOST_OR_UNPROVEN","V4_VERIFIED"] {
            let value=blocked(state,json!("test"),json!({"state":state}));assert_eq!(value["startupBlocked"],true);assert_eq!(value["recovery_required"],true);
        }
    }
}
