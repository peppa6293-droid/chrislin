//! Synthetic-only, pipe-controlled bundled SQLite experiment peer. Never an App entrypoint.
use rusqlite::{config::DbConfig, types::ValueRef, Connection, OpenFlags};
use serde_json::{json, Value};
use std::{io::{self, BufRead, Write, Read}, fs, path::PathBuf, time::Instant};
use std::os::unix::fs::MetadataExt;

fn value(v: ValueRef<'_>) -> Value { match v { ValueRef::Null=>Value::Null, ValueRef::Integer(x)=>json!(x), ValueRef::Real(x)=>json!(x), ValueRef::Text(x)=>json!(String::from_utf8_lossy(x)), ValueRef::Blob(x)=>json!(x) } }
fn emit(v: Value) { println!("{}",v); io::stdout().flush().unwrap(); }
fn main() {
 let args:Vec<String>=std::env::args().collect();
 let raw=PathBuf::from(args.get(1).expect("synthetic root required"));
 let root=raw.canonicalize().unwrap();
 assert_eq!(raw,root,"canonical root required");
 let tmp=std::env::temp_dir().canonicalize().unwrap();
 assert!(root.starts_with(&tmp) && root!=tmp, "synthetic temp directory only");
 let marker=fs::symlink_metadata(root.join("SYNTHETIC_ONLY")).unwrap();
 assert!(marker.is_file()&&!marker.file_type().is_symlink()&&marker.nlink()==1);
 assert_eq!(fs::read_to_string(root.join("SYNTHETIC_ONLY")).unwrap(), "PFC_QUIESCENCE_SYNTHETIC_V1\n");
 let path=root.join("personal-finance-console.sqlite3");
 let create=args.iter().any(|s|s=="--create");
 for suffix in ["","-wal","-shm","-journal"] {let candidate=root.join(format!("personal-finance-console.sqlite3{suffix}"));match fs::symlink_metadata(&candidate) {Ok(m)=>assert!(m.is_file()&&!m.file_type().is_symlink()&&m.nlink()==1,"unsafe fixture file"),Err(e)=>assert!(e.kind()==io::ErrorKind::NotFound&&(suffix!=""||create),"fixture file missing or inaccessible")}}
 let flags=OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NOFOLLOW | if create {OpenFlags::SQLITE_OPEN_CREATE} else {OpenFlags::empty()};
 let c=Connection::open_with_flags(&path,flags).unwrap();
 c.busy_timeout(std::time::Duration::ZERO).unwrap();
 c.set_db_config(DbConfig::SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE,true).unwrap();
 c.pragma_update(None,"wal_autocheckpoint",0).unwrap();
 // Metadata must not implicitly touch the schema: opening while the owner holds
 // EXCLUSIVE is itself a required experiment, followed by explicitly timed SQL.
 let version=rusqlite::version();
 let source=unsafe {std::ffi::CStr::from_ptr(rusqlite::ffi::sqlite3_sourceid()).to_string_lossy().into_owned()};
 let mut options=Vec::<String>::new();
 for i in 0..1000 {let ptr=unsafe{rusqlite::ffi::sqlite3_compileoption_get(i)};if ptr.is_null(){break;}options.push(unsafe{std::ffi::CStr::from_ptr(ptr).to_string_lossy().into_owned()});}
 let vfs=unsafe { let v=rusqlite::ffi::sqlite3_vfs_find(std::ptr::null()); std::ffi::CStr::from_ptr((*v).zName).to_string_lossy().into_owned() };
 emit(json!({"event":"opened","pid":std::process::id(),"sqlite_version":version,"source_id":source,"compile_options":options,"default_vfs":vfs,"os":std::env::consts::OS,"arch":std::env::consts::ARCH,"no_checkpoint_on_close":true,"wal_autocheckpoint":0}));
 for line in io::stdin().lock().lines() {
  let req:Value=serde_json::from_str(&line.unwrap()).unwrap(); let start=Instant::now();
  let action=req["action"].as_str().unwrap_or("sql");
  if action=="close" { drop(c); emit(json!({"event":"closed","pid":std::process::id()}));return; }
  if action=="raw_close" { let mut f=fs::File::open(&path).unwrap();let mut b=[0u8;100];let n=f.read(&mut b).unwrap();drop(f);emit(json!({"event":"raw_closed","bytes":n,"pid":std::process::id()}));continue; }
  let sql=req["sql"].as_str().unwrap();
  let result:Result<Value,rusqlite::Error>=(|| {
   if req["query"].as_bool().unwrap_or(false) {let mut st=c.prepare(sql)?;let names:Vec<String>=st.column_names().iter().map(|s|s.to_string()).collect();let mut rows=st.query([])?;let mut out=vec![];while let Some(row)=rows.next()? {let mut obj=serde_json::Map::new();for (i,name) in names.iter().enumerate(){obj.insert(name.clone(),value(row.get_ref(i)?));}out.push(Value::Object(obj));}Ok(json!(out))}
   else {c.execute_batch(sql)?;Ok(Value::Null)}
  })();
  let mut v=json!({"event":"sql","pid":std::process::id(),"sql":sql,"elapsed_us":start.elapsed().as_micros(),"autocommit":c.is_autocommit()});
  match result {Ok(rows)=>{v["ok"]=json!(true);v["rows"]=rows;},Err(e)=>{v["ok"]=json!(false);v["error"]=json!(e.to_string());if let rusqlite::Error::SqliteFailure(code,_) = e {v["primary_code"]=json!(code.extended_code & 255);v["extended_code"]=json!(code.extended_code);}}}
  emit(v);
 }
}
