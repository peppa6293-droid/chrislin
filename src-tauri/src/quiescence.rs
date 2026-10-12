//! Synthetic-only implementation of the native cutover ownership boundary.
//! Linked only into explicit synthetic fixture / IPC runtimes, not Production.
//! No arbitrary SQL or target path is accepted by the migration runner.
use rusqlite::{config::DbConfig, Connection, OpenFlags};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{fs::{self, File, OpenOptions}, io::{Read, Write, BufRead}, os::unix::{fs::{MetadataExt, OpenOptionsExt, PermissionsExt}, io::{AsRawFd, FromRawFd}}, path::{Path, PathBuf}, process::{Command, Stdio}, time::{Duration, Instant}};

pub type Result<T> = std::result::Result<T, Failure>;
pub type EventCallback = dyn Fn(&str, Value) -> Result<()> + Send + Sync;
#[path = "quiescence_contract.rs"]
mod contract;
#[path = "quiescence_recovery.rs"]
mod recovery;
const DB: &str = "personal-finance-console.sqlite3";
const MARKER: &str = "PFC_QUIESCENCE_SYNTHETIC_V1\n";
const UNIFIED_MARKER: &[u8] = b"PFC_WP04_SYNTHETIC_CUTOVER_V1\n";
const M4: &str = include_str!("../../migrations/004.sql");
const V3: &str = include_str!("../../migrations/v3-schema.json");
const V4: &str = include_str!("../../migrations/v4-schema.json");

#[derive(Debug, Serialize)]
pub struct Failure { pub code: String, pub detail: String, pub sqlite_primary: Option<i32>, pub sqlite_extended: Option<i32> }
impl Failure { pub fn new(code: &str, detail: impl ToString) -> Self { Self { code: code.into(), detail: detail.to_string(), sqlite_primary: None, sqlite_extended: None } } }
impl From<std::io::Error> for Failure { fn from(e: std::io::Error) -> Self { Self::new("IO_ERROR", e) } }
impl From<serde_json::Error> for Failure { fn from(e: serde_json::Error) -> Self { Self::new("INVALID_PROTOCOL", e) } }
impl From<rusqlite::Error> for Failure {
    fn from(e: rusqlite::Error) -> Self {
        let mut result = Self::new("SQLITE_ERROR", &e);
        if let rusqlite::Error::SqliteFailure(ref err, _) = e { result.sqlite_primary = Some(err.extended_code & 255); result.sqlite_extended = Some(err.extended_code); }
        result
    }
}
fn require(ok: bool, code: &str) -> Result<()> { if ok { Ok(()) } else { Err(Failure::new(code, code)) } }
fn failpoint(name: &str) -> bool { std::env::var("PFC_Q_FAIL").ok().as_deref() == Some(name) }
fn present_or_unreadable(path:&Path)->bool {match fs::symlink_metadata(path){Err(error) if error.kind()==std::io::ErrorKind::NotFound=>false,_=>true}}

#[derive(Deserialize, Serialize, Clone)]
#[serde(deny_unknown_fields)]
struct Permit {
    format_version: u32, synthetic_only: bool, session: String, nonce: String,
    authorization_id: String, database_sha256: String, backup_sha256: String,
    executable_path: String, executable_sha256: String, manifest_sha256: String,
    allow_recovery: bool, allow_wal_infrastructure: bool,
    #[serde(default, skip_serializing_if="Option::is_none")]
    managed_contract_sha256: Option<String>,
    #[serde(default, skip_serializing_if="Option::is_none")]
    authorization_sha256: Option<String>,
    #[serde(default, skip_serializing_if="Option::is_none")]
    lease_dev: Option<u64>,
    #[serde(default, skip_serializing_if="Option::is_none")]
    lease_inode: Option<u64>,
}
#[derive(Deserialize, Serialize, Debug, Clone, PartialEq)]
struct Identity { dev: u64, inode: u64, size: u64, links: u64 }
fn identity(m: &fs::Metadata) -> Identity { Identity { dev:m.dev(), inode:m.ino(), size:m.len(), links:m.nlink() } }
fn regular(path: &Path) -> Result<Identity> {
    let m = fs::symlink_metadata(path)?;
    require(m.is_file() && !m.file_type().is_symlink() && m.nlink() == 1, "UNSAFE_FILE_IDENTITY")?;
    Ok(identity(&m))
}
fn root_checked(raw: &str) -> Result<PathBuf> {
    let root = fs::canonicalize(raw)?;
    let temp = fs::canonicalize(std::env::temp_dir())?;
    require(root != temp && root.starts_with(&temp), "NOT_SYNTHETIC_TEMP_ROOT")?;
    require(Path::new(raw) == root, "ROOT_MUST_BE_CANONICAL")?;
    regular(&root.join("SYNTHETIC_ONLY"))?;
    require(fs::read_to_string(root.join("SYNTHETIC_ONLY"))? == MARKER, "MISSING_SYNTHETIC_MARKER")?;
    require(!root.to_string_lossy().contains("com.personalfinance.console"), "PRODUCTION_NAMESPACE_REFUSED")?;
    Ok(root)
}
fn hash_file(path: &Path) -> Result<String> {
    let initial = regular(path)?;
    let mut f = OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC).open(path)?;
    require(identity(&f.metadata()?) == initial, "FILE_CHANGED_AT_OPEN")?;
    let mut hash=Sha256::new(); let mut buffer=[0u8;65536];
    loop { let n=f.read(&mut buffer)?; if n==0 { break; } hash.update(&buffer[..n]); }
    require(identity(&f.metadata()?) == initial && regular(path)? == initial, "FILE_CHANGED_DURING_HASH")?;
    Ok(format!("{:x}",hash.finalize()))
}
fn sync_dir(root: &Path) -> Result<()> { File::open(root)?.sync_all()?; Ok(()) }
fn durable(root: &Path, name: &str, data: &Value) -> Result<()> {
    let pending=root.join(format!("{name}.pending"));
    let mut f=OpenOptions::new().write(true).create_new(true).mode(0o600).open(&pending)?;
    serde_json::to_writer(&mut f,data)?; f.write_all(b"\n")?; f.sync_all()?;
    fs::rename(pending,root.join(name))?; sync_dir(root)
}
struct Lease { _fd:File, path:PathBuf, initial:Identity, session_body:Option<Value> }
impl Lease {
    fn inherited(root:&Path, session:&str)->Result<Self> {
        require(std::env::var("PFC_QUIESCENCE_SESSION").ok().as_deref()==Some(session),"SESSION_MISMATCH")?;
        require(std::env::var("PFC_QUIESCENCE_LEASE_PATH").ok().as_deref()==root.join("maintenance.lock").to_str(),"LEASE_PATH_MISMATCH")?;
        let fd:i32=std::env::var("PFC_QUIESCENCE_LEASE_FD").map_err(|_|Failure::new("LEASE_MISSING","inherited fd required"))?.parse().map_err(|_|Failure::new("LEASE_INVALID","fd"))?;
        require(fd>2,"LEASE_INVALID")?;
        // Duplicate ownership locally, immediately prevent propagation to the helper.
        let duplicate=unsafe { libc::fcntl(fd,libc::F_DUPFD_CLOEXEC,3) };
        require(duplicate>=0,"LEASE_INVALID")?;
        let file=unsafe{File::from_raw_fd(duplicate)};
        require(identity(&file.metadata()?)==regular(&root.join("maintenance.lock"))?,"LEASE_IDENTITY_MISMATCH")?;
        require(unsafe{libc::fcntl(fd,libc::F_SETFD,libc::FD_CLOEXEC)}==0,"LEASE_CLOEXEC_FAILED")?;
        // Before attempting the inherited lock, prove the gate already owns it.
        // Acquiring first would wrongly accept an unlocked inherited descriptor.
        let probe=OpenOptions::new().read(true).write(true).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC).open(root.join("maintenance.lock"))?;
        let acquired=unsafe{libc::flock(probe.as_raw_fd(),libc::LOCK_EX|libc::LOCK_NB)};
        require(acquired != 0,"LEASE_HANDOFF_UNPROVEN")?;
        require(std::io::Error::last_os_error().raw_os_error()==Some(libc::EWOULDBLOCK),"LEASE_PROBE_UNKNOWN")?;
        require(unsafe{libc::flock(file.as_raw_fd(),libc::LOCK_EX|libc::LOCK_NB)}==0,"LEASE_NOT_HELD")?;
        let initial=regular(&root.join("maintenance.lock"))?;
        let session_body=fs::read(root.join("maintenance.lock")).ok().and_then(|b|serde_json::from_slice::<Value>(&b).ok()).filter(|v|v["format_version"]==2);
        if let Some(body)=&session_body {require(body["session"]==session,"LEASE_SESSION_BODY_MISMATCH")?;}
        Ok(Self{_fd:file,path:root.join("maintenance.lock"),initial,session_body})
    }
    fn validate(&self)->Result<()> {
        require(identity(&self._fd.metadata()?)==self.initial && regular(&self.path)?==self.initial,"LEASE_IDENTITY_MISMATCH")?;
        if let Some(expected)=&self.session_body {require(contract::read_json(&self.path)?==*expected,"LEASE_SESSION_BODY_MISMATCH")?;}
        // A separate descriptor must remain contended. Reacquiring first could
        // conceal an unlocked interval or a different process's lock.
        let probe=OpenOptions::new().read(true).write(true).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC).open(&self.path)?;
        let acquired=unsafe{libc::flock(probe.as_raw_fd(),libc::LOCK_EX|libc::LOCK_NB)};
        require(acquired!=0 && std::io::Error::last_os_error().raw_os_error()==Some(libc::EWOULDBLOCK),"LEASE_CONTINUITY_UNPROVEN")?;
        require(unsafe{libc::flock(self._fd.as_raw_fd(),libc::LOCK_EX|libc::LOCK_NB)}==0,"LEASE_NOT_HELD")
    }
}
#[derive(Serialize, Deserialize)]
struct HashResult { session:String, role:String, identity:Identity, sha256:String, header_read:u8, header_write:u8, inherited_db_fds:Vec<i32> }
fn matching_fds(id:&Identity)->Vec<i32> {
    let mut output=Vec::new();
    let max=unsafe{libc::sysconf(libc::_SC_OPEN_MAX)}.clamp(256,65536) as i32;
    for fd in 3..max { let mut stat=std::mem::MaybeUninit::<libc::stat>::uninit();
        if unsafe{libc::fstat(fd,stat.as_mut_ptr())}==0 { let stat=unsafe{stat.assume_init()}; if stat.st_dev as u64==id.dev && stat.st_ino as u64==id.inode { output.push(fd); } }
    } output
}
fn hash_role(root:&Path)->Result<()> {
    let mut line=String::new(); std::io::stdin().read_line(&mut line)?;
    let request:Value=serde_json::from_str(&line)?;
    let permit_path=if root.join("permit.claimed.json").exists(){root.join("permit.claimed.json")}else{root.join("permit.json")};
    let permit:Permit=serde_json::from_slice(&fs::read(permit_path)?)?;
    require(request["session"]==permit.session && request["role"]=="fixed-db-hash", "HASH_ROLE_MISMATCH")?;
    let path=root.join(DB); let id=regular(&path)?;
    let inherited=matching_fds(&id); require(inherited.is_empty(),"HASH_INHERITED_SQLITE_FD")?;
    let mut f=OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC).open(&path)?;
    require(identity(&f.metadata()?)==id,"HASH_OBJECT_CHANGED")?;
    let mut hasher=Sha256::new(); let mut header=[0u8;100]; f.read_exact(&mut header)?; hasher.update(header);
    require(&header[..16]==b"SQLite format 3\0","INVALID_DB_HEADER")?;
    let mut buffer=[0u8;65536]; loop {let n=f.read(&mut buffer)?;if n==0{break;}hasher.update(&buffer[..n]);}
    require(identity(&f.metadata()?)==id && regular(&path)?==id,"HASH_OBJECT_CHANGED")?;
    println!("{}",serde_json::to_string(&HashResult{session:permit.session,role:"fixed-db-hash".into(),identity:id,sha256:format!("{:x}",hasher.finalize()),header_read:header[18],header_write:header[19],inherited_db_fds:inherited})?);
    Ok(())
}
fn safe_hash(root:&Path,permit:&Permit)->Result<HashResult> {
    let id=regular(&root.join(DB))?;
    require(hash_file(Path::new(&permit.executable_path))?==permit.executable_sha256,"HASH_EXECUTABLE_DRIFT")?;
    for fd in matching_fds(&id) {require(unsafe{libc::fcntl(fd,libc::F_GETFD)} & libc::FD_CLOEXEC != 0,"SQLITE_FD_NOT_CLOEXEC")?;}
    let mut child=Command::new(&permit.executable_path).args(["hash",root.to_str().unwrap()]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn()?;
    let locked=root.join("outcome.json").exists() && serde_json::from_slice::<Value>(&fs::read(root.join("outcome.json"))?)?["state"]=="QUIESCENCE_ACQUIRED";
    if !failpoint("hash_timeout") && !(locked&&failpoint("hash_locked_timeout")) { let mut input=child.stdin.take().unwrap(); writeln!(input,"{}",json!({"session":permit.session,"role":"fixed-db-hash"}))?; }
    let start=Instant::now(); loop {
        if child.try_wait()?.is_some(){break;}
        if start.elapsed()>Duration::from_secs(3){child.kill()?;child.wait()?;return Err(Failure::new("HASH_TIMEOUT","helper killed and reaped"));}
        std::thread::sleep(Duration::from_millis(5));
    }
    let out=child.wait_with_output()?;require(out.status.success(),"HASH_HELPER_FAILED")?;
    let mut result:HashResult=serde_json::from_slice(&out.stdout)?;
    if locked&&failpoint("hash_locked_mismatch"){result.identity.inode=result.identity.inode.wrapping_add(1);}
    require(result.session==permit.session && result.role=="fixed-db-hash" && result.identity==id && result.inherited_db_fds.is_empty(),"HASH_BINDING_MISMATCH")?;
    Ok(result)
}
fn candidate(root:&Path,p:&Permit,db:&Identity)->Result<()> {
    let exe=fs::canonicalize(std::env::current_exe()?)?;
    require(exe.to_str()==Some(&p.executable_path),"CANDIDATE_PATH_MISMATCH")?;
    for name in ["backup.sqlite3","manifest.json"] { let id=regular(&root.join(name))?;require((id.dev,id.inode)!=(db.dev,db.inode),"DB_ALIAS_REFUSED")?; }
    require(hash_file(&exe)?==p.executable_sha256,"CANDIDATE_HASH_MISMATCH")?;
    require(hash_file(&root.join("manifest.json"))?==p.manifest_sha256,"MANIFEST_HASH_MISMATCH")?;
    require(hash_file(&root.join("backup.sqlite3"))?==p.backup_sha256,"BACKUP_HASH_MISMATCH")?;
    if p.format_version==2 {contract::validate(root,p)?;}
    Ok(())
}
fn sidecars(root:&Path,allow_journal:bool,db:&Identity)->Result<Value> {
    let mut result=serde_json::Map::new();
    for suffix in ["-wal","-shm","-journal"] {
        let path=root.join(format!("{DB}{suffix}"));
        match fs::symlink_metadata(&path) {
            Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{result.insert(suffix.into(),Value::Null);},
            Err(e)=>return Err(e.into()),
            Ok(_)=>{let id=regular(&path)?;require((id.dev,id.inode)!=(db.dev,db.inode),"SIDECAR_DB_ALIAS")?;
                require(suffix=="-journal"&&allow_journal,"SIDECAR_UNEXPECTED")?;
                result.insert(suffix.into(),serde_json::to_value(id)?);
            }
        }
    } Ok(Value::Object(result))
}
fn file_control(c:&Connection,op:i32)->Result<i32> {
    let mut result=-1i32;
    let code=unsafe{rusqlite::ffi::sqlite3_file_control(c.handle(),b"main\0".as_ptr().cast(),op,(&mut result as *mut i32).cast())};
    require(code==rusqlite::ffi::SQLITE_OK,"VFS_FILE_CONTROL_UNSUPPORTED")?;Ok(result)
}
fn vfs_name(c:&Connection)->Result<String> {
    let mut name:*mut libc::c_char=std::ptr::null_mut();
    let code=unsafe{rusqlite::ffi::sqlite3_file_control(c.handle(),b"main\0".as_ptr().cast(),rusqlite::ffi::SQLITE_FCNTL_VFSNAME,(&mut name as *mut *mut libc::c_char).cast())};
    require(code==rusqlite::ffi::SQLITE_OK&&!name.is_null(),"VFS_IDENTITY_UNAVAILABLE")?;
    let value=unsafe{std::ffi::CStr::from_ptr(name)}.to_string_lossy().into_owned();
    unsafe{rusqlite::ffi::sqlite3_free(name.cast())};
    require(value=="unix","UNSUPPORTED_VFS")?;Ok(value)
}
fn same_object(c:&Connection,root:&Path,id:&Identity)->Result<()> {
    let now=regular(&root.join(DB))?;
    require((now.dev,now.inode,now.links)==(id.dev,id.inode,id.links),"DB_IDENTITY_DRIFT")?;
    require(file_control(c,rusqlite::ffi::SQLITE_FCNTL_HAS_MOVED)?==0,"DB_FILE_MOVED")
}
fn guarded(c:&Connection,root:&Path,id:&Identity)->Result<()> {
    same_object(c,root,id)?;
    require(file_control(c,rusqlite::ffi::SQLITE_FCNTL_LOCKSTATE)?==4,"GUARD_LOST_OR_UNPROVEN")
}
fn schema(c:&Connection,version:i64)->Result<()> {
    let user:i64=c.query_row("PRAGMA user_version",[],|r|r.get(0))?;
    let versions=c.prepare("SELECT version FROM schema_migrations ORDER BY version")?.query_map([],|r|r.get::<_,i64>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
    require(user==version && versions==(1..=version).collect::<Vec<_>>(),"SCHEMA_VERSION_MISMATCH")?;
    let actual=c.prepare("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name")?.query_map([],|r|Ok(json!({"type":r.get::<_,String>(0)?,"name":r.get::<_,String>(1)?,"tbl_name":r.get::<_,String>(2)?,"sql":r.get::<_,String>(3)?})))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let expected:Vec<Value>=serde_json::from_str(if version==3{V3}else{V4})?;
    require(actual==expected,"SCHEMA_STRUCTURE_MISMATCH")?;
    let integrity:String=c.query_row("PRAGMA integrity_check",[],|r|r.get(0))?;require(integrity=="ok","INTEGRITY_FAILED")?;
    let mut stmt=c.prepare("PRAGMA foreign_key_check")?;let empty=stmt.query([])?.next()?.is_none();require(empty,"FOREIGN_KEY_FAILED")
}
fn business_snapshot(c:&Connection)->Result<Value> {
    let expected:Vec<Value>=serde_json::from_str(V3)?;let mut result=serde_json::Map::new();
    for object in expected {if object["type"]!="table"{continue;}let name=object["name"].as_str().unwrap();if name=="schema_migrations"||name=="sqlite_sequence"{continue;}
        let mut stmt=c.prepare(&format!("SELECT * FROM \"{}\"",name.replace('"',"\"\"")))?;let count=stmt.column_count();
        let rows=stmt.query_map([],|row|{let mut values=Vec::new();for i in 0..count{values.push(format!("{:?}",row.get_ref(i)?));}Ok(values)})?.collect::<std::result::Result<Vec<_>,_>>()?;
        let mut encoded:Vec<String>=rows.iter().map(|row|serde_json::to_string(row).unwrap()).collect();encoded.sort();result.insert(name.into(),json!(encoded));
    }Ok(Value::Object(result))
}
struct Events<'a> { barriers:bool, callback:Option<&'a EventCallback>, lease:Option<&'a Lease> }
impl Events<'_> {fn emit(&self,event:&str,details:Value)->Result<()> {
    if let Some(lease)=self.lease {lease.validate()?;}
    if let Some(callback)=self.callback {callback(event,details)?;} else {
        println!("{}",json!({"event":event,"pid":std::process::id(),"details":details}));std::io::stdout().flush()?;
        if self.barriers{let mut line=String::new();std::io::stdin().lock().read_line(&mut line)?;require(line.trim()=="continue","CONTROLLER_DISCONNECTED")?;}
    }
    if let Some(lease)=self.lease {lease.validate()?;}
    Ok(())
}}
fn state(root:&Path,p:&Permit,status:&str,details:Value)->Result<()> {
    if p.format_version==2 {contract::persist_state(root,p,status,details)} else {durable(root,"outcome.json",&json!({"format_version":1,"synthetic_only":true,"session":p.session,"nonce":p.nonce,"authorization_id":p.authorization_id,"state":status,"details":details}))}
}
fn run(root:&Path,events:&Events)->Result<()> {
    require(!["permit.claimed.json","consumed.json","outcome.json","consumed.json.pending","outcome.json.pending"].iter().any(|name|present_or_unreadable(&root.join(name))),"PERMIT_REPLAY_OR_PENDING")?;
    regular(&root.join("permit.json"))?;
    let p:Permit=serde_json::from_slice(&fs::read(root.join("permit.json"))?)?;
    require(p.format_version==1&&p.synthetic_only&&!p.session.is_empty()&&!p.nonce.is_empty()&&!p.authorization_id.is_empty(),"PERMIT_INVALID")?;
    require(p.allow_recovery&&p.allow_wal_infrastructure,"RECOVERY_POLICY_NOT_APPROVED")?;
    require(p.backup_sha256==p.database_sha256,"BACKUP_NOT_EXACT_C0")?;
    let _lease=Lease::inherited(root,&p.session)?;
    let id=regular(&root.join(DB))?;candidate(root,&p,&id)?;
    fs::rename(root.join("permit.json"),root.join("permit.claimed.json"))?;sync_dir(root)?;
    events.emit("permit_claimed",json!({"session":p.session}))?;
    if failpoint("permit_persistence"){return Err(Failure::new("PERMIT_PERSISTENCE_FAILED","synthetic injection; claim retained"));}
    durable(root,"consumed.json",&serde_json::to_value(&p)?)?;
    state(root,&p,"PERMIT_CONSUMED",json!({"guard":"not_acquired"}))?;
    events.emit("permit_consumed",json!({"session":p.session}))?;
    let result=run_consumed(root,&p,&id,events);
    if let Err(ref e)=result {println!("{}",json!({"event":"failure_metadata","error":e,"state":fs::read_to_string(root.join("outcome.json")).ok()}));}
    result
}
fn run_consumed(root:&Path,p:&Permit,id:&Identity,events:&Events)->Result<()> {
    sidecars(root,false,id)?;let pre=safe_hash(root,p)?;
    require(pre.header_read==1&&pre.header_write==1,"UNSUPPORTED_HEADER_MODE")?;
    events.emit("preflight",json!({"hash":pre.sha256,"identity":pre.identity}))?;
    let opening=regular(&root.join(DB))?;
    require((opening.dev,opening.inode,opening.links)==(id.dev,id.inode,id.links),"DB_IDENTITY_DRIFT")?;
    let c=Connection::open_with_flags(root.join(DB),OpenFlags::SQLITE_OPEN_READ_WRITE|OpenFlags::SQLITE_OPEN_NO_MUTEX|OpenFlags::SQLITE_OPEN_PRIVATE_CACHE|OpenFlags::SQLITE_OPEN_NOFOLLOW)?;
    c.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE,true)?;
    require(c.db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE)?,"CHECKPOINT_CLOSE_CONFIG_FAILED")?;
    // Bind the opened VFS object before any ordinary SQLite database activity.
    // A regular-file swap must not be probed/recovered before it is rejected.
    same_object(&c,root,id)?;
    c.busy_timeout(Duration::ZERO)?;
    c.execute_batch("PRAGMA wal_autocheckpoint=0; PRAGMA foreign_keys=ON; PRAGMA locking_mode=EXCLUSIVE; PRAGMA synchronous=FULL; PRAGMA fullfsync=ON;")?;
    for (pragma,want) in [("busy_timeout",0),("wal_autocheckpoint",0),("foreign_keys",1),("synchronous",2),("fullfsync",1)] {let got:i64=c.query_row(&format!("PRAGMA {pragma}"),[],|r|r.get(0))?;require(got==want,"SQLITE_PROFILE_MISMATCH")?;}
    let mode:String=c.query_row("PRAGMA journal_mode",[],|r|r.get(0))?;require(mode=="delete","UNSUPPORTED_JOURNAL_MODE")?;
    let locking:String=c.query_row("PRAGMA locking_mode",[],|r|r.get(0))?;require(locking=="exclusive","LOCK_PROFILE_MISMATCH")?;
    let options=c.prepare("PRAGMA compile_options")?.query_map([],|r|r.get::<_,String>(0))?.collect::<std::result::Result<Vec<_>,_>>()?;
    let source:String=c.query_row("SELECT sqlite_source_id()",[],|r|r.get(0))?;
    let vfs=vfs_name(&c)?;
    if p.format_version==2 {state(root,p,"CONNECTION_PREPARED",json!({"guard":"not_acquired","sqlite_version":rusqlite::version(),"source_id":source,"vfs":vfs,"journal":mode,"locking":locking,"connection":"single-native-owner"}))?;}
    events.emit("connection_prepared",json!({"sqlite_version":rusqlite::version(),"source_id":source,"compile_options":options,"os":std::env::consts::OS,"vfs":vfs,"journal":mode,"locking":locking,"busy_timeout":0,"synchronous":2,"fullfsync":1,"no_ckpt_on_close":true,"wal_autocheckpoint":0}))?;
    c.execute_batch("BEGIN EXCLUSIVE")?;
    guarded(&c,root,id)?;
    state(root,p,"QUIESCENCE_ACQUIRED",json!({"guard":"known-held"}))?;
    let outcome=protected(&c,root,p,id,events);
    if let Err(ref original)=outcome {
        let committed=c.is_autocommit();
        let dangerous=matches!(original.sqlite_primary,Some(10|7|11|13)) || original.code=="GUARD_LOST_OR_UNPROVEN" || original.code=="DB_IDENTITY_DRIFT" || original.code=="DB_FILE_MOVED" || original.code.starts_with("LEASE_");
        if !committed && !dangerous && !failpoint("rollback_failure") {
            match c.execute_batch("ROLLBACK") {
                Ok(()) if guarded(&c,root,id).is_ok() && schema(&c,3).is_ok() && candidate(root,p,id).is_ok()=>{state(root,p,"FAILED_V3_CONFIRMED",json!({"error":original,"guard":"known-held","businessStartupBlocked":true,"runtime":"verified-isolated","rollback":"confirmed","safe_terminal":false}))?;},
                _=>{state(root,p,"GUARD_LOST_OR_UNPROVEN",json!({"error":original,"guard":"unknown"}))?;}
            }
        } else {state(root,p,if committed{"COMMIT_OUTCOME_UNKNOWN"}else{"GUARD_LOST_OR_UNPROVEN"},json!({"error":original,"guard":"unknown","autocommit":committed}))?;}
    }
    // Dropping this sole C is the explicit release boundary, never a reconnect.
    drop(c);outcome
}
fn protected(c:&Connection,root:&Path,p:&Permit,id:&Identity,events:&Events)->Result<()> {
    events.emit("quiescence_acquired",json!({"lockstate":file_control(c,rusqlite::ffi::SQLITE_FCNTL_LOCKSTATE)?}))?;
    guarded(c,root,id)?;schema(c,3)?;sidecars(root,false,id)?;
    let mode:String=c.query_row("PRAGMA journal_mode",[],|r|r.get(0))?;require(mode=="delete","LOCK_INTERNAL_MODE_MISMATCH")?;
    candidate(root,p,id)?;let before=safe_hash(root,p)?;
    guarded(c,root,id)?;require(before.sha256==p.database_sha256,"DB_HASH_MISMATCH")?;
    events.emit("hash_complete",serde_json::to_value(&before)?)?;
    let original=business_snapshot(c)?;
    if p.format_version==2 {state(root,p,"V3_REVALIDATED",json!({"guard":"known-held","database_sha256":before.sha256,"database_identity":before.identity,"business_snapshot":original,"schema":3,"runtime":"independently-reenumerated"}))?;}
    state(root,p,"MIGRATION_IN_PROGRESS",json!({"guard":"known-held"}))?;events.emit("m4_started",json!({}))?;
    let mut journal:Option<Identity>=None;
    for (index,sql) in M4.split(';').filter(|s|!s.trim().is_empty()).enumerate() {
        guarded(c,root,id)?;c.execute_batch(sql)?;
        let current=sidecars(root,true,id)?;
        if !current["-journal"].is_null(){let actual:Identity=serde_json::from_value(current["-journal"].clone())?;if let Some(ref seen)=journal{require((seen.dev,seen.inode)==(actual.dev,actual.inode),"JOURNAL_IDENTITY_CHANGED")?;}else{journal=Some(actual);}}
        events.emit("m4_statement",json!({"index":index,"sidecars":current}))?;
        if failpoint("constraint")&&index==0{c.execute_batch("INSERT INTO schema_migrations(version, applied_at) SELECT version,applied_at FROM schema_migrations LIMIT 1")?;}
        if failpoint("rollback_failure")&&index==0{return Err(Failure::new("INJECTED_ROLLBACK_FAILURE","synthetic control skips rollback; not a real IO fault"));}
    }
    c.execute("INSERT INTO schema_migrations(version,applied_at) VALUES(4,strftime('%Y-%m-%dT%H:%M:%fZ','now'))",[])?;
    schema(c,4)?;require(business_snapshot(c)?==original,"LEGACY_BUSINESS_DATA_CHANGED")?;guarded(c,root,id)?;
    state(root,p,"COMMIT_OUTCOME_UNKNOWN",json!({"guard":"known-held","commitAttempted":false}))?;
    events.emit("before_commit",json!({}))?;
    c.execute_batch("COMMIT")?;
    // Crash here leaves the durable pre-commit UNKNOWN, never implied V3.
    events.emit("committed",json!({"autocommit":c.is_autocommit(),"lockstate":file_control(c,rusqlite::ffi::SQLITE_FCNTL_LOCKSTATE)?}))?;
    state(root,p,"V4_COMMITTED_PENDING_VERIFICATION",json!({"guard":"known-held"}))?;
    guarded(c,root,id)?;if failpoint("post_readback"){return Err(Failure::new("POST_READBACK_FAILED","synthetic injection"));}
    schema(c,4)?;require(business_snapshot(c)?==original,"LEGACY_BUSINESS_DATA_CHANGED")?;
    candidate(root,p,id)?;let post=safe_hash(root,p)?;guarded(c,root,id)?;
    let sides=sidecars(root,true,id)?;
    if !sides["-journal"].is_null(){let actual:Identity=serde_json::from_value(sides["-journal"].clone())?;let seen=journal.ok_or_else(||Failure::new("UNKNOWN_JOURNAL","not created in M4"))?;require((seen.dev,seen.inode)==(actual.dev,actual.inode),"JOURNAL_IDENTITY_CHANGED")?;
        let mut f=OpenOptions::new().read(true).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC).open(root.join(format!("{DB}-journal")))?;let mut header=[0u8;28];let n=f.read(&mut header)?;require(header[..n].iter().all(|b|*b==0),"JOURNAL_NOT_TERMINATED")?;
    }
    events.emit("post_readback",json!({"hash":post.sha256,"sidecars":sides,"guard":"known-held"}))?;
    if p.format_version==2 {candidate(root,p,id)?;}
    if p.format_version==2 {state(root,p,"POST_READBACK_GUARDED",json!({"guard":"known-held","sha256":post.sha256,"database_identity":post.identity,"schema":4,"business_snapshot":original,"runtime":"independently-reenumerated"}))?;}
    guarded(c,root,id)?;state(root,p,"V4_VERIFIED",json!({"sha256":post.sha256,"guard":"known-held","businessStartupBlocked":p.format_version==2,"separate_restart_handoff_required":p.format_version==2,"scope":"synthetic-only"}))?;
    events.emit("verified_handoff",json!({"guard":"held-until-return"}))?;
    if p.format_version==2 {candidate(root,p,id)?;guarded(c,root,id)?;}
    Ok(())
}
fn startup_blocked(root:&Path,value:&Option<Value>)->bool {
    if ["consumed.json.pending","outcome.json.pending"].iter().any(|name|present_or_unreadable(&root.join(name))){return true;}
    let Some(v)=value else {return ["permit.claimed.json","consumed.json","outcome.json"].iter().any(|name|present_or_unreadable(&root.join(name)));};
    if ["outcome.json","consumed.json","permit.claimed.json"].iter().any(|name|regular(&root.join(name)).is_err()){return true;}
    if v["format_version"]!=1 || v["synthetic_only"]!=true || v["state"]!="V4_VERIFIED" || v["details"]["scope"]!="synthetic-only" {return true;}
    let hash=v["details"]["sha256"].as_str().unwrap_or("");
    if hash.len()!=64 || !hash.bytes().all(|b|b.is_ascii_hexdigit()) {return true;}
    let Some(p)=fs::read(root.join("consumed.json")).ok().and_then(|bytes|serde_json::from_slice::<Permit>(&bytes).ok()) else {return true;};
    p.format_version!=1 || !p.synthetic_only || p.session.is_empty() || p.nonce.is_empty() || p.authorization_id.is_empty() || v["session"]!=p.session || v["nonce"]!=p.nonce || v["authorization_id"]!=p.authorization_id
}

/// Supported synthetic entrypoint, called by a native-owned worker behind real
/// Tauri IPC. The callback carries observations/barriers only, never SQL or C.
pub fn run_integrated(raw:&str,event:&EventCallback)->Result<Value> {
    let root=root_checked(raw)?;
    require(!["native-launch.json","native-launch.json.pending","permit.claimed.json","consumed.json","outcome.json","consumed.json.pending","outcome.json.pending"].iter().any(|name|present_or_unreadable(&root.join(name))),"PERMIT_REPLAY_OR_PENDING")?;
    let p:Permit=serde_json::from_value(contract::read_json(&root.join("permit.json"))?)?;
    require(p.format_version==2,"V2_PERMIT_REQUIRED")?;
    let lease=Lease::inherited(&root,&p.session)?;
    let id=regular(&root.join(DB))?;
    candidate(&root,&p,&id)?;lease.validate()?;
    // The inherited descriptor is transferred, not leaked beside our RAII
    // duplicate. Gate's descriptor still overlaps; it may close, never unlock.
    let inherited:i32=std::env::var("PFC_QUIESCENCE_LEASE_FD").map_err(|e|Failure::new("LEASE_MISSING",e))?.parse().map_err(|e|Failure::new("LEASE_INVALID",e))?;
    require(unsafe{libc::close(inherited)}==0,"LEASE_TRANSFER_CLOSE_FAILED")?;
    let launch=json!({"format_version":2,"synthetic_only":true,"session":p.session,"nonce":p.nonce,"authorization_id":p.authorization_id,"managed_contract_sha256":p.managed_contract_sha256,"pid":std::process::id(),"parent_pid":unsafe{libc::getppid()},"lease_dev":lease.initial.dev,"lease_inode":lease.initial.inode});
    // create_new is the independent duplicate-native gate even if a mistaken
    // gate hands the same open file description to two candidate processes.
    // Deterministic OS-death boundaries exist only in isolated fixture-feature builds.
    // They run after root/candidate/lease validation and before any SQLite open.
    #[cfg(feature="quiescence-fixture")]
    if failpoint("native_ack_pre_write") {event("native_ack_pre_write",launch.clone())?;}
    let mut claim=OpenOptions::new().write(true).create_new(true).mode(0o600).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC).open(root.join("native-launch.json"))?;
    #[cfg(feature="quiescence-fixture")]
    if failpoint("native_ack_created") {event("native_ack_created",launch.clone())?;}
    serde_json::to_writer(&mut claim,&launch)?;claim.write_all(b"\n")?;claim.sync_all()?;sync_dir(&root)?;
    let events=Events{barriers:false,callback:Some(event),lease:Some(&lease)};
    let result=(||->Result<()> {
        for (status,entry) in [("VERIFIED_CANDIDATE","frozen candidate and full object tree rechecked"),("MANAGED_ISOLATED","all retained old processes independently absent; disabled archive/staging rechecked"),("OWNER_AUTHORIZED","exact authorization/session/nonce/contract hash bound")] {
            state(&root,&p,status,json!({"entry_verified":entry,"managed_contract_sha256":p.managed_contract_sha256,"lease":"held"}))?;
            events.emit("state_persisted",json!({"state":status,"phase":contract::phase(status)}))?;
        }
        events.emit("lease_native_owned",launch.clone())?;
        events.emit("managed_revalidated",json!({"managed_contract_sha256":p.managed_contract_sha256,"scope":"entire-declared-managed-tree"}))?;
        fs::rename(root.join("permit.json"),root.join("permit.claimed.json"))?;sync_dir(&root)?;
        events.emit("permit_claimed",json!({"session":p.session}))?;
        if failpoint("permit_persistence"){return Err(Failure::new("PERMIT_PERSISTENCE_FAILED","claim retained; no connection opened"));}
        durable(&root,"consumed.json",&serde_json::to_value(&p)?)?;
        state(&root,&p,"PERMIT_CONSUMED",json!({"guard":"not_acquired","managed_contract_sha256":p.managed_contract_sha256}))?;
        events.emit("permit_consumed",json!({"session":p.session}))?;
        run_consumed(&root,&p,&id,&events)
    })();
    if let Err(error)=result {
        // Any failure is recorded without resurrecting permit or overwriting
        // the database. A write failure retains its pending file, fail-closed.
        if let Ok(mut current)=contract::read_json(&root.join("outcome.json")) {
            current["details"]["last_failure"]=serde_json::to_value(&error)?;
            if let Some(status)=current["state"].as_str() {let _=state(&root,&p,status,current["details"].clone());}
        }
        return Err(error);
    }
    lease.validate()?;
    let outcome=contract::verify_chain(&root,&p)?;
    require(outcome["state"]=="V4_VERIFIED","HANDOFF_NOT_VERIFIED")?;
    // C was closed by run_consumed only after the guarded durable handoff;
    // dropping lease here is the explicit last maintenance ownership release.
    drop(lease);
    Ok(outcome)
}

/// Must be checked at the beginning of the isolated Tauri binary's main(),
/// before constructing an application/webview. This is not a frontend pipe.
pub fn hash_entrypoint()->Option<Result<()>> {
    let args:Vec<String>=std::env::args().collect();
    if args.get(1).map(String::as_str)!=Some("hash"){return None;}
    Some((|| {require(args.len()==3,"HASH_ARGUMENTS_INVALID")?;let root=root_checked(&args[2])?;hash_role(&root)})())
}
pub fn diagnostic_integrated(root:&str)->Result<Value> {recovery::diagnostic(root)}
pub fn recover_integrated(root:&str,authorization_path:&str,event:&EventCallback)->Result<Value> {recovery::recover(root,authorization_path,event)}

#[cfg(feature="quiescence-fixture")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AuthorityDomain { UnifiedR2bGateOwned }

#[cfg(feature="quiescence-fixture")]
struct ValidatedGateAuthority {
    domain: AuthorityDomain,
    root: PathBuf,
    session: String,
    nonce: String,
    authorization_id: String,
    permit_sha256: String,
    receipt_sha256: String,
    authorization_sha256: String,
    candidate_approval_sha256: String,
    candidate_sha256: String,
    bundle_id: String,
    manifest_sha256: String,
    database_sha256: String,
    backup_sha256: String,
    database_identity: Identity,
    backup_identity: Identity,
    expires_at_unix: u64,
    expiry_validated: bool,
    lease: Lease,
}

#[cfg(feature="quiescence-fixture")]
fn exact_hash(path:&Path, expected:&str)->Result<String> {
    let actual=hash_file(path)?;
    require(actual==expected,"GATE_AUTHORITY_HASH_MISMATCH")?;
    Ok(actual)
}

#[cfg(feature="quiescence-fixture")]
fn consume_unified_gate_permit(raw:&str)->Result<(ValidatedGateAuthority,Value)> {
    let supplied=Path::new(raw);
    let root=fs::canonicalize(supplied)?;
    let temporary=fs::canonicalize(std::env::temp_dir())?;
    require(supplied==root&&root!=temporary&&root.starts_with(&temporary)&&!root.to_string_lossy().contains("com.personalfinance.console"),"UNIFIED_ROOT_INVALID")?;
    let marker=root.join("SYNTHETIC_ONLY");
    regular(&marker)?;
    require(fs::read(&marker)?==UNIFIED_MARKER,"UNIFIED_MARKER_INVALID")?;
    for name in ["authorization.json","permit.json","consumed.json","migration-authorization.json","migration-permit.json","permit.claimed.json","gate-permit.claimed.json","gate-permit.claimed","consumed.json","migration-terminal.json","outcome.json"] {
        require(!present_or_unreadable(&root.join(name)),"UNIFIED_DOMAIN_AUTHORITY_CONFLICT")?;
    }
    require(!present_or_unreadable(&root.join("consumed-ledger.json")),"UNIFIED_LEDGER_ALREADY_EXISTS")?;
    let permit_path=root.join("gate-permit.json");
    let permit_identity=regular(&permit_path)?;
    let permit_bytes=fs::read(&permit_path)?;
    let permit_sha=format!("{:x}",Sha256::digest(&permit_bytes));
    require(std::env::var("PFC_GATE_PERMIT_SHA256").ok().as_deref()==Some(permit_sha.as_str()),"GATE_PERMIT_EXACT_BYTES_DRIFT")?;
    let p:Value=serde_json::from_slice(&permit_bytes)?;
    let string=|key:&str|->Result<String>{p.get(key).and_then(Value::as_str).map(str::to_owned).ok_or_else(||Failure::new("GATE_PERMIT_INVALID",key))};
    let root_s=root.to_string_lossy().to_string();
    let app=root.join("managed/install/Installed.app");
    let exe=app.join("Contents/MacOS/personal-finance-console");
    let db=root.join(DB);
    let backup=root.join("backup.sqlite3");
    let receipt_path=root.join("release-receipt.json");
    let auth_path=root.join("gate-inputs/migration-authorization.json");
    let approval_path=root.join("gate-inputs/candidate-approval.json");
    require(string("status")?=="ONE_TIME_PRODUCTION_V4_MIGRATION_AUTHORIZATION","GATE_PERMIT_STATUS")?;
    require(p.get("syntheticOnly").and_then(Value::as_bool)==Some(true),"GATE_PERMIT_DOMAIN")?;
    require(string("productionBundleId")?=="org.pfc.quiescence.integration","GATE_BUNDLE_ID")?;
    require(string("installedAppPath")?==app.to_string_lossy().as_ref(),"GATE_CANDIDATE_PATH")?;
    require(string("candidateExecutablePath")?==exe.to_string_lossy().as_ref(),"GATE_EXECUTABLE_PATH")?;
    require(fs::canonicalize(std::env::current_exe()?)?==exe,"GATE_EXECUTABLE_IDENTITY")?;
    require(string("productionDatabasePath")?==db.to_string_lossy().as_ref(),"GATE_DATABASE_PATH")?;
    require(string("backupPath")?==backup.to_string_lossy().as_ref(),"GATE_BACKUP_PATH")?;
    require(string("releaseReceiptPath")?==receipt_path.to_string_lossy().as_ref(),"GATE_RECEIPT_PATH")?;
    require(p.get("sidecarsAbsent").and_then(Value::as_bool)==Some(true),"GATE_SIDECARS")?;
    require(p.get("maxSupportedSchemaVersion").and_then(Value::as_i64)==Some(4),"GATE_SCHEMA_RANGE")?;
    let issued=p.get("issuedAtUnix").and_then(Value::as_u64).ok_or_else(||Failure::new("GATE_PERMIT_INVALID","issuedAtUnix"))?;
    let expires=p.get("expiresAtUnix").and_then(Value::as_u64).ok_or_else(||Failure::new("GATE_PERMIT_INVALID","expiresAtUnix"))?;
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|Failure::new("CLOCK_INVALID",e))?.as_secs();
    require(issued<=now&&expires>=now&&expires-issued<=120,"GATE_PERMIT_EXPIRED")?;
    require(!string("nonce")?.is_empty()&&!string("ownerAuthorizationId")?.is_empty(),"GATE_PERMIT_BINDING")?;
    let receipt_sha=string("releaseReceiptSha256")?;
    let auth_sha=string("migrationAuthorizationSha256")?;
    let approval_sha=string("candidateApprovalSha256")?;
    exact_hash(&receipt_path,&receipt_sha)?;
    exact_hash(&auth_path,&auth_sha)?;
    exact_hash(&approval_path,&approval_sha)?;
    let receipt:Value=serde_json::from_slice(&fs::read(&receipt_path)?)?;
    require(receipt.get("status").and_then(Value::as_str)==Some("PREFLIGHT_PASS_READY_FOR_SEPARATELY_AUTHORIZED_MIGRATION")&&
        receipt.get("syntheticOnly").and_then(Value::as_bool)==Some(true)&&
        receipt.get("productionDatabasePath").and_then(Value::as_str)==Some(db.to_string_lossy().as_ref())&&
        receipt.get("candidateExecutablePath").and_then(Value::as_str)==Some(exe.to_string_lossy().as_ref()),"GATE_RECEIPT_BINDING")?;
    for key in ["candidateApprovalSha256","migrationAuthorizationSha256","candidateExecutableSha256","compatibilityManifestSha256","productionDatabasePreMigrationSha256","backupSha256","releaseReceiptPath","productionBundleId"] {
        require(receipt.get(key)==p.get(key),"GATE_RECEIPT_FIELD_DRIFT")?;
    }
    let approval:Value=serde_json::from_slice(&fs::read(&approval_path)?)?;
    let authorization:Value=serde_json::from_slice(&fs::read(&auth_path)?)?;
    require(approval.get("status").and_then(Value::as_str)==Some("OWNER_APPROVED_SYNTHETIC_R2B_CANDIDATE")&&
        approval.get("syntheticOnly").and_then(Value::as_bool)==Some(true)&&
        approval.get("bundleId").and_then(Value::as_str)==Some("org.pfc.quiescence.integration")&&
        approval.get("candidateExecutableSha256").and_then(Value::as_str)==p.get("candidateExecutableSha256").and_then(Value::as_str),"GATE_CANDIDATE_APPROVAL_BINDING")?;
    require(receipt.get("candidateApprovalId").and_then(Value::as_str)==approval.get("authorizationId").and_then(Value::as_str),"GATE_APPROVAL_RECEIPT_ID_BINDING")?;
    require(authorization.get("status").and_then(Value::as_str)==Some("OWNER_AUTHORIZED_SYNTHETIC_R2B_MIGRATION")&&
        authorization.get("syntheticOnly").and_then(Value::as_bool)==Some(true)&&
        authorization.get("productionDbPreMigrationSha256").and_then(Value::as_str)==p.get("productionDatabasePreMigrationSha256").and_then(Value::as_str)&&
        authorization.get("candidateExecutableSha256").and_then(Value::as_str)==p.get("candidateExecutableSha256").and_then(Value::as_str)&&
        authorization.get("backupPath").and_then(Value::as_str)==p.get("backupPath").and_then(Value::as_str)&&
        receipt.get("ownerAuthorizationId")==authorization.get("authorizationId")&&
        p.get("ownerAuthorizationId")==authorization.get("authorizationId"),"GATE_MIGRATION_AUTHORIZATION_BINDING")?;
    let managed:Value=serde_json::from_slice(&fs::read(root.join("SYNTHETIC_C3_MANAGED_ISOLATED.json"))?)?;
    require(managed.get("status").and_then(Value::as_str)==Some("SYNTHETIC_C3_MANAGED_ISOLATED")&&
        managed.get("mode").and_then(Value::as_str)==Some("UNIFIED_R2B_GATE_OWNED")&&
        managed.get("root").and_then(Value::as_str)==Some(root_s.as_str()),"C3_RECEIPT_BINDING")?;
    let marker_sha=hash_file(&marker)?;
    require(managed.get("rootMarkerSha256").and_then(Value::as_str)==Some(marker_sha.as_str()),"C3_MARKER_BINDING")?;
    exact_hash(&root.join("managed-contract.json"),managed["managedContractSha256"].as_str().ok_or_else(||Failure::new("C3_RECEIPT_BINDING","managed contract hash"))?)?;
    exact_hash(&root.join("managed-state-S1_MANAGED_ISOLATED.json"),managed["managedStateReceiptSha256"].as_str().ok_or_else(||Failure::new("C3_RECEIPT_BINDING","managed state hash"))?)?;
    let session=managed["lease"]["session"].as_str().ok_or_else(||Failure::new("C3_RECEIPT_BINDING","lease session"))?.to_owned();
    let lease=Lease::inherited(&root,&session)?;
    lease.validate()?;
    let c3_exe=managed["candidate"]["executableSha256"].as_str().ok_or_else(||Failure::new("C3_RECEIPT_BINDING","candidate hash"))?;
    let candidate_sha=string("candidateExecutableSha256")?;
    require(c3_exe==candidate_sha,"GATE_C3_CANDIDATE_DRIFT")?;
    exact_hash(&exe,&candidate_sha)?;
    let bundle=plist::Value::from_file(app.join("Contents/Info.plist")).map_err(|e|Failure::new("GATE_BUNDLE_INFO_INVALID",e))?;
    let bundle_id=bundle.as_dictionary().and_then(|d|d.get("CFBundleIdentifier")).and_then(plist::Value::as_string);
    let executable_name=bundle.as_dictionary().and_then(|d|d.get("CFBundleExecutable")).and_then(plist::Value::as_string);
    require(bundle_id==Some("org.pfc.quiescence.integration")&&executable_name==Some("personal-finance-console"),"GATE_BUNDLE_INFO_BINDING")?;
    let manifest_path=app.join("Contents/Resources/runtime-compatibility.json");
    let manifest_sha=string("compatibilityManifestSha256")?;
    exact_hash(&manifest_path,&manifest_sha)?;
    let manifest:Value=serde_json::from_slice(&fs::read(&manifest_path)?)?;
    require(manifest.get("bundleId").and_then(Value::as_str)==Some("org.pfc.quiescence.integration")&&
        manifest.get("executable").and_then(Value::as_str)==Some("Contents/MacOS/personal-finance-console")&&
        manifest.get("runtimeGeneration").and_then(Value::as_u64)==Some(4)&&
        manifest.get("minSupportedSchemaVersion").and_then(Value::as_u64)==Some(3)&&
        manifest.get("maxSupportedSchemaVersion").and_then(Value::as_u64)==Some(4),"GATE_MANIFEST_BINDING")?;
    require(managed["candidate"]["manifestSha256"].as_str()==Some(manifest_sha.as_str()),"GATE_C3_MANIFEST_DRIFT")?;
    let db_identity=regular(&db)?;
    let db_sha=string("productionDatabasePreMigrationSha256")?;
    exact_hash(&db,&db_sha)?;
    let backup_identity=regular(&backup)?;
    let backup_sha=string("backupSha256")?;
    exact_hash(&backup,&backup_sha)?;
    require(db_sha==backup_sha,"GATE_BACKUP_NOT_EXACT")?;
    let conn=Connection::open_with_flags(&db,OpenFlags::SQLITE_OPEN_READ_ONLY|OpenFlags::SQLITE_OPEN_NO_MUTEX|OpenFlags::SQLITE_OPEN_NOFOLLOW)?;
    schema(&conn,3)?;
    drop(conn);
    sidecars(&root,false,&db_identity)?;
    lease.validate()?;
    let authorization_id=authorization["authorizationId"].as_str().ok_or_else(||Failure::new("GATE_AUTHORIZATION_ID_MISSING","authorizationId"))?.to_owned();
    let ledger=json!({"formatVersion":1,"syntheticOnly":true,"domain":"UNIFIED_R2B_GATE_OWNED",
        "permitSha256":permit_sha,"nonce":p["nonce"],"authorizationId":authorization_id,
        "authorizationSha256":auth_sha,"candidateApprovalSha256":approval_sha,"receiptSha256":receipt_sha,
        "candidateBundleId":"org.pfc.quiescence.integration","candidateSha256":candidate_sha,
        "manifestSha256":manifest_sha,"databaseSha256":db_sha,"databaseIdentity":db_identity,
        "backupSha256":backup_sha,"backupIdentity":backup_identity,"session":session,
        "leasePath":root.join("maintenance.lock"),"leaseIdentity":lease.initial,
        "consumerExecutableSha256":hash_file(&exe)?,
        "expiresAtUnix":expires,"expiryValidated":true,"claimedAtUnix":now,"consumerPid":std::process::id()});
    let claim_dir=root.join("gate-permit.claimed");
    fs::create_dir(&claim_dir).map_err(|e|Failure::new("GATE_PERMIT_CLAIM_REFUSED",e))?;
    fs::set_permissions(&claim_dir,fs::Permissions::from_mode(0o700))?;
    sync_dir(&root)?;
    let claim=claim_dir.join("permit.json");
    fs::rename(&permit_path,&claim).map_err(|e|Failure::new("GATE_PERMIT_CLAIM_REFUSED",e))?;
    sync_dir(&claim_dir)?;
    sync_dir(&root)?;
    require(hash_file(&claim)?==permit_sha&&regular(&claim)?==permit_identity,"GATE_PERMIT_CLAIM_DRIFT")?;
    let ledger_path=root.join("consumed-ledger.json");
    let mut file=OpenOptions::new().write(true).create_new(true).mode(0o600).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC).open(&ledger_path)
        .map_err(|e|Failure::new("GATE_LEDGER_CREATE_REFUSED",e))?;
    serde_json::to_writer(&mut file,&ledger)?;file.write_all(b"\n")?;file.sync_all()?;sync_dir(&root)?;
    let ledger_bytes=fs::read(&ledger_path)?;
    require(serde_json::from_slice::<Value>(&ledger_bytes)?==ledger,"GATE_LEDGER_READBACK")?;
    lease.validate()?;
    let authority=ValidatedGateAuthority{domain:AuthorityDomain::UnifiedR2bGateOwned,root:root.clone(),session,nonce:string("nonce")?,authorization_id,
        permit_sha256:permit_sha,receipt_sha256:receipt_sha,authorization_sha256:auth_sha,
        candidate_approval_sha256:approval_sha,candidate_sha256:candidate_sha,bundle_id:"org.pfc.quiescence.integration".into(),
        manifest_sha256:manifest_sha,database_sha256:db_sha,backup_sha256:backup_sha,database_identity:db_identity,backup_identity,
        expires_at_unix:expires,expiry_validated:true,lease};
    let response=json!({"event":"gate_permit_consumed","status":"GATE_PERMIT_CONSUMED_NATIVE_S4_PENDING",
        "syntheticOnly":true,"permitSha256":authority.permit_sha256,"ledgerPath":ledger_path});
    Ok((authority,response))
}

#[cfg(feature="quiescence-fixture")]
pub fn run_unified_gate_handoff(root:&str)->Result<Value> {
    let (authority,mut result)=consume_unified_gate_permit(root)?;
    require(authority.domain==AuthorityDomain::UnifiedR2bGateOwned&&authority.bundle_id=="org.pfc.quiescence.integration"&&
        authority.expiry_validated&&!authority.nonce.is_empty()&&!authority.authorization_id.is_empty(),"RUNNER_AUTHORITY_INVALID")?;
    let app=authority.root.join("managed/install/Installed.app");
    let exe=app.join("Contents/MacOS/personal-finance-console");
    let manifest=app.join("Contents/Resources/runtime-compatibility.json");
    exact_hash(&exe,&authority.candidate_sha256)?;
    exact_hash(&manifest,&authority.manifest_sha256)?;
    exact_hash(&authority.root.join("release-receipt.json"),&authority.receipt_sha256)?;
    exact_hash(&authority.root.join("gate-inputs/migration-authorization.json"),&authority.authorization_sha256)?;
    exact_hash(&authority.root.join("gate-inputs/candidate-approval.json"),&authority.candidate_approval_sha256)?;
    require(regular(&authority.root.join("backup.sqlite3"))?==authority.backup_identity,"S4_BACKUP_IDENTITY_DRIFT")?;
    exact_hash(&authority.root.join("backup.sqlite3"),&authority.backup_sha256)?;
    let now=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|e|Failure::new("CLOCK_INVALID",e))?.as_secs();
    require(now<=authority.expires_at_unix,"S4_AUTHORITY_EXPIRED")?;
    let db=authority.root.join(DB);
    let before=regular(&db)?;
    require(before==authority.database_identity&&hash_file(&db)?==authority.database_sha256,"S4_DATABASE_DRIFT")?;
    let connection=Connection::open_with_flags(&db,OpenFlags::SQLITE_OPEN_READ_WRITE|OpenFlags::SQLITE_OPEN_NO_MUTEX|OpenFlags::SQLITE_OPEN_NOFOLLOW)?;
    same_object(&connection,&authority.root,&authority.database_identity)?;
    connection.busy_timeout(Duration::ZERO)?;
    connection.execute_batch("PRAGMA locking_mode=EXCLUSIVE;")?;
    let busy:i64=connection.query_row("PRAGMA busy_timeout",[],|r|r.get(0))?;
    let locking:String=connection.query_row("PRAGMA locking_mode",[],|r|r.get(0))?;
    let journal:String=connection.query_row("PRAGMA journal_mode",[],|r|r.get(0))?;
    require(busy==0&&locking=="exclusive"&&journal=="delete","S4_SQLITE_PROFILE")?;
    authority.lease.validate()?;
    require(regular(&db)?==authority.database_identity,"S4_DATABASE_IDENTITY_DRIFT")?;
    same_object(&connection,&authority.root,&authority.database_identity)?;
    sidecars(&authority.root,false,&authority.database_identity)?;
    schema(&connection,3)?;
    drop(connection);
    let post_hash=hash_file(&db)?;
    require(post_hash==authority.database_sha256,"S4_DATABASE_BYTES_CHANGED")?;
    authority.lease.validate()?;
    result["status"]=json!("S4_CONNECTION_PREPARED");
    result["highestState"]=json!("S4_CONNECTION_PREPARED");
    result["beginExclusiveExecuted"]=json!(false);
    result["migration4Executed"]=json!(false);
    result["databaseSchema"]=json!({"userVersion":3,"migrationRows":[1,2,3]});
    result["connection"]=json!({"opened":true,"busyTimeout":busy,"lockingMode":locking,"journalMode":journal,"create":false});
    result["continuity"]=json!({"gatePermitSha256":authority.permit_sha256,"consumerInputSha256":authority.permit_sha256,
        "claimedPermitSha256":authority.permit_sha256,"ledgerPermitSha256":authority.permit_sha256,
        "runnerAuthorityPermitSha256":authority.permit_sha256,"receiptSha256":authority.receipt_sha256,
        "authorizationSha256":authority.authorization_sha256,"candidateSha256":authority.candidate_sha256,
        "manifestSha256":authority.manifest_sha256,"databaseSha256":authority.database_sha256,
        "backupSha256":authority.backup_sha256,"backupIdentity":authority.backup_identity,
        "databaseIdentity":authority.database_identity,"candidateBundleId":authority.bundle_id,
        "domain":"UNIFIED_R2B_GATE_OWNED","session":authority.session,"nonce":authority.nonce,
        "authorizationId":authority.authorization_id,"expiryValidated":authority.expiry_validated,
        "expiresAtUnix":authority.expires_at_unix,"databaseSha256After":post_hash});
    durable(&authority.root,"r2b1b-s4-stop.json",&json!({"state":"R2B1B_TEST_STOP_BEFORE_QUIESCENCE",
        "highestState":"S4_CONNECTION_PREPARED","connectionOpenConfirmed":true,"busyTimeout":busy,
        "lockingMode":locking,"journalMode":journal,"beginExclusiveExecuted":false,"migration4Executed":false,
        "databaseSha256Before":authority.database_sha256,"databaseSha256After":post_hash,
        "permitSha256":authority.permit_sha256,"receiptSha256":authority.receipt_sha256,
        "authorizationSha256":authority.authorization_sha256,"session":authority.session}))?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::symlink;
    static FIXTURE_SEQUENCE:std::sync::atomic::AtomicU64=std::sync::atomic::AtomicU64::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new()->Self {
            let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos();
            let sequence=FIXTURE_SEQUENCE.fetch_add(1,std::sync::atomic::Ordering::Relaxed);
            let path=std::env::temp_dir().join(format!("pfc-quiescence-unit-{}-{stamp}-{sequence}",std::process::id()));
            fs::create_dir(&path).unwrap();fs::write(path.join("SYNTHETIC_ONLY"),MARKER).unwrap();
            Self(fs::canonicalize(path).unwrap())
        }
    }
    impl Drop for Fixture {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
    #[test] fn empty_synthetic_state_is_not_started(){let f=Fixture::new();assert!(!startup_blocked(&f.0,&None));assert!(root_checked(f.0.to_str().unwrap()).is_ok());}
    #[test] fn corrupt_outcome_blocks_startup(){let f=Fixture::new();fs::write(f.0.join("outcome.json"),b"{broken").unwrap();assert!(startup_blocked(&f.0,&None));}
    #[test] fn claimed_without_outcome_blocks_startup(){let f=Fixture::new();fs::write(f.0.join("permit.claimed.json"),b"{}").unwrap();assert!(startup_blocked(&f.0,&None));}
    #[test] fn dangling_pending_symlink_blocks_startup(){let f=Fixture::new();symlink(f.0.join("missing"),f.0.join("outcome.json.pending")).unwrap();assert!(startup_blocked(&f.0,&None));}
    #[test] fn unbound_verified_string_is_not_a_handoff(){let f=Fixture::new();assert!(startup_blocked(&f.0,&Some(json!({"state":"V4_VERIFIED"}))));}
    #[test] fn symlink_marker_is_not_synthetic_authority(){let f=Fixture::new();fs::rename(f.0.join("SYNTHETIC_ONLY"),f.0.join("marker-target")).unwrap();symlink(f.0.join("marker-target"),f.0.join("SYNTHETIC_ONLY")).unwrap();assert_eq!(root_checked(f.0.to_str().unwrap()).unwrap_err().code,"UNSAFE_FILE_IDENTITY");}
    #[test] fn pending_claim_blocks_before_any_db_open(){let f=Fixture::new();fs::write(f.0.join("consumed.json.pending"),b"{}").unwrap();assert_eq!(run(&f.0,&Events{barriers:false,callback:None,lease:None}).unwrap_err().code,"PERMIT_REPLAY_OR_PENDING");}
}
pub fn cli()->Result<()> {
    let args:Vec<String>=std::env::args().collect();require(args.len()>=3,"USAGE_RUN_HASH_STATUS_ROOT")?;
    let root=root_checked(&args[2])?;
    match args[1].as_str(){
        "hash"=>hash_role(&root),
        "run"=>run(&root,&Events{barriers:args.iter().any(|x|x=="--barrier"),callback:None,lease:None}),
        // Native fixture regression only. Real IPC evidence is emitted by the
        // separate opt-in Tauri binary, never relabelled from this CLI role.
        "run-integrated"=>{
            let barriers=args.iter().any(|v|v=="--barrier");
            run_integrated(root.to_str().unwrap(),&move |event,details|{
                println!("{}",json!({"event":event,"details":details}));std::io::stdout().flush()?;
                if barriers {let mut line=String::new();std::io::stdin().lock().read_line(&mut line)?;require(line.trim()=="continue","CONTROLLER_DISCONNECTED")?;}
                Ok(())
            }).map(|_|())
        },
        "diagnose-integrated"=>{println!("{}",diagnostic_integrated(root.to_str().unwrap())?);Ok(())},
        "recover-integrated"=>{
            let barriers=args.iter().any(|v|v=="--barrier");
            let value=recover_integrated(root.to_str().unwrap(),root.join("recovery-authorization.json").to_str().unwrap(),&move |event,details|{
                println!("{}",json!({"event":event,"details":details}));std::io::stdout().flush()?;
                if barriers {let mut line=String::new();std::io::stdin().lock().read_line(&mut line)?;require(line.trim()=="continue","CONTROLLER_DISCONNECTED")?;}
                Ok(())
            })?;println!("{value}");Ok(())
        },
        "status"=>{let value=fs::read(root.join("outcome.json")).ok().and_then(|b|serde_json::from_slice::<Value>(&b).ok());let blocked=startup_blocked(&root,&value);println!("{}",json!({"event":"status","startupBlocked":blocked,"outcome":value}));Ok(())},
        _=>Err(Failure::new("INVALID_ROLE","only run/hash/status in synthetic fixture"))
    }
}
