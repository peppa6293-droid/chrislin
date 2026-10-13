# WP-04R2B3C1 — Unified Synthetic Recovery Test Hooks

**Status: `WP04R2B3C1_RECOVERY_TEST_HOOKS_READY`**
Date: 2026-10-13 (Asia/Shanghai)

## Scope and implementation

Starting HEAD was `4d91e4441ea7bffa7c6db730bb4ea73a80d0d8d5` with no tracked working-tree changes. The implementation is commit `c3da2f73c03b681957b4334751b7933d102caad1`. The only runtime source change is the native unified synthetic cutover runner; the added test harness is `scripts/test_wp04r2b3c1_recovery_hooks.py`. Product UI, application, model, persistence, and Financial Model V1.0 were not changed.

A dedicated Cargo feature, `wp04-r2b-recovery-test-hooks`, depends on `wp04-r2b-synthetic`. Production/default builds do not compile hook readers or behaviors. A hook requires the exact `UNIFIED_R2B_SYNTHETIC` test domain, a previously validated Gate authority in the unified domain, and a regular root marker containing exactly `PFC_WP04_SYNTHETIC_CUTOVER_V1\n`. Fixed enum points only; incomplete configuration, wrong domain/marker, and unknown points refuse. No arbitrary SQL, path, state injection, or file deletion is accepted.

All seven required points reached through the real Formal Gate → Rust consumer → native runner chain: S5 barrier, S7 before commit, post-commit/pre-readback, durable S10/reply loss, actual maintenance-flock loss, native durable orphan ACTIVE, and safe pre-M4 FAILED_V3. Each hook wrote a fsynced `RECOVERY_TEST_INJECTION.json`; it is explicitly non-authoritative. The FAILED_V3 hook confirmed transaction rollback, V3 schema, zero M4 rows, unchanged database bytes, and held lease before writing its bound terminal. The guard-loss hook unlocked the actual inherited maintenance flock and observed native lease validation fail. No automatic recovery was added.

## Verification

- Dedicated injection harness: **12/12 PASS**, including every hook, domain/marker/unknown-point negatives, a no-hook synthetic consumer with injection parameters set, and Production/default binary symbol reachability check. The no-hook consumer completed the normal Migration 4 path exactly once and produced no injection receipt.
- Required regression: typecheck, lint, product **300/300**, WP03 preview, release-gate, web build, Rust default, quiescence fixture, quiescence Tauri, R2A Gate wiring, R2B1A C3 Gate-owned, R2B1B native authority, native lease **15/15**, component recovery **16/16**, and formal forward S0–S10 with Migration 4 exactly once all passed.
- R2B3A recovery diagnostic regression: the initial invocation lacked `PYTHONPATH=scripts` and failed during Python module import before tests ran. The corrected invocation passed **9/9** tests. The initial failure and correction are both recorded.
- Canonical prior success root: formal read-only recovery diagnostic returned `V4_VERIFIED / READONLY_CONFIRMATION_ONLY`; **25/25** object hashes and identities were unchanged and diagnostic mutation count was **0**.
- Candidate from the prior freeze remains byte-for-byte unchanged: executable SHA-256 `7c640378b10a8bbdb40cd5f9b65069de19443b8e65b9e6cc2f704a69e7f578d4`, manifest SHA-256 `cdb8f040b9250a23ba0df0f89a0c91313ba881cdd715bed8945201e1f51b7ecc`, strict code signature verified. It is now classified `R2B_PRE_RECOVERY_TEST_HOOKS_BASELINE`. No final candidate package was built.

Full-chain recovery matrix, Q01–Q18 closure, renderer, audit, and final candidate build were **not run**, as required by this work order. Component recovery 16/16 remains component-only and is not represented as full-chain recovery acceptance. Overall WP04R2B remains blocked pending its separate final acceptance scope.

## Boundary and next step

Production App/DB, Production backup, real authorization, real recovery authorization, and real permit were not accessed or created. WP-02 was not touched. WP03 acceptance was preserved.

Evidence root: `evidence/wp04-release-cutover-readiness/45-r2b3c1-recovery-test-hooks/`. The report and main R2B report update are saved in this repository. Next step: WP04R2B3C2 source freeze and candidate rebuild, using the new source commit; this work does not authorize Production cutover.
