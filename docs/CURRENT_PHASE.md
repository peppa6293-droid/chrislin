# Current Phase

Project: Personal Finance Console

Current Phase: PERSONAL_FINANCE_CONSOLE_V01_PRODUCTION_ACTIVE

Financial Model: V1.0 APPROVED / FROZEN

Phase 1: APPROVED.
Phase 2: APPROVED.
Phase 3: APPROVED.

V0.1 Status: `PERSONAL_FINANCE_CONSOLE_V01_PRODUCTION_ACTIVE`.

## Authoritative Owner Closure — Old-Runtime Protection

- On 2026-10-08, Owner closed `RB-V4-OLD-RUNTIME-01` based on the independent final re-audit `PF_V012_V4_OLD_RUNTIME_GATE_ENTRY_P1_REAUDIT_PASS_WITH_P2` of commit `06bd72291f148ed768f59ee06e3fe9398a75cb6e`.
- Final audit: P0 = 0; P1 = 0. `P1-OLD-GATE-ENTRY-01` is CLOSED. Previously closed old-runtime P1 findings remain CLOSED; old-runtime-related P2 findings are CLOSED. The six pre-existing non-blocking P2 items remain OPEN / DEFERRED.
- Owner closure record: [V012_V4_OLD_RUNTIME_PROTECTION_OWNER_CLOSURE.md](../V012_V4_OLD_RUNTIME_PROTECTION_OWNER_CLOSURE.md). Independent audit report reference: `V012_V4_OLD_RUNTIME_PROTECTION_GATE_ENTRY_P1_INDEPENDENT_REAUDIT.md` (preserved as independent evidence).
- This closure closes only the old-runtime protection release blocker. Production remains Schema V3 with migrations `[1,2,3]`; Production V4 migration remains NOT AUTHORIZED.
- This closure does not authorize Production App replacement, old App retirement, Production backup creation, Production runtime launch, Production data write, or V3→V4 migration. Each requires separate Owner authorization.

V0.1.2 Phase 1: `OWNER_PHASE1_APPROVED_AND_CLOSED` (Owner closure date: 2026-10-07).

Independent final audit: `PF_V012_PHASE1_F0_EXCEPTION_REAUDIT_PASS_WITH_P2` — P0 = 0; P1 = 0. P1-F0-01, P1-MONEY-01, P1-LANGUAGE-01, and P2-EVIDENCE-01 are CLOSED. Four accepted P2 items remain OPEN / DEFERRED: P2-F0-02, P2-DISCOVERY-01, P2-CSS-01, and P2-TEXT-01.

Accepted V0.1.2 Phase 1 scope: F0 single-domain save / persistence-truth foundation; A responsive monetary display; B consumer-language detail presentation. The accepted implementation is preserved as the Phase 1 baseline.

Protected baseline remains Financial Model V1.0, existing V3 data and semantics, debt precedence, Planning / Actual separation, Safety formulas, `cashFloorMet`, Gate logic, asset revision semantics, Stage 3 visual baseline, responsive money behavior, and consumer-language hierarchy. Production remains Schema V3 and RC2 remains unchanged. Owner has separately authorized only the V4 additive migration foundation; no UI stage is authorized by that work.

V0.1.2 V4 Additive Migration Foundation: `OWNER_V4_FOUNDATION_ACCEPTED` (Owner acceptance date: 2026-10-07). Independent final audit: `PF_V012_V4_ACTUAL02_REAUDIT_PASS_WITH_RELEASE_BLOCKER`. P0 = 0; P1 = 0. P1-V4-PLANNING-01, P1-V4-ACTUAL-01, P1-V4-ACTUAL-02, and P1-V4-PERSISTENCE-01 are CLOSED. Six P2 items remain OPEN / DEFERRED. **Historical at Foundation acceptance:** `RB-V4-OLD-RUNTIME-01` remained OPEN and Production V4 migration was NOT AUTHORIZED. The subsequent final gate-entry re-audit and Owner closure are recorded above. Evidence: [V012_V4_ACTUAL02_INDEPENDENT_FINAL_REAUDIT.md](../V012_V4_ACTUAL02_INDEPENDENT_FINAL_REAUDIT.md) and [V012_V4_ACTUAL02_FINAL_CORRECTION_REPORT.md](../V012_V4_ACTUAL02_FINAL_CORRECTION_REPORT.md).

V0.1 BASE FRAMEWORK FROZEN. Production Owner Bootstrap Final Audit: PASS. P0 = 0; P1 = 0; six accepted P2 items = DEFERRED. Owner Production data = ACTIVE. Production runtime = ACTIVE / authoritative. V0.2 = NOT STARTED. No bootstrap, import, or final-audit action remains pending.

## Authoritative Current State — Production Active

- The independent final audit report [OWNER_PRODUCTION_BOOTSTRAP_FINAL_AUDIT.md](../OWNER_PRODUCTION_BOOTSTRAP_FINAL_AUDIT.md) records `PF_OWNER_PRODUCTION_BOOTSTRAP_FINAL_AUDIT_PASS`, P0 = 0, P1 = 0; Owner accepts that result.
- The authoritative installed Production runtime is active. Audit-accepted Production DB SHA-256: `ec0da560df20030934a60d61bf83a5ee74bc402c55b8a064b9454f572d18f419`.
- Financial Model V1.0 remains approved and frozen. Six accepted P2 items remain deferred. V0.2 has not started.
- Owner bootstrap, import, and independent final audit are complete; no such action remains pending.
- Activation closure evidence: [V01_PRODUCTION_ACTIVATION_RECEIPT.md](../V01_PRODUCTION_ACTIVATION_RECEIPT.md).

## Historical — Owner Production Bootstrap Ready for Independent Final Audit

- Owner authorized the first Production Owner-data bootstrap on 2026-10-04 after accepting `PF_OWNER_BOOTSTRAP_DOCUMENTS_FINALIZED_READY_FOR_IMPORT_AUTHORIZATION`.
- Installed Production runtime identity matched the authorization: bundle `com.personalfinance.console`, version `0.1.0`, executable SHA-256 `3fe54d946dc8c8a13a167c4dd9f898b90b65499082d83c797867bfea5b184c3d`.
- A new byte-for-byte empty-V3 pre-bootstrap backup was created at `../artifacts/owner-bootstrap-pre-import-backups/production-v3-empty-pre-owner-bootstrap-20261004-225715+0800.sqlite3` and verified against the baseline hash.
- The approved candidate was submitted through installed Production onboarding. All Owner data read back through Application Services. The three locked assets were changed to `kind=OTHER` and retained `include_in_safety_resources=false` through the existing financial-maintenance Application Service.
- Production readback passed: V3, migrations `[1,2,3]`, integrity `ok`, foreign-key check empty, no sidecars, 1 profile, 0 Actual Income rows, 0 expense rows. The frozen full model matched the authorized outputs, including debt 172,579.53, mandatory service 14,518.73, safety resources 8,647.61, `STRUCTURAL_DEFICIT`, active cash gate, `RESTORE_CORE_BALANCE`, and `BASELINE_BUILDING`.
- The installed Production app was relaunched after import; onboarding did not reappear and Home loaded without crash. The app was closed after this check. Final DB SHA-256: `ec0da560df20030934a60d61bf83a5ee74bc402c55b8a064b9454f572d18f419`.
- Detailed execution evidence: [Owner Production Bootstrap Execution Receipt V2](../OWNER_PRODUCTION_BOOTSTRAP_EXECUTION_RECEIPT_V2.md). At that stage, the status was `PF_OWNER_PRODUCTION_BOOTSTRAP_READY_FOR_INDEPENDENT_FINAL_AUDIT`; the subsequent accepted final audit superseded it. V0.2 remains not started; all six P2 items remain deferred.

## V0.1.2 V4 Foundation — Owner Accepted

- Owner accepted the isolated Schema V4 Additive Foundation on 2026-10-07: `OWNER_V4_FOUNDATION_ACCEPTED`.
- Independent final audit: `PF_V012_V4_ACTUAL02_REAUDIT_PASS_WITH_RELEASE_BLOCKER`; V4 Foundation Technical Audit = PASS; P0 = 0; P1 = 0. All four V4 P1 findings are CLOSED.
- Six P2 findings remain OPEN / DEFERRED: P2-F0-02, P2-DISCOVERY-01, P2-CSS-01, P2-TEXT-01, P2-V4-ACTUAL-NOCHANGE-01, and P2-V4-TARGET-01.
- At the time of V4 Foundation acceptance, `RB-V4-OLD-RUNTIME-01` remained OPEN and mandatory before release / Production migration. This is a historical status superseded by the Owner closure recorded above. Production V4 migration remains NOT AUTHORIZED.
- Financial Model V1.0 remains frozen. No Planning UI, Stage 4–7, Production migration, old-runtime protection, or P2 cleanup is authorized by this acceptance.
- The earlier `PF_V012_V4_MIGRATION_READY_FOR_AUDIT` status was a completed prior stage and is superseded by Owner acceptance and the independent final audit.

## Historical — Owner Chinese Display-Name Normalization — Ready

- Owner approved Chinese Owner-visible `name` values for the existing cash accounts, assets, and debts. The candidate now uses the exact Chinese names; internal enums and identifiers remain unchanged.
- Essential expense import remains category-level: `HOUSING=1900`, `TRANSPORT=1028`, `UTILITIES_COMMUNICATIONS=600`. The five-part breakdown is retained as Owner context and is not expanded into unsupported onboarding rows.
- Isolated React onboarding and real Application Service tests confirm Chinese names pass validation and persist/read back exactly in UTF-8. English-name and Chinese-name candidates produce identical Home / Model Core outputs. No Production data was used for this validation.
- Stage status at that time: `PF_OWNER_CHINESE_DISPLAY_NAMES_READY_FOR_IMPORT`. It recorded preparation before the later import authorization; it is not the current Production state.
- Evidence and current mappings: [Owner Production Bootstrap Candidate](../OWNER_PRODUCTION_BOOTSTRAP_CANDIDATE_V1.md), [Model Preflight](../OWNER_BOOTSTRAP_MODEL_PREFLIGHT_V1.md), [Chinese display-name validation](../OWNER_CHINESE_DISPLAY_NAME_VALIDATION.md).


## Audited Runtime Re-Pin and No-Write Onboarding Dry Run — Completed

- Owner accepted `PF_ONBOARDING_FALSE_SELECTION_FIX_AUDIT_PASS` and authorized only exact runtime re-pin plus a no-write Production onboarding dry run.
- The old installed Production app (`com.personalfinance.console`, `0.1.0`, executable SHA-256 `c6cfcd8832a19a6df86d35085cfed9a791a10b8769d3206165a6977fc96b4dce`) was preserved and recursively verified at [runtime archive](../artifacts/production-runtime-archives/Personal%20Finance%20Console.app.pre-audited-repin-20261004-193841+0800).
- The independently audited executable (`3fe54d946dc8c8a13a167c4dd9f898b90b65499082d83c797867bfea5b184c3d`) was installed without rebuilding. Installed bundle ID/version and executable hash were read back before launch and again after close.
- Production precheck, pre-launch post-install check, and post-dry-run check retained empty V3 baseline SHA-256 `2bd2973cc7e2b04c86b0b3e8554ad3a1543786d6ed496cddcaf44eba04d07fb4`; schema V3, migrations [1,2,3], all 19 application/financial tables empty, profiles=0, integrity `ok`, no FK rows, and no sidecars.
- The approved Owner candidate was entered in the real installed onboarding UI. Restricted rent cash and all three locked assets retained explicit NO selections; the app advanced past the prior cash/assets/debts step to step 4/4 without a validation error. The final “完成设置” action was not pressed. The app was closed normally. Standard startup opened the DB and ran the migration check; the already-V3 DB remained byte-identical. The tested step transition invoked no service, and `completeOnboarding` was not invoked.
- Full evidence is recorded in [Audited Runtime Re-Pin and Onboarding Dry Run](../AUDITED_RUNTIME_REPIN_AND_ONBOARDING_DRYRUN.md). Status: `PF_AUDITED_RUNTIME_DRYRUN_READY_FOR_OWNER_REVIEW`.
- Smoke was not launched or modified. Owner data remains unimported; bootstrap is paused pending separate authorization. V0.2 remains not started; all six P2 items remain deferred.

## Historical Root-Cause Correction

The prior Production bootstrap was genuinely blocked in the then-installed runtime, as recorded in the original execution receipt; preserve that receipt unchanged. The earlier claim that explicit false validation caused the block is superseded as **UNCONFIRMED** because independent re-audit restored frozen onboarding source passed the same true / false / unselected controls. The audited runtime dry run now separately confirms the approved explicit NO selections pass through the real UI. Do not infer the old runtime's root cause from this result. See the [dry-run report](../AUDITED_RUNTIME_REPIN_AND_ONBOARDING_DRYRUN.md).

## Onboarding False-Selection Repair — Accepted

- The independent audit status `PF_ONBOARDING_FALSE_SELECTION_FIX_AUDIT_PASS` was accepted by Owner. The source maintains UNSELECTED distinct from explicit true and false.
- Independent test and UI/SQLite evidence is in [the re-audit report](../ONBOARDING_FALSE_SELECTION_FIX_REAUDIT.md). The restored frozen source passed the same controls; the prior installed-runtime root cause was not proven.
- No additional code, Financial Model, schema, or Data Contract change occurred in the runtime re-pin and UI dry-run phase.

## Historical — Owner Production Bootstrap Paused Before First Write

- The earlier Owner bootstrap execution stopped before the first Owner-data write. Its original [execution receipt](../OWNER_PRODUCTION_BOOTSTRAP_EXECUTION_RECEIPT_V1.md) remains preserved without edits.
- The then-installed-runtime behavior is documented there; root-cause attribution to false-selection validation is explicitly superseded as UNCONFIRMED by independent re-audit and the audited runtime dry run.
- This section describes the completed historical pause. The later Owner authorization and successful bootstrap are recorded below and supersede its stop state.

## Production V3 Migration Checkpoint — Historical

The following records the completed V3 schema migration preceding runtime pinning.

- Owner accepted `PF_V01_FINAL_AUDIT_PASS` on 2026-10-04: P0=0, P1=0, P2=6 deferred. V0.1 base framework and Financial Model V1.0 remain frozen.
- Owner approved [OWNER_PRODUCTION_BOOTSTRAP_CANDIDATE_V1.md](../OWNER_PRODUCTION_BOOTSTRAP_CANDIDATE_V1.md) and its full Model Core preflight for later import, but explicitly prohibited data import in the current decision.
- Authorized V2→V3 Production schema-migration-only checkpoint completed: `PF_PRODUCTION_V3_EMPTY_BASELINE_READY_FOR_OWNER_REVIEW`.
- Production identity/runtime: `com.personalfinance.console`; exact DB path: `/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`. Migration used the current project Production release and the normal startup migration path.
- Pre-migration V2 source SHA-256: `2bc477caa9aed948084d075203b4197ae6b1251e7a577b56cef4a748b72a5b42`. Verified byte-for-byte clean backup: [V2 migration backup](../artifacts/production-v3-migration-checkpoints/production-v2-clean-backup-20261004-171915+0800.sqlite3); backup hash equals source hash.
- Post-migration Production schema and `user_version` are V3/3; migrations [1,2,3] are recorded. All 19 non-migration application/financial tables remain empty; integrity is `ok`; foreign-key check is empty; no WAL/SHM/journal sidecars remain.
- New `PRODUCTION_V3_EMPTY_BASELINE_SHA256`: `2bd2973cc7e2b04c86b0b3e8554ad3a1543786d6ed496cddcaf44eba04d07fb4`.
- Production displayed fresh onboarding at step 1/4; no fields were entered or submitted. No Owner profile or financial data has been imported. V0.2 remains not started.
- Full evidence is recorded in [PRODUCTION_V3_MIGRATION_CHECKPOINT.md](../PRODUCTION_V3_MIGRATION_CHECKPOINT.md). No Smoke runtime/database was launched, opened, or written.
- Historical next Owner decision at migration time: review the V3 empty-baseline checkpoint. It was accepted before the runtime pinning phase. Any Owner-data import still requires separate explicit authorization; do not import data or start V0.2.

## Final Targeted P1 Fix (Historical; superseded by final audit)

- Owner authorized a limited repair of NEW-P1-02 only: explicit NULL in an applicable debt metadata revision must override the master fixed-payment fallback.
- Repository reads now distinguish an absent applicable revision from a present revision whose fixed monthly payment is NULL. The explicit NULL is preserved through maintenance recovery and model inputs.
- Added repository as-of and master-fallback controls, mixed-debt recovery coverage, and an end-to-end React UI / application-service / SQLite / Model / Home regression.
- `npm run lint`, `npm run typecheck`, `npm test` (171 tests / 10 files), Rust tests (7), `npm run build`, Smoke Tauri dev, Smoke Tauri build, and Production Tauri build passed.
- Production was not launched. Immutable read-only DB verification returned schema 2, integrity `ok`, no foreign-key violations, all 19 application/financial tables empty, and the unchanged baseline SHA-256 `2bc477caa9aed948084d075203b4197ae6b1251e7a577b56cef4a748b72a5b42`.
- Status means ready for independent targeted re-audit of NEW-P1-02; it is not self-approval or final audit pass. P2-02 through P2-07 remain open. No Phase 2 or V0.2 work was started.

## Phase 4 Recovery

Historical recovery record; the current audit status and phase above supersede the acceptance-ready status recorded at that time.

- Owner accepted forensic finding `STATE_A` and authorized A1 archive-and-reinitialize recovery.
- The incident database was moved, not deleted, from `/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3` to `artifacts/phase4-db-incident/production-archive-20261003-144142+0800/personal-finance-console.sqlite3`.
- Archive size: 225,280 bytes; SHA-256: `fea96cf138a1cec08be8926573a86c9271a294341aababee44c9f0be177dc9f9`; original mtime preserved at 2026-10-03 13:56:16.
- No production WAL or SHM sidecars existed at archive time. The preserved incident backup, audit report, and cleanup dry-run copies were verified before recovery and left unchanged.
- The packaged Production app created a clean database at its original path. Migrations 1 and 2 are present. All profile, settings, planning-income revision, income, essential-expense, expense, cash, cash-snapshot, asset, asset-snapshot, debt, and debt-fact counts are zero.
- Production `integrity_check` returned `ok`; `foreign_key_check` returned no rows. The built Production app displayed first-run onboarding on launch and after restart; no onboarding data was entered.

## Smoke Isolation and Visual Evidence

- Production identity: `com.personalfinance.console`, `Personal Finance Console`.
- Smoke identity: `com.personalfinance.console.smoke`, `Personal Finance Console Smoke`; its macOS app-data directory is separate from Production.
- Smoke startup rejects the Production app-data directory. Rust tests cover identity/path separation, rejection of a shared path, and the Production-path exception.
- Tauri dev Smoke created its database under `~/Library/Application Support/com.personalfinance.console.smoke/`; the Production database hash remained unchanged during Smoke flows.
- Smoke onboarding, expense entry, financial maintenance, and restart persistence were exercised in the packaged isolated Smoke app. The recaptured checkpoints 05, 07, 08, and 10 are distinct images with distinct hashes. See `PHASE4_OWNER_VISUAL_REVIEW.md`.

## Independent Audit Fix Implementation (Historical)

- Owner authorized correction of the verified 2 P0 and 6 P1 findings; no V0.2 work, Owner data import, or Production data modification is authorized.
- `PF_V01_AUDIT_FIXES_READY_FOR_REAUDIT`: all 2 P0 and 6 P1 findings have regression coverage and passed implementation review. Final acceptance authority remains the independent audit.
- `npm run lint`: PASS.
- `npm run typecheck`: PASS.
- `npm test`: PASS, 156 tests across 10 files.
- `cargo test --manifest-path src-tauri/Cargo.toml`: PASS, 7 Rust tests.
- `npm run build`: PASS.
- `npm run tauri:dev:smoke`: PASS; isolated Smoke Tauri runtime launched, then stopped.
- `npm run tauri:build:smoke`: PASS; Smoke app and DMG generated.
- `npm run tauri:build`: PASS; Production app and DMG generated (build only; app not launched).
- Read-only Production DB check after verification: schema version 2, integrity `ok`, no FK issues, all user/financial table counts 0, SHA-256 unchanged at `2bc477caa9aed948084d075203b4197ae6b1251e7a577b56cef4a748b72a5b42`.
- Read-only Smoke DB check after dev launch: schema version 3, integrity `ok`, no FK issues. Synthetic Smoke data only; no Owner data imported.

Remaining P2 follow-ups: incomplete maintenance income rows; investment-capacity semantics; path-alias hardening for Smoke isolation; full Tauri IPC/rollback/schema-version coverage; local-first command/CSP security hardening. Audit P2-01 future Actual Income as-of filtering was corrected with the temporal contract.


## Second Independent Audit P1 Fixes

- Owner authorized only the two P1 findings in `V01_INDEPENDENT_FINAL_REAUDIT.md`: unchanged new-month debt confirmation and user-input money rules incorrectly applied to aggregate/derived money. No V0.2 work or Owner-data import was performed.
- Debt maintenance marks `needsCurrentMonthFact`; unchanged missing-month debts are materialized when saved, while unchanged existing monthly facts are not duplicated. Blank current-month due remains null and previous-month facts remain unchanged.
- Money validation separates `USER_INPUT_MONEY`, `AGGREGATE_MONEY`, and `DERIVED_MONEY`. The original per-entry limit remains; valid aggregate totals above it and finite derived Decimal precision/exponent serialization remain usable.
- Added service, model, product rollover, and actual maintenance UI/database regressions.
- `npm run lint`, `npm run typecheck`, `npm test` (168 tests / 10 files), Rust tests (7), `npm run build`, Smoke Tauri dev, Smoke Tauri build, and Production Tauri build all passed.
- Production was not launched. Its database was read in immutable read-only mode after builds: version 2, integrity `ok`, no foreign-key violations, all application/financial tables empty, SHA-256 unchanged at `2bc477caa9aed948084d075203b4197ae6b1251e7a577b56cef4a748b72a5b42`.
- Status means ready for independent targeted re-audit only; it is not self-approval or `PF_V01_FINAL_AUDIT_PASS`.

## Next Action

V0.1.2 Phase 1 and the V4 Foundation are formally accepted by Owner. The old-runtime release blocker is CLOSED by Owner. Production remains active on Schema V3 with migrations `[1,2,3]`; Production V4 migration is NOT AUTHORIZED. Any future Production App replacement, old App retirement, Production backup, Production launch/write, or V3→V4 migration requires separate Owner authorization. Do not automatically begin V0.2, Stage 4–7, or deferred P2 work.
