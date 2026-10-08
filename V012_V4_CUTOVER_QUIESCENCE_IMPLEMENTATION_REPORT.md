# V0.1.2 V4 Cutover Quiescence — Implementation Report

Implementation/experiments: 2026-10-08; delivery: 2026-10-09 (Asia/Shanghai).

**PF_V012_V4_CUTOVER_QUIESCENCE_IMPLEMENTATION_BLOCKED**

中文摘要：已完成一部分隔离实现，并保存真实跨进程实验和独立回读证据。**完整 S0–S10 集成尚未完成，不能进入复审。** 主要待办是完整受管清单与 native 绑定、S1 安装/恢复流程、真实 Tauri/TS IPC，以及实验报告列出的剩余故障场景。生产环境未执行迁移、替换或恢复；新 blocker 保持 OPEN。以下保留技术实现明细，准确字段和状态名不翻译。

This is a partial isolated implementation with preserved synthetic evidence, **not** a completed S0–S10 integration, final candidate, independent audit, or Production migration authorization. The required acceptance matrix is incomplete. No blocker is closed.

## 1. Authority and baseline

- Current authority: Owner's `OWNER DECISION — V0.1.2 / CUTOVER QUIESCENCE CONTRACT APPROVED FOR ISOLATED IMPLEMENTATION`, attachment `6658253f-cfe8-486d-a0aa-f436101e47b5/已粘贴的文本.txt`.
- Approved design: `V012_V4_CUTOVER_QUIESCENCE_CONTRACT_REDESIGN.md`, SHA-256 `a21ced6cb8e565689f89c3d52a61aaacecfde5a3e6079cc7bc62b7d6c59cc228`.
- Referenced chat read through the official task reader: `01a11bf8-73d8-72b0-bed3-6f58f325225a`, titled `个人财务模型｜重设计 V4 切换静默契约`. That design-only task's old restrictions do not expand or replace the current implementation authority.
- Repository: `/Users/linte/Documents/ChatGPT/个人财务模型app开发` (not the empty chat working directory with suffix `项目 2`).
- Baseline commit: `b4296d5268bb1e9abd72699727603d3fb85d3dae`.
- Nine existing untracked design/planning/independent-audit documents were present before this implementation. They are not implementation output and are not added to the implementation commit.
- Final implementation commit: this report is part of the new implementation commit; its exact SHA is supplied in the final delivery and recoverable with `git log -1 --format=%H -- V012_V4_CUTOVER_QUIESCENCE_IMPLEMENTATION_REPORT.md`. No historical audited commit is amended; no future independent audit is included.

## 2. What is implemented

### Native synthetic runner

`src-tauri/src/quiescence.rs` is compiled only into the opt-in `quiescence-fixture` executable. It does not start Tauri or an installed App. It accepts a canonical temporary root with a strict synthetic marker, uses one fixed DB basename, refuses DB symlinks/hardlinks, and opens an existing file without CREATE or URI paths. The synthetic competitor is also feature-gated. Ordinary `cargo run` still selects the normal application.

- Atomic claim, fsynced consumed record, fsynced outcome replacement plus directory synchronization; claim/pending/corrupt outcomes prevent replay or ordinary fixture startup.
- Inherited OS `flock` lease with inode binding, a separate-open contention check before assuming ownership, and retained parent/child descriptor overlap. It is not a lock-file-existence test and does not claim that old V3 binaries obey it.
- A dedicated native `Connection C`: `READ_WRITE`, private cache, `NO_MUTEX`, `NOFOLLOW`, no CREATE. `NO_CKPT_ON_CLOSE` is set before ordinary database activity; zero automatic WAL checkpoint threshold, zero busy timeout, FK ON, EXCLUSIVE locking, FULL synchronization and fullfsync ON are set and verified. Only DELETE is admitted; no WAL conversion, explicit checkpoint, manual sidecar removal, VACUUM or ATTACH is used.
- `BEGIN EXCLUSIVE`, lock-internal exact V3 schema/version/sequence/integrity/FK/C0/backup/candidate checks, fixed M4 execution, commit, and protected V4 readback all use the same C. No successful path reconnects or performs a second BEGIN after commit.
- Native file-control checks for moved file and lock state, together with inode/link checks, make detected identity/guard loss a failure. These APIs alone are not proof of continuous OS locking; real competing processes provide additional evidence.
- Clean-exec, hash-only role on the approved executable: fixed DB target, no shell, no SQLite connection in that role, session/role binding, open/fstat/read/fstat/hash, inode/size/link/header/hash output, deadline and child reaping. Parent DB descriptors must be CLOEXEC and the child rejects inherited DB descriptors.
- Exact legacy-table row snapshots are compared before commit and after commit. Schema validation compares the complete non-null SQL definition list, not just `MAX(version)` or `IF NOT EXISTS` success.
- Durable states include permit consumed, quiescence acquired, migration in progress, commit outcome unknown, V4 committed pending verification, V4 verified, failed V3 confirmed, and guard lost/unproven. Failures do not restore an old App or a DB backup; consumed permits are not revived.
- Stage-aware journal checks retain and observe the runner-created rollback journal, including normal zeroed-header journal after EXCLUSIVE DELETE commit. No journal is manually deleted to pass an experiment.

### Migration source fidelity

The accepted TypeScript `src/persistence/migrations.ts` is unchanged and remains authoritative. `migrations/004.sql` is its byte-exact M4 extract; `003-bootstrap.sql` extracts the accepted V1–V3 definitions for fixtures. `build.rs` rejects drift of either artifact before compiling. Bundled-SQLite unit tests independently compare generated V3/V4 schema JSON to those definitions. Native inserts the version-4 migration ledger row inside the same transaction, matching the existing TS migration wrapper's semantics.

No Financial Model V1.0, Planning, Actual, cash-lifecycle or schema meaning was changed.

### Managed-runtime primitives

`scripts/quiescence_gate.py` provides temporary-fixture-only exact bundle/plist/executable/manifest identity, finite nested traversal without pruning unrelated outer Apps, canonical escape/hardlink/unknown launch-alias refusal, no archive/staging role whitelist, bare Production executable detection, disabled copies born with mode 0600, and disable-before-exit verification. Source/target overlap is rejected before any copy mutation.

Actual fixture subprocess handles and waitpid-backed exit observations are tested. Unrelated protected-PID observations are not promoted to host-wide absence proof; relevant target UNKNOWN still blocks. These are isolated primitives, **not** a complete host collector or S1 installer.

### Existing entrypoint containment

The old CLI `migrate` and `retire` paths now return structured BLOCKED before loading input or writing a receipt. Imported legacy mutation helpers are confined to temporary fixtures, preserving their historical regressions without allowing them to mutate the real Production paths. Read-only/preflight logic is not reinterpreted as new-contract readiness.

The newly compiled normal App source rejects unresolved cutover files before its SQLite access and disables the old TS-driven Production migration route. It conservatively requires a separately authorized handoff even for a cutover file claiming VERIFIED. The installed Production App was not replaced and is unaffected.

## 3. Acceptance gaps — why BLOCKED

1. **S0–S2 and full managed/native binding are incomplete.** Python's full object set, disabled launch routes, precise installed bundle and retained process associations are not yet carried through and independently rechecked by native at every required boundary. Native's current fixture executable/manifest checks are not an equivalent full inventory contract.
2. **S1 installation/replacement/compatibility-paired recovery orchestration is not implemented.** Disabled-copy and exit primitives cannot substitute for the complete formal transition path.
3. **Q11 has not run.** The fixture CLI is not a real Tauri/TypeScript IPC session. There is no claim that native unit calls, process pipes, or the historical node:sqlite chain prove front-end interruption, interleaved business IPC or end/commit token isolation in the real application.
4. **Q01–Q18 are not all complete.** See the experiment report for exact subcases. Missing evidence includes real pager/rollback I/O failure, SQLITE_LOCKED, helper-time competition, several mode/recovery races, full failure/replay/dual-gate combinations and real I/O attribution for WAL probe side effects.
5. **Recovery is intentionally fail-closed, not completed.** An unresolved attempt has no implemented authorized recovery/handoff entrypoint. A missing response never implies V3; schema=4 never alone resolves UNKNOWN. Re-running the same permit or restoring the old App is not a recovery method.
6. **Historical mapping is incomplete.** Existing regressions pass, but their continued passing is not proof that every old inventory A/P case has been replaced by a fully integrated new-contract mechanism.

These are implementation/evidence gaps, not a request to widen Production authorization. This task has not reached READY_FOR_REAUDIT. A follow-up implementer must complete the missing isolated integration and experiments before asking for independent re-audit; Owner is not being asked to close the blocker or permit Production actions.

## 4. Verification and corrections

Preserved machine-readable evidence is in `evidence/quiescence/`. Final source-bound regression output: `regressions.json`. Final concurrency evidence and synthetic DB archive are named in the experiment report. Main-task verification additionally checks artifact hashes, saved test outputs, event/error ordering and archived synthetic database contents.

Relevant discovered defects were corrected, not hidden:

- Native lease validation initially could acquire an unlocked inherited descriptor before probing. Probe now precedes inherited acquisition.
- Corrupt/unbound/pending/symlink outcome records now block startup. A VERIFIED string without ledger/session bindings is insufficient.
- Constraint injection now causes an actual SQLite constraint error; a deliberately skipped rollback remains labelled a synthetic control, not a real pager I/O failure.
- Staging copy rejected source/target overlap before mutation after a recursive-copy counterexample was identified.
- Writable native open now refuses a preflight-to-open DB symlink swap. Object identity is rechecked before ordinary connection PRAGMA/database activity, not only after acquiring the transaction.
- Controller setup failures are preserved separately: canonical `/var` alias rejection and a competing connection's early metadata SQL touching the locked schema. Metadata uses bundled C APIs instead; old failing records are not relabelled PASS.
- A parallel unit-test directory collision was corrected only in `#[cfg(test)]` by adding an AtomicU64 suffix. The failed regression output remains preserved; final parallel tests pass. The final experiment runtime binary did not change. The experiment report gives both source fingerprints and this test-only provenance distinction.

No real Production restore, cleanup, permission change, migration retry, or launch was used to fix tests.

## 5. Governance and Production preservation

`docs/CURRENT_PHASE.md` was changed only to record current Owner design approval and supersession, preserving the capability failure and old-runtime closure history:

```text
RB-V4-CUTOVER-INVENTORY-01 = SUPERSEDED_BY_RB-V4-CUTOVER-QUIESCENCE-01
RB-V4-CUTOVER-QUIESCENCE-01 = OPEN
RB-V4-OLD-RUNTIME-01 = CLOSED
Production V4 Migration = NOT AUTHORIZED
```

Production was not opened with SQLite, backed up, launched, checkpointed, recovered, migrated, replaced or retired by this task. No real permit/authorization/release receipt was created. Read-only raw-file observations are recorded in `evidence/quiescence/production-preservation.json`; they are not a frozen final C0 and not a full OS-level activity audit. Owner's ¥13.10 normal-use expense remains legitimate and was not restored or reclassified.

Stage 4–7, V0.2, UI redesign and deferred P2 cleanup remain outside scope. No project-memory station or managed-memory state was written. Project-memory and continuity skills were used only to locate context and preserve historical/current authorization distinctions; the authoritative phase file is not duplicated.

## 6. Changed-file categories and dependencies

Runtime-affecting source/configuration:

- `src-tauri/src/lib.rs`, `src-tauri/src/quiescence.rs`
- `src-tauri/src/bin/quiescence_fixture.rs`, `src-tauri/src/bin/quiescence_competitor.rs`
- `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`, `src-tauri/build.rs`
- `scripts/production_v4_release_gate.py`, `scripts/quiescence_gate.py`
- `migrations/003-bootstrap.sql`, `migrations/004.sql`, `migrations/v3-schema.json`, `migrations/v4-schema.json`

Tests/evidence:

- `scripts/test_quiescence_gate.py`, `scripts/test_quiescence_entry_boundary.py`
- `scripts/quiescence_experiments.py`, `scripts/quiescence_regressions.py`
- `scripts/verify_quiescence_evidence.py`, `evidence/quiescence/*`

Governance/reports: `docs/CURRENT_PHASE.md` and the two required quiescence implementation/experiment reports.

Dependency change: `libc` is now a direct Rust dependency for flock/FD/file identity handling. The existing locked package version is reused; no dependency version or bundled SQLite version was upgraded. No JavaScript dependency changed. No LaTeX, browser plugin or other tool installation occurred.

Three bounded subagents worked on distinct files: native runner, managed-gate primitives, and experiments. The main task owned governance, legacy entrypoint containment, shared SQL verification, final checks and delivery. Actual dispatch omitted model/reasoning overrides (inheritance requested); backend model/effort, exact tokens/credits/cost are unknown. Subagent claims were checked against source and saved evidence; this internal QA is not the future independent re-audit.

## 7. Stop point

Saved partial implementation, tests, both reports and a new implementation commit. No automatic continuation into Production or archive of this chat. Remaining work is owned by the follow-up isolated implementation effort; independent audit and Owner blocker closure occur only after all required criteria are met.
