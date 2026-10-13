# Implementation Readback

Source commit: `7b4a9c16bbbfc6ad1cd602af479d8aaa9a11f756`.

Changed runtime files: `src-tauri/src/startup_exclusion.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/quiescence.rs`, `src-tauri/src/bin/quiescence_tauri.rs`, and feature declaration in `src-tauri/Cargo.toml`. Synthetic integration test: `scripts/test_wp04r2c3a_startup_exclusion.py`.

The implementation uses the existing macOS `flock` primitive and fixed `maintenance.lock` name, with shared/exclusive modes. Production UI lock lifetime is the entire Tauri event loop. Migration lock begins before permit inspection and extends through native migration readback.

Scope review: no product business logic, Financial Model, M4 SQL, recovery state machine, permit contract, ledger contract, or UI-to-Gate IPC changes.
