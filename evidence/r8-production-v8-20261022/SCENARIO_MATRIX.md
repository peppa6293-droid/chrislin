# R8 isolated scenario matrix

Date: 2026-10-22
Scope: code, tests, isolated fixtures, and temporary directories only.
No Production identity, real Production database, real Production app-data, real permit,
real terminal, or installed `/Applications` bundle was opened, created, consumed, or launched.

Legend for the "harness" column:
- **RS** = `cargo test --manifest-path src-tauri/Cargo.toml`
- **TS** = `env NODE_ENV=test npx vitest run`
- **PY-V8** = `python3 -I scripts/test_production_v8_release_gate.py -v`
- **PY-V4** = `python3 -I scripts/test_production_v4_release_gate.py -v`
- **PY-WIRE** = `python3 -I scripts/test_production_gate_wiring_integration.py -v`

## A. Native schema migration (V3 → V8)

| # | Scenario | Harness / exact test | Required assertion | Log |
|---|---|---|---|---|
| 1 | Never-started V3 is eligible and untouched | RS `production_terminal_tests::never_started_v3_is_distinguished_and_remains_eligible` | startup succeeds; no ledger; no terminal | `30-rust/cargo-test.log` |
| 2 | Full native V3→V8 chain, isolated temp root | RS `production_terminal_tests::native_v3_to_v8_full_schema_fixture_migration_is_isolated` | source 3/3; target 8/8; rows `[1..8]`; count 8; integrity `ok`; FK 0; sidecars absent; root is not `/Applications` and does not contain the Production identifier | `30-rust/native-v3-to-v8-fixture.log` |
| 3 | Intermediate V4/V5/V6/V7 are not startable and not re-migratable | RS `production_terminal_tests::intermediate_v4_to_v7_schemas_are_neither_startable_nor_migratable` | startup fails for each; migration fails; DB unchanged at the intermediate version; zero V8 rows | `30-rust/cargo-test.log` |
| 4 | DDL failure rolls back with no half-migrated state | RS `production_terminal_tests::ddl_failure_rolls_back_to_v3_without_a_half_migrated_state` | DB returns to 3/3; rows `[1,2,3]`; zero V5–V8 tables; no sidecars | `30-rust/cargo-test.log` |
| 5 | Native source DDL matches the accepted TS migration source | RS `tests::native_schema_artifacts_match_accepted_migration_source` | `migrations/004..008.sql` content matches the accepted source | `30-rust/cargo-test.log` |
| 6 | `005.sql`–`008.sql` are byte-identical to the TS source | TS `migrations/005.sql`..`008.sql matches the TypeScript migration source byte-for-byte` (4 tests) | normalized SQL equality, one test per version | `10-tests/r8-runtime-boundary-and-parity-verbose.log` |
| 7 | Native SQL chain reproduces accepted V5–V8 schema snapshots | TS `applying the native SQL chain through V5..V8 produces the accepted schema snapshot` (4 tests) | `sqlite_master` rows equal `vN-schema.json`; `PRAGMA user_version=N` | same as #6 |

## B. Durable terminal and restart ordering

| # | Scenario | Harness / exact test | Required assertion | Log |
|---|---|---|---|---|
| 8 | Terminal is durable before the exclusive guard is released | RS `production_terminal_tests::normal_success_durably_binds_terminal_before_guard_release` | `V8_VERIFIED`; rows `[1..8]`; exactly one V8 migration row; shared startup lock is refused while guard held; startup succeeds after release | `30-rust/cargo-test.log` |
| 9 | Verified V8 restart does not replay migration | RS `production_terminal_tests::verified_v8_restart_does_not_replay_migration_and_reply_loss_keeps_terminal` | restart succeeds; re-migration fails; one V8 row | `30-rust/failure-injection-and-restart.log` |
| 10 | Lost caller reply after durable readback keeps the terminal | same test as #9 | migration call returns an error but startup still succeeds; one V8 row | `30-rust/failure-injection-and-restart.log` |
| 11 | Process exit after commit, before terminal, blocks restart | RS `production_terminal_tests::child_process_exits_after_commit_before_terminal_and_restart_is_blocked` | child exit code 86; DB is 8/8; ledger exists; no terminal; startup fails | `30-rust/failure-injection-and-restart.log` |
| 12 | Pre-terminal process stop leaves no acceptable terminal | RS `production_terminal_tests::preterminal_process_exit_and_terminal_write_failures_remain_blocked` | DB has one V8 row; no terminal; startup fails | `30-rust/failure-injection-and-restart.log` |
| 13 | Terminal temp-create/write failure (`BeforeTerminalWrite`) | same test as #12 | no terminal; startup fails | `30-rust/failure-injection-and-restart.log` |
| 14 | Terminal file fsync failure | same test as #12 | no terminal; startup fails | `30-rust/failure-injection-and-restart.log` |
| 15 | Terminal directory fsync failure | same test as #12 | no terminal; startup fails | `30-rust/failure-injection-and-restart.log` |
| 15a | Failure after directory fsync, before exact durable readback | same test as #12 (`BeforeTerminalDurableReadback`) | terminal removed; startup fails | `30-rust/failure-injection-and-restart.log` |
| 15b | Failure after the one-time permit is claimed, before native migration | RS `production_terminal_tests::authorization_claim_and_ledger_or_receipt_failures_are_fail_closed` | DB stays 3/3; permit gone; ledger present; no terminal; startup fails; second permit reuse fails | `30-rust/failure-injection-and-restart.log` |
| 15c | Consumed-ledger persistence failure after claim | same test as #15b | DB stays 3/3; claimed file retained; no ledger/terminal; startup fails; retry fails | `30-rust/failure-injection-and-restart.log` |
| 15d | Release-receipt readback failure after claim | same test as #15b | DB stays 3/3; claimed file retained; no ledger/terminal; startup fails; retry fails | `30-rust/failure-injection-and-restart.log` |
| 16 | Create-only durable terminal protocol | RS `production_cutover_state::tests::terminal_is_create_only_durable_exact_and_rejects_symlinks` | exact readback; second write refused; symlink rejected as unsafe | `30-rust/cargo-test.log` |
| 17 | Pre-publication file-sync failure leaves no terminal | RS `production_cutover_state::tests::prepublication_file_sync_failure_leaves_no_terminal` | no terminal and directory empty | `30-rust/cargo-test.log` |
| 18 | Directory-sync / readback tamper leaves no acceptable terminal | RS `production_cutover_state::tests::directory_sync_and_exact_readback_failures_leave_no_acceptable_terminal` | directory-fsync failure and post-publish tamper both fail; no terminal remains | `30-rust/cargo-test.log` |
| 19 | Unresolved claimed authorization is discovered | RS `production_cutover_state::tests::unresolved_claim_name_is_discovered` | claimed V8 filename detected | `30-rust/cargo-test.log` |

## C. Fail-closed terminal, permit, ledger, and binding matrix

| # | Scenario | Harness / exact test | Required assertion | Log |
|---|---|---|---|---|
| 20 | Corrupt terminal / stale manifest / stale backup / resurrected permit / V8→V7 / changed candidate | RS `production_terminal_tests::corrupt_or_stale_terminal_fails_closed` | every mutation makes startup fail | `30-rust/cargo-test.log` |
| 21 | Missing terminal after V8, and unresolved claim before DB access | RS `production_terminal_tests::stale_or_missing_terminal_authority_blocks_before_database_mutation` | claim blocks while DB remains V3; removed terminal blocks while one V8 row remains | `30-rust/cargo-test.log` |
| 22 | Pending terminal temp file blocks before database access | RS `production_terminal_tests::pending_terminal_write_and_unresolved_claim_block_before_database_access` | `WRITE_UNRESOLVED`; DB remains V3 | `30-rust/cargo-test.log` |
| 23 | Historical V4 terminal is block-only | RS `production_terminal_tests::legacy_v4_terminal_and_permit_are_block_only` | startup fails; migration fails; DB stays V3; zero V8 rows | `30-rust/cargo-test.log` |
| 24 | Historical V4 permit is block-only | same test as #23 | startup fails; migration fails; DB stays V3 | `30-rust/cargo-test.log` |
| 25 | V4 record recognition in pre-SQLite startup gate | RS `cutover_startup::tests::legacy_v4_terminal_is_a_block_only_record` | V4 terminal yields a blocking decision and never authorizes startup | `30-rust/cargo-test.log` |
| 26 | A verified record does not self-authorize handoff | RS `cutover_startup::tests::verified_does_not_self_authorize_handoff` | startup requires a separate authorized compatible handoff | `30-rust/cargo-test.log` |
| 27 | Tampered terminal state / missing field / wrong rows | RS `production_terminal_tests::incomplete_or_tampered_v8_terminal_fails_closed` | each tamper makes startup fail | `30-rust/cargo-test.log` |
| 28 | Ledger missing, or terminal+ledger missing | RS `production_terminal_tests::consumed_authorization_without_terminal_or_ledger_blocks` | startup fails with incomplete/ledger/terminal-required error | `30-rust/cargo-test.log` |
| 29 | Receipt owner mismatch | RS `production_terminal_tests::terminal_binding_mismatch_matrix_fails_closed` | startup fails | `30-rust/cargo-test.log` |
| 30 | Ledger nonce mismatch | same test as #29 | startup fails | `30-rust/cargo-test.log` |
| 31 | Backup content mismatch | same test as #29 | startup fails | `30-rust/cargo-test.log` |
| 32 | Database inode replacement | same test as #29 | startup fails | `30-rust/cargo-test.log` |
| 33 | Production DB direct open is refused before opening | RS `tests::o_direct_database_open_refuses_the_production_identity_path_before_opening_it` | Production path rejected | `30-rust/cargo-test.log` |
| 34 | Internal migration role has no user-supplied paths | RS `tests::p_production_internal_role_is_fixed_and_has_no_user_supplied_paths` | only the fixed role/path is accepted | `30-rust/cargo-test.log` |
| 35 | Production authorizer blocks schema/metadata mutation outside the window | RS `tests::l_production_authorizer_blocks_schema_and_metadata_mutations_outside_gate` | DDL and metadata writes denied | `30-rust/cargo-test.log` |
| 36 | Authorized migration window is single-use and exact-V8 | RS `tests::m_authorized_production_migration_window_is_single_use_and_requires_exact_v8` and `tests::n_production_migration_window_cannot_mark_an_incomplete_migration_ready` | second use rejected; incomplete migration cannot be marked ready | `30-rust/cargo-test.log` |
| 37 | Consumed-ledger persistence failure is fail-closed | RS `tests::r_consumed_ledger_persistence_failure_is_fail_closed` | failure aborts; no success state | `30-rust/cargo-test.log` |
| 38 | Only a new authorization id and nonce extend the ledger | RS `tests::s_only_new_authorization_id_and_nonce_can_extend_consumed_ledger` | duplicate id/nonce cannot extend | `30-rust/cargo-test.log` |
| 39 | Sidecar metadata is fail-closed and rejects redirected objects | RS `tests::sidecar_metadata_is_fail_closed_and_rejects_redirected_objects` | sidecar/redirect rejection | `30-rust/cargo-test.log` |

## D. TypeScript schema authority boundary

| # | Scenario | Harness / exact test | Required assertion | Log |
|---|---|---|---|---|
| 40 | Production maps only to the native V8 gate | TS `assigns Production exclusively to the native V8 gate` | authority is `NATIVE_V8_GATE` | `10-tests/r8-runtime-boundary-and-parity-verbose.log` |
| 41 | Isolated identities map to TS migrations | TS `assigns isolated identity ... to TypeScript migrations` (5 identities) | smoke, v4acceptance, wp02preview, wp03preview, quiescence.integration → `TYPESCRIPT_MIGRATION` | same as #40 |
| 42 | Unknown/empty identity fails closed | TS `fails closed for an unrecognized or empty identity` | throws `RUNTIME_IDENTITY_NOT_ISOLATED` | same as #40 |
| 43 | Production bootstrap leaves a V3 fixture at V3 | TS `bootstrap leaves an isolated V3 fixture at V3 and performs no migration` | user/migration version stay 3; no V4+ tables | same as #40 |
| 44 | Production services never enter business I/O | TS `services leave an isolated V3 fixture at V3 and never enter business I/O` | services reject; version stays 3 | same as #40 |
| 45 | Production V8 is accepted read-only | TS `bootstrap accepts an already-V8 Production database without any write` | serialized DB bytes identical before/after | same as #40 |
| 46 | No DB opened when native identity is unavailable or unknown | TS `does not open a database when native identity is unavailable` and `... for an unrecognized identity` | `openDatabase` never called | same as #40 |
| 47 | Isolated runtimes still own V1–V8 | TS `bootstrap migrates an isolated V3 fixture to V8 for ...` (smoke, v4acceptance) and `services complete the chain for an isolated V1 fixture` | versions 8/8; rows `[1..8]` | same as #40 |
| 48 | `targetVersion` is authoritative at 1/2/3, default 8 | TS `stops exactly at targetVersion 1/2/3`, `defaults to the full V8 chain unchanged` | stops exactly; default 8/8 | same as #40 |

## E. Python release-gate refusal matrix (V8)

`PY-V8` runs 25 tests, all passing. Representative mappings:

| # | Scenario | Exact test | Required assertion |
|---|---|---|---|
| 49 | Exact V8 preflight and persisted receipt | `test_preflight_accepts_only_exact_v8_contract_and_persists_receipt` | preflight passes only for the exact V8 contract |
| 50 | V4 manifest cannot authorize V8 | `test_v4_manifest_cannot_authorize_v8` | rejected |
| 51 | Future schema / authority mismatch | `test_future_schema_version_is_rejected`, `test_user_version_and_migration_version_mismatch_is_rejected` | rejected |
| 52 | Known legacy V4 executable | `test_known_legacy_executable_is_rejected` | rejected |
| 53 | Wrong bundle / missing manifest | `test_wrong_bundle_id_is_rejected`, `test_missing_manifest_is_rejected` | rejected |
| 54 | SQLite sidecar present | `test_sqlite_sidecar_is_rejected` | rejected |
| 55 | Backup hash/path/device/inode mismatch | `test_backup_hash_mismatch_is_rejected`, `test_backup_path_escape_is_rejected`, `test_path_alias_backup_is_rejected`, `test_backup_device_or_inode_mismatch_is_rejected` | rejected |
| 56 | V4 permit/terminal block-only | `test_historical_v4_permit_or_terminal_is_block_only` | rejected as authority |
| 57 | Permit create-only, one-time, receipt-bound | `test_permit_is_create_only_one_time_and_bound_to_receipt` | enforced |
| 58 | Expired/future permit; old unconsumed permit; resurrection | `test_expired_and_future_dated_permits_are_rejected`, `test_old_unconsumed_permit_blocks_a_new_permit`, `test_permit_resurrection_is_rejected` | rejected |
| 59 | Ledger duplicate/nonce/missing/tamper | `test_duplicate_authorization_and_nonce_in_ledger_are_rejected`, `test_ledger_missing_is_rejected`, `test_ledger_tamper_is_rejected` | rejected |
| 60 | Terminal missing/tamper | `test_terminal_missing_is_rejected`, `test_terminal_tamper_is_rejected` | rejected |
| 61 | Completed migration requires terminal + ledger + exact restart readback | `test_completed_migration_requires_terminal_ledger_and_exact_restart_readback` | enforced |
| 62 | Process inventory incomplete/unknown | `test_incomplete_or_unknown_process_inventory_is_rejected` | rejected |
| 63 | Synthetic root escape | `test_synthetic_root_escape_is_rejected` | rejected |

## F. Historical compatibility retained (no semantic change)

| # | Scenario | Harness / exact test | Result | Log |
|---|---|---|---|---|
| 64 | Historical V4 gate contract | PY-V4, 40 tests | 40 passed | `40-gates/v4-gate-tests.log` |
| 65 | Historical V4 gate wiring, fixture-only branch | PY-WIRE, 5 tests | 5 passed; binary rebuilt with `quiescence-fixture`; permit consumed; DB remains V3; `migration4Executed=false` | `40-gates/gate-wiring-integration-tests.log` |
| 66 | Unified synthetic contract | `python3 scripts/test_unified_synthetic_contract.py -v`, 5 tests | 5 passed | `40-gates/unified-synthetic-contract-tests.log` |
| 67 | Unified R2B recovery | `python3 scripts/test_unified_r2b_recovery.py -v` | **setup error, 0 tests run** — historical retained root lacks `SYNTHETIC_ONLY`; documented as pre-existing environment state, not an R8 pass or regression | `40-gates/unified-r2b-recovery-tests.log` |

## Negative-control summary

- No scenario writes to `/Applications`, the real Production app-data directory, or the real Production database.
- All Rust terminal/migration tests use `temp_dir()` fixtures with owner-only directories and exact executable stubs.
- The Production release binary does not contain the fixture-only V4 compatibility string; the V4 branch is compiled only under `quiescence-fixture`.
- The Production candidate was built but never launched.
