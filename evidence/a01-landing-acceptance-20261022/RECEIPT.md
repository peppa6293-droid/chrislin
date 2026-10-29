# A-01 小钱家 macOS 落地验收回执

执行依据：`docs/EXEC-A01-LANDING-ACCEPTANCE-INSTRUCTIONS.md`
角色：独立验收人（只读核查 + 运行时验证 + 证据采集 + 出结论；未改代码、未改生产包、未写业务表）
执行日期：2026-10-22
结论状态：**PARTIAL**

---

## 0. 结论摘要

- 候选身份、数据库结构、双备份、terminal/receipt/ledger 绑定、测试基线：**全部通过**。
- 真包可打开、可按 bundle id 干净退出、退出重开数据仍在：**通过**。
- 债务锚点（5 笔、2026-11 合计 157,228.31、当月应还 8,851.03）：**精确一致**。
- **A01 §2 的仪表盘锚点（收入 13,791.25 / 经常性 12,791.25 / 账户现金 5,325.93 / 安全资源 25,325.93 / 自由现金 21,525.93）在真实生产库中不存在**。真包仪表盘实拍为：收入 0.00 / 经常性收入 0.00 / 日常支出 0.00 / 账户现金 8,605.61；资产、债务、资产更新三块显示「待接入」。这是本次验收发现的 P1 文档/产品不一致，不能按 §2 出「读数一致」结论。
- `§5.2.4 记账→财务同步`：户主已选定方案 A（本人记账）。只读核对**未在生产库发现 2026-10-22 新增支出**：`expense_records` 仍为 1 笔 2026-10-05 的 13.10，`expenses` 0 行，界面「已花」仍 ¥13.1，库哈希 `8cfe86bc…` 与 R11B 收尾一致。标记 `BLOCKED_OWNER_EXPENSE_NOT_FOUND`，已按 §7.6 保留现场上报，未补记、未写库。
- `§5.3.2 补录屏`：已补 1 份（84.97 s），存户主本机私有目录 `~/Documents/pfc-a01-screen-records/`，文件本体不入库；路径/时长/录制时间/SHA-256 见 §4.2。
- **时点说明（重要）**：§1–§3.3 的只读与运行时读数采集于 **R11B 应用内重播之前**（库哈希 `319907d6…`，现金 ¥8,605.61、资产 ¥23,842.00）。R11B 按户主裁决重播后，当前库为 `8cfe86bc…`，现金 ¥5,325.93、资产 ¥40,000.00、安全资源 ¥25,325.93。§3.4 与 §4.2 的收尾核对全部在**重播后的当前库**上完成。两组读数不能混用；本回执保留前者作为 A01 首次核查现场，后者作为收尾现场。
- 因此最终状态仍为 **PARTIAL**（仪表盘锚点不一致 + 记账同步无法核对），不是 READY_FOR_REVIEW，也不是 CANDIDATE_DRIFT。

---

## 1. 候选身份（§5.1.1）

| 项 | 任务书值 | 实测值 | 判定 |
|---|---|---|---|
| 源码提交 | `e6aa8d5`（main HEAD） | 当前 HEAD `41f9843`；`e6aa8d5` 是其祖先 | 代码未漂移，见 P2-2 |
| 已装包路径 | `/Applications/Personal Finance Console.app` | 同左 | PASS |
| Bundle ID | `com.personalfinance.console` | 同左 | PASS |
| 可执行文件 SHA-256 | `444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c` | `444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c` | PASS |
| Info.plist SHA-256 | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb` | `41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb` | PASS |
| 生产库 | `~/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3` | 同左 | PASS |
| 启动后库哈希 | `319907d68dafd513a2ebed758d469a066793735677a1a462d034ea7b88b192a3` | `319907d68dafd513a2ebed758d469a066793735677a1a462d034ea7b88b192a3`（352,256 B；A01 首次运行时。R11B 重播后当前库为 `8cfe86bc…`，见 §0 时点说明） | PASS |
| `user_version` | 8 | 8 | PASS |
| `integrity_check` | ok | ok | PASS |
| 表数 | 31 张 | 31（30 张应用表 + `sqlite_sequence`） | PASS |
| V8 terminal | `production-v8-cutover-terminal.json`，sha `46d4e440…` | sha `46d4e4405437789281e949b64faaadffca2356528cd1813dc01c4ddc204ccbcc`，状态 `V8_VERIFIED` | PASS |
| 双备份 | ①`production-v8-backups/…` ②`~/Documents/pfc-v8-migration-backup-20261022/…` | 两份均 `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc`，229,376 B，`nlink=1`，常规文件、非 symlink | PASS |

关于源码提交的说明：任务书写「源码提交 `e6aa8d5`（main HEAD，2026-10-22）」。开工时实际 HEAD 已是 `41f9843`。已核对：

- `e6aa8d5` 是 `41f9843` 的祖先；
- `e6aa8d5..41f9843` 只改了 `WORKLOG.md`、`docs/CURRENT_PHASE.md`、`docs/EXEC-A01-LANDING-ACCEPTANCE-INSTRUCTIONS.md`、`docs/REMAINING-ISSUES-20261022.md`；
- 未改 `src/`、`src-tauri/`、`migrations/`、`tests/`、`scripts/`；
- 已装包哈希与 §1 完全一致。

判定：这是任务书发布后的**文档/计划提交**，不是 `CANDIDATE_DRIFT`；但 §1 的「main HEAD」表述已过时，记 P2。

---

## 2. §5.1 只读核查逐项

### 2.1 哈希与库状态

- 库哈希 `319907d6…` 与 §1 启动后锚点一致；`integrity_check=ok`；`foreign_key_check` 空；无 `-wal/-shm/-journal`；`user_version=8`；`schema_migrations=1..8`。
- 表数 31 为 `sqlite_master` 全量计数，其中 30 张应用表 + `sqlite_sequence`；不是异常。
- 日志：`10-readonly/11-identity.log`、`10-readonly/13-db-state.log`、`10-readonly/16-final-identity.log`。

### 2.2 双备份

| 备份 | SHA-256 | 期望 | 判定 |
|---|---|---|---|
| 主备份 `production-v8-backups/personal-finance-console.sqlite3` | `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc` | `ebdd7c2d…` | PASS |
| 副备份 `~/Documents/pfc-v8-migration-backup-20261022/personal-finance-console.sqlite3` | `ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc` | `ebdd7c2d…` | PASS |

两份均只读核对，未删除、未改写。日志：`10-readonly/13-db-state.log`、`30-runtime/71-post-runtime-db-state.log`。

### 2.3 terminal / receipt / ledger 绑定

| 文件 | SHA-256 | 绑定核对 |
|---|---|---|
| `production-v8-cutover-terminal.json` | `46d4e4405437789281e949b64faaadffca2356528cd1813dc01c4ddc204ccbcc` | 存在；`status=V8_VERIFIED`；`nativeStatus=V8_MIGRATION_VERIFIED_NATIVE`；`schema.userVersion=8`、`migrationVersion=8`、rows `1..8` |
| `production-v8-release-receipt.json` | `93bb61952eee41c7d7df76de9321b7e66086b3789aa116d5daaf40012c68361b` | 等于 terminal 的 `releaseReceiptSha256` |
| `production-v8-consumed-authorizations.json` | `4b337dcd7ff490e05162d5530076b43330e591b02d53a752e6d3084f9a867bbf` | 存在，1 条记录；与 terminal 的 ledger sha 一致 |
| `production-v8-migration-authorization.json`（permit） | — | 不存在（已消费） |

terminal 内的备份/库路径、device/inode、备份哈希与现场一致。日志：`10-readonly/14-terminal-binding.log`。

### 2.4 测试复跑

```text
env NODE_ENV=test npx vitest run
Test Files  44 passed | 1 skipped (45)
Tests       442 passed | 80 skipped (522)
Duration    3.61s
exit 0
```

与基线 442 passed / 80 skipped 一致。日志：`20-tests/21-vitest.log`。

### 2.5 财务锚点（只读 SQL）

| 锚点 | 期望 | 实测 | 判定 |
|---|---|---|---|
| 债务笔数 | 5 | 5 | PASS |
| 2026-10 债务合计 / 当月应还 / 笔数 | 172,579.53 / 14,518.73 / 5 | 172,579.53 / 14,518.73 / 5 | PASS |
| 2026-11 债务合计 / 当月应还 / 笔数 | 157,228.31 / 8,851.03 / 5 | 157,228.31 / 8,851.03 / 5 | PASS |
| 逐笔唯一性 | 无重复 `(debt_id, period_month)` | 10 行，无重复 | PASS |
| `debt_period_facts` | 10 | 10 | PASS |

日志：`10-readonly/15-financial-anchors.log`。

### 2.6 仪表盘锚点（A01 §2）——不通过

A01 §2 要求「仪表盘锚点：收入 13,791.25 / 经常性收入 12,791.25 / 账户现金 5,325.93 / 安全资源 25,325.93 / 自由现金 21,525.93」，并写明「验收读数必须一致」。真实生产库实测：

| 指标 | A01 §2 期望 | 生产库实测（应用口径，R11B 重播前 `319907d6`） |
|---|---|---|
| 收入 | 13,791.25 | **0.00**（`income_entries` 0 行） |
| 经常性收入 | 12,791.25 | **0.00**（`income_entries` 0 行） |
| 日常支出 | 未给 | **0.00**（`expenses` 0 行；V1 `expense_records` 有 1 笔 13.10） |
| 账户现金 | 5,325.93 | **8,605.61**（上海银行 0 + 余额宝 4,805.61 + 农业银行 0 + 房租专用资金 3,800） |
| 安全资源 | 25,325.93 | **8,647.61**（可计入现金 4,805.61 + 支付宝基金 3,842；其余理财未计入） |
| 自由现金 | 21,525.93 | **8,647.61**（`reserved_amount` 全为 0，按应用规则自由现金 = 安全资源） |

真包仪表盘实拍：`30-runtime/70-dashboard-large-scrolled.png`，显示「收入 0.00 / 经常性收入 0.00 / 日常支出 0.00 / 账户现金 8605.61」。

补充：R11B 重播后账户现金已变为 ¥5,325.93，与 §2 该项数值巧合一致；但收入/经常性收入仍 0.00，安全资源/自由现金口径未按 §2 成立（自由现金受预留额全 0 影响）。因此 §2 整体仍是 U-14 合成夹具值，不能据此判「读数一致」。

溯源：`evidence/u14-route-20261021/RECEIPT.md` §6 明确写明 U-14 的三张截图来自 `/tmp` 下的 Node 种子库 + 无头 Chrome，不是生产包实拍；其种子库预生成值正是 13,791.25 / 12,791.25 / 5,325.93 / 25,325.93 / 21,525.93。结论：**A01 §2 把 U-14 合成夹具值当成了生产真数**。这是 P1（见 §5）。

---

## 3. §5.2 运行时验证

### 3.1 打开

- 用 `open "/Applications/Personal Finance Console.app"` 启动。
- 主界面正常进入，无崩溃、无门闸报错。
- 截图：`30-runtime/34-launch.png`。

### 3.2 数据在（V1 首页可核对项）

真包首页实拍（R11B 重播前 `319907d6`；重播后首页为：资产 40,000.00 / 债务 172,579.53 / 本月必须还款 14,518.73 / 已花 13.1，见 §4.2 录屏）：

- 资产 **¥23,842.00**（支付宝基金 3,842 + 短期理财 1/2/3 合计 20,000）；
- 债务 **¥172,579.53**（2026-10 五笔合计，与 SQL 一致）；
- 本月必须还款 **¥14,518.73**（与 SQL 一致）；
- 已花 **¥13.1**（V1 `expense_records` 1 笔）；
- 手头余地 **0.27 个月**。

截图：`30-runtime/41-after-myfinance.png`、`54-myfinance-active.png`。

以上 V1 首页数字与生产库一致；但 V2 仪表盘数字与 A01 §2 不一致，见 2.6。

### 3.3 退出重开

- 退出：`osascript -e 'tell application id "com.personalfinance.console" to quit'`，未用 `kill`。
- 退出后：`pgrep` 无匹配（exit 1）；无 `-wal/-shm/-journal`；`user_version=8`；`integrity ok`。
- 重开：主界面正常；V1 首页数字与退出前一致（资产 23,842.00 / 债务 172,579.53 / 应还 14,518.73 / 已花 13.1）。
- 截图：`30-runtime/49-relaunch.png`。
- 日志：`30-runtime/71-post-runtime-db-state.log`、`72-final-quit.log`、`73-final-post-quit.log`。

### 3.4 记账→财务同步（§5.2.4，方案 A）——无法核对

**状态 `BLOCKED_OWNER_EXPENSE_NOT_FOUND`。户主已选定方案 A 并称已记账，但只读核对在生产库中找不到这笔新增支出。**

核对时间：2026-10-22 21:05–21:30（全程只读，`sqlite3 "file:$DB?mode=ro&immutable=1"`）。

| 核对项 | 实测 | 是否符合「已花增加」 |
|---|---|---|
| 生产库 SHA-256 | `8cfe86bcf0fa5640e49f8b720092177757ff74adf9908b1ca68172f77b8d8dd0` | 与 R11B 收尾（20:51 退出后）完全一致 |
| 大小 / mtime | 352,256 B / 2026-10-22 20:45:20 | 20:45 之后无写入 |
| `-wal/-shm/-journal` | 无 | 没有未落盘的写入 |
| `expense_records` 行数 | **1** | 未增加 |
| 唯一一行 | `daea72ab-1124-4fb2-bbee-d9255f1e2b3f`，13.10，`2026-10-05`，`VARIABLE` / `FOOD`，created_at `2026-10-05T00:00:00.000Z` | 是 10-05 旧记录，不是本次新增 |
| `expenses`（V2）行数 | **0** | 无镜像行 |
| 界面「已花」 | **¥13.1**（录屏 6 s / 22 s / 50 s 三处一致） | 未增加 |
| 全表 created_at 扫描 | 10-22 新增仅限 R11B 已知的现金/资产/债务修订，无任何支出类新行 | 无新增支出 |
| smoke 库（`com.personalfinance.console.smoke`） | mtime 2026-10-21 09:51:33，5 笔旧支出 | 不是户主本次记账 |

结论：

- 无法核对「已花增加」与「V1 变动支出（`kind=VARIABLE`、`category=OTHER_VARIABLE`）镜像增加」，因为源头这笔支出在库内不存在。
- 按 §7.6「发现数据异常：保留现场，停止操作，先报告，不自行修复」和「不许自己记账、不许写库」，验收人**没有补记、没有写任何业务表、没有改库凑数**，也没有把旧数据当成本次新增上报。
- 需户主确认：是否真的点了保存、是否记在另一台机器/另一个库、或记账时弹窗被取消。确认后可重新只读核对。
- 附带事实（不因本次阻塞而消失）：库里已有的 1 笔 13.10 是 `FOOD` 而非 `OTHER_VARIABLE`，且未回填 V2 `expenses`（见 P1-2）；镜像规则只能对“新增现金支出”验证，不能拿这笔旧数据代替。

---

## 4. §5.3 证据采集

### 4.1 截图（已完成）

| 文件 | 内容 |
|---|---|
| `30-runtime/34-launch.png` | 真包启动、首页 |
| `30-runtime/41-after-myfinance.png` | 「我的财务」路由页 |
| `30-runtime/49-relaunch.png` | 退出重开后的首页 |
| `30-runtime/54-myfinance-active.png` | 重开后的「我的财务」 |
| `30-runtime/65-ledger-open-on-text.png` | 「收支账本」展开 |
| `30-runtime/66-dashboard-scrolled.png` | 仪表盘滚动区 |
| `30-runtime/67-dashboard-overview.png` | 仪表盘概览 |
| `30-runtime/68-dashboard-income.png` | 仪表盘收入区 |
| `30-runtime/69-dashboard-large-window.png` | 1280×980 大窗仪表盘 |
| `30-runtime/70-dashboard-large-scrolled.png` | 仪表盘真实读数（收入 0.00 / 日常支出 0.00 / 账户现金 8605.61） |

`35`–`64` 之间的截图是点击「收支账本」未展开的中间尝试，保留作为操作过程证据，不作为产品结论。未展开的原因见 P2-1（`<summary>` 点击热区只有文字宽度）。

### 4.2 录屏（已完成，文件本体不入库）

按户主裁决「方案 b + 路径记录」执行：录屏存入户主本机私有目录，仓库 `evidence/` 内只有本登记，没有视频文件。

| 项 | 值 |
|---|---|
| 目录 | `~/Documents/pfc-a01-screen-records/`（户主本机私有目录，仓库外） |
| 文件名 | `pfc-a01-acceptance-review-20261022-2128.mov` |
| 大小 | 11,006,065 B |
| 时长 | **84.97 s** |
| 录制时间 | 2026-10-22 21:27:41 – 21:29:06（文件 birth / mtime） |
| SHA-256 | `758f7c2e79e81b1e23d61932b61f1b8385230c0c1428e8e5f2135b2c5709b11c` |
| 画面范围 | 小钱家窗口 900×720 @ (300,140)，整屏纯黑遮罩，不含桌面、其他应用或通知内容 |
| 入库状态 | **不入库**；`git status` 中无该文件 |

录制内容（时间点为视频内秒数）：

| 时间点 | 画面 |
|---|---|
| 0–5 s | 启动，进入「今天」：已花 ¥13.1、还可以安排 -¥5,046.73、本月要还 ¥14,518.73 |
| 6–11 s | 「我的财务」：收入 ¥13,000.00/月（本月记录 0 笔）、现金 ¥5,325.93（4 户）、资产 ¥40,000.00（5 项）、债务 ¥172,579.53（5 笔，本月必须还款 ¥14,518.73） |
| 13–19 s | 「我的财务 → 现金」：总额 ¥5,325.93 / 4 个账户（农业银行 5,097.04、微信零钱 55.88、上海银行 4.44、余额宝 168.57） |
| 23–34 s | 「进展 → 稳住现金 → 手头余地」：安全垫 1.40/6 个月、离目标还差 ¥82,954.45、已经准备好的安全储备 ¥25,325.93 |
| 36–42 s | 按 bundle id 退出，画面纯黑（已抽帧核对，无私人内容） |
| 43–55 s | 重新启动，直接进入「今天」，数字与退出前一致（已花 13.1 / -5,046.73 / 0.30 个月 / 14,518.73） |
| 56–85 s | 再次按 bundle id 退出，纯黑至结束 |

说明：户主那笔记账未出现在库内（§3.4），因此录屏录的是**复核过程**，未录到户主记账动作。


---

## 5. 问题分级

### P1（主链路/验收结论受影响）

**P1-1. A01 §2 仪表盘锚点不是生产真数，是 U-14 合成夹具值。**
- 证据：`10-readonly/15b-anchor-crosscheck.log`、`30-runtime/70-dashboard-large-scrolled.png`、`evidence/u14-route-20261021/RECEIPT.md` §6。
- 影响：任务书写「验收读数必须一致」，但真包无论如何都不可能读出 13,791.25 / 12,791.25 / 5,325.93 / 25,325.93 / 21,525.93。验收人若照抄会得出假通过；若照实核对则与任务书冲突。
- 处置建议：由审核员更正 A01 §2，把「生产真数」与「U-14 夹具锚点」分开写；不要改生产库去凑数。

**P1-2. V2 仪表盘没有反映生产库中已有的财务数据，且该缺口未列入剩余问题清单。**
- 证据：
  - 仪表盘「资产」「债务」「资产更新」三块硬编码「待接入」（`src/ui/v2-dashboard.tsx:203,210,217`）；
  - `getMonthSummary` 永远返回 `billStatuses: []`（`src/application/v2-expense-service.ts:366`），所以仪表盘「债务确认」显示「当前没有待还账单」，而 V1 首页显示 5 笔债务、本月必须还款 ¥14,518.73；
  - 仪表盘「日常支出 0.00」，而 V1 首页「已花 ¥13.1」，生产库 `expense_records` 有 1 笔、`expenses` 为 0 笔（历史 V1 支出未回填 V2）；
  - 仪表盘「收入 0.00 / 经常性收入 0.00」，生产库 `income_entries` 0 笔；V1 `income_records` 有 1 笔 PLANNING 13,000（2026-10-04）。
- 影响：用户从「我的财务 → 收支账本」进入看到的财务结果与首页不一致；「没有待还账单」与「本月必须还款 14,518.73」直接矛盾。对用户标准第 2 项（记账→财务结果真实同步）构成主链路风险。
- 说明：这不等同于「V2/V1 双写契约未接通」——新增现金支出的双写代码仍在；问题是历史数据未回填、仪表盘资产/债务区未接线、账单状态恒为空。剩余问题清单未披露这三项。

**P1-3. 方案 A 的户主记账在只读核对中不可见，记账同步无法验证。**
- 证据：§3.4 全表只读核对；库哈希 `8cfe86bc…`、mtime 20:45:20 与 R11B 收尾一致；`expense_records` 仍 1 笔 10-05 旧记录；`expenses` 0 行；界面与录屏三处「已花」均 ¥13.1。
- 影响：用户标准第 2 项（记账→财务结果真实同步）本次仍无法给出证据，只能给「未发现新增支出」。
- 处置建议：户主确认这笔支出的保存结果与所在库；确认后再做一次只读核对。验收人不得补记、不得改库凑数。

### P2（体验/文档）

**P2-1. 「收支账本」整行不可点，只有文字宽度可点。**
- `src/style.css:1975-1978` 的 `.finance-state-card { display:grid; justify-items:start; }` 使 `<summary>` 收缩到文字宽度；点击文字右侧空白无反应。
- 实拍与过程：`30-runtime/65-ledger-open-on-text.png`；`35`–`64` 为失败尝试。
- 影响：用户容易以为入口坏了；本次验收为此多花了多轮点击定位。建议 V0.2 把 summary 设为 `width:100%` 或整卡可点。

**P2-2. A01 §1「源码提交 e6aa8d5（main HEAD）」已过时。**
- 实际 HEAD `41f9843`；`e6aa8d5` 是其祖先，差异仅为文档/计划文件（`WORKLOG.md`、`docs/CURRENT_PHASE.md`、A01 任务书、剩余问题清单），无代码/包/库变化。
- 判定：文档陈述滞后，不是 `CANDIDATE_DRIFT`。

**P2-3. 「31 张表」表述不精确。**
- 31 是 `sqlite_master` 全量计数，含 `sqlite_sequence`；应用表为 30 张。不影响验收结论，建议以后写「30 张应用表 + sqlite_sequence」。

---

## 6. §5.4 剩余问题清单复核

| 项 | 清单「现状」是否属实 | 复核结果 |
|---|---|---|
| A1 无应用图标 | 属实 | `grep '"icon"' src-tauri/tauri.conf.json` 无结果；`bundle` 块确无 `icon` |
| A2 840×580 已花行被裁切 | 属实 | `src/ui/V2HomeSurface.tsx:484` 为「已花」行；840×580 窗口下需滚动，1280×980 下可见 |
| B1 V2 编辑/删除无 V1 镜像 | 结论属实，但「仅两个写入口」表述不准确 | 实际有 4 个 `record*`：`recordCashDebitExpense:149`、`recordCreditExpense:202`、`recordCreditCardPayment:302`（只做对账、不落库）、`recordIncomeEntry:319`。「编辑/删除无 UI、双写只覆盖新增」的结论仍成立 |
| B2 V2 分类在 V1 统一落 `OTHER_VARIABLE` | 属实 | `src/persistence/repositories.ts:1827-1828` 固定 `kind='VARIABLE'`、`category='OTHER_VARIABLE'` |
| B3 最近消费只渲染 3 条 | 属实 | `src/ui/V2HomeSurface.tsx:960` 确为 `expenses.slice(0, 3)` |
| B4 导入失败只显示条数 | 属实 | `src/ui/v2-import.tsx:260` 只显示 `errorRows` 数量，无行级原因 |
| C1 录屏 0 份 | 清单时点属实 | 本次已补录 1 份（§4.2），C1 关闭 |
| C2 真包+真数据截图未做 | 属实，**本次已补** | `30-runtime/34`、`41`、`49`、`54`、`65`–`70` 均为真包实拍 |
| D1 U-12 无独立回执 | 属实 | `4442c39` 仅改 `src/style.css`、`src/ui/v2-surface.css` 两个文件 |

复核结论：清单总体属实，没有发现「隐瞒已修复项」或「把已关闭项写成开放」；但存在两处不完整：

1. B1 漏写了 `recordCreditCardPayment`（非持久化）与 `recordIncomeEntry`；
2. **未披露 V2 仪表盘资产/债务/资产更新为「待接入」、账单状态恒为空、历史 V1 支出未回填 V2**（P1-2）。

---

## 7. 未覆盖项

- §5.2.4 记账→财务同步：`BLOCKED_OWNER_EXPENSE_NOT_FOUND`（户主选定方案 A，但库内无新增支出，见 §3.4）。
- §5.3.2 录屏：已完成（§4.2，文件存本机私有目录，不入库）。
- iOS / 手机尺寸 / 真机：按任务书 §3 不在本次范围，未验收、未混报。
- App Store 发布准备：外部账号事项，未做。
- 功能缺口修复（B 类）：属 V0.2，未修。

---

## 8. 结论（§6 格式）

```text
候选身份（§1 哈希逐项）：
  源码提交：任务书 e6aa8d5；实际 HEAD 41f9843（e6aa8d5 为祖先，差异仅文档/计划，无代码/包/库变化）
  已装包：/Applications/Personal Finance Console.app（bundle id com.personalfinance.console）
  可执行文件 SHA-256：444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c（一致）
  Info.plist SHA-256：41b8aa5a1c1933531c2d986c25d180590ffbf8920aff4483d791a882dc3cfdcb（一致）
  生产库：V8，user_version=8，integrity ok，31 表（30 应用表 + sqlite_sequence）
    首次核查时哈希 319907d6…；R11B 重播后当前哈希 8cfe86bcf0fa5640e49f8b720092177757ff74adf9908b1ca68172f77b8d8dd0
  terminal：46d4e4405437789281e949b64faaadffca2356528cd1813dc01c4ddc204ccbcc（V8_VERIFIED）
  双备份：均 ebdd7c2d52c904dc0ce763302b461a8530ce0f6f3b4bc13c695ca5386f0d29bc（完好）
验收范围：macOS 落地（iOS 不在本次）

已验证事实（按用户 5 项标准逐项）：
  1. 真实可打开独立 macOS 候选包：通过。真包启动正常，无崩溃/门闸报错；哈希与任务书一致。
  2. 记账→财务结果真实同步：无法核对（BLOCKED_OWNER_EXPENSE_NOT_FOUND）。户主已选定方案 A，但只读核对未在生产库发现 2026-10-22 新增支出：expense_records 仍为 1 笔 2026-10-05 的 13.10，expenses 0 行，界面「已花」仍 ¥13.1，库哈希 8cfe86bc… 与 R11B 收尾一致。按 §7.6 保留现场上报，未补记、未写库。现有生产数据在 V2 仪表盘上不完整（P1-2）。
  3. 退出重开数据仍在：通过。按 bundle id 退出，无残留进程/sidecar；重开后首页数字一致。
  4. 截图/录屏/测试证据：截图与测试已补；录屏 1 份（84.97 s），存 ~/Documents/pfc-a01-screen-records/pfc-a01-acceptance-review-20261022-2128.mov，SHA-256 758f7c2e…，文件本体不入库（C1 关闭）。
  5. 剩余问题清单：总体属实；A1/A2/B2/B3/B4/D1 复核通过；B1 表述不完整；C2 本次已补；另有 P1-2 未披露。

运行时验证记录（含记账同步采用的方案 A/B/C）：
  启动 → 首页 → 我的财务 → 收支账本 → 仪表盘 → 按 bundle id 退出 → 重开 → 再按 bundle id 退出。
  记账同步：户主选定方案 A；只读核对未发现新增支出，状态 BLOCKED_OWNER_EXPENSE_NOT_FOUND（详见 §3.4）。
  真包仪表盘实测：收入 0.00 / 经常性收入 0.00 / 日常支出 0.00 / 账户现金 8605.61；资产、债务、资产更新显示「待接入」；债务确认显示「当前没有待还账单」。
  V1 首页实测：重播前 资产 23,842.00 / 债务 172,579.53 / 本月必须还款 14,518.73 / 已花 13.1；
                重播后 资产 40,000.00 / 债务 172,579.53 / 本月必须还款 14,518.73 / 已花 13.1（录屏复核）。
  债务 SQL 锚点：5 笔；2026-10 172,579.53 / 14,518.73 / 5；2026-11 157,228.31 / 8,851.03 / 5。
证据路径：evidence/a01-landing-acceptance-20261022/（RECEIPT.md、10-readonly/、20-tests/、30-runtime/）

P0/P1/P2 问题（P0=数据丢失/无法使用；P1=主链路缺陷；P2=体验/外观）：
  P0：无。
  P1-1：A01 §2 仪表盘锚点（13,791.25 / 12,791.25 / 5,325.93 / 25,325.93 / 21,525.93）是 U-14 合成夹具值，不是生产真数；任务书「验收读数必须一致」无法成立。
  P1-2：V2 仪表盘未反映生产真数：资产/债务/资产更新「待接入」；billStatuses 恒为空导致「当前没有待还账单」与首页「本月必须还款 14,518.73」矛盾；历史 V1 支出 13.10 未回填 V2，仪表盘日常支出 0.00。剩余问题清单未披露。
  P1-3：方案 A 的户主记账在只读核对中不可见：生产库无 2026-10-22 新增 expense_records / expenses，界面「已花」仍 ¥13.1，库哈希与 R11B 收尾一致。需户主确认是否保存成功、是否记在另一个库。
  P2-1：「收支账本」summary 点击热区仅文字宽度（style.css:1975-1978），整行不可点。
  P2-2：A01 §1「main HEAD e6aa8d5」已过时，实际 HEAD 41f9843（差异仅文档/计划）。
  P2-3：「31 张表」含 sqlite_sequence，应用表为 30 张，表述不精确。
未覆盖项：§5.2.4 真实记账同步（BLOCKED_OWNER_EXPENSE_NOT_FOUND）；iOS/手机尺寸；App Store 发布准备；B 类功能修复。
剩余问题清单复核结果：A1/A2/B2/B3/B4/D1 属实；B1 结论成立但「仅两个写入口」不准确（实际 4 个 record*，其中 recordCreditCardPayment 不落库）；C1 本次已补录（关闭）；C2 本次已补；P1-2 未披露；P1-3 记账同步阻塞。

最终状态：PARTIAL
（PARTIAL=只读核查/启动/退出重开/测试/债务锚点通过、录屏已补；但仪表盘锚点不一致、方案 A 记账同步无法核对（库内无新增支出）。不得写 COMPLETED，最终验收权在户主）
下一责任人：户主
```

---

## 9. 给户主的待决事项

1. **方案 A 的记账去哪了**（唯一未决）：您已选定并称已记的那笔小额支出，在生产库、smoke 库和界面里都找不到——`expense_records` 仍只有 10-05 的 13.10，`expenses` 0 行，「已花」仍 ¥13.1，库 mtime 停在 20:45。请确认：
   - 是否点到了最终「保存」；
   - 是否记在另一台机器/另一个数据目录；
   - 是否记完后又取消或删除了。
   确认后验收人可再做一次只读核对；在此之前记账同步不能算通过。
2. **录屏**：已按您裁决录制并登记（§4.2），文件在 `~/Documents/pfc-a01-screen-records/pfc-a01-acceptance-review-20261022-2128.mov`，不在仓库。若您希望删除或改存位置，请告知。

---

## 10. 红线遵守声明

- 未写生产库业务表；未改库结构；未动 terminal/receipt/permit/ledger。
- 未删、未改两份备份与 `.v8-quarantined`。
- 未重建/替换生产包；未改 `src-tauri/`；未改 `src/`。
- 未 kill 应用进程；两次退出均按 bundle id。
- 未把 iOS / App Store 项写成本次已完成。
- 发现锚点异常/数据缺失后未自行修复，按 §6 与 §7.6 上报；未补记账、未改库凑数。
- 录屏文件只写入户主本机私有目录 `~/Documents/pfc-a01-screen-records/`，未进仓库/`evidence/`；录制时用纯黑遮罩，未采集桌面或其他应用内容。
