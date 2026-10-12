//! Explicit opt-in synthetic runner. Never initializes Tauri or opens Production.
#[path = "../quiescence.rs"]
mod quiescence;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.get(1).map(String::as_str) == Some("--pfc-synthetic-gate-consume") {
        if args.len() != 3 {
            eprintln!("synthetic gate consumer accepts only its fixed role and marked root");
            std::process::exit(2);
        }
        match personal_finance_console_lib::consume_synthetic_gate_authorization(std::path::Path::new(&args[2])) {
            Ok(value) => { println!("{value}"); }
            Err(error) => {
                println!("{}", serde_json::json!({"event":"blocked", "error":error}));
                std::process::exit(2);
            }
        }
        return;
    }
    if let Err(error) = quiescence::cli() {
        println!("{}", serde_json::json!({"event":"blocked", "error":error}));
        std::process::exit(2);
    }
}
