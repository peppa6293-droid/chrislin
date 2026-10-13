# WP-04R2C3A Startup Exclusion Capability Map

## Scope
Close the concurrency boundary between an ordinary Production app launch and the formal V4 Migration critical section. This is runtime/source work only. No Production database, app installation, release candidate, final freeze, or business authorization is in scope.

## Current proven primitives
- `scripts/quiescence_gate.py` already acquires a stable `maintenance.lock` with `flock(LOCK_EX|LOCK_NB)`, `O_NOFOLLOW`, and inode identity checks. The lock is held for the Gate run and is not unlinked.
- The unified synthetic Gate passes the held lock descriptor into the native consumer. `src-tauri/src/quiescence.rs` validates the inherited descriptor and lock continuity. This is the established C3 owner and must remain unchanged.
- The formal Production Gate currently takes a process-inventory snapshot. It does not continuously exclude a normal app launch after that snapshot.
- The normal Tauri startup path currently calls `Builder::default()` before its user setup checks. Tauri creates configured windows before user setup, so checks inside `.setup()` are too late to exclude WebKit startup.
- The formal Production migration command consumes/claims authorization before entering `native_migration4`; it currently has no shared OS lock coordinating normal startup.

## Intended lock contract
- One stable `maintenance.lock` in the app's canonical data authority directory.
- Normal app startup takes a nonblocking shared flock before constructing the Tauri builder and holds it until the event loop exits.
- Formal Production migration takes a nonblocking exclusive flock before touching permit/authorization state or the database and holds it through the complete migration return path.
- Contention fails closed before WebKit launch, permit claim, or database mutation.
- The file is never unlinked during normal operation. Path, symlink, regular-file, and inode checks prevent split lock identities.
- The existing Gate-owned synthetic C3 lease remains the exclusive lock owner for synthetic lifecycle runs; the native consumer continues to inherit that exact descriptor.

## Test boundary
- Synthetic tests use an isolated marked temporary authority root and the same `maintenance.lock` path for app startup and migration.
- A real Tauri/WebKit launch is required to prove no renderer appears while the synthetic Gate owns the exclusive lease; then app launch is allowed after release.
- Race and regression evidence must remain isolated under `51-r2c3a-startup-exclusion/`.


## Implementation readback (2026-10-13)
- Production ordinary startup now opens the same canonical `Application Support/com.personalfinance.console/maintenance.lock` with `flock(LOCK_SH|LOCK_NB)` before `tauri::Builder::default()` and retains the descriptor until the Tauri run loop returns.
- The fixed Production migration CLI opens that same authority path with `flock(LOCK_EX|LOCK_NB)` before permit inspection/claim, then retains the descriptor through Migration 4 and post-commit database readback.
- The lock file uses no-follow open, owner-only permissions, canonical directory checks, single-link regular-file checks, and device/inode binding. It is never unlinked.
- Synthetic full-chain validation uses the existing C3 `MaintenanceLease` exclusive flock on the same stable `maintenance.lock`; a signed isolated Tauri probe competes for the shared lock at S5 and post-COMMIT, then opens after S10.
- This is source implementation and synthetic validation only. It is not a Production run, final candidate build, source freeze, or final acceptance.
