//! Explicit opt-in synthetic runner. Never initializes Tauri or opens Production.
#[path = "../quiescence.rs"]
mod quiescence;

fn main() {
    if let Err(error) = quiescence::cli() {
        println!("{}", serde_json::json!({"event":"blocked", "error":error}));
        std::process::exit(2);
    }
}
