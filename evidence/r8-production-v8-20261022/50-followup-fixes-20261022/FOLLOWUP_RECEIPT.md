# R8 follow-up receipt — independent audit fixes F01–F08

Date: 2026-10-22
Status: **`R8_CODE_BATCH_PASS`**

This is an addendum to the preserved pre-fix receipt at
`evidence/r8-production-v8-20261022/RECEIPT.md`. That file was not modified. Its SHA-256 at the
time this addendum was written is:

```text
f39ccfc96b050c5d4fa6e3e2b70d4d574fb93b1351c2330d0c74159c235f7f27  evidence/r8-production-v8-20261022/RECEIPT.md
```

The pre-fix receipt remains `R8_CODE_BATCH_BLOCKED` for the historical record. This addendum
records the follow-up code/test fixes, the corrected command, the preserved failure evidence, and
the post-fix verification. `R8_CODE_BATCH_PASS` means only that this code/test batch passed. It
does **not** mean Production was migrated, recovered, or authorized to migrate.

## 1. Original documented command failure — preserved, not hidden

The command documented in the original task book §3.1 was reproduced verbatim:

```text
python3 -I -m unittest scripts/test_production_v8_release_gate.py
```

- Exit code: `1`
- Result: `FAILED (errors=1)`, 1 test attempted, 0 run
- Raw error: `ModuleNotFoundError: No module named 'scripts'`
- Full raw stdout/stderr: `logs/00-original-documented-command-failure.log`
- Exit code file: `logs/00-original-documented-command-failure.exit`

This is an invocation-form defect under Python 3.9.6 isolated mode (`-I` removes the current
directory from `sys.path`), not a passing test and not a code failure. It is not reported as PASS.

The §3.1 command was corrected in
`docs/EXEC-R8-PRODUCTION-SCHEMA-V8-MIGRATION-INSTRUCTIONS.md` to the verified form:

```text
python3 -I scripts/test_production_v8_release_gate.py -v
```

- Exit code: `0`
- Result: `Ran 43 tests ... OK`
- Full raw output: `logs/05-v8-gate-tests.log`
- Exit code file: `logs/05-v8-gate-tests.exit`

## 2. Per-finding fixes and regression tests

### R8-F01 — native result and terminal hash bindings

Files: `scripts/production_v8_release_gate.py`, `scripts/test_production_v8_release_gate.py`.

Implemented:

- `native_result.terminalSha256` must be present, a valid lowercase SHA-256, and equal the SHA-256
  of the first exact terminal readback bytes.
- The independent restart readback must be byte-identical and parse-identical to the first readback,
  and its raw-byte SHA-256 must equal `native_result.terminalSha256`.
- `native_result.databaseSha256` must be present, valid, and equal the post-migration
  `inspect_database()` SHA-256.
- `terminal.databasePostMigrationSha256` must equal both the post-migration readback and
  `native_result.databaseSha256`.
- Every failure is fail-closed; `V8_RELEASE_GATE_VERIFIED` is unreachable on failure.
- The synthetic `migrate_fixture()` now emits the same bindings as the native contract.

Regression tests:

- `test_native_terminal_sha256_is_required_and_bound_to_exact_bytes`
- `test_native_database_sha256_is_required_and_matches_disk`
- `test_terminal_post_migration_hash_must_equal_native_database_sha256`

### R8-F02 — post-native fresh candidate and backup readback

Files: `scripts/production_v8_release_gate.py`, `scripts/test_production_v8_release_gate.py`.

Implemented in `verify_completed_migration()`:

- Preflight candidate, backup, and pre-migration database facts are captured before the
  post-migration database fact replaces the preflight database in the working facts.
- After native returns, the candidate is re-read with `read_bundle()` from the fixed app path
  (`<synthetic_root>/Applications/Personal Finance Console.app` in synthetic mode; `APP_PATH` in
  Production mode), never from cached `facts["candidate"]`.
- Fresh bundle ID, bundle path, executable name/path/hash/mode, manifest path/hash/content, and
  Info.plist path/hash are compared item-by-item with the preflight candidate, the migration
  authorization, and the persisted release receipt.
- The backup is re-read from the fixed path via `fixed_backup_path()` and `_backup_facts()`. Any
  missing file, non-regular file, symlink/hard-link, path change, device change, inode change, nlink
  change, or SHA-256 change is rejected. The fresh backup must agree with the preflight facts, the
  migration authorization, the release receipt, the native terminal, and the originally authorized
  pre-migration database hash.
- `validate_terminal()` is called with the fresh candidate and fresh backup facts, so success
  gating cannot rely on stale preflight values.

Regression tests:

- `test_completed_migration_requires_terminal_ledger_and_exact_restart_readback` (positive)
- `test_post_migration_candidate_executable_replacement_is_rejected`
- `test_post_migration_manifest_modification_is_rejected`
- `test_post_migration_backup_replacement_is_rejected`
- `test_post_migration_backup_modification_is_rejected`

All tests use temporary synthetic roots and remove them on teardown; no permit, receipt, ledger,
or terminal is left outside the disposable fixture.

### R8-F03 — Info.plist full-chain binding

Files: `src-tauri/src/lib.rs`, `scripts/production_v8_release_gate.py`,
`scripts/test_production_v8_release_gate.py`.

Rust implemented:

- `ProductionMigrationAuthorization`, `ProductionCutoverTerminal`, and
  `ProductionMigrationAuthority` carry `candidateInfoPlistPath` / `candidateInfoPlistSha256`.
- `read_production_info_plist()` derives the fixed `Contents/Info.plist` from the authorized
  executable, requires a single-link regular file, and hashes it.
- Permit consume validates the path/hash against the current bundle before ledger persistence.
- The release receipt, terminal, and startup/restart validator all bind and re-check the same
  Info.plist path/hash, failing with `PRODUCTION_TERMINAL_CANDIDATE_BINDING_MISMATCH` on change.
- The synthetic fixture creates an Info.plist and binds it into the receipt and permit.

Python implemented:

- `validate_preflight()` requires the fixed Info.plist path and a valid SHA-256, and compares the
  observed bundle facts including Info.plist path/hash.
- Owner approval and migration authorization must bind the same valid path/hash.
- The release receipt and permit carry and validate both fields.
- Terminal validation compares Info.plist path/hash with the fixed candidate and receipt.
- `verify_completed_migration()` compares the fresh `read_bundle()` Info.plist facts with the
  receipt, authorization, preflight, and terminal bindings.
- Missing, malformed, or mismatched values fail closed; old records without the fields fail closed.

Regression tests:

- `test_info_plist_content_change_with_identical_identity_is_rejected`
- `test_info_plist_bindings_are_required_in_approval_and_authorization`
- `test_info_plist_change_after_migration_blocks_completed_verification`
- Rust: `info_plist_rebinding_blocks_migration_and_restart`

### R8-F04 — one canonical fixed backup path

Files: `src-tauri/src/lib.rs`, `scripts/production_v8_release_gate.py`,
`scripts/test_production_v8_release_gate.py`.

Implemented:

- The only accepted backup is
  `<app_data>/production-v8-backups/personal-finance-console.sqlite3`.
- The raw path is validated before any normalization; symlinks, hard links, nested files, aliases,
  directories, the database itself, different basenames, and paths outside the fixed app-data root
  are rejected.
- Rust `validate_fixed_backup_path()` runs before ledger persistence and native migration.
- Python preflight, synthetic facts, and real facts use the same exact fixed-path rule.

Regression tests:

- `test_backup_path_must_be_the_exact_fixed_file`
- `test_backup_symlink_alias_is_rejected_before_facts`
- `test_backup_hard_link_is_rejected`
- `test_fixed_backup_path_validator_does_not_normalize_aliases`
- `test_path_alias_backup_is_rejected`
- Rust: `authorization_backup_path_must_be_the_exact_fixed_file`

### R8-F05 — fixed release receipt path before side effects

Files: `scripts/production_v8_release_gate.py`, `scripts/test_production_v8_release_gate.py`,
task-book documentation.

Implemented:

- The receipt path is fixed to `APP_DATA / production-v8-release-receipt.json` in Production and
  `<synthetic_app_data>/production-v8-release-receipt.json` in synthetic mode.
- `run_gate()` validates a supplied `--receipt` path and raises `GateBlocked` before writing
  artifacts, issuing a permit, or invoking the native runner.
- A custom Production receipt path is rejected without artifacts and without a `native_runner` call.

Regression tests:

- `test_fixed_receipt_path_validator_rejects_custom_paths`
- `test_default_receipt_path_is_the_fixed_synthetic_file`
- `test_synthetic_gate_refuses_custom_receipt_before_artifacts_or_native_runner`
- `test_production_gate_refuses_custom_receipt_before_artifacts_or_native_runner`

### R8-F06 — V3 source history recheck inside the exclusive lock

Files: `src-tauri/src/lib.rs`.

Implemented:

- `validate_v3_source_history()` re-reads `PRAGMA user_version`, the full ordered
  `schema_migrations` rows, `COUNT(*)`, and `MAX(version)` after acquiring the exclusive lock and
  before any DDL.
- The required tuple is `(3, 3, 3, [1, 2, 3])`.
- Any mismatch aborts before commit, leaving no V4–V8 rows and no half-migration.

Regression test:

- Rust: `native_migration8_rejects_inconsistent_v3_source_history`

The test covers `[2,3]`, `[1,3]`, and `[1,2,3,4]` with `user_version = 3`, and verifies the legal
`[1,2,3]` case migrates to V8.

### R8-F07 — startup requires the exact post-migration database hash

Files: `src-tauri/src/lib.rs`.

Implemented:

- `validate_production_terminal()` now additionally requires
  `current.database_sha256 == terminal.database_post_migration_sha256`.
- A mismatch returns `PRODUCTION_TERMINAL_DATABASE_HASH_MISMATCH` even when schema, migration rows,
  integrity check, foreign keys, and sidecars are all still valid.

Regression test:

- Rust: `terminal_post_migration_database_hash_blocks_legal_data_changes_on_restart`

The test migrates a synthetic V3 fixture to V8, confirms an unmodified restart passes, inserts one
legal `profiles` row, confirms integrity/FK remain valid, and confirms restart is rejected on the
database hash mismatch.

### R8-F08 — documentation and follow-up evidence

- Corrected §3.1 to `python3 -I scripts/test_production_v8_release_gate.py -v`.
- Preserved the original command failure raw output and exit code in `logs/`.
- Recorded every per-finding fix and regression test name in this addendum.
- Recorded every verification command, exit code, and raw log path.
- Did not overwrite `RECEIPT.md` or any old log.

## 3. Verification commands and results

All commands were run from the repository root. Raw logs and `.exit` files are in `logs/`.

| # | Command | Exit | Result | Raw log |
|---|---|---|---|---|
| 1 | `env NODE_ENV=test npx vitest run --reporter=dot` | 0 | 44 files passed, 1 skipped; 442 tests passed, 80 skipped | `logs/01-vitest.log` |
| 2 | `npm run typecheck` | 0 | `tsc --noEmit` clean | `logs/02-typecheck.log` |
| 3 | `npm run lint` | 0 | 125 files checked, no fixes applied | `logs/03-lint.log` |
| 4 | `cargo test --manifest-path src-tauri/Cargo.toml` | 0 | 61 passed, 0 failed, 0 ignored | `logs/04-cargo-test.log` |
| 5 | `python3 -I scripts/test_production_v8_release_gate.py -v` | 0 | 43 tests, OK | `logs/05-v8-gate-tests.log` |
| 6 | `python3 -I scripts/test_production_v4_release_gate.py -v` | 0 | 40 tests, OK | `logs/06-v4-gate-tests.log` |
| 7 | `python3 -I scripts/test_production_gate_wiring_integration.py -v` | 0 | 5 tests, OK | `logs/07-gate-wiring-integration.log` |
| 8 | `python3 scripts/test_unified_synthetic_contract.py -v` | 0 | 5 tests, OK | `logs/08-unified-synthetic-contract.log` |
| 9 | `python3 scripts/test_unified_r2b_recovery.py -v` | 1 | setup error, 0 tests run — see below; not a pass | `logs/09-unified-r2b-recovery.log` |
| 10 | `git diff --check` | 0 | no whitespace errors | `logs/10-git-diff-check.log` |

Baseline comparison (from the preserved pre-fix receipt):

| Suite | Baseline HEAD | Pre-fix R8 batch | This follow-up | Change vs pre-fix R8 |
|---|---|---|---|---|
| Vitest | 415 passed, 80 skipped | 442 passed, 80 skipped | 442 passed, 80 skipped | 0 |
| Cargo | 46 passed | 57 passed | 61 passed | +4 |
| Python V8 gate | new | 25 passed | 43 passed | +18 |
| Python V4 gate | 40 passed | 40 passed | 40 passed | 0 |
| Gate wiring | 5 passed | 5 passed | 5 passed | 0 |
| Unified synthetic contract | 5 passed | 5 passed | 5 passed | 0 |
| Unified R2B recovery | setup error | setup error, 0 run | setup error, 0 run | 0 |

No existing test was deleted, skipped, or loosened. The new tests are additive.

### R2B setup error — raw and explicitly not a pass

`python3 scripts/test_unified_r2b_recovery.py -v` exits `1` with `Ran 0 tests`:

```text
ERROR: setUpClass (__main__.UnifiedR2BRecoveryTests)
FileNotFoundError: [Errno 2] No such file or directory:
'/private/var/folders/.../T/pfc-qic-wp04r2b-v3compat-retry-bzypfudz/SYNTHETIC_ONLY'
production_v4_release_gate.GateBlocked: Production V4 release gate blocked:
Synthetic marker is missing or unreadable
```

This is a pre-existing retained-fixture condition, identical to the baseline and the pre-fix R8
batch. It is not counted as a pass, not counted as an R8 regression, and was not deleted or
silently skipped. Full raw output is in `logs/09-unified-r2b-recovery.log`.

Pre-existing unrelated warning: unused `PathBuf` import in
`src-tauri/src/wp02_preview_isolation.rs:2`. It does not affect test results.

## 4. Isolated candidate build

Build flow after all code tests passed (shared output directory, so smoke was built first and the
Production candidate was rebuilt last):

```text
npm run tauri:build:smoke
npm run tauri:build
```

Raw logs: `20-builds/tauri-build-smoke-final.log`,
`20-builds/tauri-build-production-final.log`; exit codes in `.exit` files. Both exits were `0`.
A fresh smoke identity was captured before the final Production rebuild; pre-fix hashes were not
reused.

Final Production candidate (`20-builds/BUILD_IDENTITY.json`):

| Artifact | Path | SHA-256 |
|---|---|---|
| App bundle file-list hash | `src-tauri/target/release/bundle/macos/小钱家.app` | `542447e3a9d97a916e7417e93caf7310da7507706683d295319513fe24e038fc` |
| Executable | `.../Contents/MacOS/personal-finance-console` | `c27124aeb3f9d15bb863cf00f70116dd7b9402fa6fccfad523f60a108d90be23` |
| Info.plist | `.../Contents/Info.plist` | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb` |
| Manifest (bundled and source) | `.../Contents/Resources/runtime-compatibility.json` / `src-tauri/runtime-compatibility.json` | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509` |
| DMG | `src-tauri/target/release/bundle/dmg/小钱家_0.1.0_aarch64.dmg` | `5df1c14893f610fe113f24589f77267affeada490f795355a96781d22d510f48` |

Bundle identifier: `com.personalfinance.console`.
Bundle executable: `personal-finance-console`.
Manifest copied byte-identically: `true`.
Reproducible bundle file list and hashes: `20-builds/app-bundle-files.sha256`; its own SHA-256 is
`542447e3a9d97a916e7417e93caf7310da7507706683d295319513fe24e038fc`, matching
`appBundleFileListHashSha256`.

Fresh smoke identity (`20-builds/smoke-identity.json`), overwritten by the final Production
rebuild as expected:

| Artifact | SHA-256 |
|---|---|
| Smoke executable | `1185ec5821530e4a6c168ffebb812e1046f30f2c3c7501082c911aee3913fe09` |
| Smoke DMG | `25afca1e4f548d427babca501d4996bf5aa4bf30f1c804a2c53de0153c2f9a46` |
| Smoke app file-list hash | `d621810bd5970436b623a9a4ac2a08c267bd545d3b067ade20d7d93cf201b330` |

Explicitly: the candidate was **not launched**. Nothing was copied to `/Applications`. No real
Production app-data, permit, receipt, ledger, terminal, or installed bundle was created, consumed,
replaced, or modified.

## 5. Scope declaration

- All runtime tests, migration simulations, and tamper tests ran only in disposable synthetic
  fixtures or temporary directories.
- No real Production SQLite database was opened, read, written, migrated, backed up, replaced, or
  deleted.
- Production identity `com.personalfinance.console` was not started.
- No real Production permit, receipt, consumed ledger, terminal, or sidecar file was touched.
- No Owner approval, migration authorization, or V8 terminal was fabricated.
- No startup gate was lowered, no authorizer removed, and no path/hash/inode/identity binding was
  bypassed.
- No business data semantics, V2→V1 `CASH_DEBIT` dual-write, financial formulas, or UI business
  scope were changed.
- No dependency, network request, sudo, or permission relaxation was added.
- No old R8/V4 evidence was deleted or overwritten.
- No `git add -A`, commit, push, merge, or copy to `/Applications` was performed.

## 6. Residual issues

1. `test_unified_r2b_recovery.py` still aborts in `setUpClass` on the retained fixture's missing
   `SYNTHETIC_ONLY` marker. This is pre-existing, reproduced raw above, and not claimed as PASS.
2. Pre-existing unused `PathBuf` import warning in `src-tauri/src/wp02_preview_isolation.rs:2`.
3. This PASS does not authorize or perform a real Production migration. Real migration remains a
   separate Owner decision and requires a separately authorized run.
4. Observation, not an R8 defect: the unmodified base `src-tauri/tauri.conf.json` does not declare
   `bundle.icon`, so the Production candidate contains three files (Info.plist, executable,
   runtime-compatibility.json) and no `icon.icns`; the smoke config explicitly supplies an icon.
   This packaging difference pre-dates this batch and does not affect the R8 executable, manifest,
   Info.plist, hash, or path bindings. It was not changed.

## 7. Git worktree

No commit, push, or merge was performed. The relevant code/test/document changes remain in the
working tree. Untracked files that existed before this batch were not deleted. Worktree status is
recorded in `git-status-short.txt` in this directory.
