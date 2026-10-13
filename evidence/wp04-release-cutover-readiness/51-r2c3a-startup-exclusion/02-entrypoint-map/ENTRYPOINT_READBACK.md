# Startup Exclusion Entrypoint Readback

- Ordinary app entry: `src-tauri/src/lib.rs::run`; Production identity calls `production_authority`, acquires shared lock, checks unresolved durable state, then constructs `tauri::Builder`.
- Formal native migration entry: `run_production_migration_command`; exact installed executable identity is checked, then exclusive lock is acquired before permit metadata/read/claim and before the database path is opened.
- Migration scope under lock: permit inspection/consumption, native Migration 4 transaction, commit, and post-commit schema/sidecar readback.
- Synthetic UI probe: `src-tauri/src/bin/quiescence_tauri.rs`, compiled only as an isolated test harness.
- No renderer-to-Gate IPC or migration authority was added.
