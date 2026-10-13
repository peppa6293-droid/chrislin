# Frozen SQLite profile

- Frozen runtime source: `c3da2f73c03b681957b4334751b7933d102caad1`.
- `src-tauri/Cargo.toml`: `rusqlite = 0.37` with `bundled`, `hooks`.
- Frozen `Cargo.lock`: `rusqlite 0.37.0`, `libsqlite3-sys 0.35.0`.
- Native migration connection (`src-tauri/src/quiescence.rs`, `run_consumed`): `READ_WRITE | NO_MUTEX | PRIVATE_CACHE | NOFOLLOW`, `busy_timeout=0`, `journal_mode=DELETE`, `locking_mode=EXCLUSIVE`, synchronous FULL, no checkpoint on close.
- Q10 injection uses the same frozen rusqlite/bundled SQLite source and version, but deliberately uses `SQLITE_OPEN_SHARED_CACHE` on two connections to create a deterministic SQLite table-lock conflict. This is an isolated error-semantics injection mechanism, not a claim that the native private-cache production-like profile naturally creates this lock.
