# 甲-2 债务修正·执行留痕（2026-10-29）

- 执行人：小钱家执行员（AI）
- 授权：chris 于本回合直接发令「甲-2 执行」（2026-10-29 11:32，Owner 发起的执行回合）
- 规格依据：`docs/REAL-DATA-CORRECTION-PLAN-V2.1-DEBTS-20261029.md` §2 甲-2（v2.2 锁定版）+ §6 对拍硬指标
- 通道：**通道 A（App 自带债务页「停用」流程，`deactivateDebt`@`src/application/v4-foundation-service.ts:575`）**；零手工 SQL、零通道 B、零脚本 rotation、零补写链头

## 1. 改前基线校验

| 项 | 期望 | 实测 | 结论 |
|---|---|---|---|
| 活库 sha256 | `dfa4e5bf…41056faa5` | `dfa4e5bfa5df37927aa2f3835e560f70e2a0e64debe7c3add9b068b41056faa5` | ✅ |
| 锚点 sequence | 59 | 59（prev `bdf712da…`、content `6fd44af6…`、tag `b46af341…`） | ✅ |
| debts / debt_period_facts / debt_revisions | 5（全 active=1）/ 10 / 0 | 5 / 10 / 0 | ✅ |
| 2026-10 月供合计 | 14,518.73 | 14,518.73 | ✅ |
| 2026-11 月供合计 | 8,851.03 | 8,851.03 | ✅ |

改前整库备份（在线一致性 `.backup`，落在 `~/Library/Application Support/com.personalfinance.console/` 之外）：

- 文件：`backup/personal-finance-console.sqlite3.prejia2-20261029-113413`（1,294,336 字节）
- sha256：`22e9696a01be57017f21f4927dad9268308b27ed0df4eb2224fde9940e2d235f`
- 备份自身 `PRAGMA integrity_check=ok`、`user_version=8`

## 2. 唯一写入动作

- 动作：App 债务页 → 债务 → 美团月付卡片 →「停用债务」→ 确认弹窗「确定停用“美团月付”吗？」→「确认停用」（一次）。
- 写入时刻：`2026-10-29T03:39:08.413Z`（本地 11:39:08）。
- 落库形状（读回实测）：

| revision_id | debt_id | period_month | as_of_date | name | current_balance | current_month_due | fixed_monthly_payment | active | created_at |
|---|---|---|---|---|---|---|---|---|---|
| 1 | `2a6a027d-806d-44f8-92e0-131f78c6d14b` | 2026-10 | 2026-10-28 | 美团月付 | 331.37 | 331.37 | NULL | 0 | 2026-10-29T03:39:08.413Z |

- **口径说明（如实记档）**：`as_of_date` 由 App 会话日推出（`App.tsx:219` `sessionAsOfDate.slice(0,7)`；该 App 实例自 2026-10-28 23:56 启动未重启），故为 `2026-10-28`，非任务书 SQL 模板的 `<执行日>`＝2026-10-29。`period_month=2026-10` 与 v2.2「写入月份＝会话月 2026-10」一致，读回口径不受影响；仅记差异，未做任何改写。
- `debt_period_facts` 10 行**零 UPDATE / 零 DELETE**（美团 2026-10 331.37/331.37、2026-11 1.88/1.88 原样留作底稿）。

## 3. 改后读回（五组）

| # | 项 | 期望 | 实测 | 结论 |
|---|---|---|---|---|
| 1 | `debt_revisions` | 0 → 1 行 | 1 行（active=0，见上表） | ✅ |
| 2 | `debt_period_facts` | 10 行零变 | 10 行，逐行与改前一致（整表哈希 SAME） | ✅ |
| 3 | 2026-10 月供（读模型） | 14,187.36 | 14,187.36 | ✅ |
| 4 | 2026-11 月供（读模型） | 8,849.15 | 8,849.15 | ✅ |
| 5 | 债务清单 | 5 → 4 | 4 笔；债务总额 172,579.53→**172,248.16**；界面「本月必须还款 ¥14,187.36」 | ✅ |
| 6 | 11/12 月视图 | 美团消失、无 331.37/1.88 残值 | 2026-11 / 2026-12 / 2027-01 读模型均无美团；2026-09 及以前仍可见（符合规格） | ✅ |
| 7 | 链头 | 59 → 60，`previous_digest`=seq59 `content_digest` | seq 60，prev `6fd44af6…`、content `1503837c…`、tag `ad39df16…` | ✅ |
| 8 | `integrity_check` / `user_version` | ok / 8 | ok / 8 | ✅ |
| 9 | income / expense / planning | 零改动 | 整表哈希 SAME（见 §4） | ✅ |
| 10 | 第 7 条 | 零动作 | 全程无「缺本月事实」提示或阻断，未补事实、未改检查逻辑 | ✅ |

- 活库改后 sha256：`27f349c565e64913597882b10148e92cce940bceb192145401ec6abd3150117c`（这是**写入后的新哈希**，不与改前基线比较；改前基线已由 §1 校验）。
- 首页实测：结构余量 −¥4,715.36、固定负担 ¥17,715.36（= 3,528.00 + 14,187.36）、月供 ¥14,187.36；收入 13,000.00 未动。

## 4. 逐表对比（改前备份 vs 改后活库，整表内容哈希）

32 张表中 **30 张 SAME**，仅 2 张 DIFF，且均为预期：

- `debt_revisions`：空 → 1 行（甲-2 唯一写入）
- `production_integrity_state`：seq 59 → 60（业务写入同事务自动推进，非手工补写）

SAME 关键表：`debts`、`debt_period_facts`、`income_records`、`income_entries`、`expenses`、`expense_records`、`financial_settings`、`planning_income_revisions`、`planning_income_month_revisions`、`profiles`、`settings_revisions`、`schema_migrations`。

## 5. 证据清单（sha256）

| 文件 | sha256 |
|---|---|
| `backup/personal-finance-console.sqlite3.prejia2-20261029-113413` | `22e9696a01be57017f21f4927dad9268308b27ed0df4eb2224fde9940e2d235f` |
| `PRE-STATE.txt` | `237068341f28b5878c84ce783dd2960d273ab5a89ba71ca9e1a79d2f1f07f917` |
| `POST-STATE.txt` | `93a0643ee86fbaae8871dcb96e8a777786e6d75e61fe537f4df272246b9a0988` |
| `shots/01-confirm-dialog-before.png` | `6e8f0fb852d75dd81dd2adbedb6da1ffedea52be42bee8621f4153972814bc6f` |
| `shots/02-debt-list-after.png` | `3639187a63842420205391b5052982b2668a76dace8cef676d553cc918c03d46` |
| `shots/03-home-after.png` | `d37f525c7cba7601f7134d6c2fb3e5c280cc03f8332df19939ddf4a5fe5d249c` |
| `shots/04-debt-list-history-expanded.png` | `62f3ae6a11f0683a2e63dc20303305f20683d92c932d17e971703184c15190e3` |

## 6. 边界声明

- 本轮仅执行甲-2 一项；**甲-1、乙-1、丙-1～丙-4 零动作**（丙-3/丙-4 已裁定零修订，与本次无关）。
- 未改源码 / 样式 / 表结构 / 门闸文件；未提交 git（HEAD 仍 `e21f1e5`）。
- 未补写链头、未重跑 rotation、未使用脚本或手工 SQL 写入。
- 第 7 条（2026-12 起维护屏逐月标「缺本月事实」）为本轮零预授权的已知产品缺口，**本次不处理**；复发时停手上报 chris。
