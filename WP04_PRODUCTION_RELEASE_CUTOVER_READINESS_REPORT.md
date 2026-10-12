# WP-04 — Production Release / V4 Cutover Readiness Report

**Final status: `WP04_RELEASE_CUTOVER_READINESS_BLOCKED`**
**Decision:** NO-GO for final pre-production audit handoff. The candidate is prepared for owner and audit review only. No Production operation was authorized or performed.

## 1. Source baseline and WP-03 preservation

- Starting HEAD: `1a72079a7449ba746ccc158c06f4367c0d2789e6`.
- WP-03 runtime baseline: `fd1d9e8714173167430baa2ab9325557a9e80775`.
- WP-03 report commit: `1a72079a7449ba746ccc158c06f4367c0d2789e6`.
- WP-03 acceptance is preserved as accepted/closed according to the current Owner-provided WP-04 instruction. The historical R5 report itself used “ready for Planning review”; this report does not rewrite that historical artifact.
- WP-04 source commit: `b59dbfe5c00a2ed01a793b0602d6b48b246dc748`.
- Runtime-affecting source changes are committed; no dirty runtime source remains. Existing unrelated untracked project reports/evidence were preserved.
- Financial model semantics and WP-02 were not changed.

## 2. Current capability and reused protections

The current-source assessment is in [CURRENT_CUTOVER_CAPABILITY_MATRIX.md](evidence/wp04-release-cutover-readiness/01-current-capability-matrix/CURRENT_CUTOVER_CAPABILITY_MATRIX.md). Existing startup fail-closed checks, runtime compatibility manifest, native Migration 4 implementation, lease/permit/ledger and recovery tests remain present. Historical passes were not automatically promoted to current end-to-end acceptance.

The first supported migration profile remains local SQLite, DELETE journal, `busy_timeout=0`, `locking_mode=EXCLUSIVE`, `BEGIN EXCLUSIVE`, one native connection, V3→V4, fixed Migration 4. WAL migration, network filesystems, multiple databases, arbitrary migration SQL, automatic recovery, and downgrade are out of scope.

## 3. Newly hardened defects

At `b59dbfe5c00a2ed01a793b0602d6b48b246dc748`, the release gate and native startup distinguish exact `NotFound` from other metadata failures. Metadata errors, unknown object types, symlink paths, and unsafe hard-link identities fail closed. SQLite `-wal`, `-shm`, and `-journal` sidecars are detected before opening the protected database; they are not removed, checkpointed, moved, ignored, or converted away. Python and Rust negative tests cover the new cases.

Evidence: regression logs under `evidence/wp04-release-cutover-readiness/16-regression/`; source changes are limited to `scripts/production_v4_release_gate.py`, its tests, `src-tauri/src/lib.rs`, and `src-tauri/tauri.conf.json`.

## 4. Entry points and bypass analysis

The current source map is [CURRENT_SUPPORTED_ENTRYPOINT_MAP.md](evidence/wp04-release-cutover-readiness/03-entrypoint-map/CURRENT_SUPPORTED_ENTRYPOINT_MAP.md). In-scope searches found no WP-03 preview-date IPC registration in the default Production handler and no new business SQLite adapter. Native startup gates Production identity, app-data/database identity, manifest and schema before ordinary access. Production V3 remains rejected.

A material gap remains: the formal Production migration/retirement CLI is disabled, and the authorization consumer helper is not connected to a supported Production setup/invoke execution path. Therefore a complete, current-source Production V3→V4 cutover path is not established. It remains fail-closed.

## 5. Preview and test-only exclusion

The default build does not enable the WP-03 preview feature; preview IPC registration is feature-gated. Static scanning of the default packaged JavaScript found none of `wp03_preview_get_test_date`, `wp03_preview_set_test_date`, `WP03PreviewDateControl`, or the acceptance-date label. WP-02, V4 acceptance, smoke, and quiescence paths remain isolated/test-only. These are static/package findings, not runtime acceptance of the Production candidate.

## 6. Q01–Q18 and renderer termination

See [Q01_Q18_CLOSURE.md](evidence/wp04-release-cutover-readiness/07-experiment-closure/Q01_Q18_CLOSURE.md). Q05 and Q08 are reused only with current component revalidation; Q11 reuses the previously accepted five real IPC scenarios, which do not include renderer process death. Other supported scenarios remain partial where their complete current-source matrix was not rerun. WAL-related migration cases are intentionally unsupported; host-wide malicious namespace cases are outside the declared threat model.

**Renderer-only termination: `BLOCKING_DEFECT`.** No evidence demonstrates, in one real isolated Tauri/Wry flow, renderer termination while observing native process state, lease ownership, consumed permit/ledger, transaction outcome, business IPC rejection, and restart behavior. A whole-app kill or navigation disconnect is not a substitute.

## 7. Recovery and synthetic cutover status

Recovery implementation and component suites remain present, but the current source has not completed the full synthetic C0–C10 flow with a representative V3 business fixture and bound candidate, permit, ledger, migration receipt, recovery result, and C9/C10 readback. Current regression success and historical S0–S10 evidence do not establish that missing binding.

- Synthetic C0–C10: **PARTIAL / BLOCKED**; no complete current-source rehearsal receipt.
- Synthetic S0–S10: **PARTIAL**; component tests and historical evidence only, not a fresh end-to-end current-source run.
- Failure/replay/recovery matrix: **PARTIAL**; relevant unit cases pass, but full failure and restart matrix is not established for this candidate.
- Recovery Matrix: **PARTIAL**; no automatic Production recovery or restore was attempted.

The required synthetic directories remain available under the evidence root. No synthetic receipt has been represented as a real Production receipt.

## 8. Pre-production candidate identity and provenance

Candidate status: `PRODUCTION_CANDIDATE_READY_FOR_OWNER_AND_FINAL_AUDIT_REVIEW` — not C1 approval.

- Source commit: `b59dbfe5c00a2ed01a793b0602d6b48b246dc748`.
- Candidate: `/Users/linte/Library/Caches/wp04-release-candidate-20261012/build-02/cargo-target/release/bundle/macos/小钱家.app`
- Bundle ID: `com.personalfinance.console`.
- Executable: `personal-finance-console`.
- Visible app name: `小钱家`.
- Executable SHA-256: `722f560d6b543f402645d6cb8120d7b8dbf4affc17bfb090393a25577b09a475`.
- Runtime manifest SHA-256: `f60ebff85a28d67750cd4b77084cb7d549f24f8c833811ca4e16a9c41ec583e7`.
- Manifest contract: runtime generation 4, schema max 4, expected bundle and executable identities.
- Two fresh builds used the same source archive SHA-256 `0116d11698a83886ca10690d0688bc01bbc6700b266066295cf55499e22dfa5b`. Reproducibility record notes stable UUID and signature reservation differences; full signed-bundle byte identity is not claimed.
- Apple Development signature, Team ID `SSRKA7A4TN`; `codesign --verify --deep --strict` passed. Not notarized. No post-sign bundle changes were made.
- Candidate was not launched. Build and provenance evidence: `05-production-candidate/` and `06-candidate-reproducibility/`.

## 9. Regression and product preservation

`REGRESSION_FINAL.json` records passing typecheck, lint, product/preview/release-gate tests, build, Python suites, and Rust suites. The first integration run failed because its subprocess lacked the signing identity environment (28 setup errors); that original log is retained. The isolated retry with the signing environment passed all 30 integration tests. This is `PASS_WITH_DOCUMENTED_ENVIRONMENT_RETRY`, not full cutover acceptance. `git diff --check` passed.

The product and preview test suites passed. No Financial Model calculation or WP-02 source changed.

## 10. Production non-operation and outstanding work

Not performed: Production app launch/install/replacement, Production DB access or mutation, backup, authorization creation, permit issuance, checkpoint, migration, rollback, restore, or blocker closure. `RB-V4-CUTOVER-QUIESCENCE-01` remains OPEN; Production V4 migration remains NOT AUTHORIZED.

Before final audit readiness, Execution must complete and preserve:

1. A full current-source synthetic V3 business fixture and bound C0–C10 plus S0–S10 rehearsal, including permit/ledger, Migration 4, recovery, independent readback, and C10 binding.
2. The renderer-only termination scenario with native state, lease, permit/ledger, commit result, IPC, and restart evidence, or a technically justified final classification backed by the declared threat model and evidence.
3. A current supported Production gate integration/binding design and independent review, retaining fail-closed behavior.
4. Full regression and a fresh, source-bound final candidate provenance/readback after any resulting code changes.

Later real C0 observations, C1 approval, runtime replacement, backup, and Production migration require their own authorized windows. Planning owns the next assignment; Execution owns the remaining implementation/evidence. Independent final pre-production audit is **not ready**.

## 11. Evidence index

Evidence root: `evidence/wp04-release-cutover-readiness/`.

- Intake and source binding: `00-source-intake/`.
- Capability, path/sidecar, entrypoint and preview evidence: `01-current-capability-matrix/` through `04-preview-exclusion/`.
- Candidate and reproducibility: `05-production-candidate/`, `06-candidate-reproducibility/`.
- Q closure and renderer status: `07-experiment-closure/`, `08-renderer-termination/`.
- Synthetic C0–C10/S0–S10, recovery and failure folders: `09-synthetic-c0-c3/` through `15-synthetic-c10-binding/` (not complete; see status above).
- Regression: `16-regression/`.
- Go/no-go and final readback: `17-go-no-go/`, `18-final-readback/`.
