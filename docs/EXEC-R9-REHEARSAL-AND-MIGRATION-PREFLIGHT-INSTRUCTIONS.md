# EXEC-R9 迁移演练与真实库只读 Preflight 任务书

发布方：审核员/架构方。执行方：执行员。
前置事实：R8 代码批提交 `93db676`；候选包身份记录提交 `e75d7ec`；生产库仍为 v3。
本任务**不授权**真实迁移、启动生产身份、替换 /Applications、创建 permit/terminal/ledger/receipt。真实迁移须另发审批包（R8 任务书 §6）。

## 0. 红线（任一触发立即停止并返回 R9_BLOCKED，不得自行绕过）

1. 不得写入、移动、重命名、删除 `~/Library/Application Support/com.personalfinance.console/` 下任何文件。真实库只允许只读打开（见 R9-03 的精确命令）。
2. 不得启动 `com.personalfinance.console` 生产身份；不得把候选包复制到 /Applications；不得运行 `--pfc-internal-v8-migrate`。
3. 不得创建或消费任何真实 permit / terminal / ledger / receipt。
4. 不得 `git add` / `commit` / `push`。证据只写入新目录，由审核员决定是否提交。
5. 不得修改 `src/`、`src-tauri/`、`migrations/`、`scripts/`、`tests/` 下任何已提交文件。发现缺陷只记录并返回。
6. 真实库内容不得复制进仓库、证据目录或 fixture。证据里只允许出现：SHA-256、版本号、行数、聚合金额、表/列名、债务 ID。迁移演练只用合成数据。
7. 所有日志、hash、截图标注 `SYNTHETIC_ONLY` 或 `ISOLATED_CANDIDATE`。
8. 不得使用 `sudo`、不得关闭 SIP/Gatekeeper、不得改系统时间。

## 1. 开工检查（任一不满足即 R9_BLOCKED）

仓库根：`/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2`

```bash
git rev-parse HEAD            # 必须是 e75d7ec... 或其后代；git merge-base --is-ancestor e75d7ec HEAD 必须成功
git status --short            # 除 .claude/ pelican-*.html docs/EXEC-R9-*.md 及新证据目录外，不得有任何改动
mkdir -p evidence/r9-rehearsal-20261022/{10-baseline,20-synthetic-rehearsal,30-real-readonly,40-reconciliation}
```

命名规则：每条命令的 stdout+stderr 存 `<序号>-<名称>.log`，退出码存同名 `.exit`（内容形如 `exit=0`）。

## 2. 任务

### R9-01 基线复跑与候选包哈希核对

工作目录：仓库根。逐条执行，日志存 `evidence/r9-rehearsal-20261022/10-baseline/`。

| # | 命令 | 期望 |
|---|---|---|
| 01 | `npx vitest run` | 44 files passed + 1 skipped，442 passed / 80 skipped，数量不得减少 |
| 02 | `npm run typecheck` | 干净 |
| 03 | `npm run lint` | 125 files，无 fix |
| 04 | `cargo test --manifest-path src-tauri/Cargo.toml` | 66 passed, 0 failed |
| 05 | `python3 -I scripts/test_production_v8_release_gate.py -v` | 47 tests OK |
| 06 | `python3 -I scripts/test_production_v4_release_gate.py -v` | 40 tests OK |
| 07 | `python3 -I scripts/test_production_gate_wiring_integration.py -v` | 5 tests OK |
| 08 | `python3 scripts/test_unified_synthetic_contract.py -v` | 5 tests OK |
| 09 | `git diff --check` | 无输出 |

`python3 scripts/test_unified_r2b_recovery.py -v` 是既有 setup 错误（Ran 0 tests）。如实复跑并记录，不得写成通过，也不得尝试修复。

候选包哈希核对（只读，不启动）：

```bash
A="src-tauri/target/release/bundle/macos/小钱家.app/Contents"
shasum -a 256 "$A/MacOS/personal-finance-console" "$A/Info.plist" "$A/Resources/runtime-compatibility.json" src-tauri/runtime-compatibility.json src-tauri/target/release/bundle/dmg/小钱家_0.1.0_aarch64.dmg
```

期望值（来自 `evidence/r8-production-v8-20261022/70-rebuild-post-commit-93db676/BUILD_IDENTITY.json`）：

- executable `444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c`
- Info.plist `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb`
- manifest（包内与源，两处必须相同）`f98b7f7bab5161e8c0c6bb93571ac8ce658c20d81785fc5651ac37f2f9c3d509`
- DMG `ebb93b4a29647f1bc9bba543fe2834e4d3e12da1b7d1200028b66a47683d98f6`

任一不一致：不得重建覆盖，直接 R9_BLOCKED 并报告实际值。

### R9-02 合成 V3→V8 隔离演练

重要约束（已核实源码）：`scripts/production_v8_release_gate.py` 在合成模式下**不会**启动候选可执行文件；`run_gate` 在 `synthetic_fixture_root` 非空且 `native_runner` 为 None 时直接抛 `Synthetic migrate mode requires an explicit native verification runner`（约第 1381 行）。因此命令行 `migrate --synthetic-root` 必然被拒，**禁止**为了让它通过而去启动真实可执行文件或改 gate。演练分三层，各自独立取证：

**(a) Gate preflight（合成根，经 gate 自身的测试夹具）**

不得自造夹具。以 `scripts/test_production_v8_release_gate.py` 的 `setUp`（约第 30-85 行）为唯一构造依据：在 `tempfile.mkdtemp(prefix="pfc-r9-synthetic-")` 下建 `Applications/小钱家.app/...`、`Library/Application Support/com.personalfinance.console/`、固定备份目录、v3 合成库（`schema_migrations` 1,2,3 + `PRAGMA user_version=3`），并写入内容逐字节等于 `PFC_WP04R2A_GATE_SYNTHETIC_V1\n` 的 `SYNTHETIC_ONLY` marker（`scripts/production_v8_release_gate.py:45`，校验见 :474）。写一个**仅放在临时目录或 evidence 目录**的 Python 驱动脚本（不得放进 `scripts/`），导入 gate 模块复用同样的 approval/authorization 字段，然后：

```bash
python3 -I <driver 路径> | tee evidence/r9-rehearsal-20261022/20-synthetic-rehearsal/21-gate-preflight.log
```

必须记录：preflight 返回 `PREFLIGHT_PASS`；`sidecarsAbsent=true`；receipt 内 `syntheticOnly=true`；合成根不在真实 app-data、/Applications、仓库 `src-tauri/target` 之下。再做三项负向：篡改合成 executable 一个字节、替换备份文件、在 app-data 放一个 `-wal` 文件，三者各自必须被 gate 拒绝（`BLOCKED`，退出码 2），并记录拒绝原因文本。

**(b) Native V3→V8（真实 Rust 迁移代码，临时库）**

```bash
cargo test --manifest-path src-tauri/Cargo.toml native_v3_to_v8_full_schema_fixture_migration_is_isolated -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml native_migration8_rejects_inconsistent_v3_source_history -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml verified_v8_restart_does_not_replay_migration_and_reply_loss_keeps_terminal -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml preterminal_process_exit_and_terminal_write_failures_remain_blocked -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml child_process_exits_after_commit_before_terminal_and_restart_is_blocked -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml corrupt_or_stale_terminal_fails_closed -- --nocapture
cargo test --manifest-path src-tauri/Cargo.toml terminal_binding_mismatch_matrix_fails_closed -- --nocapture
```

每条日志存 `20-synthetic-rehearsal/22-<测试名>.log`。从第一条的 JSON 输出摘录并列表：`sourceSchema(3/3)`、`targetSchema(8/8)`、`migrationRows=[1..8]`、`integrityCheck=ok`、`foreignKeyViolationCount=0`、`sidecarsAbsent=true`、源/目标 SHA-256。若某测试名在当前代码中不存在，记录并改用 `cargo test --manifest-path src-tauri/Cargo.toml -- --list` 找到同名语义测试，禁止跳过不报。

**(c) TS 层边界**

```bash
env NODE_ENV=test npx vitest run tests/r8-native-migration-sql-parity.test.ts tests/r8-production-schema-authority.test.ts --reporter=verbose
```

期望 2 files / 27 tests passed。日志存 `23-ts-boundary.log`。

(a)(b)(c) 全过才算 R9-02 通过。第二次 migrate 不重复写库、已是 V8 不重复迁移，由 (b) 的 restart 与 replay 测试覆盖，不得另行手工构造。

### R9-03 真实库只读 Preflight（不迁移）

目的：给后续真实迁移审批提供事实，**不是**迁移演练。严格只读。

固定路径：

```bash
D="$HOME/Library/Application Support/com.personalfinance.console"
P="$D/personal-finance-console.sqlite3"
```

执行前基线（审核员已读到，用于比对）：user_version=3；SHA-256 `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc`；大小 229376；mtime epoch 1792594937；目录内仅 `maintenance.lock`（0 字节）、`personal-finance-console.sqlite3`、`personal-finance-console.sqlite3.v8-quarantined`（348160）。

步骤（日志存 `30-real-readonly/`）：

```bash
# 31 执行前指纹
shasum -a 256 "$P"; stat -f "dev=%d inode=%i size=%z mtime=%m" "$P"; ls -la@ "$D"
# 32 只读 schema 与完整性。必须使用 mode=ro&immutable=1，禁止裸 sqlite3 "$P"
sqlite3 "file:$P?mode=ro&immutable=1" "PRAGMA user_version; PRAGMA integrity_check; PRAGMA foreign_key_check; SELECT version FROM schema_migrations ORDER BY 1; SELECT name FROM sqlite_master WHERE type IN ('table','index') ORDER BY 1;"
# 33 只读表结构全量（供差异比对）
sqlite3 "file:$P?mode=ro&immutable=1" ".schema"
# 34 行数与聚合（只允许聚合，不得导出明细行）
sqlite3 "file:$P?mode=ro&immutable=1" "select 'debts',count(*) from debts union all select 'profiles',count(*) from profiles union all select 'assets',count(*) from assets union all select 'cash_accounts',count(*) from cash_accounts union all select 'income_records',count(*) from income_records union all select 'expense_records',count(*) from expense_records union all select 'debt_period_facts',count(*) from debt_period_facts union all select 'debt_revisions',count(*) from debt_revisions;"
sqlite3 "file:$P?mode=ro&immutable=1" "select period_month, round(sum(cast(current_balance as real)),2), round(sum(cast(coalesce(current_month_due,'0') as real)),2), count(*) from debt_period_facts group by period_month order by 1;"
# 35 执行后指纹，必须与 31 逐字相同
shasum -a 256 "$P"; stat -f "dev=%d inode=%i size=%z mtime=%m" "$P"; ls -la@ "$D"
```

审核员已读到的期望：5 debts / 1 profile / 4 assets / 4 cash_accounts / 1 income_records / 1 expense_records / 10 debt_period_facts / 0 debt_revisions；2026-10 合计余额 172579.53、当月应还 14518.73（5 笔）；2026-11 合计余额 157228.31、当月应还 8851.03（5 笔）。与此不符不是失败，但必须逐项记录差异并写入回执，由审核员裁决。

差异比对：将步骤 33 的真实库 schema 与 `migrations/003-bootstrap.sql` 以及 `migrations/v3-schema.json` 做表/列/类型/约束/索引逐项对比，输出 `33-schema-diff.md`，每条差异分类为 `不影响 V3→V8` / `可能导致迁移失败` / `未知`，并给出依据（引用 `migrations/005.sql`–`008.sql` 或 `native_migration8` 中的具体语句）。**严禁**用真实库作为迁移程序输入，也不得复制该库到任何位置。

### R9-04 迁移后对账规格（只出规格，不做真实迁移）

输出 `evidence/r9-rehearsal-20261022/40-reconciliation/POST_MIGRATION_CHECKS.md`，内含可直接 `sqlite3` 执行的 SQL 与期望值。必须使用真实列名（金额列是 TEXT，聚合需 `cast(... as real)`）：

- 表结构依据：`debts(id, profile_id, name, fixed_monthly_payment, active, created_at)`；`debt_period_facts(id, debt_id, period_month, as_of_date, current_balance, current_month_due, created_at, UNIQUE(debt_id, period_month))`。
- C1 债务 ID 不丢失、不重复：5 条，ID 精确为 `5f50bd18-7b79-49aa-a0da-fa8a19555a69`（浦发车贷）、`6ab6256a-fe7b-450b-9853-f55c8402f92b`（招商分期）、`a1ff0b1a-2a5f-4980-a058-9af7bf79249b`（京东白条）、`c7fa0eae-c78a-4d0d-8031-bbf80c523d23`（花呗）、`2a6a027d-806d-44f8-92e0-131f78c6d14b`（美团月付）。
- C2 2026-11 合计 `current_balance`=157228.31，`current_month_due` 合计=8851.03，5 笔；2026-10 为 172579.53 / 14518.73，5 笔。
- C3 逐表行数迁移前后一致：debts 5、profiles 1、assets 4、cash_accounts 4、income_records 1、expense_records 1、debt_period_facts 10、debt_revisions 0；其余 V3 既有表（asset_revisions、asset_value_snapshots、cash_account_revisions、cash_balance_snapshots、essential_expense_*、financial_settings、planning_income_revisions、settings_revisions、app_metadata）同样要求迁移前后行数相等。V5–V8 新增表单独列出，不参与相等性。
- C4 V8 结构：`user_version=8`；`schema_migrations` 恰为 1..8；`integrity_check=ok`；`foreign_key_check` 为空；无 `-wal/-shm/-journal`。
- C5 V2/V1 双账本同步（**审核员已核实源码，表名与规则以此为准，执行员不得自行推断**）：

  账本归属（只读源码依据）：

  - V2 账本表由 `migrations/005.sql`–`008.sql` 创建：`accounts`、`expense_categories`（005）；`expenses`、`import_batches`（006，007 为 `expenses` 去重唯一索引）；`income_entries`、`fixed_expense_plans`（008）。这些表在真实库当前 V3 中**不存在**，由 V3→V8 迁移以纯 DDL 创建，无播种数据。
  - V1 账本表来自 `migrations/003-bootstrap.sql`：`expense_records`、`income_records`、`planning_income_revisions` 等（`planning_income_month_revisions`、`actual_income_revisions` 是 V4 新增表，不属于 V3 既有账本；真实 V3 库中只有 `planning_income_revisions`）。`cash_accounts`、`cash_balance_snapshots`、`debts`、`debt_period_facts`、`assets` 等是两侧共用的模型表，**不属于**双账本同步范围。
  - 唯一实际实现的 V1↔V2 同步是**现金支出 `CASH_DEBIT` 单向双写**：
    - 写入点：`src/persistence/repositories.ts:1807` `createV2ExpenseWithLegacyMirror()`；CSV 导入在 `writeImportBatchAtomically()`（`repositories.ts:1948`，镜像段约 2006–2020）以同一规则在**同一事务**内写 `expense_records`。
    - 映射（同 `id`）：`amount` 等值；`occurred_at = <occurred_on>T00:00:00.000Z`；`business_date = occurred_on`；`kind='VARIABLE'`；`category='OTHER_VARIABLE'`；`note = description`（空串转 NULL）；`created_at` 相同。
    - 信用卡支出（`CREDIT_ONE_TIME` / `CREDIT_INSTALLMENT`）**按设计不镜像**，见 `tests/v2-ledger/ledger-sync.test.ts:208` 起的断言。
    - 应用层读回校验：`src/application/v2-expense-service.ts:188` 起，镜像不一致即抛 `EXPENSE_READBACK_FAILED`。

  对账 SQL（在 V8 库上执行；返回 0 行即一致。金额列为 TEXT，故用 `cast(... as real)`）：

  ```sql
  -- C5-1 每笔 V2 现金支出必须有字段一致的 V1 镜像（期望 0 行）
  SELECT e.id
  FROM expenses e
  LEFT JOIN expense_records r ON r.id = e.id
  WHERE e.kind = 'CASH_DEBIT'
    AND (r.id IS NULL
      OR cast(r.amount as real) <> cast(e.amount as real)
      OR r.occurred_at <> e.occurred_on || 'T00:00:00.000Z'
      OR r.business_date <> e.occurred_on
      OR r.kind <> 'VARIABLE'
      OR r.category <> 'OTHER_VARIABLE'
      OR coalesce(r.note, '') <> e.description);

  -- C5-2 V2 信用卡支出不得产生 V1 镜像（期望 0 行）
  SELECT e.id
  FROM expenses e
  JOIN expense_records r ON r.id = e.id
  WHERE e.kind IN ('CREDIT_ONE_TIME','CREDIT_INSTALLMENT');
  ```

  审核员已在临时合成 V8 库（依次执行 `003-bootstrap.sql`–`008.sql`，仅合成数据）上验证：两条 SQL 语法可执行，且分别对「缺失镜像」「`note` 被篡改」「`business_date` 被篡改」「信用卡支出产生镜像」精确命中，对合法镜像和 V1 历史记录不误报。执行员仍须在 R9-02(b) 的合成 V8 库上自行复跑取证，不得引用本句替代。

  说明：`expense_records` 中可能存在 V2 之前的 V1 历史记录，它们**没有** V2 对应行，属于正常状态。**禁止**做「V1 每一行都要在 V2 找到对应」的反向相等检查，也不得把历史行误判为迁移差异。

  **OPEN（既有设计缺口，非迁移引入；执行员只记录，不修复）：**

  - `OPEN 1`：V2 收入 `income_entries` 到 V1 `income_records` **没有任何镜像实现**。`recordIncomeEntry()`（`src/application/v2-expense-service.ts:319`）只写 `income_entries`，`src/` 全量检索无 `income_records` 写入。因此**不存在**「两侧收入逐笔相等」的可校验项。只可记录以下信息性数字，**不得**据此判定迁移失败：
    ```sql
    SELECT (SELECT count(*) FROM income_entries) AS v2_income_rows,
           (SELECT count(*) FROM income_records) AS v1_income_rows,
           (SELECT count(*) FROM income_entries i JOIN income_records r ON r.id = i.id) AS shared_ids;
    ```
  - `OPEN 2`：`deleteV2Expense()`（`repositories.ts:1934`）只删除 `expenses`，不删除 `expense_records` 镜像。迁移不改变该行为，不做补偿。
  - `OPEN 3`：`accounts`、`expense_categories`、`import_batches`、`income_entries`、`fixed_expense_plans` 在 V1 无对应表，不设跨账本一致性要求。

  执行员**禁止**为消除上述 OPEN 项而新增镜像、触发器、迁移语句，或修改 `src/`、`migrations/`、`tests/`。只在 `40-reconciliation/` 记录事实并向审核员报告。

SQL 必须在 R9-02(b) 产生的**合成 V8 库**上证明语法与表名可运行：用临时副本跑 SQL，对合成数据可返回 0 行或合成值，只证明可执行，不证明真实数值；真实数值的比对留给真实迁移后。合成库不得写入证据目录。

## 3. 回执

`evidence/r9-rehearsal-20261022/RECEIPT.md`，按顺序：

1. 状态：`R9_PASS` 或 `R9_BLOCKED`（含原因）。
2. R9-01…R9-04 各自 PASS/BLOCKED 与证据文件路径。
3. 所有命令的「序号 / 完整命令 / 退出码 / 结果摘要 / 日志路径」表。
4. 测试数量：R8 基线 → 本次，逐项。
5. 候选包四个哈希的期望值 vs 实测值。
6. R9-03 的执行前后指纹对照（SHA-256、dev、inode、size、mtime、目录清单）和 schema 差异分类表。
7. 剩余风险与未决项。
8. `git status --short` 输出。
9. 下面四行，值必须是 `false`，且有证据支撑：

```text
REAL_PRODUCTION_DATABASE_WRITTEN = false
REAL_PRODUCTION_IDENTITY_LAUNCHED = false
REAL_PRODUCTION_PERMIT_CREATED_OR_CONSUMED = false
REAL_PRODUCTION_TERMINAL_CREATED = false
```

禁止出现「生产已迁移 / 生产已恢复 / 可启动生产」等字样，也不得把合成演练结果写成真实生产结果。

## 4. 返回条件（R9_BLOCKED）

红线触发；开工检查失败；候选包任一哈希不符；任一测试数量下降或失败（R2B recovery 既有 setup 错误除外，须如实标注）；R9-03 执行前后指纹不一致；R9-03 出现「可能导致迁移失败」或「未知」类差异；需要修改已提交文件才能继续。返回时停止全部后续步骤，附完整原因，等待审核员裁决。
