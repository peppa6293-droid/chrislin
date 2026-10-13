# WP-04R2C2 — Renderer Architecture Applicability Report

Date: 2026-10-13 (Asia/Shanghai)
Final status: `WP04R2C_BLOCKED_ARCHITECTURE_BOUNDARY_UNPROVEN`

## Decision

The current formal Gate process is renderer-free: the Production `--pfc-internal-v4-migrate` branch exits from `lib.rs::run()` before `tauri::Builder::default()`, and the synthetic unified Gate branch returns from `main()` before `personal_finance_console_lib::run()`. Thus no Tauri Builder, WebView, or WebContent is created by the Gate consumer itself. The renderer also has no formal Gate handoff or permit/ledger/M4 authority.

The broader claim required to classify S5 and post-COMMIT renderer death as `NOT_APPLICABLE_BY_ARCHITECTURE` is not established. Tauri 2.12.1 creates configured WebviewWindow instances before invoking the application `setup` closure. The Production V3 schema refusal is inside that closure. The release Gate validates a complete empty Production process inventory before launching the separate migration consumer, but the inspected source does not hold a system-wide startup exclusion across that snapshot and S5–S10. A concurrent Production launch after the snapshot has not been ruled out at the WebContent-process level. This is an acceptance-boundary evidence gap, not a reproduced runtime defect.

Accordingly, keep the renderer subfinding open. Do not advance to final Production pre-candidate freeze on this report. No source or test file was edited; no Production action was taken.

## Architecture findings

- Formal Gate stages are native-owned: permit validation/claim, consumed ledger, lease, SQLite connection, `BEGIN EXCLUSIVE`, V3 revalidation, M4, commit/rollback, post-readback, and durable S10 terminal.
- `generate_handler!` has no formal Gate, permit-claim, consumed-ledger, raw M4, or terminal command. Generic migration begin/end IPC exists, but Production initializes `migration_permitted=false`; this does not transfer formal Gate authority to the renderer.
- Production V3 cannot reach the normal database-ready UI state: the native setup schema check refuses V3. The exact WebContent exclusion during the full formal migration window remains unproved because the WebView is created before that setup check and no persistent gate/startup exclusion was found.
- No new UI→Gate IPC path was introduced. Creating one would add a runtime path absent from the frozen architecture and is not authorized by this acceptance-only order.

## Renderer evidence and classifications

| Item | Result |
|---|---|
| Current-candidate idle renderer kill | `PASS_CURRENT` (reused R01) |
| Renderer respawn | `PASS_CURRENT` (reused R01) |
| Native stayed alive | `YES` |
| UI/IPC rebootstrap | `UNKNOWN_NON_BLOCKING_PRODUCT_RUNTIME_OBSERVATION` |
| Renderer present inside Gate consumer process at S5–S10 | `NO` |
| External Production renderer exclusion throughout S5–S10 | `NOT_PROVEN` |
| S5 / post-COMMIT renderer termination applicability | `NOT_PROVEN_NOT_APPLICABLE` |
| Q11 native portion | `PASS_REUSED_FROM_R2B` |
| Q11 idle renderer portion | `PASS_CURRENT` |
| Q11 renderer critical-section portion | `OPEN_ARCHITECTURE_EXCLUSION_UNPROVEN` |
| Q11 overall | `BLOCKED_ARCHITECTURE_BOUNDARY_UNPROVEN` |

Historical Q11 definitions and WP04 renderer closure requirement are preserved as supporting context. Earlier UI harness evidence does not override the current frozen Gate entrypoint. The R2B native failure/recovery matrix remains reused and does not establish renderer exclusion.

## Regression and freeze

Product regression: 300/300 passed. Native recovery/quiescence: 33/33 passed. Recovery diagnostic: 9/9 passed. Targeted forward Formal Gate synthetic smoke: passed; M4 executed exactly once and durable S10 was verified. Relevant IPC contract: 6/6 passed. The full 17-case matrix was not rerun.

Frozen source `c3da2f73c03b681957b4334751b7933d102caad1` remains unchanged. Candidate executable SHA-256 `e4097fc566bbe9d3e0a6eafb7044b283dae37504427a25ca08917c2b046ae1bf`; manifest SHA-256 `cdb8f040b9250a23ba0df0f89a0c91313ba881cdd715bed8945201e1f51b7ecc`; strict codesign `PASS`. No release candidate rebuild or resign occurred. The targeted forward-smoke test harness built/reused a synthetic debug fixture and wrote refreshed output into the pre-existing, untracked `37-r2b-final-rerun` evidence path; that side effect and its limitation are recorded in the regression receipt.

## Boundaries and next action

Production app/DB untouched; no real authorization or permit created. WP03 acceptance preserved; Financial Model unchanged; WP02 untouched. `RB-V4-CUTOVER-QUIESCENCE-01` remains `OPEN`.

Next owner: Planning/Owner. To close applicability, provide an existing-source proof that the Production renderer cannot be created or remain alive throughout Gate S5–S10, including the post-preflight startup boundary, or issue a separately scoped fix/testability work order. Do not add renderer-bearing Gate IPC under this acceptance-only order.

Evidence: `evidence/wp04-release-cutover-readiness/50-r2c2-architecture-applicability/`.
