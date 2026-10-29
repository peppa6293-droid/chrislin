# CORRECTION-LOG｜WP-DATA-TRUTH-01 Phase 1（V2-A）执行记录

- 执行：小钱家执行员
- 执行时刻：2026-10-28 23:21:04 CST（`created_at` 落 `2026-10-28T15:21:04.408Z`）
- 触发：chris 本人回合指令「执行 Phase 1」（Owner 回合，工具边界覆盖活库）
- 依据：`docs/REAL-DATA-CORRECTION-PLAN-V2-20261028.md` §2 / §4 / §5
- 目标库：`~/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`
- 执行脚本：`RUN-PHASE1.sh`；语句：`PHASE1-INSERTS.sql`；原始输出：`RUN-PHASE1-EXEC-20261028-2320.log`

## 1. 备份与哈希（可整体还原）

| 项 | 值 |
|---|---|
| 改前整库备份（在线一致性 `.backup`） | `personal-finance-console.sqlite3.prephase1-20261028-232104` |
| 备份大小 / 完整性 | 1,294,336 字节 / `integrity_check=ok`，`user_version=8` |
| 备份 sha256 | `b841c5ea6f8b3c78420c66e394f3e9e86b2bdbdedcda81a62a1e64748bf7f3ea` |
| 活库改前 sha256 | `a0bd66c6ff30e8371577f8a44963f7d4b72da3ad48dcf14a934ad7678f820bc7` |
| 活库改后 sha256 | `abb84197355280c21b4f4543a23617953562bb37fe632d5d9f99a5d3e6b183e0` |
| 前一版改前备份（23:00 预检时） | `personal-finance-console.sqlite3.bak-20261028-20261028-225943`（同 sha256 `b841c5ea…`） |

## 2. 逐条 before / after（12 条纯 INSERT）

**改前（before）证明**：`income_records` 仅 1 行 `PLANNING/EXPECTED/13000`（`period_month` 为 NULL）；`income_records WHERE kind='ACTUAL'` = **0 行**；`income_entries` = **0 行**。见 `BEFORE-SNAPSHOT-20261028-2320.txt`。

### R-1' `income_records`（kind=ACTUAL, status=RECEIVED, profile `ffb61fa9-…`）

| # | period_month | date | before | after amount | 新行 id |
|---|---|---|---|---|---|
| 1 | 2026-05 | 2026-05-20 | 0 行 | 33347.55 | `f6acbefe-f328-46c5-ae55-0674ae13cb58` |
| 2 | 2026-06 | 2026-06-18 | 0 行 | 10919.10 | `72613b8a-9697-4f98-9258-557b279bf7bb` |
| 3 | 2026-07 | 2026-07-20 | 0 行 | 10048.90 | `ecfa6f56-073f-4942-940b-73069d4f0a1b` |
| 4 | 2026-08 | 2026-08-20 | 0 行 | 24441.24 | `a8ab1339-0317-43b8-82fd-2f7906b505fd` |
| 5 | 2026-09 | 2026-09-18 | 0 行 | 12266.47 | `76954ba9-712d-450d-bbb7-d2f1bd7379b6` |
| 6 | 2026-10 | 2026-10-20 | 0 行 | 13791.25 | `ede4b5d8-23a8-408f-a84e-5c7336910bd4` |

去重方式：`INSERT … SELECT … WHERE NOT EXISTS(同 profile + kind=ACTUAL + period_month + date)`。

### R-2' `income_entries`（label='工资', one_time=0）

| # | period_month | occurred_at | before | after amount | 新行 id |
|---|---|---|---|---|---|
| 1 | 2026-05 | 2026-05-20 | 0 行 | 33347.55 | `9112bb98-747a-4153-9464-82244dce308a` |
| 2 | 2026-06 | 2026-06-18 | 0 行 | 10919.10 | `ae57ad71-1083-4ea9-8c61-07c730954917` |
| 3 | 2026-07 | 2026-07-20 | 0 行 | 10048.90 | `31b9beb2-0805-4b7d-8ab0-023eda344b78` |
| 4 | 2026-08 | 2026-08-20 | 0 行 | 24441.24 | `7a309696-1124-47cb-b2c6-3ee18bbe77b1` |
| 5 | 2026-09 | 2026-09-18 | 0 行 | 12266.47 | `7cf6cf90-1de6-48c5-8c17-633b29d4da6b` |
| 6 | 2026-10 | 2026-10-20 | 0 行 | 13791.25 | `f257e81c-0a83-4526-8a75-edfb43c93610` |

去重方式：表级 `UNIQUE(profile_id, occurred_at, label, amount)`。

**语句形态**：12 条 INSERT，包在单个 `BEGIN IMMEDIATE … COMMIT`；`sqlite3 -bail` 执行，任一失败整体回滚。**全程 0 条 UPDATE / DELETE / DROP / ALTER。**

## 3. §4 对拍硬指标（逐项）

| # | 指标 | 实测 | 结论 |
|---|---|---|---|
| 1 | `PRAGMA integrity_check` / `user_version` / 表结构 | `ok` / `8` / 与 `migrations/v8-schema.json` 中 `income_records`、`income_entries` 的 DDL 规范化比对 **MATCH** | ✅ |
| 2 | ACTUAL 6 行逐月金额 | 33347.55 / 10919.10 / 10048.90 / 24441.24 / 12266.47 / 13791.25；2026-10 = **13791.25** | ✅ |
| 3 | `income_entries` 6 行逐月 + 合计 | 逐月同银行；合计 **104814.51**（与 ACTUAL 侧合计一致，6/6 MATCH） | ✅ |
| 4 | PLANNING 显示 13,000 不变 | 仍为 `PLANNING/EXPECTED/13000`，period_month 仍 NULL | ✅ |
| 5 | `debts`/`debt_revisions`/`debt_period_facts` 零改动 | 前后快照分段 sha256 **SAME**；5 / 0 / 10 行；2026-10 月供合计 **14518.73**、2026-11 **8851.03**（与改前一致） | ✅ |
| 6 | `expenses` 831 / `expense_records` 832 未动 | 831 / 832；分段 sha256 **SAME** | ✅ |
| 7 | 无 DELETE/UPDATE/DROP/ALTER | 语句清单只有 INSERT；非收入表行数与内容哈希不变 | ✅ |
| 8 | `npm run lint` / `typecheck` / `test:product` | lint `Checked 172 files` 无修复；typecheck 0 错误；test:product **53 文件 / 557 通过 / 44 跳过 / 0 失败** | ✅ |
| 9 | 界面快照：首页结构卡显示真实工资 | **本回合 App 未运行（`ps` 无进程），未产生截图**；已用首页读取路径同款 SQL 证明：`period_month='2026-10' AND kind='ACTUAL' AND date<='2026-10-28'` → 1 行 **13791.25** | ⏳ 截图待 App 启动后补 |

## 4. 双计风险复核（执行员写入前提出的 ③）

`income_records` 与 `income_entries` 属**两条独立读取路径**，不存在同一视图求和：
- 首页/结构卡：`repositories.ts:listIncomeV3` → 只查 `income_records`（`period_month=? AND kind='ACTUAL' AND date<=?`）。
- 账本收入明细：`repositories.ts:listIncomeEntries` → 只查 `income_entries`。
- 全文件检索未发现对两张表的联合求和。

实测：2026-10 两表各为 **13791.25**；**首页本月实际收入 = 13791.25，不是 27582.50**。双计未发生，不触发 §5 停手条款。

## 5. 过程瑕疵（主动披露）

1. 我在只读核验时误用 `sqlite3 "$DB?mode=ro"`（缺 `file:` 前缀），在活库目录下生成了一个 0 字节空文件 `personal-finance-console.sqlite3?mode=ro`。已确认其为 0 字节空文件、非主库（inode 36129664，与主库不同），随即 `rm` 删除；主库未受影响（删除后目录仅剩主库与 v8-quarantined）。此后所有查询均改用 `file:$DB?mode=ro`。
2. 除上述空文件外，本回合所有写入仅限 12 条 INSERT 与工作区内产物。

## 6. 未做/冻结项（与 V2 一致）

- 债务侧 Phase 2 全部冻结：`debts` 5 项、`debt_period_facts` 10 行一行未动；Q-A/Q-B/Q-C 未裁决前不执行任何债务 INSERT/UPDATE/active 变更。
- 1～4 月工资无留存，不造数（挂 P4）。
- 公积金提取、微信/支付宝转账、卖二手收入不入账（chris 口径：另算）。
- 未改代码、未改库结构、未提交 git。

## 7. 还原方式

```bash
cp "evidence/…/data-fix-20261028/personal-finance-console.sqlite3.prephase1-20261028-232104" \
   "$HOME/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3"
```
还原后活库 sha256 应回到 `b841c5ea6f8b3c78420c66e394f3e9e86b2bdbdedcda81a62a1e64748bf7f3ea`。
