# S5 renderer kill — BLOCKED

No renderer signal was sent during S5. The current formal Gate→Rust→M4 path is a CLI branch that returns before Tauri/WebView creation; the ordinary Tauri UI does not expose a Gate handoff IPC command. Starting a separate CLI migration while killing the UI renderer would not exercise one shared runtime or protocol boundary. Requires a future synthetic-only testability entrypoint or an explicit Planning architecture disposition. No source change was made.
