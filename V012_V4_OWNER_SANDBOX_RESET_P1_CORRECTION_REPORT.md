# V0.1.2 V4 Owner Sandbox Reset P1 Correction Report

**Status:** `PF_V012_V4_OWNER_SANDBOX_RESET_P1_READY_FOR_REAUDIT`

## 1. Scope

Implemented only `P1-SANDBOX-RESET-01` and the adjacent presentation-only `P2-SANDBOX-HISTORY-01` label correction. Financial Model, V4 contracts, Planning and Actual semantics, Cash lifecycle semantics, repository/business rules, Migration 4, schema, Production, RC2, and Stage 4–7 were not modified.

## 2. Root Cause

The reset button depended on `window.confirm(...)` before calling the protected reset service. In the reported native acceptance run, clicking it produced no visible confirmation, success, or error and did not reset the sandbox. This left the only path to the existing reset service dependent on a browser-native confirmation that did not provide an actionable result in that run. This correction removes that dependency; it does not change or weaken the native/service safety checks.

## 3. UI Confirmation Change

`V4AcceptanceApp` now shows an in-app alert dialog with the required confirmation text and `取消` / `确认恢复` actions. Cancel only dismisses the panel. Confirm invokes the existing `service.reset()` once, blocks duplicate pending submissions, refreshes through the existing action flow, and displays `测试数据已恢复` on success. Errors remain visible through the existing error state.

## 4. Native Reset Flow

Built and ran the exact isolated V4 acceptance artifact from the writable checkout:

`artifacts/v012-v4-owner-acceptance-sandbox-20261007/cargo-target/release/bundle/macos/小钱家 V4 验收版.app`

Executable SHA-256: `0afebc1c571128cef1af32b2cb1cbbe3705b13a9aa7374ba834af6f7375f06d5`.

Native UI evidence captured the confirmation panel, its dismissal after Cancel, the second confirmation panel, and the post-confirmation state. Accessibility readback after confirm contained `测试数据已恢复`. The running PID used only the isolated acceptance executable and acceptance DB.

## 5. Cancel Behavior

The sandbox was first mutated with Planning, Actual, and Cash lifecycle revisions. After opening the confirmation and choosing `取消`, the database SHA-256 remained `af75423a814aee7649ecc31ae7fbddb33732e2e166e5ca0d49f127ea23d61638`; all table counts were unchanged, and no success message appeared. Evidence: `artifacts/v012-v4-owner-sandbox-reset-p1-20261008/dialog-open-before-cancel.json`, `after-cancel.json`, `native-after-cancel.png`.

## 6. Confirm Behavior

Reopened the confirmation and selected `确认恢复` once. The protected service completed and the in-app success text was present. The isolated acceptance DB changed to its reset seed state. Evidence: `native-confirmation-second.png`, `native-after-confirm.png`, `final-readback.json`.

## 7. Seed Readback

Read-only verification of the actual acceptance DB after reset found:

- Schema `user_version = 4`; migrations `[1,2,3,4]`; integrity `ok`; no foreign-key violations.
- Stable Planning Income = `13000`.
- Planning month revisions = `0`.
- Four seeded Actual records, each `800`, `RECEIVED`, business date `2026-10-02`; Actual V4 revisions = `0`.
- Cash account `余额宝` = `4805.61`, active; Cash lifecycle revisions = `0`.

Acceptance DB SHA-256 after reset and after restart: `eedd2a2a51b2c28e8359ae7516e89f7e4b2c5d5dcb58a20c5466d0aa03be2e82`.

## 8. Restart Persistence

Closed the acceptance app normally, reopened the same acceptance artifact, and verified the same DB path and hash. Read-only seed queries still matched after restart. The post-restart screenshot is `artifacts/v012-v4-owner-sandbox-reset-p1-20261008/native-after-restart.png`.

## 9. Identity / Path Safety

The unchanged native/service reset implementation remains responsible for fail-closed identity/path checks; no protection was moved into React or weakened. The running executable path was the isolated acceptance bundle and its open SQLite file was only:

`~/Library/Application Support/com.personalfinance.console.v4acceptance/personal-finance-console-v4-acceptance.sqlite3`

The Production DB was not open in the acceptance PID. Existing identity/path tests were retained.

## 10. P2 History Label Fix

Planning history renders stored `OVERRIDE` as `本月单独设置` and `INHERIT` as `跟随平时收入`. Stored enum values and service contracts are unchanged.

## 11. Tests

All requested checks passed:

- `npm run typecheck` — PASS.
- `npm run lint` — PASS; 24 existing non-failing CSS specificity warnings.
- `npx vitest run tests` — PASS, 14 files / 276 tests.
- `npx vitest run tests/v4-acceptance-sandbox.test.ts` — PASS, 3 tests.
- New `tests/v4-acceptance-ui.test.tsx` — PASS, 6 targeted tests.
- V4 acceptance Rust tests — PASS, 11 tests.
- `npm run build:v4acceptance` — PASS.
- `npm run tauri:build:v4acceptance` — PASS.
- `git diff --check` — PASS.

## 12. Production Preservation

Production DB SHA-256 before and after: `4b69c93356967fb8eec6fa25b7eedb6cf2a886bddf6b9ea9040182028beacf35`. Schema remains V3, migrations `[1,2,3]`, integrity `ok`, and foreign-key check clean. No Production write, migration, or launch occurred.

## 13. Ready for Independent Re-audit

The reset dialog, cancel no-op, confirmed reset, seed readback, restart persistence, acceptance-only runtime isolation, Production baseline, and requested regression checks are evidenced. No Owner acceptance is claimed. Ready for independent re-audit; no subsequent phase was started.
