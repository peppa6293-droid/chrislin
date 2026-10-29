# Phase 1 闭环 · 生产完整性锚点重新签发（rotation）执行报告

执行时间：2026-10-28 23:56（CST）｜执行人：小钱家执行员（AI）｜授权：chris 本回合「执行 rotation」（23:54 授权，范围＝为已核验的 Phase 1 状态重新签发生产完整性锚点）
结论：**锚点 rotation PASS，生产 App 已正常启动**；第 9 条截图证据 **部分满足**（详见 §6，首页本轮没有「本月实际收入」元素，需审核员裁定）。

---

## 1. 停摆根因（实测复现）

App 启动即崩：`PRODUCTION_TERMINAL_INTEGRITY_INVALID: PRODUCTION_INTEGRITY_STATE_CONTENT_MISMATCH`（src-tauri/src/lib.rs:1286 → 1013）。

门闸的启动权威不是库文件 sha256，而是库内 `production_integrity_state` 的**带 HMAC 的哈希链头**（`sequence / previous_digest / content_digest / tag`）。App 只在**自己经手的写入**里推进该头；Phase 1 的 12 条 INSERT 走的是 sqlite3 CLI，头没有推进，于是记录的内容摘要仍是 Phase 1 之前的那一版 → 合法写入被当成篡改。

实测证据：
| 项 | 值 |
| --- | --- |
| 库内 sequence | 58 |
| 库内 content_digest | `bdf712da619520c768c6bb4eaed3a2ddeb0a99de18c0ad62fbd26a765cd5f5df` |
| 当前内容实算 content_digest | `6fd44af6d4abd6a0a53f4dcfd0a572f9e2702b534c63885a01a04c9f971e0f86` |
| 用终端 `integrityKey` 复算旧状态 tag | **与库内 tag 完全一致**（证明复算实现与 App 同算法，不是猜的） |

## 2. 执行方式（只重签锚点，不碰业务数据）

- 新增一次性工具 `scripts/production-integrity-anchor-rotation.py`，默认 dry-run，`--apply` 才写；实现与 App `advance_production_integrity_state` 完全一致：
  `sequence+1`、`previous_digest = 旧 content_digest`、`content_digest = 当前内容摘要`、`tag = HMAC-SHA256(key, "PFC_PRODUCTION_INTEGRITY_V1\0" || seq || prev || content)`。
- 写入范围：**仅 `production_integrity_state` 单行**（该表被设计排除在内容摘要之外），业务表 0 写入。
- **未修改任何 `production-v8-*.json`**：终端文件 sha256 `0f480aba…dc0ec7` 与执行前副本逐字节一致，mtime 仍为 10-27 11:44:46；receipt / ledger / rotations 全部未动。
- 先 dry-run（计划留档），再 `BEGIN IMMEDIATE … COMMIT` 单事务落盘，落盘前后各校验一次。

## 3. 前后对照

| 项 | 执行前 | 执行后 |
| --- | --- | --- |
| sequence | 58 | 59 |
| previous_digest | `31d50c43…e296820` | `bdf712da…cd5f5df`（＝旧 content_digest） |
| content_digest | `bdf712da…cd5f5df`（过期） | `6fd44af6…f971e0f86`（＝当前内容） |
| 库 sha256 | `abb84197355280c2…b183e0` | `dfa4e5bfa5df3792…41056faa5` |
| 库 inode / dev | 30715175 / 16777233 | **不变** |
| 库 mtime | 10-28 23:21:04 | 10-28 23:56:29（仅锚点行） |
| 业务行数 income_records/income_entries/debts/facts/expenses/expense_records | 7/6/5/10/831/832 | **完全相同** |
| 收入合计（ACTUAL / entries） | 104,814.51 / 104,814.51 | **完全相同** |
| integrity_check | ok | ok |
| sidecar（-wal/-shm） | 无 | 无 |

执行后 8 项自检全 True：sequence、previous_digest、content_digest 与文件实算一致、tag 可验、integrity ok、无 sidecar、业务行数不变、文件身份不变。

## 4. 启动验证

`open -a "/Applications/Personal Finance Console.app"` → 进程 PID 71095 存活，**无 panic**，窗口「小钱家」正常渲染，日期显示 2026 年 10 月。启动后库未被额外写入（sha 仍 `dfa4e5bf…`、mtime 仍 23:56:29）。

## 5. 证据清单（本目录）

| 文件 | sha256 |
| --- | --- |
| `APP-HOME-2026-10-20261029-0000.png` | `0a26fc25…eb384b` |
| `APP-INCOME-2026-10-20261029-0000.png` | `dde7612b…fdb6919` |
| `INTEGRITY-ANCHOR-ROTATION-RECORD-20261028.json` | `e2c538b9…8feef8d` |
| `INTEGRITY-ROW-BEFORE-20261028.txt` | `ac705f6d…22a63bbc` |
| `ANCHOR-EVIDENCE-SHA256.txt` | 上表汇总 |

完整审计（含终端执行前副本、库执行前副本、rotation-record）在：
`~/Library/Application Support/com.personalfinance.console/production-v8-hotfix-audit/phase1-integrity-anchor-20261028-235629/`
（该目录 700、终端副本 600；**含完整性钥匙的副本未进 git、未进 evidence**。）

## 6. 第 9 条截图证据：现状与本轮边界（需审核员裁定）

- **首页（APP-HOME…png）**：2026 年 10 月正确，卡片显示「收入 ¥13,000.00」＝**计划收入**。该生产包（候选 `35c69ba5…`，10-27）首页**没有**「本月实际收入」这一元素——那是 P1-b/主卡实际收入改版的内容，按纪律尚未放行、未进生产包。
- **收入页（APP-INCOME…png）**：由 App 自己从活库渲染，显示「本月收入记录 1 笔」「已到账 2026-10-20 **¥13,791.25**」「稳定月收入 ¥13,000.00」；**全页无 27,582.50**，无双计。
- 因此：验收条件 ④ 的「首页显示 13,791.25」在现包上**不可能满足**（不是数据问题，是 UI 未发布）；但「13,791.25 真实到账、无 27,582.50」已由 App 端 UI 坐实。
- 请审核员二选一：**(A)** 以「启动成功＋收入页 13,791.25/1 笔/无双计」作为 Phase 1 证据，第 9 条按 PASS 收；**(B)** 维持 BLOCKED_EVIDENCE，等 P1-b 首页主卡实际收入上线后补首页截图。执行员不自行改判。

## 7. 回滚入口

1. 行级：`UPDATE production_integrity_state SET sequence=58, previous_digest='31d50c43…e296820', content_digest='bdf712da…cd5f5df', tag='<见 INTEGRITY-ROW-BEFORE-20261028.txt>' WHERE singleton=1;`
2. 文件级：`…/production-v8-hotfix-audit/phase1-integrity-anchor-20261028-235629/personal-finance-console.before-anchor.sqlite3`（1,294,336 字节，sha `abb84197…b183e0`）。
3. 终端 JSON 未动，无需回滚；业务表未动，无需回滚。

## 8. 红线自查

未手改 `production-v8-*.json`；未写任何业务表；未重跑 Phase 1；未改代码/未重建包；未提交 git；未把完整性钥匙写入 evidence；仅 Owner 回合执行。
