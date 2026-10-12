# R2B Integration Blockers

Verified at source HEAD `d12d09f0e0eadad3b2192fcbf9b54437b09bd18a`.

- `scripts/production_v4_release_gate.py` synthetic root marker is `PFC_WP04R2A_GATE_SYNTHETIC_V1\n`.
- `scripts/quiescence_gate.py` and `src-tauri/src/quiescence.rs` use `PFC_QUIESCENCE_SYNTHETIC_V1\n` for the same `SYNTHETIC_ONLY` object.
- `collect_synthetic_facts()` maps synthetic fixtures to `Applications/Personal Finance Console.app`, Production Bundle ID, and `Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`.
- `run_gate(..., migrate)` invokes the native consumer and expects `AUTHORIZATION_CONSUMED_NATIVE_MIGRATION_PENDING` in synthetic mode.
- `test_formal_core_reaches_actual_native_consumer_and_stops_before_migration4` asserts `migration4Executed=false` and V3 remains.
- `prepare_managed()` always emits the quiescence authorization and permit; there is no `defer_permit` option.
- The existing quiescence runner uses its own V2 permit and full S0–S10 contract. No supported formal Gate permit→q-runner handoff exists.

These observations explain why no R2B candidate/root was created and why all C0–C10/S0–S10 R2B claims remain blocked or not run. Component tests do not bridge the missing contracts.
