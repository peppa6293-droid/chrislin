# V0.1.2 V4 Old-Runtime Protection — Second P1 Correction Report

Status: `PF_V012_V4_OLD_RUNTIME_PROTECTION_P1_CORRECTION_2_READY_FOR_REAUDIT`

`RB-V4-OLD-RUNTIME-01` remains OPEN pending independent re-audit and Owner decision. Production replacement and V4 migration remain NOT AUTHORIZED.

## 1. Baseline

Baseline commit: `43ad6c9157f398502c684fb3ae76b1bda538fe79`. The starting worktree had no tracked or staged changes; the two prior independent audit reports were untracked evidence. They and their artifacts are preserved and excluded from this correction commit.

Only P1-OLD-GATE-01, P1-OLD-GATE-02, P1-OLD-RETIRE-03 and the directly related P2-OLD-RECEIPT-01, P2-OLD-CONTRACT-01, P2-OLD-DIAGNOSTIC-01 were changed. Financial Model semantics, Migration 4 SQL, Bundle ID, app-data identity and database basename remain unchanged.

## 2. P1-OLD-GATE-01 — nested app inventory

The app walker now inspects discovered `.app` bundles and continues recursively into their contents. It no longer prunes a bundle before searching for nested helpers. A nested Production bundle is inventoried and blocks a one-candidate preflight; nested metadata failures, symlink directories and traversal uncertainty block as unknown.

Focused tests cover a neutral outer app containing an old Production app, unreadable nested metadata, nested non-Production helpers, a lone valid candidate, traversal failure and a walker that yields no root entry.

## 3. P1-OLD-GATE-02 — complete process snapshot

`inventory_production_processes` now returns an explicit `complete` result, process list and diagnostics. Preflight requires both the top-level and nested completeness indicators and checks that process lists agree. Empty `ps`, blank/malformed rows, missing fields, invalid/duplicate PIDs, malformed or empty `lsof` output, missing/nonexistent/ambiguous executable paths, and app executable metadata with missing or non-string `CFBundleIdentifier` are all incomplete and BLOCKED.

The collector identifies executables by actual text paths and bundle metadata, not process display names. It also requires a complete open-file listing. Tests cover all specified incomplete cases, known/renamed Production processes, permission failure and a complete clean snapshot.

## 4. P1-OLD-RETIRE-03 — verify installed identity

`read_bundle` now validates the actual plist identity and executable, rejects symlinked or missing executables, and requires the resolved executable to be the canonical path inside the bundle. After installation, retirement rereads the installed bundle and checks Production Bundle ID, exact executable name and resolved path, executable SHA-256, manifest SHA-256, manifest Bundle ID and manifest executable path.

Any mismatch enters rollback. Tests mutate installed Bundle ID, `CFBundleExecutable`, or the executable symlink after candidate placement. Each case restores the archived old fixture and original mode, verifies the old hash and identity, records `ROLLBACK_COMPLETED`, and confirms the restored old app lacks V4 compatibility evidence and is not migration eligible. A fully matching candidate verifies successfully.

## 5. P2-OLD-RECEIPT-01 — persist precheck failures

Retirement now catches metadata, plist, manifest, authorization-type and validation failures before destructive work and persists a unique `PRECHECK_BLOCKED` receipt when storage is available. The receipt includes timestamp, old and candidate paths, available app/process inventory, exception category/message, and `destructiveActionPerformed=false`. Existing receipts are not overwritten.

Tests pass malformed candidate manifest JSON, malformed plist and a null authorization ID through `run_retirement`, then read back the persisted receipt and verify the old executable hash is unchanged.

## 6. P2-OLD-CONTRACT-01 — Python/native parity

Candidate and migration authorization IDs must be non-empty JSON strings; `null`, numbers, arrays, objects, booleans, empty and whitespace-only strings are rejected. Production preflight requires the fixed installed app and database paths. The test-only synthetic contract uses a separate fixed fixture layout and rejects roots overlapping protected Production locations.

Candidate executable paths must resolve to the canonical executable inside the approved bundle. Same-name files in other directories and symlinks escaping the bundle are rejected. Retirement authorization fields are type-checked as strings before path resolution.

## 7. P2-OLD-DIAGNOSTIC-01 — structured unknowns

App traversal, process parsing, lsof fields, plist/manifest decoding, missing executable paths and invalid authorization metadata return structured BLOCKED diagnostics. Process inspection failures never become an empty process list. CLI errors serialize a JSON `BLOCKED` result; retirement precheck errors persist a receipt where the destination is writable.

## 8. Closed-P1 regression

The earlier closed protections remain exercised:

- P1-OLD-RETIRE-01: post-install failure rollback and hard-blocked rollback failure.
- P1-OLD-BACKUP-01: WAL/SHM/journal rejection in Python and native paths.
- P1-OLD-RETIRE-02: byte-identical manifest binding through source, stage and install.
- P1-OLD-AUTH-01: durable ledger and exact permit replay rejection in a fresh process.
- P2-OLD-GUARD-01: `PRAGMA incremental_vacuum` remains denied outside migration.

## 9. Inventory rejection matrix

| Scenario | Result |
|---|---|
| Neutral outer `.app` with nested Production app | Nested app discovered; preflight BLOCKED before receipt/permit |
| Nested Production metadata unreadable or malformed | Structured BLOCKED |
| Nested non-Production helper app | Scanned; normal inventory continues |
| One valid top-level candidate | Inventory continues to normal validation |
| Traversal callback failure, symlink subtree or empty walker result | BLOCKED |

## 10. Process rejection matrix

| Scenario | Result |
|---|---|
| Empty live `ps` output or blank/malformed row | `complete=false`; BLOCKED |
| Missing process fields, invalid/duplicate PID | `complete=false`; BLOCKED |
| Empty/malformed executable or open-file lsof result | `complete=false`; BLOCKED |
| Missing/nonexistent or ambiguous executable path | `complete=false`; BLOCKED |
| App executable with missing/invalid Bundle ID | `complete=false`; BLOCKED |
| Permission or nonzero process-inspector result | `complete=false`; BLOCKED |
| Complete known clean synthetic snapshot | `complete=true`; normal validation continues |

## 11. Installed identity rollback evidence

Synthetic on-disk mutations after install verify that wrong Bundle ID, wrong executable name and an executable symlink resolving outside the bundle do not produce `CANDIDATE_INSTALLED_AND_VERIFIED`. Each attempt restores the old fixture, verifies Bundle ID/executable/hash/mode and writes `ROLLBACK_COMPLETED`. The positive case verifies every installed identity field and receipt hash.

## 12. Synthetic chain

The existing positive chain passes: synthetic V3 → exact byte backup → complete synthetic inventory → approved candidate → Python receipt/permit → native consumption → durable ledger → fresh-process replay rejection → real TypeScript Migration 4 → V4/version 4/integrity `ok`/clean FK.

Negative chains also pass: a nested Production app stops before receipt or permit, and a post-stage installed Bundle ID mutation triggers rollback before the normal path can qualify for migration.

The harness is isolated to synthetic roots and test code. No Production path override, real financial data, installed runtime or application launch is involved.

## 13. Real-machine blocked preflight

Read-only preflight remains BLOCKED. The known old Production app is installed. `/Applications` and `~/Applications` inventory is incomplete due symlinked app directories and bundles with missing/malformed metadata; `lsof` also returned a nonzero result for PID 1, so process inventory is unknown. These facts are structured blockers. No real approval, backup or permit was created.

## 14. Production preservation

Read-only immutable verification before and after correction: Production SHA-256 `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35`; Schema V3; migrations `[1,2,3]`; integrity `ok`; foreign-key check clean; no WAL/SHM/journal. No Production write, launch, checkpoint, backup or migration occurred.

## 15. Installed old App preservation

`/Applications/Personal Finance Console.app` was not launched, moved, chmodded, archived or replaced. Its executable SHA-256 remains `0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f`.

## 16. RC2 preservation

RC2 was not launched, rebuilt, installed or modified. Its executable SHA-256 remains `f55f412665fecdf51858b8437284635e8f746db54ce2ce425dfd772466d9c60c`.

## 17. Tests

- `npm run typecheck`: PASS.
- `npm run lint`: PASS; 24 existing non-failing CSS specificity warnings.
- `npx vitest run tests`: PASS — 15 files, 281 tests.
- `npm run test:release-gate`: PASS — 32 tests.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: PASS — 20 tests, including the synthetic chain and fresh-process replay.
- `python3 -m py_compile scripts/production_v4_release_gate.py scripts/test_production_v4_release_gate.py`: PASS.

## 18. Residual risks

The machine remains BLOCKED and the old V3 app remains installed; a later separately authorized replacement checkpoint is required. Strict inventory intentionally blocks on unrelated unreadable or symlinked app bundles. This protection does not claim macOS can prevent an Owner from manually restoring an archived binary. Deferred P2 items remain unchanged: P2-F0-02, P2-DISCOVERY-01, P2-CSS-01, P2-TEXT-01, P2-V4-ACTUAL-NOCHANGE-01 and P2-V4-TARGET-01.

## 19. Changed files

- `scripts/production_v4_release_gate.py`
- `scripts/test_production_v4_release_gate.py`
- `V012_V4_OLD_RUNTIME_PROTECTION_P1_CORRECTION_2_REPORT.md`

No Rust code, Model Core, Migration 4, Production data, installed app, RC2 or independent audit report was changed. The two independent audit reports remain outside the implementation commit.

## 20. Ready for re-audit

The three remaining P1 findings and three related P2 findings have focused fixes and regression evidence. The five previously closed P1 protections and P2-OLD-GUARD-01 remain covered. The positive synthetic chain and both negative chains pass; the real machine remains BLOCKED; Production, the installed old app and RC2 remain unchanged.

This is ready for independent re-audit only. It does not close `RB-V4-OLD-RUNTIME-01` or authorize Production App replacement or Production V4 migration.
