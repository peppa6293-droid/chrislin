//! Project-owned synthetic V3 process. It emits readiness only after initialization.
use std::io::{self, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

static TERMINATE: AtomicBool = AtomicBool::new(false);

extern "C" fn request_termination(_: libc::c_int) {
    TERMINATE.store(true, Ordering::SeqCst);
}

fn main() {
    let mut args = std::env::args();
    let _program = args.next();
    if args.next().as_deref() != Some("--synthetic-old-runtime") {
        eprintln!("expected --synthetic-old-runtime <session>");
        std::process::exit(2);
    }
    let Some(session) = args.next() else { std::process::exit(2) };
    if session.is_empty() || args.next().is_some() { std::process::exit(2) }

    // Install the requested shutdown handler and initialize the process state
    // before publishing a session-bound readiness record.
    unsafe { libc::signal(libc::SIGTERM, request_termination as libc::sighandler_t); }
    let initialized = AtomicBool::new(false);
    initialized.store(true, Ordering::SeqCst);
    if !initialized.load(Ordering::SeqCst) { std::process::exit(2) }
    println!("{}", serde_json::json!({
        "protocol": "pfc.synthetic-old-runtime.ready.v1",
        "pid": std::process::id(),
        "session": session,
        "initialized": true,
    }));
    if io::stdout().flush().is_err() { std::process::exit(2) }

    while !TERMINATE.load(Ordering::SeqCst) {
        std::thread::sleep(Duration::from_millis(10));
    }
}
