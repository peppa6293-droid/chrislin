# R13B 授权热修发布：包指纹重绑定与收尾验收回执

日期：2026-10-23
执行依据：`docs/EXEC-R13B-HOTFIX-RELEASE-REBIND.md`（户主已拍板 A1，2026-10-22）
授权编号：`owner-approval-r13b-20261022-1`
结论：**R13B_PARTIAL**

门闸重绑定、授权留痕、启动、退出重开、SQL 只读锚点全部通过；**唯一未通过项是任务书 §5.2 的「首页已花 = 100,513.11」这一锚点口径**——该数字是 `expense_records` 全量累计总额（实测精确相等），不是首页读数；首页「已花」按产品定义是当月支出，实测 ¥8,635.27，也与库内 2026-10 合计精确相等。按 §5「一项不过即 PARTIAL」判 PARTIAL，属任务书锚点标注问题，不是功能或数据缺陷，详见 §4 与 §9。

---

## 1. 预检（全只读）

日志：`00-preflight.log`

| 项目 | 实测 | 判定 |
|------|------|------|
| 三件套旧候选指纹 | terminal / receipt / ledger 均为 `444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c` | ✅ 与 R13 回执一致 |
| terminal 交叉哈希 | `releaseReceiptSha256` = 回执实测哈希；`consumedLedgerSha256` = 台账实测哈希 | ✅ |
| 台账记录数 | 1 条 | ✅ |
| permit 文件 | `production-v8-migration-authorization.json`、v4 变体均不存在 | ✅ |
| 轮换日志 | 不存在（未重复轮换） | ✅ |
| 生产库 SHA-256 | `857fda164fdb0a46853a8f9a716d2bc0099ebce898984228b208d4f16e6d2a2f` | ✅ |
| `/Applications` 可执行实测 | `ea430fe97dac79c006d7a86558454f2f0a6d5a5522699e796d545e7b60f44baa` | ✅ = §2 目标指纹 |
| 运行进程 | 无 | ✅ |
| 三件套元数据 | mode 0600、uid 501、nlink 1 | ✅ |

## 2. 授权文件

- 路径：`~/Library/Application Support/com.personalfinance.console/production-v8-hotfix-release-authorization.json`（0600，732 B，**不进 git**）
- 授权 ID：`owner-approval-r13b-20261022-1`
- nonce：`tNz9lmTmT85Ao2WDzU99WJLRg3i-V4QDGuPw5floinI`
- issuedAtUtc：`2026-10-22T16:03:12.233Z`
- SHA-256：`a734e2e7e99a0164b902fcd6f588c1c4421cddc6b5a61261a1b865dff73e094f`
- 范围：仅限任务书 §3 字段清单；不含代码、数据、迁移操作。

## 3. 审计副本

改前两份副本（均含完整性钥匙，**只留本机**，不进 git、不进 evidence/）：

- 副本 A：`…/production-v8-hotfix-audit/r13b/`（0700）
- 副本 B：`…/backups/pre-r13b-gate-20261023-000315/`（0700）
- 哈希登记表：`01-audit-copies.sha256`

| 文件 | 改前 SHA-256（两份副本一致） |
|------|------------------------------|
| `production-v8-cutover-terminal.json` | `46d4e4405437789281e949b64faaadffca2356528cd1813dc01c4ddc204ccbcc` |
| `production-v8-release-receipt.json` | `93bb61952eee41c7d7df76de9321b7e66086b3789aa116d5daaf40012c68361b` |
| `production-v8-consumed-authorizations.json` | `4b337dcd7ff490e05162d5530076b43330e591b02d53a752e6d3084f9a867bbf` |

## 4. 字段 diff（应仅 §3 清单项）

脚本：`scripts/r13b-rebind-candidate-binding.mjs`（支持 `--dry-run`，原子写，保持原权限）。
dry-run 与实跑后独立复核均为同一结果：`02-dry-run-diff.json`、`04-post-rebind-verify.log`

| 文件 | 实际改动路径 | 是否在 §3 清单内 |
|------|--------------|------------------|
| 回执 | `candidateExecutableSha256` | ✅ |
| 回执 | `productionAppInventory[0].executable_sha256` | ✅ |
| 回执 | `hotfixReleaseRotation`（新增，恰 6 键） | ✅ |
| 台账 | `[0].candidateExecutableSha256` | ✅ |
| 终态 | `candidateExecutableSha256` | ✅ |
| 终态 | `releaseReceiptSha256` | ✅ |
| 终态 | `consumedLedgerSha256` | ✅ |

迁移历史字段（授权 ID / nonce / 消耗时间 / 迁移前后库哈希 / 备份绑定 / schema / 完整性钥匙 / migration 授权哈希）逐值比对**全部未变**；终态未新增任何键；台账仍恰 1 条。

改后哈希：

| 文件 | 改后 SHA-256 |
|------|--------------|
| terminal | `61457ae72f493c6f832cf68f4b348f9b2e262123c6b7903ae8edc9cbaeda64b7` |
| receipt | `66dc64e66612ef3471862d43c0967672e09901368600c42e7d4acdfb6ac0d9db` |
| ledger | `8a15ea3130afff8aaf9d4cc579179fcb3a22b35023a17a3eea189cb5a2c6a7fe` |

## 5. 轮换日志

- 路径：`…/production-v8-hotfix-rotations.json`（0600，3102 B，纯审计，门闸不读；**不进 git**）
- SHA-256：`6d7952953c2a6cafe44bb58c3a275b68ec6a0891269e431a1e16ff4ea0cfeab3`（登记：`05-rotation-log.sha256.txt`）
- 已原样写入 §1 语义说明：候选指纹含义由「执行迁移的包」更新为「当前授权生产包」，迁移事实由历史字段与审计副本继续作证；这是经授权的绑定轮换，不是篡改迁移记录。
- 含授权 ID、旧/新指纹、时间、两份审计副本路径与逐文件哈希、授权文件哈希、`gateReadsThisFile:false`。

## 6. 真库启动

`10-launch.log`：`open` 退出码 0；6 秒后进程在（PID 12818）；窗口 `小钱家 840×580`；无 panic、无 `PRODUCTION_*` 错误码。

**正常进入首页**，无「暂时打不开账本」。（截图 `11-home-fullscreen.png`、`12-home-window.png`）

## 7. 界面回读

| 项目 | 任务书期望 | 实测 | 判定 |
|------|------------|------|------|
| 首页「已花」 | 100,513.11 | **¥8,635.27** | ⚠️ 口径不符（见下） |
| 债务笔数 | 5 笔 | **5 笔** | ✅ |
| 本月必须还款 | 14,518.73 | **¥14,518.73** | ✅ |
| 现金 | 5,325.93 | **¥5,325.93**（4 个账户） | ✅ |
| 安全资源 | 25,325.93 | **¥25,325.93** | ✅ |
| F1 仪表盘占位 / 收入 0.00 | 不判失败 | 未接线占位 | ✅ 不判失败 |

截图：`13-home-clean.png`（已花 / 本月要还）、`14-safety-detail.png`（安全储备 25,325.93）、`15-my-finance.png`（现金 5,325.93 / 资产 40,000.00 / 债务 172,579.53 · 5 笔 · 本月必须还款 14,518.73）。

### 7.1「已花」锚点口径核对（本次唯一偏差）

只读 SQL 三方对数：

| 量 | 值 | 与锚点关系 |
|----|-----|-----------|
| 首页「已花」（当月 2026-10） | 8,635.27 | = `expense_records` 2026-10 合计 **8,635.27**（106 笔），精确相等 |
| `expense_records` 全量累计 | 100,513.11 | = 任务书写的 100,513.11，**精确相等** |
| 导入关联行（`expenses.import_batch_id NOT NULL`） | 100,450.11（824 笔） | = 任务书 §5.3「导入总额 100,450.11」，精确相等 |
| 差额 | 13.10 + 49.90 | 13.10 为仅存在于 `expense_records` 的 1 笔（2026-10-05）；49.90 为库内既有非导入支出 |

结论：**100,513.11 是 `expense_records` 全量累计总额，不是首页读数**；首页「已花」按产品定义（`V2HomeSurface.tsx:484` → `home.currentMonthSpending` → `model.spending.actualVariableSpending`，只统计当月）显示当月 8,635.27，两数都精确对库。任务书 §5.2 把累计总额错标为首页读数。未改库、未改数、未改代码去凑数。

## 8. SQL 只读复核（`22-sql-readback.log`）

`sqlite3 "file:$DB?mode=ro&immutable=1"`，全只读。

| 指标 | 锚点 | 实测 | 判定 |
|------|------|------|------|
| `expenses` | 825 | 825 | ✅ |
| `expense_records` | 826 | 826 | ✅ |
| `import_batches` | 12 | 12 | ✅ |
| 导入总额 | 100,450.11 | 100,450.11 | ✅ |
| 0 元行总数 | 14 | 14 | ✅ |
| 2026-10 内 0 元行 | 3 | 3 | ✅ |
| 2026-10 债务合计 | 172,579.53 | 172,579.53（5 笔） | ✅ |
| 2026-10 本月应还 | 14,518.73 | 14,518.73 | ✅ |
| `PRAGMA user_version` | 8 | 8 | ✅ |
| `PRAGMA integrity_check` | ok | ok | ✅ |

逐笔：京东白条 2,198.70 / 657.46；招商分期 46,605.10 / 5,679.47；浦发车贷 118,137.60 / 3,487.87；美团月付 331.37 / 331.37；花呗 5,306.76 / 4,362.56。

## 9. 退出重开复核

- 退出：`osascript … to quit`（按 bundle id）退出码 0，100 ms 后无进程。
- 重开：`20-reopen.log` / `21-reopen-home-wide.png`，`open` 退出码 0，进程在（PID 15404），窗口正常，**直接进入首页**，读数与退出前一致：已花 ¥8,635.27、本月要还 ¥14,518.73、手头余地 0.30 个月。
- 启动日志中无 panic、无门闸错误码。

## 10. 库文件哈希（验收后）

- `857fda164fdb0a46853a8f9a716d2bc0099ebce898984228b208d4f16e6d2a2f`（= 验收前，= pre-r13 备份）
- size 1282048，mtime `2026-10-22T22:44:36+0800`（未变化）
- pre-r13 备份哈希同为 `857fda16…`，完好。
- 三件套验收后元数据：均 0600 / uid 501 / nlink 1；哈希与改后登记一致；轮换日志与授权文件在位。
- 日志：`23-db-hash.log`

**本批未写入库，无任何合法写入需要解释。**

## 11. 红线自查

1. SQL 全部 `mode=ro&immutable=1`；未删改任何数据行；未动 `production_integrity_state`。✅
2. **零代码变更、零重建**：未改 `src/`、`src-tauri/`、`tests/`、UI；`/Applications` 包未动（沿用 R13 已装包 `ea430f…`）。仅按 §4.4 新增一次性脚本 `scripts/r13b-rebind-candidate-binding.mjs`（repo 内）。✅
3. 三件套仅改 §3 清单字段；permit 未创建；两份迁移备份、`.v8-quarantined`、库文件未动。✅
4. 改前两份审计副本 + 哈希登记；改后独立复核 diff 未越界。✅
5. 未出现校验报错或数据异常；唯一偏差为任务书锚点口径，未自行扩大处置。✅
6. 回执未写 COMPLETED。✅

## 12. 异常 / 偏差

1. **§5.2「首页已花 = 100,513.11」口径错误**（唯一未过项）：该值是 `expense_records` 全量累计总额；首页当月读数为 8,635.27，两者分别对库精确。建议审核员把 §5.2 改为「首页已花 = 8,635.27（当月）」，并把「全量累计 100,513.11」单列为库侧锚点；更正后本批全部验收项通过，无需再执行。
2. 无其他偏差。门闸重绑定一次通过，未出现任何 `PRODUCTION_*` 错误码。

## 13. 流程教训确认

已知悉，无需执行：

1. 本批机制为「户主授权下的字段级重绑定 + 审计留痕」；门闸原生热修轮换链（台账多条、链式校验、专用 CLI）列为后续加固项，稳定后做，之前照用本机制。
2. 以后凡「改代码重建」类任务书，必须带热修发布授权段（本任务书 §2–§4 为模板），否则必撞门闸。
3. R13 零元热修代码已封存有效（444/0/80 全绿），本批只做绑定登记，未顺手再改。
