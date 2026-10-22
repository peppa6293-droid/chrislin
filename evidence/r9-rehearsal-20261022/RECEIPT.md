# R9 迁移演练与真实库只读 Preflight 回执

执行依据：`docs/EXEC-R9-REHEARSAL-AND-MIGRATION-PREFLIGHT-INSTRUCTIONS.md`（提交 `6318a8b`）
开工 HEAD：`6318a8b`（`git merge-base --is-ancestor e75d7ec HEAD` 成功）
执行日期：2026-10-22

## 1. 状态

**R9_PASS**

所有 R9-01…R9-04 均完成且符合任务书期望；无红线触发，无返回条件触发。
本任务未执行真实迁移，生产库仍为 V3；本回执不表示已对生产库执行迁移、恢复或授权启动。

## 2. 分任务结论

| 任务 | 结论 | 证据 |
|---|---|---|
| 第 1 节 开工检查 | PASS | `git rev-parse HEAD` = `6318a8b`；`git merge-base --is-ancestor e75d7ec HEAD` 成功；开工时工作区仅有允许的未跟踪项（`.claude/`、`pelican-*.html`、新证据目录、任务书） |
| R9-01 基线复跑与候选哈希 | PASS | `10-baseline/01`–`10`；四个候选哈希与 `70-rebuild-post-commit-93db676/BUILD_IDENTITY.json` 完全一致 |
| R9-02 合成 V3→V8 隔离演练 | PASS | `20-synthetic-rehearsal/21`、`21a`–`21c`、`22*`、`23`；(a)(b)(c) 三层全过 |
| R9-03 真实库只读 Preflight | PASS | `30-real-readonly/31`–`35`；执行前后指纹逐字相同；schema 差异 0 条 |
| R9-04 迁移后对账规格 | PASS（SPEC_ONLY） | `40-reconciliation/POST_MIGRATION_CHECKS.md`；合成 SQL 验证 `41` = `RESULT=PASS` |

## 3. 命令、退出码与日志

工作目录除注明外均为仓库根。

| # | 完整命令 | 退出码 | 结果摘要 | 日志 |
|---|---|---|---|---|
| 01 | `npx vitest run` | 0 | 44 passed + 1 skipped files；442 passed / 80 skipped（522） | `10-baseline/01-vitest.log` |
| 02 | `npm run typecheck` | 0 | 无错误 | `10-baseline/02-typecheck.log` |
| 03 | `npm run lint` | 0 | 125 files checked，无 fix | `10-baseline/03-lint.log` |
| 04 | `cargo test --manifest-path src-tauri/Cargo.toml` | 0 | 66 passed, 0 failed, 0 ignored | `10-baseline/04-cargo-test.log` |
| 05 | `python3 -I scripts/test_production_v8_release_gate.py -v` | 0 | Ran 47 tests, OK | `10-baseline/05-prod-v8-gate.log` |
| 06 | `python3 -I scripts/test_production_v4_release_gate.py -v` | 0 | Ran 40 tests, OK | `10-baseline/06-prod-v4-gate.log` |
| 07 | `python3 -I scripts/test_production_gate_wiring_integration.py -v` | 0 | Ran 5 tests, OK | `10-baseline/07-gate-wiring.log` |
| 08 | `python3 scripts/test_unified_synthetic_contract.py -v` | 0 | Ran 5 tests, OK | `10-baseline/08-unified-synthetic.log` |
| 08b | `python3 scripts/test_unified_r2b_recovery.py -v` | 1 | **既有 setup 错误**：`SYNTHETIC_ONLY` marker 不存在；Ran 0 tests；未修改、未计为通过 | `10-baseline/08b-unified-r2b-recovery.log` |
| 09 | `git diff --check` | 0 | 无输出 | `10-baseline/09-git-diff-check.log` |
| 10 | `shasum -a 256 "$A/MacOS/personal-finance-console" "$A/Info.plist" "$A/Resources/runtime-compatibility.json" src-tauri/runtime-compatibility.json src-tauri/target/release/bundle/dmg/小钱家_0.1.0_aarch64.dmg`（`A="src-tauri/target/release/bundle/macos/小钱家.app/Contents"`） | 0 | 5 个实测哈希全部命中期望 | `10-baseline/10-candidate-hashes.log` |
| 21 | `python3 -I evidence/r9-rehearsal-20261022/20-synthetic-rehearsal/driver_r9_gate_preflight.py scripts/production_v8_release_gate.py "$(pwd)" positive` | 0 | `PREFLIGHT_PASS`；receipt `syntheticOnly=true`；`sidecarsAbsent=true`；`isolationProblems=[]` | `20-synthetic-rehearsal/21-gate-preflight.log` |
| 21a | `python3 -I evidence/r9-rehearsal-20261022/20-synthetic-rehearsal/driver_r9_gate_preflight.py scripts/production_v8_release_gate.py "$(pwd)" tampered-executable` | 2 | `BLOCKED`：可执行文件哈希不匹配 | `20-synthetic-rehearsal/21a-negative-tampered-executable.log` |
| 21b | `python3 -I evidence/r9-rehearsal-20261022/20-synthetic-rehearsal/driver_r9_gate_preflight.py scripts/production_v8_release_gate.py "$(pwd)" replaced-backup` | 2 | `BLOCKED`：备份哈希不匹配、非逐字节一致 | `20-synthetic-rehearsal/21b-negative-replaced-backup.log` |
| 21c | `python3 -I evidence/r9-rehearsal-20261022/20-synthetic-rehearsal/driver_r9_gate_preflight.py scripts/production_v8_release_gate.py "$(pwd)" added-wal` | 2 | `BLOCKED`：检测到 SQLite `-wal` | `20-synthetic-rehearsal/21c-negative-sidecar-wal.log` |
| 22a | `cargo test --manifest-path src-tauri/Cargo.toml -- --list` | 0 | 66 tests, 0 benchmarks；确认 7 个目标测试均存在 | `20-synthetic-rehearsal/22a-test-list.log` |
| 22-b1 | `cargo test --manifest-path src-tauri/Cargo.toml native_v3_to_v8_full_schema_fixture_migration_is_isolated -- --nocapture` | 0 | 1 passed；JSON：源 3/3、目标 8/8、行 1..8、`integrityCheck=ok`、FK 违规 0、`sidecarsAbsent=true` | `20-synthetic-rehearsal/22-native_v3_to_v8_full_schema_fixture_migration_is_isolated.log` |
| 22-b2 | `cargo test --manifest-path src-tauri/Cargo.toml native_migration8_rejects_inconsistent_v3_source_history -- --nocapture` | 0 | 1 passed, 65 filtered | `20-synthetic-rehearsal/22-native_migration8_rejects_inconsistent_v3_source_history.log` |
| 22-b3 | `cargo test --manifest-path src-tauri/Cargo.toml verified_v8_restart_does_not_replay_migration_and_reply_loss_keeps_terminal -- --nocapture` | 0 | 1 passed, 65 filtered | `20-synthetic-rehearsal/22-verified_v8_restart_does_not_replay_migration_and_reply_loss_keeps_terminal.log` |
| 22-b4 | `cargo test --manifest-path src-tauri/Cargo.toml preterminal_process_exit_and_terminal_write_failures_remain_blocked -- --nocapture` | 0 | 1 passed, 65 filtered | `20-synthetic-rehearsal/22-preterminal_process_exit_and_terminal_write_failures_remain_blocked.log` |
| 22-b5 | `cargo test --manifest-path src-tauri/Cargo.toml child_process_exits_after_commit_before_terminal_and_restart_is_blocked -- --nocapture` | 0 | 1 passed, 65 filtered | `20-synthetic-rehearsal/22-child_process_exits_after_commit_before_terminal_and_restart_is_blocked.log` |
| 22-b6 | `cargo test --manifest-path src-tauri/Cargo.toml corrupt_or_stale_terminal_fails_closed -- --nocapture` | 0 | 1 passed, 65 filtered | `20-synthetic-rehearsal/22-corrupt_or_stale_terminal_fails_closed.log` |
| 22-b7 | `cargo test --manifest-path src-tauri/Cargo.toml terminal_binding_mismatch_matrix_fails_closed -- --nocapture` | 0 | 1 passed, 65 filtered | `20-synthetic-rehearsal/22-terminal_binding_mismatch_matrix_fails_closed.log` |
| 23 | `env NODE_ENV=test npx vitest run tests/r8-native-migration-sql-parity.test.ts tests/r8-production-schema-authority.test.ts --reporter=verbose` | 0 | 2 files passed；27 tests passed | `20-synthetic-rehearsal/23-ts-boundary.log` |
| 31 | `shasum -a 256 "$P"; stat -f "dev=%d inode=%i size=%z mtime=%m" "$P"; ls -la@ "$D"` | 0 | 采集执行前指纹 | `30-real-readonly/31-pre-fingerprint.log` |
| 32 | `sqlite3 "file:$P?mode=ro&immutable=1" "PRAGMA user_version; PRAGMA integrity_check; PRAGMA foreign_key_check; SELECT version FROM schema_migrations ORDER BY 1; SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY 1;"` | 0 | `3`、`ok`、FK 空、迁移 1..3；20 表 + 13 索引 | `30-real-readonly/32-readonly-schema-integrity.log` |
| 33 | `sqlite3 "file:$P?mode=ro&immutable=1" ".schema"` | 0 | 真实 V3 结构文本（仅结构） | `30-real-readonly/33-schema.log` |
| 33-diff | `python3 -I evidence/r9-rehearsal-20261022/30-real-readonly/driver_r9_schema_diff.py "$(pwd)" evidence/r9-rehearsal-20261022/30-real-readonly/33-schema.log evidence/r9-rehearsal-20261022/30-real-readonly/33-schema-diff.json` | 0 | `differencesVs003=0`；`differencesVsV3SchemaJson=0` | `30-real-readonly/33-schema-diff-command.log`、`33-schema-diff.json`、`33-schema-diff.md` |
| 34 | `sqlite3 "file:$P?mode=ro&immutable=1" "select 'debts',count(*) from debts union all ... union all select 'debt_revisions',count(*) from debt_revisions;"`（任务书原文 8 表） | 0 | 5/1/4/4/1/1/10/0 | `30-real-readonly/34-rowcounts-aggregates.log` |
| 34 | `sqlite3 "file:$P?mode=ro&immutable=1" "select period_month, round(sum(cast(current_balance as real)),2), round(sum(cast(coalesce(current_month_due,'0') as real)),2), count(*) from debt_period_facts group by period_month order by 1;"` | 0 | 2026-10 `172579.53/14518.73/5`；2026-11 `157228.31/8851.03/5` | 同上 |
| 35 | `shasum -a 256 "$P"; stat -f "dev=%d inode=%i size=%z mtime=%m" "$P"; ls -la@ "$D"` | 0 | 与 31 逐字相同 | `30-real-readonly/35-post-fingerprint.log` |
| 35-diff | `diff 31-pre-fingerprint.log 35-post-fingerprint.log` | 0 | 无输出 | `30-real-readonly/35-fingerprint-diff.log` |
| 41 | `python3 -I evidence/r9-rehearsal-20261022/40-reconciliation/driver_r9_verify_reconciliation_sql.py "$(pwd)"` | 0 | `RESULT=PASS`；C5-1 命中 `e2,e3,e4`；C5-2 命中 `e5`；C4 合成库 `user_version=8`、迁移 1..8、`ok`、FK 0、无 sidecar | `40-reconciliation/41-synthetic-sql-verification.log` |

## 4. 测试数量：R8 最终状态 → 本次

| 套件 | R8（含 `93db676` 后修复批次） | R9-01 本次 | 变化 |
|---|---|---|---|
| Vitest | 442 passed, 80 skipped（522）；44 passed + 1 skipped files | 442 passed, 80 skipped（522）；44 passed + 1 skipped files | 0 |
| Cargo | 66 passed, 0 failed | 66 passed, 0 failed | 0 |
| Python V8 gate | 47 tests OK | 47 tests OK | 0 |
| Python V4 gate | 40 tests OK | 40 tests OK | 0 |
| Gate wiring integration | 5 tests OK | 5 tests OK | 0 |
| Unified synthetic contract | 5 tests OK | 5 tests OK | 0 |
| Unified R2B recovery | 既有 setup 错误，Ran 0 | 既有 setup 错误，Ran 0 | 0（如实标注，非通过） |

数量无下降，无新增失败。

## 5. 候选包哈希核对

`A="src-tauri/target/release/bundle/macos/小钱家.app/Contents"`

| 对象 | 期望值 | 实测值 | 结论 |
|---|---|---|---|
| 可执行文件 | `444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c` | `444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c` | 一致 |
| `Info.plist` | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb` | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb` | 一致 |
| 包内 `runtime-compatibility.json` | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509` | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509` | 一致 |
| 源 `src-tauri/runtime-compatibility.json` | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509` | `f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509` | 一致（与包内相同） |
| DMG | `ebb93b4a29647f1bc9bba543fe2834e4d3e12da1b7d1200028b66a47683d98f6` | `ebb93b4a29647f1bc9bba543fe2834e4d3e12da1b7d1200028b66a47683d98f6` | 一致 |

未重建、未覆盖候选包。

## 6. R9-03 真实库只读指纹与 schema 差异

路径：`$HOME/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`；
只读访问方式：`sqlite3 "file:$P?mode=ro&immutable=1"`，从未裸开、从未复制该库。

| 项目 | 执行前（31） | 执行后（35） | 判定 |
|---|---|---|---|
| SHA-256 | `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc` | 同左 | 相同 |
| dev | `16777232` | `16777232` | 相同 |
| inode | `30715175` | `30715175` | 相同 |
| size | `229376` | `229376` | 相同 |
| mtime epoch | `1792594937` | `1792594937` | 相同 |
| 目录清单 | `maintenance.lock`（0）、`personal-finance-console.sqlite3`（229376）、`personal-finance-console.sqlite3.v8-quarantined`（348160） | 同左 | 相同 |
| `diff` 31 vs 35 | — | — | 退出 0，无输出 |

只读查询结果：`user_version=3`；`integrity_check=ok`；`foreign_key_check` 无输出；`schema_migrations` = 1,2,3；
表 20、索引 13。行数：debts 5、profiles 1、assets 4、cash_accounts 4、income_records 1、expense_records 1、
debt_period_facts 10、debt_revisions 0。聚合：2026-10 余额 172579.53 / 应还 14518.73 / 5 笔；
2026-11 余额 157228.31 / 应还 8851.03 / 5 笔。全部与任务书给定期望一致。

Schema 差异分类（详见 `30-real-readonly/33-schema-diff.md`）：

| 分类 | 条数 | 说明 |
|---|---|---|
| `不影响 V3→V8` | 33（20 表 + 13 索引） | 与 `003-bootstrap.sql` 及 `migrations/v3-schema.json` 的表/列/类型/NOT NULL/DEFAULT/PK/FK/索引/规范化 DDL 全部一致 |
| `可能导致迁移失败` | 0 | 无 |
| `未知` | 0 | 无 |

真实库中不存在 `accounts`、`expense_categories`、`expenses`、`import_batches`、`income_entries`、
`fixed_expense_plans`，符合 `005.sql`–`008.sql` 纯 DDL 新建的预期，不构成差异。未把真实库作为任何迁移程序输入。

## 7. 剩余风险与未决项

1. **R9-04 取证来源需审核员知悉（已披露，不隐瞒）**：任务书要求 SQL 在 R9-02(b) 产生的合成 V8 库上执行；
   但该原生测试在 `src-tauri/src/lib.rs:2745` 自行 `remove_dir_all` 删除夹具，测试结束后不留库。
   因此 R9-04 改为用同一已提交链（`003-bootstrap.sql` → `004`…`008`）重建等价的合成 V8 库，并仅在该临时库上验证。
   合成库的 schema 身份由 `22-native_*.log` 与 `tests/r8-native-migration-sql-parity.test.ts` 锚定。
   需要说明的差异：提交的 `004`–`008.sql` 只做 DDL 与 `PRAGMA user_version`，不写 `schema_migrations` 行；
   原生 migrator 自行写 4..8。合成重建因此**仅在临时库内**补写 `schema_migrations(4..8)`，不涉及真实库或提交文件。
   结论（语法、表名、列名、判定语义可执行）成立，但“逐字节同于 (b) 夹具”不成立。
2. **既有测试副作用会污染已提交证据文件**：R9-01 的 `cargo test` 会由
   `src-tauri/src/startup_exclusion.rs:154` 重写
   `evidence/wp04-release-cutover-readiness/53-r2c3c1-production-durable-terminal/12-regression/STARTUP_EXCLUSION_RACE_MATRIX.json`。
   本次差异仅为 50 轮竞态中 `migration_acquired`/`ui_acquired` 的非确定性互换，所有 `double_win=false`。
   已把差异保存为 `10-baseline/99-unexpected-worktree-write.diff`，并用 `git restore` 将该文件恢复到 HEAD，
   工作区回到开工状态。**该测试每次运行都会再次产生此改动**，属既有缺陷，建议审核员另行决定是否修复；
   本次未修改源码、未提交。
3. **R2B recovery 仍是既有 setup 错误**：`Ran 0 tests`，未修复、未计为通过。
4. **V2/V1 账本既有缺口（OPEN 1–3）**：`income_entries` 无 V1 镜像；`deleteV2Expense()` 不删 `expense_records` 镜像；
   V2 独有表无 V1 对应。迁移不改变这些行为，本次只记录，未新增镜像/触发器/迁移语句。
5. **R9-04 是规格而非执行结果**：`POST_MIGRATION_CHECKS.md` 为 `SPEC_ONLY`，真实数值比对必须在审核员单独批准的
   真实迁移后执行；本次未做真实迁移，未产生真实迁移后数据。
6. **真实库目录内存在 `personal-finance-console.sqlite3.v8-quarantined`**（348160 字节）：本次只读列举，未触碰、
   未删除、未移动；其去留由审核员裁决。
7. **日志标注说明**：`20-synthetic-rehearsal/` 与 `40-reconciliation/` 产物均为 `SYNTHETIC_ONLY`；
   `30-real-readonly/` 为真实库只读原始捕获，内容仅含任务书允许的哈希、版本、行数、聚合、表/列名，
   未包含任何业务明细行，本回执将其明确标记为 `REAL_READ_ONLY`，未伪标为合成数据。

## 8. 最终 `git status --short`

```text
?? .claude/
?? evidence/r9-rehearsal-20261022/
?? pelican-bicycle-animation.html
?? pelican-bicycle.html
?? pelican-bike-ride.html
?? pelican-bike.html
?? pelican-cycling.html
```

无已跟踪文件改动；无 `git add` / `commit` / `push`。

## 9. 生产写入四项标志

```text
REAL_PRODUCTION_DATABASE_WRITTEN = false
REAL_PRODUCTION_IDENTITY_LAUNCHED = false
REAL_PRODUCTION_PERMIT_CREATED_OR_CONSUMED = false
REAL_PRODUCTION_TERMINAL_CREATED = false
```

证据：R9-03 执行前后真实库 SHA-256、dev、inode、size、mtime 与目录清单逐字相同（`31`/`35`/`35-diff`）；
全程未启动 `com.personalfinance.console`，未复制候选包到 `/Applications`，未运行 `--pfc-internal-v8-migrate`；
所有 gate 演练均使用 `tempfile.mkdtemp` 合成根并在结束时删除（`21*`、`41`）；
未创建或消费任何真实 permit / terminal / ledger / receipt。
