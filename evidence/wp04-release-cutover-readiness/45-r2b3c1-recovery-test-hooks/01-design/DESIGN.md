# R2B3C1 Hook Design

The unified runner receives one optional fixed test point only in Cargo feature `wp04-r2b-recovery-test-hooks`, which depends on `wp04-r2b-synthetic`. Production/default builds do not compile this feature or its environment variable readers.

A selected hook requires both `PFC_R2B_RECOVERY_TEST_POINT` and the exact domain `UNIFIED_R2B_SYNTHETIC`. The native authority must already be the validated `UNIFIED_R2B_GATE_OWNED` Gate authority, and the root marker is rechecked as a regular file with exact bytes `PFC_WP04_SYNTHETIC_CUTOVER_V1\n`. Missing, wrong, or symlink marker fails closed. Unknown points are refused without fallback.

Hook points write a separate fsynced `RECOVERY_TEST_INJECTION.json` receipt with source commit, candidate identity, session, native state, timestamp, DB schema/migration rows, permit/ledger hashes, behavior, and `authority: false`. It is not part of the recovery authority chain.

Guard loss releases the actual inherited maintenance `flock`, then confirms the production guard validation fails before persisting the typed recovery state. Orphan ACTIVE and FAILED_V3 records are emitted by the native runner from the consumed Gate authority after S5; FAILED_V3 first rolls back the transaction and verifies V3, zero M4 rows, exact DB bytes, and a held lease. The hook adds no recovery action.
