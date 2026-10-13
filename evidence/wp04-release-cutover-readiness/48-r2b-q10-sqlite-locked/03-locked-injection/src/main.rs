use rusqlite::{Connection, OpenFlags};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{env, fs, path::{Path, PathBuf}, time::{Duration, Instant}};
#[path = "/Users/linte/Library/Caches/pfc-wp04r2b3c2-c3da2f7/regression-worktree/src-tauri/src/quiescence.rs"]
mod frozen_quiescence;
fn sha(path:&Path)->String { let b=fs::read(path).unwrap(); format!("{:x}",Sha256::digest(b)) }
fn flags()->OpenFlags { OpenFlags::SQLITE_OPEN_READ_WRITE|OpenFlags::SQLITE_OPEN_CREATE|OpenFlags::SQLITE_OPEN_URI|OpenFlags::SQLITE_OPEN_SHARED_CACHE }
fn open(uri:&str, timeout:u64)->Connection { let c=Connection::open_with_flags(uri,flags()).unwrap(); c.busy_timeout(Duration::from_millis(timeout)).unwrap(); c }
fn run_case(root:&Path, timeout:u64)->Value {
 let db=root.join(format!("locked-{timeout}.sqlite3"));
 { let c=Connection::open(&db).unwrap(); c.busy_timeout(Duration::ZERO).unwrap(); c.execute_batch("PRAGMA journal_mode=DELETE; CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY); INSERT INTO schema_migrations VALUES(1),(2),(3); CREATE TABLE business_probe(id INTEGER PRIMARY KEY, value TEXT NOT NULL); INSERT INTO business_probe VALUES(1,'preserve'); PRAGMA user_version=3;").unwrap(); }
 let before=sha(&db);
 let pre=Connection::open(&db).unwrap();
 let user_version_before:i64=pre.query_row("PRAGMA user_version",[],|r|r.get(0)).unwrap();
 let migration_rows_before:Vec<i64>={let mut st=pre.prepare("SELECT version FROM schema_migrations ORDER BY version").unwrap();st.query_map([],|r|r.get(0)).unwrap().map(Result::unwrap).collect()};
 let integrity_before:String=pre.query_row("PRAGMA integrity_check",[],|r|r.get(0)).unwrap();
 let fk_before:Vec<Value>={let mut st=pre.prepare("PRAGMA foreign_key_check").unwrap();st.query_map([],|r|Ok(json!([r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?]))).unwrap().map(Result::unwrap).collect()};
 drop(pre);
 let uri=format!("file:{}?cache=shared",db.display());
 let reader=open(&uri,0); let writer=open(&uri,timeout);
 let journal:String=writer.query_row("PRAGMA journal_mode",[],|r|r.get(0)).unwrap();
 let locking:String=writer.query_row("PRAGMA locking_mode",[],|r|r.get(0)).unwrap();
 let timeout_actual:i64=writer.query_row("PRAGMA busy_timeout",[],|r|r.get(0)).unwrap();
 reader.execute_batch("BEGIN;").unwrap();
 let held:i64=reader.query_row("SELECT count(*) FROM business_probe",[],|r|r.get(0)).unwrap();
 let start=Instant::now();
 let attempt=writer.execute("INSERT INTO business_probe(value) VALUES('must-not-write')",[]);
 let elapsed=start.elapsed();
 let (raw,primary,extended,name,message,native)=match attempt {
  Ok(n)=> (json!({"kind":"unexpected_success","rows":n}),-1,-1,"NONE".to_string(),"unexpected success".to_string(),json!({"classification":"UNEXPECTED_SUCCESS"})),
  Err(e)=> {
   let raw_debug=format!("{:?}",e); let raw_message=e.to_string();
   let native=frozen_quiescence::Failure::from(e);
   let primary=native.sqlite_primary.unwrap_or(-1); let extended=native.sqlite_extended.unwrap_or(-1);
   let name=match extended {262=>"SQLITE_LOCKED_SHAREDCACHE",6=>"SQLITE_LOCKED",5=>"SQLITE_BUSY",_=>"OTHER"}.to_string();
   (json!({"kind":"sqlite_error","debug":raw_debug,"display":raw_message}),primary,extended,name,native.detail.clone(),json!({"code":native.code,"sqlite_primary":native.sqlite_primary,"sqlite_extended":native.sqlite_extended,"detail":native.detail}))
  }
 };
 let writer_autocommit_after_error=writer.is_autocommit();
 let reader_autocommit_after_error=reader.is_autocommit();
 let writer_changes_after_error=writer.changes();
 // End the reader transaction after observing the blocked writer; no application data is committed.
 reader.execute_batch("ROLLBACK;").unwrap();
 drop(reader); drop(writer);
 let after=sha(&db);
 let c=Connection::open(&db).unwrap();
 let user_version:i64=c.query_row("PRAGMA user_version",[],|r|r.get(0)).unwrap();
 let migrations:Vec<i64>={let mut s=c.prepare("SELECT version FROM schema_migrations ORDER BY version").unwrap();s.query_map([],|r|r.get(0)).unwrap().map(Result::unwrap).collect()};
 let m4:i64=c.query_row("SELECT count(*) FROM schema_migrations WHERE version=4",[],|r|r.get(0)).unwrap();
 let rows:Vec<(i64,String)>={let mut s=c.prepare("SELECT id,value FROM business_probe ORDER BY id").unwrap();s.query_map([],|r|Ok((r.get(0)?,r.get(1)?))).unwrap().map(Result::unwrap).collect()};
 let integrity:String=c.query_row("PRAGMA integrity_check",[],|r|r.get(0)).unwrap();
 let fk:Vec<Value>={let mut s=c.prepare("PRAGMA foreign_key_check").unwrap();s.query_map([],|r|Ok(json!([r.get::<_,String>(0)?,r.get::<_,i64>(1)?,r.get::<_,String>(2)?,r.get::<_,i64>(3)?]))).unwrap().map(Result::unwrap).collect()};
 drop(c);
 let sidecars=["-wal","-shm","-journal"].iter().filter_map(|suffix|{let p=PathBuf::from(format!("{}{}",db.display(),suffix));p.exists().then(||p.display().to_string())}).collect::<Vec<_>>();
 let source_connection=Connection::open(&db).unwrap();
 let source_id:String=source_connection.query_row("SELECT sqlite_source_id()",[],|r|r.get(0)).unwrap();
 let mut option_stmt=source_connection.prepare("PRAGMA compile_options").unwrap();
 let compile_options:Vec<String>=option_stmt.query_map([],|r|r.get(0)).unwrap().map(Result::unwrap).collect();
 drop(option_stmt); drop(source_connection);
 let passed=primary==6 && before==after && user_version_before==3 && migration_rows_before==vec![1,2,3] && integrity_before=="ok" && fk_before.is_empty() && user_version==3 && migrations==vec![1,2,3] && m4==0 && rows==vec![(1,"preserve".to_string())] && integrity=="ok" && fk.is_empty();
 json!({
  "busy_timeout_requested_ms":timeout,
  "busy_timeout_readback_ms":timeout_actual,
  "database":db.display().to_string(),
  "database_sha256_before":before,
  "database_sha256_after":after,
  "database_bytes_unchanged":before==after,
  "sqlite_version":rusqlite::version(),
  "sqlite_source_id":source_id,
  "compile_options":compile_options,
  "connection":{"uri_mode":true,"shared_cache":true,"reader_busy_timeout_ms":0,"writer_busy_timeout_ms":timeout,"journal_mode":journal,"locking_mode":locking,"lock_mechanism":"reader holds an active read transaction on business_probe; second shared-cache connection attempts INSERT on same table"},
  "held_reader_row_count":held,
  "writer_autocommit_after_error":writer_autocommit_after_error,
  "reader_autocommit_after_error":reader_autocommit_after_error,
  "writer_changes_after_error":writer_changes_after_error,
  "user_version_before":user_version_before,
  "migration_rows_before":migration_rows_before,
  "integrity_before":integrity_before,
  "foreign_key_violations_before":fk_before,
  "raw_result":raw,
  "sqlite_primary_code":primary,
  "sqlite_extended_code":extended,
  "sqlite_error_name":name,
  "sqlite_error_message":message,
  "native_failure_conversion":native,
  "elapsed_ns":elapsed.as_nanos(),
  "user_version_after":user_version,
  "migration_rows_after":migrations,
  "migration4_count_after":m4,
  "business_rows_after":rows,
  "integrity_check":integrity,
  "foreign_key_violations":fk,
  "sidecars_after_close":sidecars,
  "passed":passed
 })
}
fn main(){let root=PathBuf::from(env::args().nth(1).expect("Q10 output root"));fs::create_dir_all(&root).unwrap();let results=vec![run_case(&root,0),run_case(&root,5000)];let all_pass=results.iter().all(|x|x["passed"].as_bool()==Some(true));let output=json!({"engine":"frozen rusqlite bundled SQLite","sqlite_version":rusqlite::version(),"cases":results,"all_pass":all_pass});println!("{}",serde_json::to_string_pretty(&output).unwrap());}
