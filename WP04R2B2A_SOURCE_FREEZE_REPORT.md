# WP-04R2B2A — Source Freeze & Candidate Rebuild Report

**Final Status: `WP04R2B2A_SOURCE_FREEZE_READY`**

## Scope and disposition

This phase froze the implemented R2B final chain and rebuilt one candidate from the resulting clean runtime commit. It did not run full C0–C10, create a V3 cutover fixture, launch the candidate, or touch Production. The isolated component regression executed Migration 4 once against its disposable synthetic fixture, as explicitly required to verify this implementation path.

Overall R2B acceptance remains `WP04R2B_SYNTHETIC_CUTOVER_BLOCKED` until the separately scoped full synthetic acceptance run. This report does not promote the candidate to Production or assert business acceptance.

## Intake and source review

- Starting HEAD: `a3e317ea0b58c2f62050f798432397d746a8156f`.
- Exactly five tracked files were modified and none staged at intake. They are classified in `evidence/wp04-release-cutover-readiness/38-r2b2a-source-freeze/01-diff-classification/classification.json`. The intake contained 6,476 untracked paths, all classified as evidence/report material, zero unknowns; these were preserved.
- Runtime changes reviewed: PASS. Gate now expects native `VERIFIED_HANDOFF`; the synthetic-only Rust consumer continues S4 through guarded Migration 4, post-readback and durable S10 handoff. A dedicated Cargo feature wires this native consumer while the default app entry remains the normal product Tauri app. The updated native-handoff test checks the same permit hash/consumed-ledger chain and final S10 result.
- Product behavior changed: NO. Diffs from accepted WP03 R5 baseline `fd1d9e8714173167430baa2ab9325557a9e80775` are empty for `src/ui`, `src/application`, `src/model`, and `src/persistence`. Financial Model implementation files changed: none.
- `git diff --check`: PASS.

## Required pre-commit regression

All requested current-source regression groups passed before the runtime commit:

- Product: `npm run typecheck`, `lint`, `test:product`, `test:wp03-preview`, `test:release-gate`, and `build` — all PASS.
- R2A formal Gate: 5 tests PASS.
- R2B1A Gate-owned C3: 15 tests PASS.
- R2B1B native authority: 16 tests PASS, including Gate permit continuity, one consumed ledger, S10 `VERIFIED_HANDOFF`, and exactly one synthetic Migration 4 execution in the component fixture.
- Rust default, quiescence fixture, and quiescence Tauri suites — all PASS.
- Native lease regression: 15/15 PASS.
- Synthetic recovery matrix: 16/16 PASS.
- Dedicated `wp04-r2b-synthetic,tauri/custom-protocol` product-binary Cargo build: PASS.

Machine-readable results and logs are in `evidence/wp04-release-cutover-readiness/38-r2b2a-source-freeze/03-precommit-regression/`. These verify implementation components, not full C0–C10 acceptance.

## Runtime implementation commit

- Commit subject: `WP-04R2B Final Chain Implementation Commit`.
- Runtime commit: `453fdb05b6457a4e9362c98308ca384c10f5d8b4`.
- Committed files: `scripts/production_v4_release_gate.py`, `scripts/test_wp04r2b1b_native_handoff.py`, `src-tauri/Cargo.toml`, `src-tauri/src/main.rs`, `src-tauri/src/quiescence.rs`.
- Runtime dirty source after commit: NO. Pre-existing untracked reports/evidence were not staged into this implementation commit.

## Source provenance

- Final source commit: `453fdb05b6457a4e9362c98308ca384c10f5d8b4`.
- Fresh `git archive` SHA-256: `00cb89aedb0e21205c316c68a8ae3bb1c2a16100abd6a111769378a8b0c9f09b`; archive size 46643200 bytes. Extracted committed tree validation: 1,051 files checked, zero mismatches.
- `src-tauri/Cargo.lock` SHA-256: `5a58d1e21d6de8bbfdb3d3cb0332e2fe06516ea0790f2e9c14127b0943f054c8`.
- `package-lock.json` SHA-256: `3f2152b71eba56701d63ae1c39b1c583543f8109a146bf5dc2e955256cbfba16`.
- Effective synthetic Tauri config SHA-256: `f0d5e1f1be6510209cf524a99ccd54043f542521fe772b19c28e04d9f9ee39ac`. Tracked base `src-tauri/tauri.conf.json` SHA-256: `0c442bf8421f16d737d086d5036de3f56237f6f01033867e14e6c5cd04baf425`.
- Source/build root: `/Users/linte/Library/Caches/pfc-wp04r2b2a-453fdb05/build` on APFS Data, outside CloudDocs.

## Candidate rebuild and signing

- Candidate: `/Users/linte/Library/Caches/pfc-wp04r2b2a-453fdb05/build/cargo-target/release/bundle/macos/小钱家.app`.
- Rebuilt from the clean extracted archive for commit `453fdb05b6457a4e9362c98308ca384c10f5d8b4` using `npm ci`, Vite production build, then the Tauri command recorded in candidate evidence.
- Bundle ID: `org.pfc.quiescence.integration`. Executable: `Contents/MacOS/personal-finance-console`.
- Executable SHA-256: `f7625ec29e69ac527a830e9a622f0a7568d9a4556b1d9db005f19e29d623bdff`. Manifest SHA-256: `cdb8f040b9250a23ba0df0f89a0c91313ba881cdd715bed8945201e1f51b7ecc`.
- Apple Development Team ID: `SSRKA7A4TN`; signing authority and strict verification are recorded in `07-codesign/codesign-readback.json`. `codesign --verify --deep --strict`: PASS.
- `SOURCE_CANDIDATE_BINDING.json` binds commit/archive, candidate, executable, manifest, effective Tauri config, lockfiles, Team ID, and build timestamp. The signed candidate was not launched or modified after verification.

## Previous build classification

Build-02 executable `09c12af103f68a5c5a7061c14188546e5862ad3a34893e9c18606ffc61b687a4` is formally `DEVELOPMENT_PROBE_ONLY`: it was built against pre-commit source `a3e317ea0b58c2f62050f798432397d746a8156f` and is excluded from final R2B acceptance. Its package/evidence remain intact. The current committed-source component Migration 4 regression passed; that result is not attributed to build-02.

The newly bound candidate above is the only candidate for the next full R2B acceptance run.

## Production boundary and next action

- Production app/database accessed: NO. Production SQLite read: NO.
- Real authorization, backup, release receipt, or permit created: NO. Component fixtures used only synthetic authorization/evidence.
- WP-02 touched: NO. Financial Model V1.0 changed: NO.
- WP03 R5 source/evidence preserved; this report does not change its pending Planning/Owner acceptance.
- Next responsibility: Planning/Owner issues the separate `WP-04R2B FINAL ACCEPTANCE RUN` scope. That run must use only the bound candidate and follow its own C0–C10 boundary.

## Evidence root

`evidence/wp04-release-cutover-readiness/38-r2b2a-source-freeze/`
