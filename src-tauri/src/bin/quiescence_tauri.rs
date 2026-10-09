//! Real Wry/Tauri IPC harness. Never linked into the Production application.
//! The frontend can release a diagnostic barrier, but cannot commit, run SQL,
//! replace a target, manufacture a permit, or acquire the cutover connection C.
#[path = "../quiescence.rs"]
mod quiescence;

use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::HashSet,
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    os::unix::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
    sync::{Arc, Condvar, Mutex},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{RunEvent, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

type IpcResult = std::result::Result<Value, Value>;
const APP_ID: &str = "org.pfc.quiescence.integration";
const DB: &str = "personal-finance-console.sqlite3";

fn failure(code: &str, detail: impl ToString) -> Value {
    json!({"code":code,"detail":detail.to_string()})
}

struct Journal(Mutex<(File, u64)>);
impl Journal {
    fn append(&self, event: &str, detail: Value) -> std::io::Result<()> {
        let mut journal = self.0.lock().unwrap();
        journal.1 += 1;
        let row = json!({"format_version":1,"transport":"tauri-wry-ipc", "sequence":journal.1,
            "pid":std::process::id(),"at_unix_ms":SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis(),
            "event":event,"detail":detail});
        serde_json::to_writer(&mut journal.0, &row)?;
        journal.0.write_all(b"\n")?;
        journal.0.sync_all()
    }
}

#[derive(Clone, Serialize)]
struct Barrier { id: u64, event: String, details: Value }

#[derive(Default)]
struct Inner {
    started: bool,
    running: bool,
    disconnected: bool,
    commit_fenced: bool,
    barrier: Option<Barrier>,
    next_barrier: u64,
    released: HashSet<u64>,
    requests: HashSet<String>,
    result: Option<Value>,
    error: Option<Value>,
    window_close_prevented: u64,
    app_exit_prevented: u64,
    handoff_authorized: bool,
}

struct RuntimeState {
    root: PathBuf,
    session: String,
    token: String,
    scenario: String,
    phase: String,
    startup: Value,
    inner: Mutex<Inner>,
    wake: Condvar,
    journal: Journal,
}

impl RuntimeState {
    fn record(&self, event: &str, detail: Value) -> IpcResult {
        self.journal.append(event, detail).map_err(|e| failure("EVIDENCE_IO_FAILED", e))?;
        Ok(json!({"recorded":true}))
    }

    fn authorize(&self, session: &str, token: &str, request_id: &str, command: &str) -> IpcResult {
        let mut inner = self.inner.lock().unwrap();
        let code = if session != self.session { Some("SESSION_MISMATCH") }
            else if token != self.token { Some("TOKEN_MISMATCH") }
            else if request_id.is_empty() || request_id.len() > 160 { Some("REQUEST_ID_INVALID") }
            else if !inner.requests.insert(request_id.to_owned()) { Some("REQUEST_REPLAY") }
            else { None };
        drop(inner);
        self.record("ipc_invocation", json!({"command":command,"request_id":request_id,
            "authenticated":code.is_none(),"rejected_code":code}))?;
        match code { Some(code) => Err(failure(code, command)), None => Ok(json!({"admitted":true})) }
    }

    fn rejected(&self, command: &str, code: &str) -> IpcResult {
        self.record("ipc_rejected",json!({"command":command,"code":code,"connection_opened":false}))?;
        Err(failure(code, command))
    }

    fn snapshot(&self) -> Value {
        let inner = self.inner.lock().unwrap();
        json!({"started":inner.started,"running":inner.running,"barrier":inner.barrier,
            "disconnected":inner.disconnected,"commit_fenced":inner.commit_fenced,"result":inner.result,"error":inner.error,
            "window_close_prevented":inner.window_close_prevented,"app_exit_prevented":inner.app_exit_prevented,
            "handoff_authorized":inner.handoff_authorized,"startup":self.startup})
    }

    fn native_event(&self, event: &str, details: Value) -> quiescence::Result<()> {
        self.journal.append("native_event", json!({"event":event,"details":details}))?;
        let mut inner = self.inner.lock().unwrap();
        // Before the native commit decision, document loss cancels at the next
        // protected callback. After that fence it cannot veto COMMIT or readback.
        if inner.disconnected && !inner.commit_fenced {
            return Err(quiescence::Failure::new("FRONTEND_DISCONNECTED", "document lost before native commit fence"));
        }
        let pause_at = if self.scenario == "crash_before_commit" { "before_commit" } else { "quiescence_acquired" };
        let second = (self.scenario == "disconnect_after_release" && event == "m4_started")
            || (self.scenario == "disconnect_postcommit" && event == "committed");
        if event != pause_at && !second {
            if event == "before_commit" {
                inner.commit_fenced = true;
                self.journal.append("native_commit_fence",json!({"frontend_cannot_cancel_after_this_point":true}))?;
            }
            return Ok(());
        }
        inner.next_barrier += 1;
        let id = inner.next_barrier;
        inner.barrier = Some(Barrier { id, event:event.into(), details });
        self.journal.append("native_barrier_entered",json!({"barrier_id":id,"event":event,"owns_connection_c":true,"commit_fenced":inner.commit_fenced}))?;
        while !inner.released.contains(&id) && !inner.disconnected {
            let (next, timed) = self.wake.wait_timeout(inner, Duration::from_secs(45)).unwrap();
            inner = next;
            if timed.timed_out() {
                if inner.commit_fenced {break;}
                return Err(quiescence::Failure::new("FRONTEND_BARRIER_TIMEOUT", event));
            }
        }
        if inner.disconnected && !inner.commit_fenced { return Err(quiescence::Failure::new("FRONTEND_DISCONNECTED", "real webview document loss before commit fence")); }
        inner.barrier = None;
        self.journal.append("native_barrier_released",json!({"barrier_id":id,"event":event}))?;
        if event == "before_commit" {inner.commit_fenced=true;self.journal.append("native_commit_fence",json!({"frontend_cannot_cancel_after_this_point":true}))?;}
        Ok(())
    }

    fn disconnect(&self, url: &str) {
        let mut inner = self.inner.lock().unwrap();
        if inner.running && !inner.disconnected {
            inner.disconnected = true;
            let _ = self.journal.append("frontend_document_disconnected",json!({"url":url,"source":"real_webview_navigation_or_page_load_hook","commit_fenced":inner.commit_fenced,
                "policy":if inner.commit_fenced{"native-continues-protected-terminal-verification"}else{"native-cancels-before-commit-at-protected-callback"}}));
            self.wake.notify_all();
        }
    }
}

#[tauri::command]
fn ipc_bootstrap(state: State<'_, Arc<RuntimeState>>) -> IpcResult {
    state.record("frontend_bootstrap",json!({"scenario":state.scenario,"phase":state.phase,"app_identifier":APP_ID}))?;
    Ok(json!({"session":state.session,"token":state.token,"scenario":state.scenario,"phase":state.phase,
        "app_identifier":APP_ID,"app_data_dir":state.root,"startup":state.startup}))
}

#[tauri::command]
fn native_status(state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String) -> IpcResult {
    state.authorize(&session,&token,&request_id,"native_status")?;
    Ok(state.snapshot())
}

#[tauri::command]
fn start_native_cutover(state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String) -> IpcResult {
    state.authorize(&session,&token,&request_id,"start_native_cutover")?;
    {
        // The same mutex covers business connection open/use/close and the transition
        // to worker ownership. No pre-existing ordinary connection can cross this edge.
        let mut inner = state.inner.lock().unwrap();
        if inner.started { drop(inner); return state.rejected("start_native_cutover","CUTOVER_ALREADY_STARTED"); }
        if state.phase != "initial" { drop(inner); return state.rejected("start_native_cutover","DURABLE_CUTOVER_REQUIRES_RECOVERY"); }
        inner.started = true;
        inner.running = true;
    }
    state.record("native_worker_started",json!({"scope":"synthetic-only","connection_c_exposed_to_frontend":false}))?;
    let shared = Arc::clone(state.inner());
    std::thread::spawn(move || {
        let events = Arc::clone(&shared);
        let result = quiescence::run_integrated(shared.root.to_str().unwrap(), &move |event, detail| events.native_event(event, detail));
        let mut inner = shared.inner.lock().unwrap();
        inner.running = false;
        inner.barrier = None;
        match result {
            Ok(value) => { let _ = shared.journal.append("native_worker_finished",json!({"success":true,"result":value})); inner.result = Some(value); }
            Err(error) => { let value = serde_json::to_value(error).unwrap(); let _ = shared.journal.append("native_worker_finished",json!({"success":false,"error":value})); inner.error = Some(value); }
        }
        shared.wake.notify_all();
    });
    Ok(json!({"accepted":true,"native_owns_cutover":true}))
}

#[tauri::command]
fn diagnostic_advance_barrier(state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String, barrier_id: u64) -> IpcResult {
    state.authorize(&session,&token,&request_id,"diagnostic_advance_barrier")?;
    let mut inner = state.inner.lock().unwrap();
    if inner.released.contains(&barrier_id) { drop(inner); return state.rejected("diagnostic_advance_barrier","BARRIER_REPLAY"); }
    if !inner.running || inner.barrier.as_ref().map(|b|b.id) != Some(barrier_id) { drop(inner); return state.rejected("diagnostic_advance_barrier","BARRIER_MISMATCH"); }
    inner.released.insert(barrier_id);
    state.journal.append("frontend_released_barrier",json!({"barrier_id":barrier_id,"can_commit":false})).map_err(|e|failure("EVIDENCE_IO_FAILED",e))?;
    state.wake.notify_all();
    Ok(json!({"released":barrier_id,"commit_control":"native_state_machine_only"}))
}

fn business(state: &RuntimeState, command: &str, write: bool) -> IpcResult {
    let inner = state.inner.lock().unwrap();
    if inner.running || (inner.started && !inner.handoff_authorized) {
        drop(inner); return state.rejected(command,"BUSINESS_IPC_BLOCKED_DURING_CUTOVER");
    }
    // This executable is a maintenance runtime from S0 onwards, including the
    // managed/authorized pre-claim window. Only a separately authorized native
    // recovery verification opens business entry; schema or missing outcome
    // files cannot authorize an ordinary connection.
    if !inner.handoff_authorized { drop(inner); return state.rejected(command,"BUSINESS_IPC_RECOVERY_REQUIRED"); }
    let flags = if write {rusqlite::OpenFlags::SQLITE_OPEN_READ_WRITE} else {rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY}
        | rusqlite::OpenFlags::SQLITE_OPEN_NOFOLLOW | rusqlite::OpenFlags::SQLITE_OPEN_PRIVATE_CACHE;
    let connection = rusqlite::Connection::open_with_flags(state.root.join(DB),flags).map_err(|e|failure("BUSINESS_DB_OPEN_FAILED",e))?;
    // Deliberately fixed business operations: neither endpoint accepts SQL or a path.
    let result = if write {
        connection.execute("INSERT OR REPLACE INTO app_metadata(key,value) VALUES('ipc-ordinary-write','synthetic')",[])
            .map(|count|json!({"changed":count})).map_err(|e|failure("BUSINESS_WRITE_FAILED",e))
    } else {
        connection.query_row("SELECT count(*) FROM app_metadata",[],|row|row.get::<_,i64>(0))
            .map(|count|json!({"metadata_count":count})).map_err(|e|failure("BUSINESS_READ_FAILED",e))
    };
    drop(connection);
    state.record("business_connection_closed",json!({"command":command,"dedicated_cutover_connection":false}))?;
    drop(inner);
    result
}

#[tauri::command]
fn ordinary_business_read(state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String) -> IpcResult {
    state.authorize(&session,&token,&request_id,"ordinary_business_read")?;
    business(&state,"ordinary_business_read",false)
}
#[tauri::command]
fn ordinary_business_write(state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String) -> IpcResult {
    state.authorize(&session,&token,&request_id,"ordinary_business_write")?;
    business(&state,"ordinary_business_write",true)
}
#[tauri::command]
fn native_commit_cutover(state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String) -> IpcResult {
    state.authorize(&session,&token,&request_id,"native_commit_cutover")?;
    state.rejected("native_commit_cutover","EARLY_COMMIT_FORBIDDEN_NATIVE_ONLY")
}
#[tauri::command]
fn native_end_cutover(state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String) -> IpcResult {
    state.authorize(&session,&token,&request_id,"native_end_cutover")?;
    state.rejected("native_end_cutover","EARLY_END_FORBIDDEN_NATIVE_ONLY")
}
#[tauri::command]
fn request_app_close(app: tauri::AppHandle, state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String) -> IpcResult {
    state.authorize(&session,&token,&request_id,"request_app_close")?;
    if !state.inner.lock().unwrap().running { return state.rejected("request_app_close","NO_ACTIVE_CUTOVER"); }
    state.record("real_app_exit_requested",json!({"source":"AppHandle.exit","exit_code":79}))?;
    app.exit(79);
    Ok(json!({"exit_requested":true}))
}
#[tauri::command]
fn diagnostic_recovery(state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String) -> IpcResult {
    state.authorize(&session,&token,&request_id,"diagnostic_recovery")?;
    quiescence::diagnostic_integrated(state.root.to_str().unwrap()).map_err(|e|serde_json::to_value(e).unwrap())
}
#[tauri::command]
async fn authorized_recovery_handoff(state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String) -> IpcResult {
    state.authorize(&session,&token,&request_id,"authorized_recovery_handoff")?;
    {
        let mut inner = state.inner.lock().unwrap();
        if inner.running { drop(inner); return state.rejected("authorized_recovery_handoff","CUTOVER_ACTIVE"); }
        inner.running = true;
    }
    let shared = Arc::clone(state.inner());
    tauri::async_runtime::spawn_blocking(move || {
        let auth = shared.root.join("recovery-authorization.json");
        let events = Arc::clone(&shared);
        let result = quiescence::recover_integrated(shared.root.to_str().unwrap(),auth.to_str().unwrap(),&move |event,details| {
            events.journal.append("native_recovery_event",json!({"event":event,"details":details}))?; Ok(())
        }).map_err(|e|serde_json::to_value(e).unwrap());
        let mut inner = shared.inner.lock().unwrap();
        inner.running = false;
        inner.handoff_authorized = result.as_ref().ok().is_some_and(|v|v["handoff_authorized"]==true);
        let _ = shared.journal.append("authorized_handoff_result",json!({"result":result}));
        result
    }).await.map_err(|e|failure("RECOVERY_WORKER_FAILED",e))?
}
#[tauri::command]
fn record_frontend_evidence(state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String, value: Value) -> IpcResult {
    state.authorize(&session,&token,&request_id,"record_frontend_evidence")?;
    if serde_json::to_vec(&value).unwrap().len() > 65536 {return state.rejected("record_frontend_evidence","EVIDENCE_TOO_LARGE");}
    state.record("frontend_evidence",json!({"scenario":state.scenario,"phase":state.phase,"value":value}))
}
#[tauri::command]
fn finish_frontend(app: tauri::AppHandle, state: State<'_, Arc<RuntimeState>>, session: String, token: String, request_id: String, value: Value) -> IpcResult {
    state.authorize(&session,&token,&request_id,"finish_frontend")?;
    if state.inner.lock().unwrap().running { return state.rejected("finish_frontend","NATIVE_STILL_OWNS_C"); }
    state.record("frontend_complete",json!({"scenario":state.scenario,"phase":state.phase,"value":value,"native":state.snapshot()}))?;
    // Let the invoke reply reach the real document before a normal event-loop exit.
    std::thread::spawn(move || {std::thread::sleep(Duration::from_millis(180));app.exit(0);});
    Ok(json!({"saved":true}))
}

fn checked_state() -> std::result::Result<Arc<RuntimeState>, Box<dyn std::error::Error>> {
    let raw = std::env::var("PFC_IPC_ROOT")?;
    let root = fs::canonicalize(&raw)?;
    let temp = fs::canonicalize(std::env::temp_dir())?;
    if Path::new(&raw)!=root || root==temp || !root.starts_with(temp) || root.to_string_lossy().contains("com.personalfinance.console") {
        return Err("IPC_ROOT_NOT_CANONICAL_SYNTHETIC_TEMP".into());
    }
    let marker = fs::symlink_metadata(root.join("SYNTHETIC_ONLY"))?;
    if !marker.is_file() || marker.file_type().is_symlink() || marker.nlink()!=1 || fs::read_to_string(root.join("SYNTHETIC_ONLY"))?!="PFC_QUIESCENCE_SYNTHETIC_V1\n" {
        return Err("IPC_SYNTHETIC_MARKER_INVALID".into());
    }
    let scenario = std::env::var("PFC_IPC_SCENARIO")?;
    if !["readiness","normal","disconnect","refresh","disconnect_after_release","disconnect_postcommit","crash_at_quiescence","crash_before_commit","guard_lost"].contains(&scenario.as_str()) {return Err("IPC_SCENARIO_INVALID".into());}
    let phase = std::env::var("PFC_IPC_PHASE").unwrap_or_else(|_|"initial".into());
    if !["initial","restart"].contains(&phase.as_str()) { return Err("IPC_PHASE_INVALID".into()); }
    let permit_path = if root.join("permit.json").exists(){root.join("permit.json")}else{root.join("consumed.json")};
    let permit: Value = serde_json::from_slice(&fs::read(permit_path)?)?;
    let session = permit["session"].as_str().ok_or("IPC_SESSION_MISSING")?.to_owned();
    // macOS also uses the real bundle's Info.plist, not just tauri.conf.json.
    // Prove both identities before creating any application or webview state.
    let executable = fs::canonicalize(std::env::current_exe()?)?;
    if !executable.starts_with(root.join("managed/install")) || permit["executable_path"].as_str()!=executable.to_str() {
        return Err("IPC_EXECUTABLE_OUTSIDE_EXACT_SYNTHETIC_INSTALL".into());
    }
    let contents = executable.parent().and_then(Path::parent).ok_or("IPC_BUNDLE_LAYOUT_INVALID")?;
    let info = plist::Value::from_file(contents.join("Info.plist"))?;
    let info = info.as_dictionary().ok_or("IPC_BUNDLE_INFO_INVALID")?;
    if info.get("CFBundleIdentifier").and_then(plist::Value::as_string)!=Some(APP_ID)
        || info.get("CFBundleExecutable").and_then(plist::Value::as_string)!=executable.file_name().and_then(|s|s.to_str()) {
        return Err("IPC_REAL_BUNDLE_IDENTITY_NOT_ISOLATED".into());
    }
    let mut random = [0u8;32]; File::open("/dev/urandom")?.read_exact(&mut random)?;
    let token = random.iter().map(|v|format!("{v:02x}")).collect::<String>();
    let file = OpenOptions::new().write(true).create_new(true).custom_flags(libc::O_NOFOLLOW|libc::O_CLOEXEC).mode(0o600)
        .open(root.join(format!("ipc-{phase}.jsonl")))?;
    let journal = Journal(Mutex::new((file,0)));
    journal.append("native_entry_validated",json!({"session":session,"root":root,"actual_executable":executable,"before_diagnostic":true,"before_tauri_builder":true}))?;
    let startup = quiescence::diagnostic_integrated(root.to_str().unwrap()).unwrap_or_else(|e|json!({"startupBlocked":true,"diagnostic_error":e}));
    let state = Arc::new(RuntimeState{root,session,token,scenario,phase,startup,inner:Mutex::new(Inner::default()),wake:Condvar::new(),journal});
    state.journal.append("native_runtime_boot",json!({"app_identifier":APP_ID,"app_data_dir":state.root,"scenario":state.scenario,"phase":state.phase,
        "startup":state.startup,"runtime":"Tauri/Wry/WebKit","webview_data_store":"nonpersistent","production_setup_called":false,
        "session":state.session,"actual_bundle_identifier":APP_ID,"actual_executable":executable}))?;
    Ok(state)
}

fn main() {
    // Hash subprocesses must never initialize Tauri, a webview, or business state.
    if let Some(result) = quiescence::hash_entrypoint() {
        if let Err(error)=result {eprintln!("{}",serde_json::to_string(&error).unwrap());std::process::exit(1);}
        return;
    }
    // Validate generated context BEFORE Builder::build/app event loop. Tauri
    // creates config-declared windows before calling the user setup hook.
    let context=tauri::generate_context!("tauri.quiescence.conf.json");
    if context.config().identifier!=APP_ID || !context.config().app.windows.is_empty() || context.config().build.dev_url.is_some() {
        eprintln!("ISOLATED_CONTEXT_REJECTED_BEFORE_TAURI_BUILD: identifier={}, configured_windows={}, dev_url_present={}",
            context.config().identifier,context.config().app.windows.len(),context.config().build.dev_url.is_some());
        std::process::exit(1);
    }
    let state=match checked_state(){Ok(value)=>value,Err(error)=>{eprintln!("ISOLATED_IPC_STARTUP_BLOCKED: {error}");std::process::exit(1);}};
    let setup_state=Arc::clone(&state);
    let close_state=Arc::clone(&state);
    let app=tauri::Builder::default()
        .manage(Arc::clone(&state))
        .invoke_handler(tauri::generate_handler![ipc_bootstrap,native_status,start_native_cutover,diagnostic_advance_barrier,
            ordinary_business_read,ordinary_business_write,native_commit_cutover,native_end_cutover,request_app_close,
            diagnostic_recovery,authorized_recovery_handoff,record_frontend_evidence,finish_frontend])
        .setup(move |app| {
            if app.config().identifier!=APP_ID {return Err("ISOLATED_APP_IDENTIFIER_MISMATCH".into());}
            let navigation=Arc::clone(&setup_state);
            let loading=Arc::clone(&setup_state);
            WebviewWindowBuilder::new(app,"quiescence",WebviewUrl::App("index.html".into()))
                .title("Synthetic Q11 — real Tauri IPC")
                .inner_size(760.0,420.0)
                .incognito(true)
                .on_navigation(move |url| {
                    let allowed=matches!(url.scheme(),"tauri"|"http"|"https") && matches!(url.host_str(),Some("localhost"|"tauri.localhost"));
                    if allowed {navigation.disconnect(url.as_str());}
                    allowed
                }).on_page_load(move |_window,payload| {
                    if matches!(payload.event(),tauri::webview::PageLoadEvent::Started) {loading.disconnect(payload.url().as_str());}
                }).build()?;
            Ok(())
        })
        .on_window_event(move |_window,event| {
            if let WindowEvent::CloseRequested{api,..}=event {
                let mut inner=close_state.inner.lock().unwrap();
                let protected=inner.running;
                if protected {api.prevent_close();inner.window_close_prevented+=1;}
                let _=close_state.journal.append("real_window_close_requested",json!({"prevented":protected,"source":"Tauri.WindowEvent.CloseRequested"}));
            }
        })
        .build(context)
        .expect("isolated Tauri build");
    app.run(move |_app,event| {
        if let RunEvent::ExitRequested{api,code,..}=event {
            let mut inner=state.inner.lock().unwrap();
            let protected=inner.running;
            if protected {api.prevent_exit();inner.app_exit_prevented+=1;}
            let _=state.journal.append("real_app_exit_event",json!({"prevented":protected,"code":code,"source":"Tauri.RunEvent.ExitRequested"}));
        }
    });
}
