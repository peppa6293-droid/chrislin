# Phase 1 就绪报告（V2-A：收入纯新增 12 行）

- 时间：2026-10-28 23:20 (Asia/Shanghai)
- 执行：小钱家执行员
- 依据：`docs/REAL-DATA-CORRECTION-PLAN-V2-20261028.md` §2 R-1'/R-2'、§4 对拍、§5 停手
- 状态：**脚本就绪 + 干跑通过；活库写入 0 次**（本轮工具边界不含活库，见 §4）

## 1. 基线核对（工作区备份副本只读，`mode=ro`）
- `income_records`：仅 1 行 PLANNING / EXPECTED / 13,000 / 2026-10-04；ACTUAL 行 **0**。
- `income_entries`：**0 行**。
- `profiles`：唯一 profile `ffb61fa9-1206-4bdd-923b-7e440468139c`（display_name 空）。
- `PRAGMA user_version`=8；双表 schema 与 `migrations/v8-schema.json` 逐字一致（含 `UNIQUE(profile_id, occurred_at, label, amount)`）。

## 2. 脚本
- `PHASE1-INSERTS.sql`：12 条 INSERT（6 行 `income_records` ACTUAL/RECEIVED + 6 行 `income_entries` label='工资'/one_time=0），单事务 `BEGIN IMMEDIATE … COMMIT`；records 侧带 `NOT EXISTS` 防重，entries 侧靠 UNIQUE 兜底；`created_at` 取执行时刻 `strftime('%Y-%m-%dT%H:%M:%fZ','now')`。
- `RUN-PHASE1.sh <活库路径>`：S0 只读 PRECHECK（`integrity_check`/`user_version`/ACTUAL=0/entries=0，任一不符即停）→ S1 `.backup` 在线备份 + sha256 → S2 `-bail` 单事务写入（失败自动回滚）→ S3 §4 对拍。

## 3. 干跑结果（在备份副本上执行，副本已删除）
| 项 | 结果 |
|---|---|
| 写入行数 | records 6 + entries 6 |
| ACTUAL 合计 | **104,814.51** |
| entries 合计 | **104,814.51** |
| 逐月 | 33,347.55 / 10,919.10 / 10,048.90 / 24,441.24 / 12,266.47 / 13,791.25 |
| `integrity_check` / `user_version` | ok / 8 |
| PLANNING 13,000 | 未变 |
| debts 5 / debt_period_facts 10 / expenses 831 / expense_records 832 | 未变 |
| 二次执行 | 0 新增，6 条 UNIQUE 报错（防重复生效） |

## 4. 为什么本轮没写入活库（BLOCKED，访问边界）
- 授权工作区原文：`authorized_workspace: /Users/linte/Documents/ChatGPT`（本轮为审核员发起，非 Owner 回合）。
- 工具名：`bash` / `write`（文件与 shell 工具）。
- 目标路径：`/Users/linte/Library/Application Support/com.personalfinance.console/personal-finance-console.sqlite3`（在授权工作区外）。
- 已尝试动作：**无越界动作**（依据身份上下文即判定边界，不做越界读写试验）；仅在授权工作区内读备份副本、写脚本、干跑。
- 结论：22:59 那次备份之所以成功，是因为当时是 chris 本人发起的回合；边界**按回合生效**，换审核员发起即收回。故 Phase 1 需在 chris 发起的回合执行 `RUN-PHASE1.sh`，或由管理端把活库目录永久纳入授权工作区。

## 5. 待确认的一个技术风险（写入后立即验）
`income_records(ACTUAL)` 与 `income_entries` 现在会同时持有同 6 笔金额（方案要求双写）。STAGE0 已实测「同月三个收入数互不连通」，若某视图同时汇总两表，2026-10 会显示 27,582.50（13,791.25×2）。写入后必查首页「本月实际收入」：出现双计即按 §5 停手回报，不自行改代码。
