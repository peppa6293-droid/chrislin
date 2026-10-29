# R11 真数重播回执

执行依据：`docs/EXEC-R11-REALDATA-REPLAY-INSTRUCTIONS.md`
角色：执行员（按 §1 写入、§2 回读；未改代码/生产包/备份/隔离库）
执行日期：2026-10-22
结论状态：**R11_BLOCKED**

---

## 0. 结论摘要

- 写入本身成功，且严格限于任务书 §1 的七张表：目标表与隔离库逐行一致，非目标表全部未变，债务与记账表未动。
- §2 的六项锚点中，**前五项用只读 SQL 计算全部对上**（收入 13,791.25 / 经常性 12,791.25 / 账户现金 5,325.93 / 安全资源 25,325.93 / 预留 3,800.00 / 自由现金 21,525.93 / 固定计划 5,076.31 / 2026-11 核心义务 13,927.34 / 债务 5 笔、157,228.31、8,851.03）。
- **第六项失败：写入后 App 无法启动。** 直接执行生产包二进制，启动门闸在 Builder 之前 panic：
  `PRODUCTION_TERMINAL_INTEGRITY_INVALID: PRODUCTION_INTEGRITY_STATE_CONTENT_MISMATCH`（`src/lib.rs:2116:14`，退出码 101）。
- 因此界面回读无法进行，本次不能出 `R11_PASS`。按红线「保留现场、停手、先报告」，**未回滚、未改完整性状态、未改 terminal/receipt/permit**。
- 另有一项在启动前就发现的界面口径冲突：收入行是 **2026-09**，而 App 仪表盘默认月份是 **2026-10**，按严格按月过滤，界面收入会显示 **0.00**，不可能读出 13,791.25。见 §4.2。

---

## 1. 回执（§5 格式）

```text
R11_BLOCKED

写入前库哈希：  319907d68dafd513a2ebed758d469a066793735677a1a462d034ea7b88b192a3
写入后库哈希：  bb077455bdc5234a118ef07acef83c36261344277ca378f93d4e098664405789

备份 SHA-256（主/副）：
  主：319907d68dafd513a2ebed758d469a066793735677a1a462d034ea7b88b192a3
      ~/Library/Application Support/com.personalfinance.console/production-v8-backups/personal-finance-console.sqlite3.r11-pre-replay-20261022
  副：319907d68dafd513a2ebed758d469a066793735677a1a462d034ea7b88b192a3
      ~/Documents/pfc-r11-replay-backup-20261022/personal-finance-console.sqlite3

§2 锚点逐项对照：
  1. 收入 13,791.25 / 经常性 12,791.25 / 含一次性收入徽标
     SQL：一致（2026-09 两行，合计 13,791.25，经常性 12,791.25，一次性 1 行）
     界面：未验证（App 无法启动）；且默认 2026-10 月份下预期为 0.00
  2. 账户现金 5,325.93
     SQL：一致（2026-10-21 与 2026-10-31 均为 5,325.93）
     界面：未验证（App 无法启动）
  3. 安全资源 25,325.93 / 预留 3,800.00 / 自由现金 21,525.93
     SQL：一致（2026-10-21 与 2026-10-31 均为 25,325.93 / 3,800.00 / 21,525.93）
     界面：未验证（App 无法启动；V2 仪表盘是否直接展示该三项亦未确认）
  4. 固定计划合计 5,076.31；2026-11 核心义务 13,927.34
     SQL：一致（计划 5,076.31 + 债供 8,851.03 = 13,927.34）
     界面：未验证（App 无法启动）
  5. 债务不变：5 笔、2026-11 余额 157,228.31、当月应还 8,851.03
     SQL：一致（5 / 157,228.31 / 8,851.03）
  6. App 启动正常、无门闸报错
     失败：启动门闸 panic，退出码 101
     PRODUCTION_TERMINAL_INTEGRITY_INVALID: PRODUCTION_INTEGRITY_STATE_CONTENT_MISMATCH

界面读数截图路径：无。App 未进入主界面，没有可截的产品界面；为避免把无关桌面窗口截入仓库，已删除失败启动时的整屏截图。
  失败启动日志：50-launch/50-pre-launch.log、52-exec-stdout.log、53-exec-stderr.log

异常/偏差：
  1) 启动门闸内容校验失败（阻塞项，见 §2）。
  2) 收入行月份 2026-09 与仪表盘默认月份 2026-10 不一致，界面收入预期为 0.00（见 §4.2）。
  3) 任务书 §3.4 建议「直接 SQL（与播种/迁移同模式）」，但该方式与 V8 启动门闸的内容摘要校验不兼容。
```

---

## 2. 启动门闸失败（阻塞项）

### 2.1 现象

写入完成后：

- `open "/Applications/Personal Finance Console.app"` 返回成功，但进程立即消失，`pgrep` 无匹配。
- `open -W` 报 `Unable to block on application (GetProcessPID() returned 18446744073709551016)`。
- 直接执行包内二进制，10 秒内退出，退出码 **101**。
- stdout 为空；stderr：

```text
thread 'main' (72375623) panicked at src/lib.rs:2116:14:
Production durable cutover terminal check failed before Builder: "PRODUCTION_TERMINAL_INTEGRITY_INVALID: PRODUCTION_INTEGRITY_STATE_CONTENT_MISMATCH"
note: run with `RUST_BACKTRACE=1` environment variable to display a backtrace
```

证据：`50-launch/53-exec-stderr.log`、`50-launch/50-pre-launch.log`。

### 2.2 关键对照

| 项 | 写入前（备份） | 写入后（生产） |
|---|---|---|
| 库 SHA-256 | `319907d6…` | `bb077455…` |
| `production_integrity_state.sequence` | 3 | 3 |
| `production_integrity_state.previous_digest` | `7daca8df…a6ab` | `7daca8df…a6ab` |
| `production_integrity_state.content_digest` | `50e6a032…b801` | `50e6a032…b801` |
| `production_integrity_state.tag` | `1049713e…fa67` | `1049713e…fa67` |
| `PRAGMA integrity_check` | ok | ok |
| `user_version` | 8 | 8 |

证据：`40-readback/41-db-diff.log`、`50-launch/54-post-attempt-state.log`。

直接证据指向：本次按任务书写入改变了库内容，但 `production_integrity_state.content_digest` 仍是写入前的值；启动门闸按该摘要校验内容，判定 `CONTENT_MISMATCH`。这不是行数据错误，而是「绕过应用写路径直接改库」与「V8 启动门闸」的机制冲突。

本任务红线明确不研究门闸/terminal 内部实现，因此未进一步推导摘要算法，也未尝试手改 `production_integrity_state` 或 terminal 文件来「修好」启动。

---

## 3. 写入范围与数据核对

### 3.1 写入对象

- SQL 稿：`30-write/31-replay.sql`，SHA-256 `9d442e4e97a8155df360dd1d305550d7b7c4256eb2e33f90c14bd18c9d498f16`
- 执行：单事务 `BEGIN IMMEDIATE`，`PRAGMA foreign_keys=ON`，写入退出码 0
- 写入前后均无 App 进程在运行；无 `-wal/-shm/-journal`

### 3.2 目标表与隔离库逐行一致

| 表 | 结果 |
|---|---|
| `cash_accounts` | MATCH |
| `cash_balance_snapshots` | MATCH |
| `cash_account_lifecycle_revisions` | MATCH |
| `assets` | MATCH |
| `asset_value_snapshots` | MATCH |
| `income_entries` | MATCH |
| `fixed_expense_plans` | MATCH |

证据：`40-readback/41-db-diff.log`。

### 3.3 非目标表未动

`41-db-diff.log` 对 23 张非目标表逐一比对，全部 `UNCHANGED`，包括：

- 债务：`debts`、`debt_period_facts`、`debt_revisions`
- 记账：`expense_records`、`expenses`、`import_batches`、`expense_categories`
- V1：`income_records`、`essential_expense_items` 及其修订/快照表
- 元数据：`production_integrity_state`、`schema_migrations`、`profiles`、`financial_settings`

红线表计数复核：

```text
debts|5
debt_period_facts|10
expense_records|1
expenses|0
import_batches|0
expense_categories|6
income_records|1
essential_expense_items|3
```

### 3.4 目标表计数

| 表 | 写入前 | 写入后 |
|---|---:|---:|
| `cash_accounts` | 4 | 5 |
| `cash_balance_snapshots` | 4 | 8 |
| `cash_account_lifecycle_revisions` | 0 | 1 |
| `assets` | 4 | 5 |
| `asset_value_snapshots` | 4 | 6 |
| `income_entries` | 0 | 2 |
| `fixed_expense_plans` | 0 | 5 |

证据：`30-write/32-write.log`。

---

## 4. §2 只读 SQL 回读明细

日志：`40-readback/42-anchors-sql.log`。

### 4.1 已对上的锚点

```text
income_entries 2026-09: 2 行, 合计 13791.25, 经常性 12791.25, 一次性 1 行
账户现金 2026-10-21: 5325.93
账户现金 2026-10-31: 5325.93
安全资源 2026-10-21: 25325.93
安全资源 2026-10-31: 25325.93
预留 2026-10-21/31: 3800.00
自由现金: 21525.93
固定计划合计（effective<=2026-11-30）: 5076.31
2026-11 债供: 8851.03
2026-11 核心义务: 13927.34
债务: 5 笔; 2026-10 172579.53 / 14518.73; 2026-11 157228.31 / 8851.03
```

现金账户明细（2026-10-21）：

| 账户 | 余额 | include_in_safety | reserved | 生效状态 |
|---|---:|---:|---:|---|
| 余额宝 | 168.57 | 1 | 0.00 | active |
| 农业银行 | 5,097.04 | 1 | 3,800.00 | active |
| 上海银行 | 4.44 | 1 | 0.00 | active |
| 微信零钱 | 55.88 | 1 | 0.00 | active |
| 房租专用资金 | — | 0 | 0.00 | 2026-10-21 起 inactive（lifecycle 修订） |

资产明细（2026-10-21）：

| 资产 | 值 | kind | include_in_safety |
|---|---:|---|---:|
| 支付宝基金 | 0.00 | LIQUID_INVESTMENT | 1 |
| 证券账户 | 20,000.00 | LIQUID_INVESTMENT | 1 |
| 短期理财 1/2/3 | 10,000 / 7,000 / 3,000 | LIQUID_INVESTMENT | 0 |

### 4.2 收入月份与仪表盘月份不一致（界面偏差）

只读代码核对（未改代码）：

- 收入行按任务书写入 `period_month='2026-09'`，`occurred_at='2026-09-30'`。
- App 的 `sessionAsOfDate` 取本机当天（`src/ui/App.tsx:34`），当前为 **2026-10-22**。
- `HomeScreen` 把 `month={date.slice(0,7)}` 传给仪表盘（`src/ui/HomeScreen.tsx:306`），即 **2026-10**。
- `listIncomeEntries` 严格按 `period_month=?` 过滤（`src/persistence/repositories.ts:1182-1196`）。

因此即使门闸通过，默认仪表盘也会读 **2026-10**，收入为 **0.00**，而不是 §2 要求的 13,791.25。SQL 锚点在 **2026-09** 成立；§2 没有说明界面应切到 9 月，也没有提供生产包可用的月份切换入口。

同理，`cashAccountsAt('2026-09-30')` 会因为所有账户的 `created_at` 和快照都晚于 9 月底而返回 **0.00**；所以「9 月收入 + 9 月现金」也无法同时成立。**5,325.93 只能在 2026-10 口径下成立。**

这不是写入错误，是任务书 §1.3 的月份与 §2 的界面读数口径不一致。未改数据去凑界面，按偏差上报。

---

## 5. 当前生产状态与处置建议

### 5.1 当前状态

- 生产库：`bb077455bdc5234a118ef07acef83c36261344277ca378f93d4e098664405789`，V8，`integrity_check=ok`，`foreign_key_check` 空，无 sidecar。
- 目标数据：全部按 §1 写入，且与隔离库逐行一致。
- App：**无法启动**，启动门闸 panic，退出码 101。
- 两份 R11 备份：完好，均为 `319907d6…`，未删未改。
- 未回滚，未改完整性状态，未碰 terminal/receipt/permit，未改代码/生产包，未 git 提交。

### 5.2 建议由审核员/户主裁决

1. **恢复可用性**：用 R11 主备份或副备份恢复生产库，App 应回到写入前可启动状态（备份哈希即 A01 启动态 `319907d6…`）。恢复会撤销本次重播的数据，需明确授权。
2. **若必须保留真数**：需要一条「应用门闸认可」的写入路径（例如由应用自身写路径/受支持的迁移工具更新内容摘要），而不是直接 SQL。具体方案属审核员范围；本执行员未自行设计或实施。
3. **收入月份**：需明确仪表盘应展示 2026-09 还是 2026-10。若产品要求默认展示当月，则 §2 的「界面收入 13,791.25」需要改为「切到 2026-09 后为 13,791.25」，或调整数据月份；两者都超出本任务授权。

---

## 6. 红线遵守声明

- 只写了 §1 列出的七张目标表；债务、期事实、记账表、V1 收入/必要支出表均未动（逐表 `UNCHANGED`）。
- 未删、未改两份 R11 备份；未删、未改 `.v8-quarantined`；未读、未改 terminal/receipt/permit 文件。
- 未改 `src/`、`src-tauri/`；未重建/替换生产包。
- 未 `kill`/`killall` 应用进程；启动失败后进程自行退出。
- 未 git 提交。
- 发现启动门闸失败后按红线停手，保留现场，未自行修复。
