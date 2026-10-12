# WP-04R2B1 Unified Synthetic Contract Report

## Status

`BLOCKED` — partial contract groundwork is implemented and component checks pass, but the requested end-to-end contract is not complete. This report does not declare `WP04R2B1_SYNTHETIC_CONTRACT_UNIFIED_READY`.

Starting source-equivalent HEAD: `d12d09f0e0eadad3b2192fcbf9b54437b09bd18a` (current HEAD `164cd813e466e73db87acb556312d7543f6c25b1` adds prior evidence/report commits only).

## Before contract

The pre-change matrix is preserved in `evidence/wp04-release-cutover-readiness/34-r2b1-contract-unification/01-contract-before/CONTRACT_DIFF_BEFORE.md`. R2A Gate and standalone quiescence used different markers, candidate identities, database paths, permit formats, and authority ledgers. C3 created a standalone authorization and permit; the formal Gate independently issued another permit. The formal Rust consumer did not enter the native quiescence runner.

## Implemented groundwork

- Added a named unified synthetic marker `PFC_WP04_SYNTHETIC_CUTOVER_V1` and fixed identity `org.pfc.quiescence.integration` to the Gate adapter.
- Added explicit `unified-r2b` marker validation to the Gate and Python quiescence root checker. The unified marker is not inferred; default legacy and Production paths remain distinct.
- Added a narrow unit suite covering exact marker acceptance, legacy/wrong/symlink marker refusal, explicit mode selection, and the single synthetic manifest identity.
- Added an explicit synthetic Gate branch for the managed candidate and root-level V3 database contract. This branch is not wired to a Gate-owned C3 producer or a compatible native consumer.

## Required integration not completed

- `prepare_managed()` has no `UNIFIED_R2B_GATE_OWNED` mode and still creates `authorization.json` plus its standalone `permit.json` in its existing mode.
- The Rust product binary has no unified Gate-permit consumer, exact-byte claim, one-chain ledger, or authority handoff to a runner.
- The quiescence runner has no validated in-memory Gate authority entry point and no stop-before-`BEGIN EXCLUSIVE` S4 barrier.
- No real formal CLI → compiled Rust consumer → native runner S4 integration was executed. Permit/receipt/ledger hash continuity, replay refusal, dual-permit refusal, and V3 unchanged post-run state therefore remain unproven.
- The full required negative domain/identity matrix and component cross-mode tests were not implemented.

## Verification performed

- `npm run typecheck`: PASS.
- `npm run lint`: exit 0; 25 pre-existing CSS descending-specificity warnings.
- `npm run test:product`: PASS, 300 tests.
- `npm run test:wp03-preview`: PASS, 5 tests.
- `npm run test:release-gate`: PASS, 40 tests.
- `npm run build`: PASS (web/core build only; no Production app bundle).
- `cargo test --manifest-path src-tauri/Cargo.toml --features quiescence-fixture --bins`: PASS, 33 Rust fixture tests.
- `cargo test --manifest-path src-tauri/Cargo.toml --bins`: PASS (default Rust binary test build).
- `scripts/quiescence_recovery_matrix.py` against the compiled fixture: PASS, 16/16 recovery component scenarios.
- R2A Gate CLI → legacy Rust consumer integration tests: PASS, 5 tests. This is legacy component regression only, not the new unified native path.
- Quiescence Python component suite with the recorded synthetic signing identity: PASS, 73 tests.
- New `test_unified_synthetic_contract.py`: PASS, 5 tests.
- Initial invocation of the quiescence Python suite without its configured test signing identity failed during fixture setup; the configured synthetic run above then passed.

These component regressions do not establish the requested unified native acceptance.

## Safety and remaining work

No Production app or database was opened, read, backed up, installed, or migrated. No real authorization, release receipt, or permit was created. Migration 4 was not executed. The R2B overall status remains BLOCKED. A follow-up implementation must add Gate-owned C3, the exact-byte Rust consumer/ledger, and the native S4 stop integration before this work can be marked READY or used to rerun full R2B.

## Commits

Implementation commit: `f7b37374e32d8a3736c060c6f91a4c1e3e7aee70` (`Add explicit WP04 unified synthetic root contract`). This is a partial adapter/root-contract implementation, not the missing C3/native S4 integration. The report and evidence are committed with this report update.

## R2B1A — C3 Gate-Owned Permit Mode

追加记录：`WP04R2B1A_C3_GATE_OWNED_REPORT.md` 状态为 `WP04R2B1A_C3_GATE_OWNED_READY`。此项只关闭 Python/C3 的第二套 migration authorization/permit；原报告中完整 WP04R2B1 `BLOCKED` 结论仍有效。Native consumer/runner authority handoff、S4、Migration 4 与完整 R2B 尚未实施或验收，交由 WP04R2B1B。

C3 implementation commit：`75b2d87fe89f8b0a2fe990ed3f2d65c5116d22fe`。回归与正反例证据位于 `evidence/wp04-release-cutover-readiness/35-r2b1a-c3-gate-owned/`。

## R2B1B — Native Authority Handoff

当前 WP04R2B1 状态：`WP04R2B1_SYNTHETIC_CONTRACT_UNIFIED_READY`。R2B1B 已将 formal Gate 的唯一 permit 经编译 Rust consumer、精确字节 claim、唯一 durable ledger 和私有 validated authority 接入 native runner，并在 S4 停止。权威报告为 `WP04R2B1B_NATIVE_AUTHORITY_HANDOFF_REPORT.md`；实现提交 `24ff2365e36d4471873b2090128b11725244825a`；证据位于 `evidence/wp04-release-cutover-readiness/36-r2b1b-native-handoff/`。

历史状态保留：本报告前文记录的 WP04R2B1 `BLOCKED` 是 R2B1B 实施前真实状态，不作删除或改写。当前 R2B1 unified contract 已具备重跑完整合成 WP04R2B 的前置条件；完整 WP04R2B 仍未执行、未 PASS。Production 未触碰；Migration 4、S5、renderer、final candidate 均未执行。R2B1B 的“修改前调用图”仅由 intake commit 回溯重建，非同期记录，详见证据文档中的限制。
