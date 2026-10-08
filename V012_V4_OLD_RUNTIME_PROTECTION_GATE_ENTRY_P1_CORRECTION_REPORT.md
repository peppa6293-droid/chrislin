# V0.1.2 V4 Production Gate Entrypoint — P1 Correction Report

Status: `PF_V012_V4_OLD_RUNTIME_GATE_ENTRY_P1_READY_FOR_REAUDIT`

`RB-V4-OLD-RUNTIME-01` remains OPEN. Production V4 migration is NOT AUTHORIZED.

## 1. Baseline

Correction baseline: `a77ec142beff048be17c672393c76934f0936ac1`. The two prior independent audit reports were untracked at task start and remain unchanged, outside this implementation commit. No other starting source changes were present.

This correction addresses only `P1-OLD-GATE-ENTRY-01`. The prior correction's three P1s, related P2s and six deferred P2s were not reopened or redesigned.

## 2. Root cause

The supported `run_gate` function called `make_release_receipt(facts, synthetic_fixture_root=root)`, but `root` exists only in `create_synthetic_rehearsal`. Both normal `preflight` and `migrate` therefore raised `NameError` after fact collection and before the intended gate/receipt flow.

## 3. Production / synthetic path separation

The normal `run_gate` now calls `make_release_receipt(facts)` with no synthetic argument. Its validator uses the fixed Production app and DB paths. Only `create_synthetic_rehearsal` passes its explicitly validated fixture root. No global/default synthetic root, environment bypass or Production validation weakening was introduced.

## 4. Formal preflight entrypoint proof

The actual `run_gate("preflight", ...)` entrypoint was called with monkeypatched, fully valid facts rooted in a temporary isolated app/database fixture. The test confirms it runs full `make_release_receipt` validation, writes and reads back the persistent receipt with candidate, database, backup and authorization facts, and returns the preflight status. Permit writer and launcher mocks were asserted unused. No real DB, app-data or installed app was read or changed by this entrypoint fixture.

## 5. Formal migrate entrypoint proof

The actual `run_gate("migrate", ...)` entrypoint was called with the same isolated fixture facts. It performed gate validation, persisted the release receipt, reached the permit-writer mock, then reached the launcher mock in that order. The mock verified the permit existed and the requested executable path matched the validated candidate. No app was launched and no database was migrated.

## 6. Negative entrypoint matrix

The actual `run_gate("preflight", ...)` entrypoint was exercised against nested Production app facts, incomplete app inventory, incomplete process inventory, wrong candidate Bundle ID, WAL sidecar, missing backup, mismatched backup, stale DB approval hash, and missing authorization file. Each returned the intended structured BLOCKED reason before receipt/permit/launcher effects. Missing authorization stopped at the explicit authorization loader. Other cases reached `make_release_receipt` and failed its targeted validation.

Existing permit-consumption tests continue to reject consumed/replayed permits, including exact byte restoration in a fresh process. The formal Python `run_gate` itself does not consume permits; native consumption remains the next stage after the mocked launch boundary.

## 7. Synthetic rehearsal regression

The existing test-only Python gate → receipt → permit → native consume → durable ledger → replay rejection → actual TypeScript Migration 4 chain was rerun in the Rust suite. It finished at `user_version=4`, maximum migration version 4, `integrity_check=ok`, and clean foreign-key check. The normal Production entrypoint and synthetic rehearsal remain separate.

## 8. Previously closed protection regression

The required typecheck/lint/Vitest/release-gate/Rust suite was rerun. It includes post-install rollback, WAL/SHM/journal rejection, exact manifest-byte binding, durable permit replay rejection, and `incremental_vacuum` denial. No regression was found in those closed protections.

## 9. Real-machine blocked preflight

Read-only real-machine facts still produce BLOCKED. The known old Production app remains installed. App inventory is incomplete due symlinked app directories and unreadable/malformed app metadata; process inventory is incomplete after lsof returned nonzero for PID 1. The actual `run_gate("preflight")` entrypoint was also called with temporary diagnostic-only JSON placeholders; it stopped on the real app-inventory blocker, returned structured BLOCKED reasons, and created no receipt. The placeholders were stored only in a temporary directory and were not Owner approvals. No real backup or permit was created. No NameError or synthetic-root leak occurred.

## 10. Production preservation

Read-only immutable verification before and after: Production SHA-256 `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35`; Schema V3; migrations `[1,2,3]`; integrity `ok`; foreign-key check clean; no WAL/SHM/journal. No Production launch, write, checkpoint, backup or migration occurred.

## 11. Installed App preservation

The installed old app was not launched, moved, chmodded, archived or replaced. Its executable SHA-256 remains `0e6dcb261de20eb96fcb2f85eaa7fe78fc3cd8c72a96bee78856ac081153911f`.

## 12. RC2 preservation

RC2 was not launched, moved, rebuilt, installed or modified. Its executable SHA-256 remains `f55f412665fecdf51858b8437284635e8f746db54ce2ce425dfd772466d9c60c`.

## 13. Tests

- `npm run typecheck`: PASS.
- `npm run lint`: PASS; 24 existing non-failing CSS specificity warnings.
- `npx vitest run tests`: PASS — 15 files, 281 tests.
- `npm run test:release-gate`: PASS — 36 tests, including actual `run_gate` preflight/migrate entrypoints and negative matrix.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib`: PASS — 20 tests, including the synthetic chain and prior closed-protection tests.
- `python3 -m py_compile scripts/production_v4_release_gate.py scripts/test_production_v4_release_gate.py`: PASS.

## 14. Changed files

- `scripts/production_v4_release_gate.py`
- `scripts/test_production_v4_release_gate.py`
- `V012_V4_OLD_RUNTIME_PROTECTION_GATE_ENTRY_P1_CORRECTION_REPORT.md`

No independent audit report is part of this correction commit.

## 15. Ready for final independent re-audit

The normal supported gate no longer references an undefined synthetic root. Actual `run_gate` preflight and migrate entrypoints reach their intended validation and mocked post-gate boundaries; invalid facts block through the expected checks. The separate synthetic chain still passes, while the real machine stays blocked and all protected Production/old-App/RC2 state remains unchanged.

This is ready for independent re-audit only. It does not close `RB-V4-OLD-RUNTIME-01` or authorize Production App replacement or V4 migration.
