#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(feature = "wp04-r2b-synthetic")]
#[path = "quiescence.rs"]
mod quiescence;

fn main() {
    #[cfg(feature = "wp04-r2b-synthetic")]
    {
        let args: Vec<String> = std::env::args().collect();
        if args.get(1).map(String::as_str) == Some("--pfc-r2b1-unified-synthetic") {
            if args.len() != 3 {
                eprintln!("unified synthetic consumer accepts only its fixed role and marked root");
                std::process::exit(2);
            }
            match quiescence::run_unified_gate_handoff(&args[2]) {
                Ok(value) => println!("{value}"),
                Err(error) => {
                    println!("{}", serde_json::json!({"event":"blocked", "error":error}));
                    std::process::exit(2);
                }
            }
            return;
        }
    }
    personal_finance_console_lib::run();
}
