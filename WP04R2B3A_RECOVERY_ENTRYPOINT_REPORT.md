# WP04R2B3A — Unified Recovery Entrypoint Report

**Status: `WP04R2B3A_RECOVERY_ENTRYPOINT_READY`**  
**Date:** 2026-10-13 (Asia/Shanghai)  
**Authorized scope:** `R2B3_RECOVERY_ENTRYPOINT_PATCH_AUTHORIZED`  
**Starting HEAD:** `df335e5f199b8ad082dd2e42ee148c625ebe788d`  
**Recovery implementation commit:** `60be80a0c91bdc867fd5c08a66f69b3e0b498838`  
**Final source commit:** `713e4c5c8a5c5ccfb1ad06481f4d6e138da294b2`

## Result

Implemented a read-only unified R2B recovery diagnostic in the existing formal cutover CLI. It validates the exact-byte authority chain from release receipt and consumed Gate permit through consumed ledger, Rust/native lineage and durable terminal. A separately supplied, exact-byte-pinned `UNIFIED_R2B_SYNTHETIC` authorization binds the original migration authorization, receipt, permit, ledger, candidate and manifest, database and backup identities/hashes, terminal/S-state lineage, scope, expiry and authorization ID. The entrypoint refuses Production domain before reading a root.

The diagnostic supports explicit safe dispositions for V4 verified, failed V3 confirmed, quiescence acquired, M4 in transaction, commit outcome unknown, committed-but-reply-lost, guard lost/unproven, orphan ACTIVE, missing terminal, corrupt state and consumed permit. Every output is non-mutating; a consumed permit is never reusable, automatic M4 rerun is disabled, and restore is never performed. Failed-V3 only advertises future fresh-authorization eligibility.

## Entrypoint

```text
python3 scripts/production_v4_release_gate.py recover-diagnostic \
  --domain UNIFIED_R2B_SYNTHETIC \
  --root <canonical-synthetic-root> \
  --recovery-authorization <external-authorization.json> \
  --authorization-sha256 <independent-exact-byte-sha256>
```

Production is refused. This work did not create a real recovery authorization, migration authorization, permit or backup.

## Verification

- Unified diagnostic tests: 9/9 pass, including V4 success, typed fail-closed dispositions, exact-byte/auth binding negatives, Production-domain refusal, CLI dispatch and canonical-root no-mutation readback.
- Canonical accepted success root: `V4_VERIFIED`; 25 protected objects' SHA-256 and filesystem identities match before/after; `diagnosticMutationCount=0`.
- Recovery component matrix: 16/16 pass, explicitly `COMPONENT_ONLY`; not promoted to full-chain Recovery Matrix or Q closure.
- Typecheck, product tests (17 files / 300 tests), WP03 preview, release-gate, R2A integration, C3 Gate-owned, R2B1B native handoff, Rust default, quiescence-fixture and quiescence-Tauri all pass.
- Forward formal Gate → Rust claim → S0–S10/Migration 4 exactly-once scenario passes.
- Lint exits 0 with 25 style warnings; no files were auto-fixed.
- One initial R2B1B test invocation lacked the required configured signing identity and failed before fixture setup. The retry with the existing local Apple Development identity passed 16/16; both logs are retained.

Command outputs, component matrix and summary are under `evidence/wp04-release-cutover-readiness/42-r2b3a-recovery-entrypoint/08-regression/`. Canonical read-only object readback is under `07-canonical-success-readonly/`.

## Boundaries and remaining work

No final candidate was built. No C0–C10 acceptance was rerun. No full-chain recovery scenarios, Q closure, renderer or audit were performed. The older 16-case recovery component remains its separate contract and is not a substitute for WP04R2B3B final acceptance. The frozen old synthetic candidate is classified `R2B_PRE_RECOVERY_ENTRYPOINT_BASELINE` and retained.

Production App and Production database were not opened, started, stopped, replaced or written. WP-02, WP-03 acceptance evidence and Financial Model V1.0 were not changed. The canonical synthetic success root was inspected read-only and is unchanged.

**Next responsibility:** Planning/Owner may issue WP04R2B3B — Recovery Final Acceptance + Q Closure against a newly accepted candidate. This report does not claim that next-stage acceptance or Production readiness is complete.

## Evidence index

- `evidence/wp04-release-cutover-readiness/42-r2b3a-recovery-entrypoint/00-intake/` — starting HEAD, status, diffs and recent commits.
- `.../01-design/` — entrypoint design.
- `.../02-auth-schema/` — synthetic-only recovery authorization schema.
- `.../03-lineage/` — bound authority and native lineage.
- `.../04-disposition/` — disposition and action policy.
- `.../05-readonly/` — read-only behavior guarantees.
- `.../06-binding-negative/` — negative binding cases.
- `.../07-canonical-success-readonly/` — canonical chain and pre/post object readback.
- `.../08-regression/` — full regression logs and 16-case component result.
- `.../09-final-readback/` — final saved-state and commit readback.
