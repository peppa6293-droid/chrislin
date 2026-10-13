# WP-04R2B3B1 — Recovery-Patch Source Freeze & Candidate Rebuild

**Final status:** `WP04R2B3B1_RECOVERY_SOURCE_FREEZE_READY`  
**Starting HEAD:** `ef23dbc7c375fed8d82901b78989c5ceae58c9a7`  
**Frozen runtime source commit:** `713e4c5c8a5c5ccfb1ad06481f4d6e138da294b2`  
**Source archive SHA-256:** `249038d0a04de75391b464b8cb2cad59e9034aebafa754db572c6b6ff3a1a865`

## Result

Reviewed the R2B3A runtime change against frozen runtime `453fdb05b6457a4e9362c98308ca384c10f5d8b4`. Its three runtime source paths are limited to the unified recovery diagnostic, the existing release-gate CLI dispatch, and their tests. The WP03 R5 baseline comparison has no changes in `src/ui`, `src/application`, `src/model`, or `src/persistence`. No tracked source was dirty at intake or after the build; no untracked runtime source was present. Existing unrelated untracked reports/evidence were preserved and excluded from commits.

Created a fresh Git archive from commit `713e4c5…`, SHA-256 `249038d0a04de75391b464b8cb2cad59e9034aebafa754db572c6b6ff3a1a865`, size 47,820,800 bytes, 1,185 files. All archive entries matched the Git tree; mismatch count 0. Candidate compilation used a second clean extraction with 1,185 tracked files and mismatch count 0. Build and candidate roots are in `/Users/linte/Library/Caches/pfc-wp04r2b3b1-713e4c5/`, on the APFS Data volume and outside CloudDocs.

The frozen archive passed the full regression set: typecheck, lint, 300 product tests, WP03 preview, release-gate, production web build, R2A, C3, R2B1B, R2B3A recovery diagnostic, Rust default, quiescence fixture/Tauri, native lease, recovery component 16/16, and forward formal Gate → Rust → S0–S10 → Migration 4 exactly once. Some test scripts require binaries under the extracted source's standard `src-tauri/target`; after identifying that path requirement, affected tests were rerun there and passed. Initial failed-before-case attempts and the successful rerun receipts are both retained. Lint exits 0 with the repository's style warnings; no automatic fixes were applied.

The canonical success root was re-diagnosed from the frozen source: `V4_VERIFIED`; 25 observed chain objects had identical hashes and file identities before/after, with `diagnosticMutationCount=0`. The recovery component matrix remains `COMPONENT_ONLY`; it is not full-chain recovery acceptance or Q closure.

## Candidate

Built one fresh synthetic Tauri app from the clean archive extraction after `npm ci` and production Vite build. Tauri used feature set `wp04-r2b-synthetic,tauri/custom-protocol` and a generated synthetic-only config. The app is at:

`/Users/linte/Library/Caches/pfc-wp04r2b3b1-713e4c5/candidate-build/cargo-target/release/bundle/macos/小钱家.app`

- Bundle ID: `org.pfc.quiescence.integration`
- `CFBundleExecutable`: `personal-finance-console`
- Executable SHA-256: `7c640378b10a8bbdb40cd5f9b65069de19443b8e65b9e6cc2f704a69e7f578d4`
- Compatibility manifest SHA-256: `cdb8f040b9250a23ba0df0f89a0c91313ba881cdd715bed8945201e1f51b7ecc`
- Team ID: `SSRKA7A4TN`
- Signing identity: Apple Development (`FW5KHTFNZ6`)
- `codesign --verify --deep --strict`: PASS
- Candidate launched: NO

The executable differs from the retained old candidate (`f7625ec…`). The old package remains classified `R2B_PRE_RECOVERY_ENTRYPOINT_BASELINE`; this new package is the only candidate designated for WP04R2B3B2 recovery final acceptance.

## Boundaries

No C0/V3 fixture, authorization, receipt, permit, full-chain recovery scenario, Q closure, renderer, or audit was run. No Production App/DB access, `/Applications` write, migration, restore, real authorization, backup, or permit creation occurred. WP-02, WP-03 acceptance, and Financial Model V1.0 remain unchanged. This work does not change the overall WP04R2B status to READY and does not establish Production readiness.

## Evidence

`evidence/wp04-release-cutover-readiness/43-r2b3b1-recovery-source-freeze/` contains Git intake, source review, product preservation, frozen-source regression receipts, Git archive and tree validation, candidate build logs, strict code-sign readback, source/candidate binding, and final readback. The binding is `07-source-candidate-binding/R2B3B_SOURCE_CANDIDATE_BINDING.json`.

**Next responsibility:** Planning may issue `WP04R2B3B2 — RECOVERY FINAL ACCEPTANCE + Q CLOSURE`, using only the candidate bound above. Stop here until that work order arrives.
