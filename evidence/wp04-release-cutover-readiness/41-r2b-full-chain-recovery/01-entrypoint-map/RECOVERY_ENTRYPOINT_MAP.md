# WP-04R2B3 Recovery Entrypoint Capability Map

Captured: 2026-10-13 (Asia/Shanghai)

## Freeze readback

- Repository HEAD: `df335e5f199b8ad082dd2e42ee148c625ebe788d`.
- Frozen runtime source commit required by WP-04R2B3: `453fdb05b6457a4e9362c98308ca384c10f5d8b4`.
- Tracked working-tree diff at inspection: none. HEAD is the evidence/readback commit after the frozen source commit; runtime source is unchanged from the freeze.
- Candidate executable SHA-256: `f7625ec29e69ac527a830e9a622f0a7568d9a4556b1d9db005f19e29d623bdff` (current readback matches the frozen value).
- Candidate manifest SHA-256: `cdb8f040b9250a23ba0df0f89a0c91313ba881cdd715bed8945201e1f51b7ecc`; current bytes are `Contents/Resources/runtime-compatibility.json` and hash to the frozen value. Frozen binding is also recorded in `38-r2b2a-source-freeze/06-candidate-build/candidate-facts.json` and final acceptance readback.
- Canonical successful Gate chain remains read-only at `40-r2b-final-acceptance-v3-compatible/attempt-02/`.

## Existing entrypoints

| Entrypoint / state surface | Location | Capability | Classification for this request |
|---|---|---|---|
| Formal release Gate `preflight` / `migrate` | `scripts/production_v4_release_gate.py:833-947`, CLI at `1255-1283` | Runs unified synthetic Gate checks, persists release receipt, issues/consumes the Gate permit through the frozen Rust consumer, and invokes the native migration chain. It has no recovery command or recovery disposition API for the unified permit/ledger chain. | `SUPPORTED` for Gate forward path; `MISSING` for full-chain recovery |
| Gate-owned C3 | `scripts/quiescence_integration.py:306-374, 892-893` and the unified synthetic C3 path | Establishes managed isolation without issuing migration authority. | `SUPPORTED` for C3 only; not recovery |
| Unified Gate permit consumer and native handoff | `src-tauri/src/quiescence.rs:426-610` and `scripts/production_v4_release_gate.py:900-947` | Consumes `gate-permit.json`, binds the formal receipt and candidate/database/backup identities, creates `consumed-ledger.json`, then hands authority to the managed native runner. The exposed flow is forward-only. | `SUPPORTED` for C7 forward path; no full-chain recovery entrypoint |
| Unified successful-state evidence | Canonical `attempt-02/08-c7`, `09-c8`, `10-c9`, and final readback | Persisted permit/ledger, S-state records, `verified-handoff.json`, C9 close and independent readback prove the accepted successful chain. | `SUPPORTED` readback of this successful run; not a recovery API and not mutable for scenarios |
| Quiescence `run_integrated` / `diagnostic_integrated` | `src-tauri/src/quiescence.rs:423-424, 755-775`; contract `docs/quiescence-integration-contract.json` | Operates on the separate managed quiescence contract and its own file/state schema. | `SUPPORTED`, but `COMPONENT_ONLY` relative to unified R2B Gate chain |
| Quiescence `recover_integrated` / `recover-integrated` | `src-tauri/src/quiescence.rs:423-424, 767-775`; contract `docs/quiescence-integration-contract.json:68-88` | Requires `recovery-authorization.json`, managed contract, `consumed.json`, `outcome.json`, and recovery history/terminal. Its recovery authorization binds those objects and it performs read-only verification; it does not accept or validate the unified `gate-permit.json` + `consumed-ledger.json` + unified S-state lineage. | `SUPPORTED` for its own contract; `COMPONENT_ONLY` for WP-04R2B3; not a compatible unified-chain entrypoint |
| Recovery component matrix | `scripts/quiescence_recovery_matrix.py` | `setup()` creates independent recovery fixtures and runs the separate `run-integrated`/`recover-integrated` contract. Its 16/16 result is retained in `attempt-02/16-recovery/RECOVERY_MATRIX_CURRENT_SOURCE.json`. | `TEST_ONLY` / `COMPONENT_ONLY`; cannot establish requested full-chain binding |
| Tauri recovery IPC | `src-tauri/src/bin/quiescence_tauri.rs:284-304` | Diagnostic and authorized handoff use the quiescence contract's shared root and `recovery-authorization.json`; they are not wired to the unified R2B migration permit/ledger lineage. | `SUPPORTED` for quiescence runtime; `COMPONENT_ONLY` for this request |
| Unified R2B recovery state inspector / recovery authorization | No implementation found in the frozen source paths above | No entrypoint accepts a unified R2B root and binds the original Gate release receipt, Gate permit bytes, consumed ledger, native authority and terminal/S-state into an authorized recovery/readback decision. | `MISSING` |

## Binding gap

The existing recovery component's authority chain is not the R2B authority chain:

- Component recovery requires `managed-contract.json`, `consumed.json`, `outcome.json`, and a separate `recovery-authorization.json` bound to their hashes.
- The accepted unified R2B chain uses the Gate `release-receipt.json`, `gate-permit.json`, Rust consumer claim, `consumed-ledger.json`, managed S-state records, and `verified-handoff.json`.
- Component fixtures issue their own authorization and terminal. The component matrix does not consume the canonical C7 receipt/permit/ledger and cannot be renamed or promoted to full-chain recovery.
- The canonical `attempt-02` root is accepted evidence and must remain unchanged. It establishes the successful chain but cannot be mutated to manufacture failures.

## Decision / stop point

`WP04R2B3_BLOCKED_NEEDS_RECOVERY_ENTRYPOINT_IMPLEMENTATION`

Missing entrypoint: a frozen-source-compatible, unified R2B recovery/diagnostic path that verifies the exact Gate receipt → Gate permit → Rust consumer → durable consumed ledger → native terminal/S-state lineage and returns the contract-allowed recovery disposition without M4 replay, permit resurrection, or restore.

Missing state: a unified recovery authorization/readback schema bound to that exact chain, including restart interpretation for unresolved/unknown states. Existing quiescence recovery state cannot substitute because its authority fields and terminal lineage belong to a different contract.

Why the component matrix is insufficient: it creates independent fixtures and uses a different permit, ledger, outcome and recovery authorization. It proves recovery behavior of that component contract only; it does not prove a recovery scenario reached through the R2B formal Gate chain.

Smallest capability Planning would need to consider for a separately approved source change: add a unified R2B recovery/diagnostic entrypoint and tests that bind the frozen Gate receipt, permit, ledger, native authority and durable terminal/S-state; support only safe read-only classification/verification and approved failure injection; fail closed for unknown, drift, orphan, corrupt or missing state; never reissue/consume an old permit, rerun M4, restore V3, or alter the accepted success root. This is a scope proposal, not implementation authorization.

No recovery scenario was run. No Q01–Q18 classification was changed. Source and candidate were not modified or rebuilt; Production was not accessed.
