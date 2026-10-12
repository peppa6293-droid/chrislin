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

Implementation commit: `f7b37374e32d8a3736c060c6f91a4c1e3e7aee70` (`Add explicit WP04 unified synthetic root contract`). This is a partial adapter/root-contract implementation, not the missing C3/native S4 integration. Report/evidence commit: pending.
