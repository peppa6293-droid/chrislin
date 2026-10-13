# R2C3A Regression Summary

- Typecheck: PASS.
- Lint: exit 0, 25 existing CSS specificity warnings.
- Product: 300/300. WP03 preview packaging: 5/5. Release Gate: 40/40.
- R2A wiring, R2B1A Gate-owned contract, unified synthetic contract and recovery diagnostic: 34/34 combined; the diagnostic suite contributed 9 passing cases.
- Rust default library: 40/40. Quiescence fixture with R2C3A test feature: 33/33. Tauri harness: 44/44.
- R2B1B native handoff: 16/16. Recovery hooks: 12/12. Native lease: 15/15.
- R2C3A UI/Gate/full-chain/crash/namespace cases: 4/4. Shared/exclusive startup race: 50 iterations, 0 double wins.
- Forward synthetic Migration 4: exactly one version-4 row and `VERIFIED_HANDOFF`.

The first R2B1B/native-lease attempts lacked the environment-provided Apple Development identity and stopped at the prerequisite check. Both were rerun with the already configured identity and passed; the first attempt records remain preserved.

No full 17-case recovery matrix was repeated because recovery state-machine behavior was not changed. No final candidate was frozen or built. Production app/database were not accessed.
