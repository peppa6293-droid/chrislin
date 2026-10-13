# WP-04R2C3C1 — Production Durable Terminal Report

Date: 2026-10-13 (Asia/Shanghai)

## Final status

`WP04R2C3C1_PRODUCTION_DURABLE_TERMINAL_READY`

This is an implementation and synthetic-validation result. It is ready for Planning to issue the separate R2C3C2 source-freeze and final-acceptance work order. It does not authorize Production access, release, migration, candidate build, or source freeze.

## Source and commits

- Starting HEAD: `af717492b127aa3ef2360391d7cce867323a0ba3`
- Runtime source baseline: `7b4a9c16bbbfc6ad1cd602af479d8aaa9a11f756`
- Durable-terminal implementation commit: `670c880` (`Add durable Production V4 cutover terminal`)
- Final source commit: `670c880`
- Final report commit: recorded by the follow-up report/state commit.
- No history was amended or reset.

## Implemented behavior

- Reused the existing fixed Production release receipt, one-time migration authorization, consumed-authorization ledger, candidate executable, compatibility manifest, database, backup, and shared canonical Production authority directory.
- Added one fixed-name Production terminal: `production-v4-cutover-terminal.json`. Its terminal state is `V4_VERIFIED`; test-created terminal state is explicitly marked `syntheticOnly=true`, while the formal Production path writes `syntheticOnly=false`.
- The terminal binds the authorization identity and bytes, permit hash and contract hash, consumed-ledger path/hash/content, release receipt path/hash, candidate executable and manifest paths/hashes, database path/device/inode and pre/post hashes, backup path/device/inode/hash, source/target schema versions, exact migration rows/count, integrity check, foreign-key check, and sidecar state.
- Terminal publication uses an owner-only, create-only temporary file, `O_NOFOLLOW`, file fsync, hard-link publication at the single fixed basename, parent-directory fsync, exact-byte readback, and full authority/readback validation. No replacement or alternate terminal namespace is accepted.
- The existing exclusive migration RAII guard spans authorization/permit validation, consumed-ledger durability, DB access, M4, COMMIT, post-readback, terminal durability, and terminal binding readback. Only after this does the function return and release the guard.
- Production startup checks claimed authorization, consumed ledger, permit resurrection, terminal exact bindings, and current V4 schema/readback before Tauri Builder. A fresh consistent V3 with no cutover authority remains distinguishable from a started cutover with a missing terminal.
- A claimed authorization covers the rename-before-ledger crash interval. The existing consumed ledger is durable before the first DB open/mutation and covers later unresolved intervals. No second ACTIVE/ledger/permit contract was added.

## Required scenarios

| Scenario | Result |
|---|---|
| Normal migration | PASS; M4 exactly once; terminal durable and read back before guard release |
| Process exit after COMMIT/readback but before terminal | PASS; restart refused before Builder |
| Terminal write/file-fsync/directory-fsync failure | PASS; no success return; startup remains blocked |
| Corrupt or stale terminal/authority | PASS; startup refused before DB/UI access |
| Never-started consistent V3 | PASS; not misclassified as missing-terminal cutover |
| Verified V4 restart | PASS; startup allowed after terminal verification; no permit reuse or M4 replay |
| Durable terminal then lost reply | PASS; restart recognizes terminal; no M4 replay |
| Guard-order evidence | PASS; machine-readable sequence records terminal durable/readback at sequence 1, guard release/UI shared acquisition at sequence 2 |

Evidence: `evidence/wp04-release-cutover-readiness/53-r2c3c1-production-durable-terminal/`, including `10-ordering/GUARD_TERMINAL_ORDERING.json` and `12-regression/REGRESSION_SUMMARY.json`.

## Regression results

- TypeScript typecheck: PASS.
- Lint: PASS, with 25 existing CSS specificity warnings.
- Product: 300/300 PASS.
- WP03 preview: 5/5 PASS.
- Release Gate: 40/40 PASS.
- R2A formal Gate wiring and R2B1A Gate-owned permit: PASS.
- R2B1B native handoff: 16/16 PASS.
- Recovery diagnostic: PASS; recovery hooks: 12/12 PASS.
- Rust default: 50/50 PASS; startup-exclusion hook build: 50/50 PASS, including 50 lock races; quiescence fixture: 33/33 PASS; Tauri: 44/44 PASS.
- R2C3A startup-exclusion: 4/4 PASS.
- Native lease: 15/15 PASS from the preserved R2C3A evidence. The current harness SHA matches that evidence; the native lease implementation and executable were not changed by this patch.
- Production terminal scenarios: 7/7 PASS, including real child-process exit at the pre-terminal boundary.
- The full 17-case R2B matrix was not rerun because the recovery state machine was unchanged.

`cargo fmt` was unavailable because `cargo-fmt` is not installed. No toolchain installation was attempted.

## Scope and safety

- Permit contract changed: NO.
- Consumed-ledger contract changed: NO.
- Migration4 changed: NO.
- R2B recovery contract changed: NO.
- Product behavior changed: NO.
- Financial Model changed: NO.
- Runtime dirty source after implementation commit: NO.
- WP03 acceptance preserved: YES. WP02 touched: NO.
- Production app/database touched: NO.
- Real authorization, backup, permit, or terminal created: NO.
- Final candidate built or source frozen: NO.

## Historical status and next responsibility

R2C2 BLOCKED, R2C3A READY, and R2C3B BLOCKED remain preserved as historical records. This result resolves only the R2C3C1 implementation blocker. Planning/Owner is the next responsibility: issue WP-04R2C3C2 for final source freeze and current-source final acceptance. Stop here until that separate work order.
