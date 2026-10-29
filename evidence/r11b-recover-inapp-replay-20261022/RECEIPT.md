# R11B 恢复与应用内重播回执

执行依据：`docs/EXEC-R11B-RECOVER-AND-INAPP-REPLAY.md`
角色：执行员（含屏幕操作；未改代码 / 生产包 / 两份备份 / 隔离库）
执行日期：2026-10-22
结论状态：**R11B_PASS**（F5–F7 按任务书如实挂账，属预期缺口；界面读数位置有一处偏差，见 §7）

---

## 1. 回执（任务书 §8 格式）

```text
R11B_PASS

留档副本路径 + SHA-256：
  ~/Library/Application Support/com.personalfinance.console/production-v8-backups/personal-finance-console.sqlite3.r11-written-20261022
  bb077455bdc5234a118ef07acef83c36261344277ca378f93d4e098664405789
  （size 352256，mtime 2026-10-22 20:35:39，只增未改）

恢复：覆盖前哈希 / 覆盖后哈希（应为 319907d6…）：
  bb077455bdc5234a118ef07acef83c36261344277ca378f93d4e098664405789
  / 319907d68dafd513a2ebed758d469a066793735677a1a462d034ea7b88b192a3
  （恢复源为主备份 personal-finance-console.sqlite3.r11-pre-replay-20261022，哈希 319907d6…；
    PRAGMA integrity_check=ok，user_version=8，无 sidecar）

启动验证：进入主界面 是；门闸报错 无
  - 恢复后启动：20:35:44 进入主界面，20:36:10 按 bundle id 干净退出，库哈希保持 319907d6…
  - 重播完成后再次启动：20:49:45 进入主界面，无任何门闸报错；20:51 按 bundle id 干净退出
  - 两次启动后 pgrep 均无进程，目录无 -wal/-shm/-journal

应用内重播 8 步逐步结果（操作 / 时间 / 结果）：
  1 余额宝 → 168.57        / 20:37:16–20:37:44 / 成功，toast「保存好了，金额已更新」；40-after-yuebao.png
  2 农业银行 → 5,097.04    / 20:38:39–20:38:55 / 成功；45-after-abc.png
  3 上海银行 → 4.44        / 20:39:07–20:39:14 / 成功；48-after-bosc.png
  4 新增微信零钱 55.88，纳入安全储备 / 20:39:16–20:40:14 / 成功；61-after-wechat.png
  5 房租专用资金 停用       / 20:40:20–20:40:32 / 成功，toast「账户已停用，历史记录还在」；
                                                   现金总额 5,325.93 / 4 个账户；65-after-deactivate.png
  6 新增证券账户 20,000，流动投资，纳入安全储备 / 20:41:37–20:44:44 / 成功；93-after-sec.png、94-assets-top.png
  7 支付宝基金 → 0.00      / 20:45:05–20:45:22 / 成功，toast「保存好了，金额已更新」；97-after-fund.png
  8 短期理财 1/2/3 不动     / 20:45:28 复核    / 10,000 / 7,000 / 3,000 均未变；98-assets-final.png

回读：现金 5,325.93 ／ 安全资源 25,325.93 ／ 债务 5 笔（2026-11 余额 157,228.31、当月应还 8,851.03）
      ／ income_entries 0 行 ／ fixed_expense_plans 0 行 ／ 预留 0.00
      （应用自身写路径落在修订表，快照表口径说明见 §6.2）

界面截图路径：
  evidence/r11b-recover-inapp-replay-20261022/30-inapp/
  恢复后启动：27-launch-window.png
  重播过程：36/38/40、42/43/44/45、47/48、51/55/56/59/60/61、63/65、92/93/94、95/96/97/98
  重播后总览：106-cash-page.png、107-cash-accounts-final.png
  重播后重启复核：108-relaunch-after-replay.png、109-home-scrolled-relaunch.png、
                  110-myfinance-relaunch.png、111-cash-detail-relaunch.png、
                  112-cash-summary-relaunch.png、113-safety-relaunch.png、
                  114-progress-relaunch.png、115-safety-detail-relaunch.png、
                  116-safety-reserve-relaunch.png

缺口登记确认（F5/F6/F7）：确认，按任务书 §6 如实挂账，未用任何旁路写库凑数。
  F5 V2 收入无写入口：recordIncomeEntry 零调用者，界面「本月收入记录 0 笔」，income_entries 0 行
  F6 V2 固定计划无写入口：createFixedExpensePlan 零调用者，fixed_expense_plans 0 行
  F7 账户预留额无写入口：setCashAccountReservedAmount 零调用者，reserved 合计 0.00

异常/偏差：
  1) 任务书 §5.2 写「首页」显示账户现金/安全资源；实际「今天」首页只显示“还可以安排/手头余地/
     本月要还”。账户现金 5,325.93 在「我的财务 → 现金」页核实（112），安全资源 25,325.93 在
     「进展 → 稳住现金 → 手头余地」页核实（116）。读数本身完全一致，仅展示位置不同。
  2) §5.1 写「现金快照合计」；应用自身写路径实际写入 cash_account_revisions / asset_revisions，
     cash_balance_snapshots 仍只有 2026-10-04 的 4 行旧值。按应用真实读取口径（修订表）合计为
     5,325.93，与界面一致。详见 §6.2。
  3) 余额/市值记录日为操作当日 2026-10-22（非 2026-10-21），属任务书 §4 明示的接受偏差。
  4) 操作中两次误触「高级维护」「打开现有综合维护」，均弹出「更新财务数据」对话框，已点取消，
     未录入任何数据；V1 表计数复核未变（income_records 1、essential_expense_items 3）。
  5) 重播后重启时窗口位置在屏幕外（-956,-1202），仅移动窗口后截图，不涉及数据。
```

---

## 2. R11B-1 留档与恢复

### 2.1 留档

| 项 | 值 |
|---|---|
| 路径 | `~/Library/Application Support/com.personalfinance.console/production-v8-backups/personal-finance-console.sqlite3.r11-written-20261022` |
| SHA-256 | `bb077455bdc5234a118ef07acef83c36261344277ca378f93d4e098664405789` |
| 大小 / 时间 | 352256 / 2026-10-22 20:35:39 |
| 处置 | 只增不改；2026-10-22 20:51 复核哈希未变 |

### 2.2 恢复

| 项 | 值 |
|---|---|
| 恢复源 | `production-v8-backups/personal-finance-console.sqlite3.r11-pre-replay-20261022`（SHA-256 `319907d6…`） |
| 覆盖前生产库 | `bb077455bdc5234a118ef07acef83c36261344277ca378f93d4e098664405789` |
| 覆盖后生产库 | `319907d68dafd513a2ebed758d469a066793735677a1a462d034ea7b88b192a3`（= 预期） |
| 恢复后校验 | `integrity_check=ok`；`user_version=8`；无 sidecar |
| 恢复后计数 | income_entries 0 / fixed_expense_plans 0 / cash_accounts 4 / cash_balance_snapshots 4 / assets 4 |
| 恢复后债务 | 5 笔；2026-11 余额 157,228.31、当月应还 8,851.03 |

日志：`20-archive-restore/21-archive-restore.log`。

### 2.3 恢复后启动验证

- 20:35:44 启动 `/Applications/Personal Finance Console.app`，窗口「小钱家」840×580 正常出现，无门闸报错。
- 20:36:10 按 bundle id 干净退出：`NO_PROCESS`，库哈希保持 `319907d6…`，无 sidecar。
- 日志与截图：`25-launch/26-launch.log`、`25-launch/27-launch-window.png`、`25-launch/28-quit.log`。

---

## 3. R11B-2 应用内重播（8 步）

全部通过应用界面完成，未执行任何写业务表的 SQL。值为应用界面显示值；时间取自截图文件时间。

| # | 操作 | 目标值 | 时间（2026-10-22） | 结果 | 证据 |
|---|---|---|---|---|---|
| 1 | 编辑账户「余额宝」余额 | 168.57 | 20:37:16–20:37:44 | 成功，toast「保存好了，金额已更新」 | `40-after-yuebao.png` |
| 2 | 编辑账户「农业银行」余额 | 5,097.04 | 20:38:39–20:38:55 | 成功 | `42`–`45-after-abc.png` |
| 3 | 编辑账户「上海银行」余额 | 4.44 | 20:39:07–20:39:14 | 成功 | `47`–`48-after-bosc.png` |
| 4 | 新增账户「微信零钱」55.88，计入安全储备 | 55.88 | 20:39:16–20:40:14 | 成功，显示“纳入安全储备” | `51`–`61-after-wechat.png` |
| 5 | 「房租专用资金」停用 | 停用日=当日 | 20:40:20–20:40:32 | 成功，toast「账户已停用，历史记录还在」；现金总额变为 5,325.93 / 4 个账户 | `63`、`65-after-deactivate.png` |
| 6 | 新增资产「证券账户」：流动投资、计入安全资源、市值 20,000.00 | 20,000.00 | 20:41:37–20:44:44 | 成功；资产总额 43,842.00（含支付宝基金原值 3,842） | `92-sec-ready.png`、`93-after-sec.png`、`94-assets-top.png` |
| 7 | 编辑资产「支付宝基金」市值 | 0.00 | 20:45:05–20:45:22 | 成功；资产总额变为 40,000.00 | `95`–`97-after-fund.png`、`98-assets-final.png` |
| 8 | 短期理财 1/2/3 不动 | — | 20:45:28 复核 | 10,000 / 7,000 / 3,000 未变 | `98-assets-final.png` |

界面读数（重播完成后）：

- 现金账户总额 **¥5,325.93**，4 个账户：农业银行 5,097.04、微信零钱 55.88、上海银行 4.44、余额宝 168.57（`107`、`112`）。
- 资产总额 **¥40,000.00**，5 项：证券账户 20,000、短期理财 1/2/3 10,000/7,000/3,000、支付宝基金 0.00（`98`）。
- 已经准备好的安全储备 **¥25,325.93**（`106`、`116`）。
- 债务 ¥172,579.53（5 笔），本月必须还款 ¥14,518.73（`102`、`110`）。
- 收入「本月收入记录 0 笔」——F5 预期现状。

---

## 4. 重播后重启复核

- 20:49:45 重新启动 App，直接进入主界面，**无门闸报错**（`108`、`109`）。
- 「我的财务」：资产 ¥40,000.00（5 项）、债务 ¥172,579.53（5 笔）、现金 ¥5,325.93（4 个账户）、收入 0 笔（`110`）。
- 「我的财务 → 现金」：现金账户总额 **¥5,325.93 / 4 个账户**（`112`）。
- 「进展 → 稳住现金 → 手头余地」：已经准备好的安全储备 **¥25,325.93**；安全垫 1.40/6 个月；离目标还差 ¥82,954.45（`115`、`116`）。
- 20:51 按 bundle id 干净退出：`NO_PROCESS`；库哈希 `8cfe86bcf0fa5640e49f8b720092177757ff74adf9908b1ca68172f77b8d8dd0`，退出前后一致；无 sidecar。
- 该哈希与恢复时的 `319907d6…` 不同，是应用自身写路径写入后重算的完整状态；App 能正常启动即说明启动门闸认可（这正是 R11 直插 SQL 所缺的一环）。

---

## 5. 只读 SQL 回读（权威日志 `40-readback/42-readback-final.log`）

| 锚点 | 要求 | 实测 | 结论 |
|---|---|---|---|
| 现金（修订表口径） | 5,325.93 | 5,325.93 | 一致 |
| 安全资源 | 25,325.93 | 25,325.93 | 一致 |
| 债务笔数 | 5 | 5 | 一致 |
| 2026-11 债务余额 | 157,228.31 | 157,228.31 | 一致 |
| 2026-11 当月应还 | 8,851.03 | 8,851.03 | 一致 |
| income_entries | 0 行（F5 预期） | 0 | 一致 |
| fixed_expense_plans | 0 行（F6 预期） | 0 | 一致 |
| 预留合计 | 0.00（F7 预期） | 0.00 | 一致 |
| integrity_check | ok | ok | 一致 |

红线表计数（全部未动）：

```text
expense_records|1
expenses|0
import_batches|0
expense_categories|6
income_records|1
essential_expense_items|3
```

现金账户修订明细（as_of 2026-10-22）：

| 账户 | 余额 | 纳入安全资源 | 生效状态 |
|---|---:|---:|---|
| 农业银行 | 5,097.04 | 1 | active |
| 微信零钱 | 55.88 | 1 | active |
| 上海银行 | 4.44 | 1 | active |
| 余额宝 | 168.57 | 1 | active |
| 房租专用资金 | — | — | inactive（lifecycle 修订 2026-10-22 active=0） |

资产修订明细：

| 资产 | 市值 | kind | 纳入安全资源 | 修订日 |
|---|---:|---|---:|---|
| 证券账户 | 20,000 | LIQUID_INVESTMENT | 1 | 2026-10-22 |
| 支付宝基金 | 0 | LIQUID_INVESTMENT | 1 | 2026-10-22 |
| 短期理财 1 | 10,000 | OTHER | 0 | 2026-10-04（未动） |
| 短期理财 2 | 7,000 | OTHER | 0 | 2026-10-04（未动） |
| 短期理财 3 | 3,000 | OTHER | 0 | 2026-10-04（未动） |

---

## 6. 缺口登记（F5–F7）

按任务书 §6 如实挂账，本次**未重播**收入、固定计划、预留额，也未用任何旁路写库：

- **F5 V2 收入**：`recordIncomeEntry` 无调用者。生产界面「本月收入记录 0 笔」，`income_entries` 0 行；仪表盘收入恒 0.00。需 V0.2 补收入录入入口，并明确归属月份口径（2026-09 工资/进步奖按当月录入会看不到）。
- **F6 V2 固定计划**：`createFixedExpensePlan` 无调用者。`fixed_expense_plans` 0 行；「固定支出 / 核心义务」恒 0。需补固定支出计划管理入口。
- **F7 账户预留额**：`setCashAccountReservedAmount` 无调用者。`cash_accounts.reserved_amount` 全部 0.00，预留合计 0.00；「自由现金」会虚高（本次界面显示“还可以安排 -¥5,046.73”，与预留未录入口径有关）。需补账户预留额编辑字段。

---

## 7. 偏差与现场说明

1. **读数位置与任务书措辞不同**：§5.2 写「首页」显示账户现金 / 安全资源；实际「今天」首页只显示“还可以安排”、“手头余地 0.30 个月”、“本月要还 14,518.73”。同一读数在「我的财务 → 现金」和「进展 → 手头余地」页面核实，数值完全一致（5,325.93 / 25,325.93）。判定为展示位置差异，不是数据差异。
2. **快照表口径**：应用自身写路径写入的是 `cash_account_revisions` / `asset_revisions`（以及 `cash_account_lifecycle_revisions`），界面从修订表取当前值；`cash_balance_snapshots` / `asset_value_snapshots` 仍只有 2026-10-04 的 4 行旧值。§5.1 的“现金快照合计 5,325.93”按应用真实读取口径（修订表）成立。探索期日志 `41-readback.log` 曾按快照表误读，已由 `42-readback-final.log` 取代，见 `40-readback/README.md`。
3. **余额/市值记录日**：操作当日 2026-10-22，未追 2026-10-21；属任务书 §4 明示的接受偏差。
4. **误触对话框**：操作中「高级维护」「打开现有综合维护」两次弹出「更新财务数据」（显示稳定月收入 13,000、住房 1,900、水电通讯 600），均已取消，未保存；V1 表计数未变（`103`、`104`、`105`）。
5. **窗口位置**：重播后重启时窗口在屏幕外（-956,-1202），通过 AX 移到 (200,120) 后截图；不涉及数据改动。

---

## 8. 红线遵守声明

- 未执行任何写业务表的 SQL；所有 SQL 均为 `mode=ro&immutable=1` 只读。恢复动作是用主备份整库覆盖，属任务书 §3 明确授权的恢复，不是 SQL 写库。
- 未动、未读 `production_integrity_state`，未读改 terminal / receipt / permit 文件。
- 未删、未改两份 R11 备份与 `.v8-quarantined`；留档副本只增不改（复核哈希 `bb077455…` 未变）。
- 未改 `src/`、`src-tauri/`（`git status --porcelain -- src src-tauri` 为空）；未重建 / 替换生产包（包 mtime 2026-10-22 14:27:26）。
- 未 kill 进程；两次退出均用 `tell application id "com.personalfinance.console" to quit`。
- 未 git 提交。

---

## 9. 证据清单

```text
evidence/r11b-recover-inapp-replay-20261022/
  10-verify/11-preflight.log
  20-archive-restore/21-archive-restore.log
  25-launch/26-launch.log
  25-launch/27-launch-window.png
  25-launch/28-quit.log
  30-inapp/31–116-*.png / *.txt（逐步操作截图与 AX 转储）
  40-readback/41-readback.log（探索期，已被取代）
  40-readback/42-readback-final.log（权威回读）
  40-readback/43-backups-and-evidence.log
  40-readback/44-final-state.log
  40-readback/README.md
  RECEIPT.md
```
