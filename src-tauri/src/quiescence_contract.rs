//! Frozen, versioned gate/native contract. All paths are finite synthetic facts.
//! A controller's `complete` flag is deliberately not part of this protocol.
use super::*;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(super) struct Object {
    pub role:String, pub path:String, pub kind:String, pub dev:u64, pub inode:u64,
    pub size:u64, pub links:u64, pub mode:u32, pub sha256:Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Bundle {
    pub role:String, pub path:String, pub executable:String, pub info_plist:String,
    pub manifest:String, pub bundle_id:String, pub enabled:bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Route {pub path:String,pub enabled:bool}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Process {
    pub pid:i32,pub start:String,pub executable_sha256:String,
    pub executable_dev:u64,pub executable_inode:u64,pub state:String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Transition {pub state:String,pub path:String,pub evidence_sha256:String}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct LeaseBinding {pub path:String,pub dev:u64,pub inode:u64,pub session:String}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub(super) struct Authorization {
    pub format_version:u32,pub synthetic_only:bool,pub scope:String,
    pub id:String,pub session:String,pub nonce:String,pub database_sha256:String,
    pub backup_sha256:String,pub candidate_executable_sha256:String,
    pub allow_recovery:bool,pub allow_wal_infrastructure:bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Contract {
    pub format_version:u32,pub synthetic_only:bool,pub root:String,
    pub session:String,pub authorization_id:String,pub nonce:String,
    pub objects:Vec<Object>,pub bundles:Vec<Bundle>,pub known_nested:Vec<String>,
    pub launch_routes:Vec<Route>,pub processes:Vec<Process>,pub transitions:Vec<Transition>,
    pub lease:LeaseBinding,pub authorization:Authorization,
}
pub(super) fn digest_ok(value:&str)->bool {value.len()==64&&value.bytes().all(|b|b.is_ascii_hexdigit()&&!b.is_ascii_uppercase())}
fn scoped(root:&Path,raw:&str)->Result<PathBuf> {
    let path=PathBuf::from(raw);
    require(path.is_absolute()&&path!=root&&path.starts_with(root),"MANAGED_PATH_ESCAPE")?;
    require(fs::canonicalize(&path)?==path,"MANAGED_PATH_NOT_CANONICAL")?;
    Ok(path)
}
pub(super) fn read_json(path:&Path)->Result<Value> {regular(path)?;Ok(serde_json::from_slice(&fs::read(path)?)?)}

fn enumerate(path:&Path,actual:&mut BTreeMap<String,Object>)->Result<()> {
    let meta=fs::symlink_metadata(path)?;
    require(!meta.file_type().is_symlink()&&(meta.is_dir()||meta.is_file()),"MANAGED_UNSAFE_OBJECT")?;
    let filename=path.file_name().map(|v|v.to_string_lossy()).unwrap_or_default();
    require(!filename.ends_with(".alias")&&!filename.ends_with(".bookmark"),"MANAGED_LAUNCH_ALIAS_UNKNOWN")?;
    let name=path.to_str().ok_or_else(||Failure::new("NON_UTF8_MANAGED_PATH","unsupported path"))?.to_owned();
    let sha256=if meta.is_file(){Some(hash_file(path)?)}else{None};
    let item=Object{role:String::new(),path:name.clone(),kind:if meta.is_file(){"file"}else{"directory"}.into(),
        dev:meta.dev(),inode:meta.ino(),size:meta.len(),links:meta.nlink(),mode:meta.mode()&0o7777,sha256};
    require(actual.insert(name,item).is_none(),"DUPLICATE_MANAGED_OBJECT")?;
    if meta.is_dir(){
        let mut entries=fs::read_dir(path)?.map(|e|e.map(|v|v.path())).collect::<std::io::Result<Vec<_>>>()?;
        entries.sort();for entry in entries {enumerate(&entry,actual)?;}
        let after=fs::symlink_metadata(path)?;
        require((meta.dev(),meta.ino(),meta.len(),meta.nlink(),meta.mode())==(after.dev(),after.ino(),after.len(),after.nlink(),after.mode()),"MANAGED_DIRECTORY_DRIFT")?;
    }
    Ok(())
}
fn plist(path:&Path)->Result<plist::Dictionary> {
    let bytes=fs::read(path)?;
    let parsed=plist::Value::from_reader(std::io::Cursor::new(bytes)).map_err(|e|Failure::new("PLIST_INVALID",e))?;
    parsed.into_dictionary().ok_or_else(||Failure::new("PLIST_INVALID","dictionary required"))
}
fn check_bundle(root:&Path,b:&Bundle,objects:&BTreeMap<String,Object>)->Result<()> {
    let path=scoped(root,&b.path)?;
    require(objects.get(&b.path).is_some_and(|o|o.kind=="directory"),"BUNDLE_ROOT_UNKNOWN")?;
    let info=scoped(root,&b.info_plist)?;let exe=scoped(root,&b.executable)?;let manifest=scoped(root,&b.manifest)?;
    require(info==path.join("Contents/Info.plist")&&exe.starts_with(path.join("Contents/MacOS"))&&manifest==path.join("Contents/Resources/runtime-compatibility.json"),"BUNDLE_LAYOUT_MISMATCH")?;
    for field in [&b.info_plist,&b.executable,&b.manifest]{require(objects.get(field).is_some_and(|o|o.kind=="file"),"BUNDLE_OBJECT_NOT_ENUMERATED")?;}
    let info=plist(&info)?;
    require(info.get("CFBundleIdentifier").and_then(plist::Value::as_string)==Some(b.bundle_id.as_str()),"BUNDLE_ID_MISMATCH")?;
    let name=info.get("CFBundleExecutable").and_then(plist::Value::as_string).ok_or_else(||Failure::new("BUNDLE_EXECUTABLE_UNKNOWN","missing field"))?;
    require(!name.contains('/')&&exe==path.join("Contents/MacOS").join(name),"BUNDLE_EXECUTABLE_MISMATCH")?;
    let m=read_json(&manifest)?;
    require(m["manifestFormatVersion"]==1&&m["bundleId"]==b.bundle_id&&m["executable"]==format!("Contents/MacOS/{name}"),"RUNTIME_MANIFEST_INCOMPATIBLE")?;
    let max=m["maxSupportedSchemaVersion"].as_u64().ok_or_else(||Failure::new("RUNTIME_MANIFEST_INCOMPATIBLE","max schema required"))?;
    let min=m["minSupportedSchemaVersion"].as_u64().ok_or_else(||Failure::new("RUNTIME_MANIFEST_INCOMPATIBLE","min schema required"))?;
    require(min>0&&min<=max,"RUNTIME_MANIFEST_INCOMPATIBLE")?;
    if ["installed","candidate","staging"].contains(&b.role.as_str()) {require(m["runtimeGeneration"]==4&&min<=3&&max==4,"V4_RUNTIME_INCOMPATIBLE")?;}
    else {require((m["runtimeGeneration"]==3&&max==3)||(m["runtimeGeneration"]==4&&max==4),"ARCHIVE_RUNTIME_UNKNOWN")?;}
    require((objects[&b.executable].mode&0o111!=0)==b.enabled,"BUNDLE_EXECUTION_STATE_DRIFT")
}

// A hash-linked receipt proves bytes, not their meaning. The supported S1
// collector retains exactly one project-owned old runtime until waitpid.
fn validate_retained_receipt(details:&Value,old:&Process,session:&str)->Result<()> {
    let a=&details["association"];
    require(a["pid"]==old.pid&&a["start"]==old.start&&a["executable_dev"]==old.executable_dev
        &&a["executable_inode"]==old.executable_inode&&a["executable_sha256"]==old.executable_sha256
        &&a["identity"]==old.executable_sha256&&digest_ok(&old.executable_sha256),"RETAINED_ASSOCIATION_RECEIPT_MISMATCH")?;
    require(a["readiness"]==json!({"protocol":"pfc.synthetic-old-runtime.ready.v1","pid":old.pid,
        "session":session,"initialized":true,"executable_sha256":old.executable_sha256}),"OLD_RUNTIME_READINESS_RECEIPT_MISMATCH")?;
    let start=&details["start_evidence"];
    require(start["pid"]==old.pid&&start["value"]==old.start&&start["returncode"]==0
        &&start["collector"]=="ps_exact_retained_child_lstart"&&start["ownership"]=="retained_Popen_waitpid"
        &&start["readiness"]==a["readiness"],"OLD_RUNTIME_START_RECEIPT_MISMATCH")?;
    require(a["signature"]["signature_verified"]==true
        &&a["signature"]["signature_details"].as_str().is_some_and(|s|s.lines().any(|line|line=="Identifier=org.pfc.quiescence.oldruntime")),
        "OLD_RUNTIME_IDENTITY_RECEIPT_MISMATCH")
}

fn validate_exit_receipt(details:&Value,association:&Value)->Result<()> {
    let observations=details["observations"].as_array().ok_or_else(||Failure::new("OLD_RUNTIME_EXIT_RECEIPT_MISMATCH","observations required"))?;
    require(observations.len()==1,"OLD_RUNTIME_EXIT_RECEIPT_MISMATCH")?;
    let mut expected=association.clone();
    let fields=expected.as_object_mut().ok_or_else(||Failure::new("OLD_RUNTIME_EXIT_RECEIPT_MISMATCH","association required"))?;
    fields.insert("target".into(),json!(true));fields.insert("state".into(),json!("EXIT_CONFIRMED"));
    fields.insert("exitCode".into(),json!(0));fields.insert("evidence".into(),json!("retained_Popen_waitpid"));
    require(observations[0]==expected,"OLD_RUNTIME_EXIT_RECEIPT_MISMATCH")
}

pub(super) fn validate(root:&Path,p:&Permit)->Result<Contract> {
    require(p.format_version==2&&p.synthetic_only&&!p.session.is_empty()&&!p.nonce.is_empty()&&!p.authorization_id.is_empty(),"V2_PERMIT_REQUIRED")?;
    let contract_hash=p.managed_contract_sha256.as_deref().filter(|v|digest_ok(v)).ok_or_else(||Failure::new("MANAGED_CONTRACT_HASH_MISSING","version 2 requires exact frozen hash"))?;
    let auth_hash=p.authorization_sha256.as_deref().filter(|v|digest_ok(v)).ok_or_else(||Failure::new("AUTHORIZATION_HASH_MISSING","version 2 requires exact frozen hash"))?;
    require(hash_file(&root.join("managed-contract.json"))?==contract_hash,"MANAGED_CONTRACT_HASH_MISMATCH")?;
    require(hash_file(&root.join("authorization.json"))?==auth_hash,"AUTHORIZATION_HASH_MISMATCH")?;
    let c:Contract=serde_json::from_value(read_json(&root.join("managed-contract.json"))?)?;
    require(c.format_version==2&&c.synthetic_only&&Path::new(&c.root)==root&&c.session==p.session&&c.authorization_id==p.authorization_id&&c.nonce==p.nonce,"MANAGED_CONTRACT_BINDING_MISMATCH")?;
    let authorization:Authorization=serde_json::from_value(read_json(&root.join("authorization.json"))?)?;
    require(authorization==c.authorization,"AUTHORIZATION_BYTES_OBJECT_MISMATCH")?;
    let a=&c.authorization;
    require(a.format_version==2&&a.synthetic_only&&a.scope=="synthetic-integration-only"&&a.id==p.authorization_id&&a.session==p.session&&a.nonce==p.nonce&&a.database_sha256==p.database_sha256&&a.backup_sha256==p.backup_sha256&&a.candidate_executable_sha256==p.executable_sha256&&a.allow_recovery==p.allow_recovery&&a.allow_wal_infrastructure==p.allow_wal_infrastructure&&a.allow_recovery&&a.allow_wal_infrastructure,"OWNER_AUTHORIZATION_BINDING_MISMATCH")?;
    require(p.database_sha256==p.backup_sha256&&[&p.database_sha256,&p.executable_sha256,&p.manifest_sha256].iter().all(|s|digest_ok(s)),"PERMIT_HASH_INVALID")?;
    let lease=regular(&root.join("maintenance.lock"))?;
    require(c.lease.path==root.join("maintenance.lock").to_string_lossy()&&c.lease.session==p.session&&Some(c.lease.dev)==p.lease_dev&&Some(c.lease.inode)==p.lease_inode&&lease.dev==c.lease.dev&&lease.inode==c.lease.inode,"LEASE_CONTRACT_MISMATCH")?;
    let lease_body=read_json(&root.join("maintenance.lock"))?;
    require(lease_body==json!({"format_version":2,"session":p.session,"authorization_id":p.authorization_id,"nonce":p.nonce}),"LEASE_SESSION_BODY_MISMATCH")?;
    let mut actual=BTreeMap::new();enumerate(&root.join("managed"),&mut actual)?;
    let mut expected=BTreeMap::new();
    for object in &c.objects {
        require(["installed","candidate","staging","archive","managed_container"].contains(&object.role.as_str())&&["file","directory"].contains(&object.kind.as_str()),"MANAGED_OBJECT_INVALID")?;
        scoped(root,&object.path)?;
        require(expected.insert(object.path.clone(),object.clone()).is_none(),"DUPLICATE_MANAGED_OBJECT")?;
    }
    require(actual.keys().eq(expected.keys()),"MANAGED_OBJECT_SET_MISMATCH")?;
    for (path,item) in &mut actual {item.role=expected[path].role.clone();require(*item==expected[path],"MANAGED_OBJECT_DRIFT")?;}
    let mut bundle_paths=BTreeSet::new();let mut executable_paths=BTreeSet::new();
    for bundle in &c.bundles {require(["installed","candidate","staging","archive","nested"].contains(&bundle.role.as_str()),"UNKNOWN_BUNDLE_ROLE")?;require(bundle_paths.insert(bundle.path.clone()),"DUPLICATE_BUNDLE")?;check_bundle(root,bundle,&actual)?;executable_paths.insert(bundle.executable.clone());}
    for role in ["installed","candidate","staging","archive"] {require(c.bundles.iter().filter(|b|b.role==role).count()==1,"REQUIRED_BUNDLE_ROLE_UNKNOWN")?;}
    let installed=c.bundles.iter().find(|b|b.role=="installed").unwrap();
    require(installed.enabled&&installed.executable==p.executable_path&&hash_file(Path::new(&installed.manifest))?==p.manifest_sha256,"INSTALLED_RUNTIME_BINDING_MISMATCH")?;
    for b in &c.bundles {require(b.role=="installed"||!b.enabled,"SECOND_ENABLED_RUNTIME")?;}
    let top:Vec<&Bundle>=c.bundles.iter().filter(|b|["installed","candidate","staging","archive"].contains(&b.role.as_str())).collect();
    for (index,first) in top.iter().enumerate() {for second in top.iter().skip(index+1) {require(!Path::new(&first.path).starts_with(&second.path)&&!Path::new(&second.path).starts_with(&first.path),"MANAGED_SOURCE_TARGET_OVERLAP")?;}}
    for b in &c.bundles {if ["candidate","staging"].contains(&b.role.as_str()) {
        require(actual[&b.executable].sha256.as_deref()==Some(p.executable_sha256.as_str())&&actual[&b.manifest].sha256.as_deref()==Some(p.manifest_sha256.as_str())&&actual[&b.info_plist].sha256==actual[&installed.info_plist].sha256,"CANDIDATE_INSTALL_BYTES_MISMATCH")?;
    }}
    // Discover matching identities independently; an unrelated outer bundle is
    // not a pruning boundary. Every descendant was already enumerated above.
    let identities:BTreeSet<&str>=c.bundles.iter().map(|b|b.bundle_id.as_str()).collect();
    let executable_names:BTreeSet<&str>=c.bundles.iter().filter_map(|b|Path::new(&b.executable).file_name().and_then(|n|n.to_str())).collect();
    let mut discovered=BTreeSet::new();
    for (path,object) in &actual {if object.kind!="file"||Path::new(path).file_name().and_then(|v|v.to_str())!=Some("Info.plist"){continue;}
        let parsed=plist(Path::new(path))?;
        let base=Path::new(path).parent().unwrap().parent().unwrap();
        let known_id=parsed.get("CFBundleIdentifier").and_then(plist::Value::as_string).is_some_and(|v|identities.contains(v));
        let known_exe=parsed.get("CFBundleExecutable").and_then(plist::Value::as_string).is_some_and(|v|executable_names.contains(v));
        if known_id||known_exe||actual.contains_key(&base.join("Contents/Resources/runtime-compatibility.json").to_string_lossy().to_string()) {
            require(path.ends_with("/Contents/Info.plist"),"RELATED_UNSUPPORTED_BUNDLE_LAYOUT")?;
            discovered.insert(base.to_string_lossy().to_string());
        }
    }
    require(discovered==bundle_paths,"NESTED_RUNTIME_NOT_ENUMERATED")?;
    let nested:BTreeSet<String>=c.bundles.iter().filter(|b|b.role=="nested").map(|b|b.path.clone()).collect();
    require(nested==c.known_nested.iter().cloned().collect()&&nested.len()==c.known_nested.len(),"NESTED_BINDING_MISMATCH")?;
    let mut routes=BTreeSet::new();
    for r in &c.launch_routes {let object=actual.get(&r.path).ok_or_else(||Failure::new("LAUNCH_ROUTE_UNKNOWN",&r.path))?;
        require(routes.insert(r.path.clone())&&object.kind=="file"&&(object.mode&0o111!=0)==r.enabled,"LAUNCH_ROUTE_BINDING_MISMATCH")?;
        require(!r.enabled||r.path==installed.executable,"SECOND_ENABLED_LAUNCH_ROUTE")?;
    }
    require(executable_paths.is_subset(&routes),"BUNDLE_LAUNCH_ROUTE_OMITTED")?;
    let image_hashes:BTreeSet<&str>=c.bundles.iter().filter_map(|b|actual[&b.executable].sha256.as_deref()).collect();
    for (path,object) in &actual {if object.kind=="file"&&object.mode&0o111!=0 {require(path==&installed.executable&&routes.contains(path),"UNDECLARED_EXECUTABLE_ROUTE")?;}}
    for (path,object) in &actual {if object.kind=="file"&&(object.sha256.as_deref().is_some_and(|hash|image_hashes.contains(hash))||Path::new(path).file_name().and_then(|v|v.to_str()).is_some_and(|name|executable_names.contains(name))) {require(routes.contains(path),"KNOWN_BARE_IMAGE_ROUTE_OMITTED")?;}}
    let mut pids=BTreeSet::new();
    for old in &c.processes {
        require(old.pid>1&&old.pid!=std::process::id() as i32&&!old.start.is_empty()&&old.state=="EXIT_CONFIRMED"&&pids.insert(old.pid),"OLD_PROCESS_ASSOCIATION_UNKNOWN")?;
        require(actual.values().any(|o|o.kind=="file"&&o.dev==old.executable_dev&&o.inode==old.executable_inode&&o.sha256.as_deref()==Some(&old.executable_sha256)&&o.mode&0o111==0),"RETAINED_PROCESS_IMAGE_MISMATCH")?;
        let alive=unsafe{libc::kill(old.pid,0)};
        require(alive<0&&std::io::Error::last_os_error().raw_os_error()==Some(libc::ESRCH),"KNOWN_OLD_PROCESS_ACTIVE_OR_UNKNOWN")?;
    }
    require(!c.processes.is_empty(),"RETAINED_OLD_PROCESS_REQUIRED")?;
    let wanted=["S0_VERIFIED_CANDIDATE","S1_MANAGED_ISOLATED","S2_OWNER_AUTHORIZED"];
    require(c.transitions.len()==wanted.len(),"MANAGED_TRANSITION_CHAIN_MISSING")?;
    for (transition,state) in c.transitions.iter().zip(wanted) {
        require(transition.state==state&&transition.path==root.join(format!("managed-state-{state}.json")).to_string_lossy(),"MANAGED_TRANSITION_PATH_MISMATCH")?;
        require(hash_file(Path::new(&transition.path))?==transition.evidence_sha256,"MANAGED_TRANSITION_HASH_MISMATCH")?;
        let record=read_json(Path::new(&transition.path))?;
        require(record["format_version"]==2&&record["synthetic_only"]==true&&record["state"]==state&&record["session"]==p.session&&record["authorization_id"]==p.authorization_id&&record["nonce"]==p.nonce&&record["details"].is_object(),"MANAGED_TRANSITION_BINDING_MISMATCH")?;
    }
    // S2's exact frozen hash transitively binds the *entire* ordered S1 chain,
    // including the disable-before-exit-before-move intermediate receipts.
    let managed_states=["S0_VERIFIED_CANDIDATE","S1_OLD_RUNTIME_RETAINED","S1_ENTRIES_DISABLED","S1_TARGET_EXIT_VERIFIED","S1_ARCHIVE_VERIFIED","S1_STAGING_VERIFIED","S1_INSTALLED_DISABLED","S1_MANAGED_ISOLATED","S2_OWNER_AUTHORIZED"];
    let mut prior:Option<String>=None;
    let mut retained_association:Option<Value>=None;
    for (index,status) in managed_states.iter().enumerate() {
        let path=root.join(format!("managed-state-{status}.json"));let record=read_json(&path)?;
        require(record["format_version"]==2&&record["synthetic_only"]==true&&record["state"]==*status&&record["session"]==p.session&&record["authorization_id"]==p.authorization_id&&record["nonce"]==p.nonce&&record["sequence"]==index+1&&record["previous_evidence_sha256"]==json!(prior),"MANAGED_ORDERED_RECEIPT_CHAIN_INVALID")?;
        prior=Some(hash_file(&path)?);
        if *status=="S1_MANAGED_ISOLATED" {require(record["details"]["objects"]==serde_json::to_value(&c.objects)?&&record["details"]["bundles"]==serde_json::to_value(&c.bundles)?&&record["details"]["known_nested"]==serde_json::to_value(&c.known_nested)?,"MANAGED_ISOLATION_RECEIPT_DRIFT")?;}
        if *status=="S2_OWNER_AUTHORIZED" {require(record["details"]["authorization"]==serde_json::to_value(&c.authorization)?&&record["details"]["lease"]==serde_json::to_value(&c.lease)?,"MANAGED_AUTHORIZATION_RECEIPT_DRIFT")?;}
        if *status=="S1_OLD_RUNTIME_RETAINED" {
            require(c.processes.len()==1,"RETAINED_ASSOCIATION_RECEIPT_MISMATCH")?;
            validate_retained_receipt(&record["details"],&c.processes[0],&p.session)?;
            retained_association=Some(record["details"]["association"].clone());
        }
        if *status=="S1_TARGET_EXIT_VERIFIED" {
            let association=retained_association.as_ref().ok_or_else(||Failure::new("OLD_RUNTIME_EXIT_RECEIPT_MISMATCH","retained association missing"))?;
            validate_exit_receipt(&record["details"],association)?;
        }
    }
    // Re-read the frozen bytes after the full traversal, not merely beforehand.
    require(hash_file(&root.join("managed-contract.json"))?==contract_hash&&hash_file(&root.join("authorization.json"))?==auth_hash,"FROZEN_CONTRACT_DRIFT")?;
    Ok(c)
}

pub(super) fn phase(state:&str)->Option<u64> {match state {
    "VERIFIED_CANDIDATE"=>Some(0),"MANAGED_ISOLATED"=>Some(1),"OWNER_AUTHORIZED"=>Some(2),
    "PERMIT_CONSUMED"=>Some(3),"CONNECTION_PREPARED"=>Some(4),"QUIESCENCE_ACQUIRED"=>Some(5),
    "V3_REVALIDATED"=>Some(6),"MIGRATION_IN_PROGRESS"=>Some(7),"COMMIT_OUTCOME_UNKNOWN"=>Some(8),
    "V4_COMMITTED_PENDING_VERIFICATION"|"POST_READBACK_GUARDED"=>Some(9),"V4_VERIFIED"=>Some(10),_=>None}}

fn state_rule(state:&str,phase:u64)->Value {
    let entries=["candidate/self/plist/manifest/tree exact bytes and identity independently checked",
        "closed managed inventory; all old pid associations absent; archive/staging/candidate disabled",
        "exact session/nonce/authorization and contract hashes bound; live lease",
        "atomic claim and fsynced consumed permit readback before opening C",
        "one native C; no CREATE; fixed main object; delete/exclusive/0ms/fullsync profile verified",
        "same C BEGIN EXCLUSIVE and native file-control guard checked",
        "same C full V3 schema/integrity/FK, exact C0/helper hash, backup and full runtime rechecked",
        "same C and transaction; fixed approved M4 only; original business snapshot retained",
        "same C V4 schema and business snapshot checked; commit outcome durably unknown before COMMIT",
        "same C after COMMIT; exclusive lock still held; full V4/legacy data/hash/runtime verified",
        "guarded evidence durably read back; post-callback runtime/lease recheck; explicit close C then L"];
    let failed=matches!(state,"FAILED_V3_CONFIRMED"|"GUARD_LOST_OR_UNPROVEN");
    json!({"entry":entries[phase as usize],"allowed_next":if failed{Value::String("explicit separately-authorized recovery only".into())}else if phase==10{Value::String("separate compatible handoff authorization on restart".into())}else{json!(phase+1)},
        "failure":"preserve consumed permit, exact latest durable phase and failure; never restore runtime/DB or infer outcome from schema",
        "restart":"ordinary financial startup blocked; read-only diagnosis, then separately-authorized independent recovery",
        "evidence":"immutable hash-linked native-state-NNN.json, atomically replaced outcome.json, callback events"})
}

pub(super) fn persist_state(root:&Path,p:&Permit,status:&str,details:Value)->Result<()> {
    let previous=if root.join("outcome.json").exists(){Some(read_json(&root.join("outcome.json"))?)}else{None};
    let previous_hash=if previous.is_some(){Some(hash_file(&root.join("outcome.json"))?)}else{None};
    let sequence=previous.as_ref().and_then(|v|v["sequence"].as_u64()).map_or(0,|v|v+1);
    let prior_phase=previous.as_ref().and_then(|v|v["phase"].as_u64());
    let target=phase(status).or(prior_phase).unwrap_or(0);
    if let Some(old)=&previous {
        require(old["format_version"]==2&&old["session"]==p.session&&old["nonce"]==p.nonce&&old["authorization_id"]==p.authorization_id&&old["managed_contract_sha256"]==json!(p.managed_contract_sha256),"DURABLE_STATE_BINDING_MISMATCH")?;
        if let Some(next)=phase(status) {let prior=prior_phase.ok_or_else(||Failure::new("DURABLE_PHASE_INVALID","missing phase"))?;
            require(next==prior||next==prior+1||status=="COMMIT_OUTCOME_UNKNOWN"&&prior>=8,"ILLEGAL_STATE_TRANSITION")?;
        }
    } else {require(status=="VERIFIED_CANDIDATE","MISSING_INITIAL_STATE")?;}
    let record=json!({"format_version":2,"synthetic_only":true,"sequence":sequence,"phase":target,"state":status,
        "session":p.session,"nonce":p.nonce,"authorization_id":p.authorization_id,
        "managed_contract_sha256":p.managed_contract_sha256,"authorization_sha256":p.authorization_sha256,
        "object_binding":{"executable_path":p.executable_path,"executable_sha256":p.executable_sha256,"manifest_sha256":p.manifest_sha256,"database_c0_sha256":p.database_sha256,"backup_sha256":p.backup_sha256,"lease_dev":p.lease_dev,"lease_inode":p.lease_inode},
        "previous_record_sha256":previous_hash,"pid":std::process::id(),
        "restart":"ordinary-startup-blocked; explicit diagnostic/recovery authorization required",
        "state_contract":state_rule(status,target),
        "details":details});
    let name=format!("native-state-{sequence:03}.json");
    require(!present_or_unreadable(&root.join(&name)),"STATE_RECEIPT_REPLAY")?;
    durable(root,&name,&record)?;durable(root,"outcome.json",&record)?;
    require(read_json(&root.join("outcome.json"))?==record&&read_json(&root.join(name))?==record,"STATE_READBACK_FAILED")
}

pub(super) fn verify_chain(root:&Path,p:&Permit)->Result<Value> {
    let outcome=read_json(&root.join("outcome.json"))?;
    let sequence=outcome["sequence"].as_u64().filter(|s|*s<=1000).ok_or_else(||Failure::new("DURABLE_STATE_INVALID","sequence"))?;
    let mut previous:Option<String>=None;let mut previous_phase:Option<u64>=None;
    for n in 0..=sequence {
        let path=root.join(format!("native-state-{n:03}.json"));let record=read_json(&path)?;
        require(record["sequence"]==n&&record["format_version"]==2&&record["synthetic_only"]==true&&record["session"]==p.session&&record["nonce"]==p.nonce&&record["authorization_id"]==p.authorization_id&&record["managed_contract_sha256"]==json!(p.managed_contract_sha256)&&record["authorization_sha256"]==json!(p.authorization_sha256)&&record["previous_record_sha256"]==json!(previous),"DURABLE_CHAIN_MISMATCH")?;
        let status=record["state"].as_str().ok_or_else(||Failure::new("DURABLE_STATE_INVALID","state"))?;
        let current_phase=record["phase"].as_u64().filter(|v|*v<=10).ok_or_else(||Failure::new("DURABLE_PHASE_INVALID","phase"))?;
        if n==0 {require(status=="VERIFIED_CANDIDATE"&&current_phase==0,"DURABLE_CHAIN_INITIAL_INVALID")?;}
        else {
            let prior=previous_phase.unwrap();
            if let Some(expected)=phase(status) {require(expected==current_phase&&(current_phase==prior||current_phase==prior+1||status=="COMMIT_OUTCOME_UNKNOWN"&&prior>=8),"DURABLE_CHAIN_TRANSITION_INVALID")?;}
            else {require(["FAILED_V3_CONFIRMED","GUARD_LOST_OR_UNPROVEN"].contains(&status)&&current_phase==prior,"DURABLE_CHAIN_FAILURE_INVALID")?;}
        }
        if n==sequence {require(record==outcome,"DURABLE_OUTCOME_MISMATCH")?;}
        previous=Some(hash_file(&path)?);previous_phase=Some(current_phase);
    }
    for entry in fs::read_dir(root)? {let name=entry?.file_name().to_string_lossy().to_string();
        require(!(name.ends_with(".pending")&&(name.starts_with("native-state-")||name=="outcome.json.pending"||name=="consumed.json.pending")),"DURABLE_STATE_PENDING")?;
        if name.starts_with("native-state-")&&name.ends_with(".json") {
            let number=name.trim_start_matches("native-state-").trim_end_matches(".json").parse::<u64>().map_err(|_|Failure::new("DURABLE_EXTRA_RECEIPT","unrecognized receipt filename"))?;
            require(number<=sequence&&name==format!("native-state-{number:03}.json"),"DURABLE_EXTRA_RECEIPT")?;
        }
    }
    Ok(outcome)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    fn old_receipt()->(Process,Value) {
        let old=Process{pid:12345,start:"Fri Oct 9 2026".into(),executable_sha256:"a".repeat(64),executable_dev:1,executable_inode:2,state:"EXIT_CONFIRMED".into()};
        let readiness=json!({"protocol":"pfc.synthetic-old-runtime.ready.v1","pid":old.pid,"session":"s","initialized":true,"executable_sha256":old.executable_sha256});
        let details=json!({"association":{"pid":old.pid,"start":old.start,"identity":old.executable_sha256,
            "executable_sha256":old.executable_sha256,"executable_dev":1,"executable_inode":2,"readiness":readiness,
            "signature":{"signature_verified":true,"signature_details":"Identifier=org.pfc.quiescence.oldruntime\n"}},
            "start_evidence":{"pid":old.pid,"value":old.start,"returncode":0,"collector":"ps_exact_retained_child_lstart","ownership":"retained_Popen_waitpid","readiness":readiness}});
        (old,details)
    }
    #[test] fn s1_readiness_semantics_reject_rehashed_false_claims() {
        let (old,valid)=old_receipt();validate_retained_receipt(&valid,&old,"s").unwrap();
        for (pointer,replacement) in [
            ("/association/readiness/protocol",json!("generic-ready")),("/association/readiness/session",json!("other")),
            ("/association/readiness/pid",json!(12346)),("/association/readiness/initialized",json!(false)),
            ("/association/readiness/executable_sha256",json!("b".repeat(64))),
            ("/association/executable_dev",json!(3)),("/association/executable_inode",json!(3)),
            ("/association/identity",json!("b".repeat(64))),
            ("/association/signature/signature_verified",json!(false)),
            ("/association/signature/signature_details",json!("Identifier=org.pfc.quiescence.oldruntime.evil\n")),
            ("/start_evidence/ownership",json!("kill-zero")),("/start_evidence/value",json!("other-start")),
            ("/start_evidence/returncode",json!(1)),("/start_evidence/readiness",Value::Null),
        ] {let mut changed=valid.clone();*changed.pointer_mut(pointer).unwrap()=replacement;
            assert!(validate_retained_receipt(&changed,&old,"s").is_err(),"accepted {pointer}");}
        let mut missing=valid.clone();missing["association"].as_object_mut().unwrap().remove("readiness");
        assert!(validate_retained_receipt(&missing,&old,"s").is_err());
    }
    #[test] fn s1_exit_requires_exact_retained_association_zero_exit_and_waitpid() {
        let (_,retained)=old_receipt();let association=&retained["association"];
        let mut observed=association.clone();observed["target"]=json!(true);observed["state"]=json!("EXIT_CONFIRMED");
        observed["exitCode"]=json!(0);observed["evidence"]=json!("retained_Popen_waitpid");
        let valid=json!({"complete":true,"observations":[observed]});validate_exit_receipt(&valid,association).unwrap();
        for (field,value) in [("pid",json!(12346)),("start",json!("wrong")),("executable_inode",json!(3)),
            ("exitCode",json!(-15)),("exitCode",Value::Null),("target",json!(false)),("state",json!("ACTIVE")),
            ("evidence",json!("kill-zero")),("readiness",Value::Null)] {
            let mut changed=valid.clone();changed["observations"][0][field]=value;
            assert!(validate_exit_receipt(&changed,association).is_err(),"accepted {field}");
        }
        for observations in [json!([]),json!([observed.clone(),observed]),Value::Null] {
            assert!(validate_exit_receipt(&json!({"complete":true,"observations":observations}),association).is_err());
        }
    }
    static SEQ:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {fn new()->Self {
        let n=SEQ.fetch_add(1,std::sync::atomic::Ordering::Relaxed);
        let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
        let raw=std::env::temp_dir().join(format!("pfc-native-contract-{}-{now}-{n}",std::process::id()));
        fs::create_dir(&raw).unwrap();let root=fs::canonicalize(raw).unwrap();fs::write(root.join("SYNTHETIC_ONLY"),MARKER).unwrap();Self(root)
    }}
    impl Drop for Fixture {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    fn permit()->Permit {serde_json::from_value(json!({"format_version":2,"synthetic_only":true,"session":"s","nonce":"n","authorization_id":"a","database_sha256":"a".repeat(64),"backup_sha256":"a".repeat(64),"executable_path":"/synthetic/executable","executable_sha256":"b".repeat(64),"manifest_sha256":"c".repeat(64),"allow_recovery":true,"allow_wal_infrastructure":true,"managed_contract_sha256":"d".repeat(64),"authorization_sha256":"e".repeat(64),"lease_dev":1,"lease_inode":2})).unwrap()}
    fn chain(root:&Path,p:&Permit,last:usize) {
        let states=["VERIFIED_CANDIDATE","MANAGED_ISOLATED","OWNER_AUTHORIZED","PERMIT_CONSUMED","CONNECTION_PREPARED","QUIESCENCE_ACQUIRED","V3_REVALIDATED","MIGRATION_IN_PROGRESS","COMMIT_OUTCOME_UNKNOWN","V4_COMMITTED_PENDING_VERIFICATION","V4_VERIFIED"];
        for state in states.iter().take(last+1) {persist_state(root,p,state,json!({"test_fixture":true})).unwrap();}
        durable(root,"consumed.json",&serde_json::to_value(p).unwrap()).unwrap();
        durable(root,"permit.claimed.json",&serde_json::to_value(p).unwrap()).unwrap();
    }
    #[test] fn protocol_rejects_unknown_fields_and_missing_objects(){assert!(serde_json::from_value::<Contract>(json!({"format_version":2,"complete":true})).is_err());}
    #[test] fn state_mapping_is_explicit_not_schema_based(){assert_eq!(phase("V3_REVALIDATED"),Some(6));assert_eq!(phase("POST_READBACK_GUARDED"),Some(9));assert_eq!(phase("schema=4"),None);assert_eq!(phase("FAILED_V3_CONFIRMED"),None);}
    #[test] fn hash_requires_exact_canonical_digest(){assert!(digest_ok(&"a".repeat(64)));assert!(!digest_ok(&"A".repeat(64)));assert!(!digest_ok(""));}
    #[test] fn omitted_phase_cannot_skip_to_migration(){let f=Fixture::new();let p=permit();persist_state(&f.0,&p,"VERIFIED_CANDIDATE",json!({})).unwrap();assert_eq!(persist_state(&f.0,&p,"MIGRATION_IN_PROGRESS",json!({})).unwrap_err().code,"ILLEGAL_STATE_TRANSITION");}
    #[test] fn seven_real_persisted_classifications_never_open_a_database(){
        for (phase,status) in [(3,"PERMIT_CONSUMED"),(5,"QUIESCENCE_ACQUIRED"),(7,"MIGRATION_IN_PROGRESS"),(8,"COMMIT_OUTCOME_UNKNOWN"),(9,"V4_COMMITTED_PENDING_VERIFICATION"),(7,"FAILED_V3_CONFIRMED"),(7,"GUARD_LOST_OR_UNPROVEN")] {
            let f=Fixture::new();let p=permit();chain(&f.0,&p,phase);
            if phase==7&&status!="MIGRATION_IN_PROGRESS" {persist_state(&f.0,&p,status,json!({"safe_terminal":false})).unwrap();}
            fs::write(f.0.join(DB),b"This is not SQLite and diagnostic must not touch it").unwrap();
            let original=fs::read(f.0.join(DB)).unwrap();let result=diagnostic_integrated(f.0.to_str().unwrap()).unwrap();
            assert_eq!(result["state"],status);assert_eq!(result["startupBlocked"],true);assert_eq!(fs::read(f.0.join(DB)).unwrap(),original);
        }
    }
    #[test] fn saved_receipt_ahead_of_outcome_is_pending_not_verified(){let f=Fixture::new();let p=permit();chain(&f.0,&p,3);durable(&f.0,"native-state-004.json",&json!({"unexpected":"later receipt"})).unwrap();assert_eq!(verify_chain(&f.0,&p).unwrap_err().code,"DURABLE_EXTRA_RECEIPT");}
    #[test] fn tampered_durable_phase_is_not_inferred_from_its_state(){let f=Fixture::new();let p=permit();chain(&f.0,&p,3);let mut last=read_json(&f.0.join("outcome.json")).unwrap();last["phase"]=json!(10);durable(&f.0,"native-state-003.json",&last).unwrap();durable(&f.0,"outcome.json",&last).unwrap();assert_eq!(verify_chain(&f.0,&p).unwrap_err().code,"DURABLE_CHAIN_TRANSITION_INVALID");}
    #[test] fn corrupt_chain_pending_and_claim_binding_fail_closed(){
        for kind in ["corrupt","pending","binding"] {let f=Fixture::new();let p=permit();chain(&f.0,&p,3);
            match kind {"corrupt"=>fs::write(f.0.join("native-state-001.json"),b"{}").unwrap(),"pending"=>fs::write(f.0.join("outcome.json.pending"),b"{}").unwrap(),_=>{let mut claim=serde_json::to_value(&p).unwrap();claim["nonce"]=json!("wrong");durable(&f.0,"permit.claimed.json",&claim).unwrap();}}
            let result=diagnostic_integrated(f.0.to_str().unwrap()).unwrap();assert_eq!(result["state"],"GUARD_LOST_OR_UNPROVEN");assert_eq!(result["startupBlocked"],true);
        }
    }
    #[test] fn managed_only_partial_attempt_is_not_not_started(){let f=Fixture::new();fs::write(f.0.join("managed-state-S1_ENTRIES_DISABLED.json"),b"{}").unwrap();assert_eq!(diagnostic_integrated(f.0.to_str().unwrap()).unwrap()["startupBlocked"],true);}
    #[test] fn alias_hardlink_and_symlink_are_rejected_by_native_traversal(){
        for kind in ["alias","hardlink","symlink"] {let f=Fixture::new();let root=f.0.join("managed");fs::create_dir(&root).unwrap();let file=root.join("source");fs::write(&file,b"x").unwrap();
            match kind {"alias"=>fs::write(root.join("old.alias"),b"x").unwrap(),"hardlink"=>fs::hard_link(&file,root.join("other")).unwrap(),_=>std::os::unix::fs::symlink(&file,root.join("other")).unwrap()};
            assert!(enumerate(&root,&mut BTreeMap::new()).is_err());
        }
    }
    #[test] fn native_walk_preserves_extra_disabled_and_enabled_objects(){let f=Fixture::new();let root=f.0.join("managed");fs::create_dir(&root).unwrap();let helper=root.join("hidden-helper");fs::write(&helper,b"x").unwrap();fs::set_permissions(&helper,fs::Permissions::from_mode(0o700)).unwrap();let mut actual=BTreeMap::new();enumerate(&root,&mut actual).unwrap();assert_eq!(actual.len(),2);assert_eq!(actual[helper.to_str().unwrap()].mode,0o700);}
    #[test] fn lease_body_replacement_and_inode_recreation_are_detected(){
        for changed in ["body","inode"] {let f=Fixture::new();let path=f.0.join("maintenance.lock");let body=json!({"format_version":2,"session":"a","authorization_id":"a","nonce":"a"});fs::write(&path,serde_json::to_vec(&body).unwrap()).unwrap();let file=OpenOptions::new().read(true).write(true).open(&path).unwrap();assert_eq!(unsafe{libc::flock(file.as_raw_fd(),libc::LOCK_EX|libc::LOCK_NB)},0);let lease=Lease{initial:regular(&path).unwrap(),path:path.clone(),_fd:file,session_body:Some(body.clone())};lease.validate().unwrap();
            if changed=="body" {let mut wrong=body.clone();wrong["session"]=json!("b");fs::write(&path,serde_json::to_vec(&wrong).unwrap()).unwrap();assert_eq!(lease.validate().unwrap_err().code,"LEASE_SESSION_BODY_MISMATCH");}
            else {fs::rename(&path,f.0.join("old-lock")).unwrap();fs::write(&path,serde_json::to_vec(&body).unwrap()).unwrap();assert_eq!(lease.validate().unwrap_err().code,"LEASE_IDENTITY_MISMATCH");}
        }
    }
    #[test] fn missing_wrong_or_replayed_recovery_authority_never_opens_db(){
        for kind in ["missing","session","nonce","authorization","action","replay"] {
            let f=Fixture::new();let p=permit();chain(&f.0,&p,8);
            fs::write(f.0.join(DB),b"not SQLite; must not be opened").unwrap();
            let mut authorization=json!({"format_version":2,"synthetic_only":true,"scope":"synthetic-recovery-handoff-only","authorization_id":"recovery-a","session":"s","nonce":"recovery-n","managed_contract_sha256":p.managed_contract_sha256,"consumed_sha256":hash_file(&f.0.join("consumed.json")).unwrap(),"outcome_sha256":hash_file(&f.0.join("outcome.json")).unwrap(),"action":"verify-v4-handoff","expected_database_sha256":"f".repeat(64)});
            match kind {"session"=>authorization["session"]=json!("wrong"),"nonce"=>authorization["nonce"]=json!(p.nonce),"authorization"=>authorization["authorization_id"]=json!(p.authorization_id),"action"=>authorization["action"]=json!("restore-db"),"replay"=>durable(&f.0,"recovery-consumed.json",&json!({})).unwrap(),_=>{}}
            if kind!="missing" {durable(&f.0,"recovery-authorization.json",&authorization).unwrap();}
            let error=recover_integrated(f.0.to_str().unwrap(),f.0.join("recovery-authorization.json").to_str().unwrap(),&|_,_|Ok(())).unwrap_err();
            assert_eq!(error.code,match kind {"missing"=>"IO_ERROR","action"=>"RECOVERY_ACTION_FORBIDDEN","replay"=>"RECOVERY_AUTHORIZATION_REPLAY",_=>"RECOVERY_AUTHORIZATION_BINDING_MISMATCH"});
            assert_eq!(fs::read(f.0.join(DB)).unwrap(),b"not SQLite; must not be opened");
        }
    }
}
