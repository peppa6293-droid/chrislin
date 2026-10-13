# Startup Exclusion Design

## Production authority identity

Both ordinary Production startup and `--pfc-internal-v4-migrate` resolve the canonical current user's `Library/Application Support/com.personalfinance.console` directory. The only lock path is its stable `maintenance.lock` file. The lock is owner-only, single-link, regular, non-symlink, and checked against the opened inode. The app-data directory must be canonical and owned by the effective user.

## Lock lifetime

- Ordinary Production startup acquires `LOCK_SH | LOCK_NB` before `tauri::Builder::default()` and keeps the returned file descriptor alive through the blocking Tauri event loop.
- The formal native Migration 4 role acquires `LOCK_EX | LOCK_NB` before reading or consuming permit state, and keeps the descriptor alive across native migration and verified readback.
- The unified synthetic Gate retains its existing Gate-owned `LOCK_EX` lease and inherited descriptor, so the UI probe contends on exactly the same `maintenance.lock` path.
- Lock contention returns a fail-closed error before WebView construction, permit claim, or SQLite mutation.
- Existing durable startup diagnostics still run before Builder. The lock only serializes process entry; it does not infer schema state or authorize recovery.

## Test-only pause boundary

The optional `wp04-r2c3a-startup-exclusion-test-hooks` feature pauses the synthetic native consumer after durable S5 and after COMMIT/before verified readback. Its control directory is a distinct canonical temporary directory outside the managed fixture root. It is not enabled in the default Production build and does not alter permit, ledger, migration, recovery, or S-state semantics.
