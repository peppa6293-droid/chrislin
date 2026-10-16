# 小钱家 build-21 Candidate Manifest

- Candidate: `build-21`
- Baseline: `ad71366`
- Manifest status: pre-commit candidate snapshot
- Scope source: current Git index (staged content before manifest inclusion)
- Production App/DB: not touched by this candidate preparation

## Staged scope

Before adding this manifest, the staged index contained **28 files: 20 modified and 8 added**. This is the verified count; earlier reports claiming 26 files (19M + 7A) are superseded by index inspection.

### Modified (20)

- `.gitignore`
- `scripts/build_wp03_product_preview.py`
- `src-tauri/src/lib.rs`
- `src/application/product-service.ts`
- `src/application/v4-foundation-service.ts`
- `src/main.tsx`
- `src/persistence/repositories.ts`
- `src/runtime/tauri-bootstrap.ts`
- `src/ui/App.tsx`
- `src/ui/HomeScreen.tsx`
- `src/ui/MyFinancePages.tsx`
- `src/ui/contracts.ts`
- `src/ui/duo-guide.css`
- `src/ui/trial-experience.css`
- `tests/financial-maintenance-service.test.ts`
- `tests/persistence.test.ts`
- `tests/product-restart.test.ts`
- `tests/product-service.test.ts`
- `tests/ui.test.tsx`
- `tests/v4-foundation.test.ts`

### Added (8)

- `docs/GPT6_LUNA_EXECUTION_MASTER_PROMPT.md`
- `docs/MUSE_SPARK_1_3_EXECUTION_PROMPTS.md`
- `docs/V2_TEST_MIGRATION_DISPOSITION.md`
- `docs/XIAOQIANJIA_FINAL_AUDIT_CHECKLIST.md`
- `docs/XIAOQIANJIA_PRODUCT_DESIGN_V2.md`
- `src/ui/V2HomeSurface.tsx`
- `src/ui/v2-surface.css`
- `tests/v2-ui.test.tsx`

## Functional scope

- Add `expenseById()` and month-scoped `listRecentExpenses()` persistence access.
- Restrict Home recent expenses to the current business month.
- Correct December-to-January month upper-bound calculation.
- Add persistence and V2 UI coverage for month filtering and cross-year isolation.
- Include the staged V2 UI, Tauri/runtime, V4 foundation, test, build-script, and documentation changes already present in the working tree.

## Verification evidence

- TypeScript typecheck: passed.
- Web build (`npm run build:web`): passed.
- Targeted tests under `NODE_ENV=test`: 72/72 passed.
  - `tests/persistence.test.ts`: 40/40
  - `tests/v2-ui.test.tsx`: 19/19
  - `tests/v4-acceptance-ui.test.tsx`: 6/6
  - `tests/onboarding-safety-eligibility.test.tsx`: 7/7
- Full Vitest under `NODE_ENV=test`: 295 passed, 34 failed, 329 total.
- Known full-suite failures: legacy `tests/ui.test.tsx` Phase 3 assertions incompatible with the staged V2 UI migration.
- Cached diff whitespace check: passed before manifest creation.

## Acceptance boundaries

- This manifest does not claim that the full test suite is green.
- This manifest does not claim macOS release, iOS build/device validation, signing, or App Store readiness.
- This manifest does not authorize production data migration, production database access, publishing, or deployment.
- Candidate commit must be verified after commit; the final commit hash and final staged scope are authoritative.
