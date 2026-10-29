# EXEC-R13B 授权热修发布：包指纹重绑定与收尾验收任务书（交执行者）

发布者：审核员（拟稿）→ 户主拍板下发 ｜ 发布日期：2026-10-22 ｜ 执行者：**执行员**（非审核员本人）
前置裁决：**户主已拍板 A1（2026-10-22）**——立「授权热修发布」流程：户主签发热修授权、重绑定包指纹后继续 R13 验收。R13_BLOCKED 裁决成立（执行侧停手合规，根因是任务书流程缺口，不是执行偏差）。本任务书即该授权的执行依据。
性质：**P0 收尾**——恢复生产可用性。本批**零代码变更、零重建、零数据改动**，只做门闸绑定文件的授权重绑定 + R13 §5 收尾验收。

---

## 0. 背景摘要（审核员复核结论，已独立核对证据与门闸代码）

1. R13 零元热修本身已完成且质量合格：应用层过滤、回归测试 2 条、全量 444/0/80、typecheck/lint 全绿，库分毫未动（825/826/12、导入总额 100,450.11、0 元行 14、债务 172,579.53 全部对锚）。
2. 新包装好后启动即退：`PRODUCTION_TERMINAL_CANDIDATE_BINDING_MISMATCH`。根因：迁移终态文件把安装包可执行指纹钉死（`production-v8-cutover-terminal.json` 的 `candidateExecutableSha256` 与回执/台账三方交叉校验），**改代码→重建→指纹必变→必拒**，与修复内容对错无关。
3. R13 任务书 §4「重建+安装」与 §4.6/§7.3「不动 terminal/receipt/permit」在该门闸下互斥——**任务书流程缺口**，已按红线 §7.4 停手，处置正确。
4. **没有可等的「下次发布窗口」**：迁移许可一次性已消耗、库已是 V8、V3→V8 迁移不可重跑（恢复 V3 旧备份会毁掉 R11/R12 真数）。今后**任何**改代码重建（含 V0.2 编辑/删除、后续导入配套）都会撞同一堵墙。故必须立本流程，本批做完即恢复可用。
5. 现场：`/Applications` 已是 R13 新包（起不来）；生产库哈希与 pre-r13 备份一致、未写过；旧包已不在（且旧包也过不了 0 元行报错页，恢复旧包不构成方案）；permit 已消耗且不存在。

## 1. 机制定案（审核员架构定案：字段级重绑定，本批不动门闸代码）

**三件套与交叉哈希链**（`~/Library/Application Support/com.personalfinance.console/`）：

| 文件 | 角色 | 交叉校验 |
|------|------|----------|
| `production-v8-cutover-terminal.json` | 迁移终态 + 启动授权 | 内含 `releaseReceiptSha256` ↔ 回执文件哈希；`consumedLedgerSha256` ↔ 台账文件哈希 |
| `production-v8-release-receipt.json` | 发布回执 | 与终态逐字段比对（含 `candidateExecutableSha256`） |
| `production-v8-consumed-authorizations.json` | 已消耗授权台账（0600） | 恰好 1 条记录，指纹须与终态一致 |

启动时门闸（`src-tauri/src/lib.rs` `validate_production_terminal`）拿**当前安装包**的可执行/Info.plist/manifest 三哈希与上述绑定逐一比对，并全量校验其余部分（回执字段、台账、备份身份、库身份、完整性头、schema 回读）。

**本批机制**：在户主热修授权下，**只更新「当前绑定」字段**（三件的候选可执行指纹 + 终态的两个交叉哈希），**迁移历史字段一律原样**（授权 ID、nonce、消耗时间、迁移前后库哈希、备份绑定、schema、完整性钥匙、migration 授权哈希等）。

- 语义说明（须原样写进轮换日志）：候选指纹的含义由「执行迁移的包」更新为「当前授权生产包」；迁移事实由历史字段与审计副本继续作证。这是有意的、经授权的绑定轮换，不是篡改迁移记录。
- **轮换留痕**：新增只追加审计文件 `production-v8-hotfix-rotations.json`（门闸不读它，纯审计；不得放入终态结构）。
- **审计副本**：重绑定前把三件各留两份副本（`production-v8-hotfix-audit/r13b/` 与 `backups/pre-r13b-gate-<时间戳>/`，均在应用数据目录内）。**副本含完整性钥匙，一律不进 git、不进 evidence/**；evidence/ 只收哈希登记与字段 diff。
- **为什么不动门闸代码**：生产正不可用，此时最小化变更面。重绑定后启动即跑全量校验——若有任何越界改动，照样拒启并给出具体错误码，本身就是验收的一部分。门闸原生轮换链（台账允许多条、校验链式绑定）列为后续加固项（§8），不在本批。

## 2. 户主热修授权（落档）

- 授权 ID：`owner-approval-r13b-20261022-1`（本任务书 §前置裁决即户主签发依据）。
- 授权范围：仅限 §3 字段清单内的三件重绑定；不含任何代码变更、数据变更、迁移操作。
- 目标指纹：`/Applications/Personal Finance Console.app/Contents/MacOS/personal-finance-console` 的 SHA-256，**执行时实测登记**。R13 构建的实测值为 `ea430fe97dac79c006d7a86558454f2f0a6d5a5522699e796d545e7b60f44baa`（见 R13 回执 §5）；若实测不符，**停止报告**。若因故被迫重建（预期不会，§7.2 禁止），以新实测为准并记「二次授权漂移」，且须回批。
- 旧指纹（轮换前）：`444729451aafc3bbe6cf95b52ffd84a2191b75f6c1477d0d840656ace4711b5c`（R10 安装包）。
- 执行时生成 `production-v8-hotfix-release-authorization.json`（授权 ID、随机 nonce、旧/新指纹、时间、范围声明「仅限 §3 字段」），登记其 SHA-256，由轮换日志引用；此文件不进 git。

## 3. 允许改动的字段清单（超出清单即作废）

**`production-v8-release-receipt.json`（回执）**：
1. `candidateExecutableSha256` → 新指纹；
2. `productionAppInventory[0].executable_sha256` → 新指纹（文档自洽，门闸不校验此项）；
3. 新增键 `hotfixReleaseRotation`：`{authorizationId, rotatedAtUtc, previousExecutableSha256, newExecutableSha256, previousReceiptSha256, hotfixAuthorizationSha256}`；
4. 其余字段一律原样（含 `status`、`observedAtUtc`、`ownerAuthorizationId`、`migrationAuthorizationSha256`、`productionDatabasePreMigrationSha256`、`backupSha256`、`productionSchema` 等迁移历史字段）。

**`production-v8-consumed-authorizations.json`（台账）**：
1. 仍只允许 **1 条**记录（不得追加第 2 条——门闸校验写死恰好 1 条，本批不动该校验）；
2. `candidateExecutableSha256` → 新指纹；
3. 其余字段（`authorizationId`、`nonce`、`consumedAtUnix`、`compatibilityManifestSha256`）原样。

**`production-v8-cutover-terminal.json`（终态）**：
1. `candidateExecutableSha256` → 新指纹；
2. `releaseReceiptSha256` → 更新后回执文件的 SHA-256；
3. `consumedLedgerSha256` → 更新后台账文件的 SHA-256；
4. **其余字段一律原样**；**不新增任何键**（轮换记录一律放独立文件）。

**始终禁止**：创建/复活 `production-v8-migration-authorization.json`（及任何 v4 变体）；改动 `production_integrity_state`；改动两份迁移备份与 `.v8-quarantined`；改动数据库文件本身；改动 Info.plist / runtime-compatibility.json。

## 4. 执行步骤

1. **预检（全只读）**：三件内容与 R13 回执记录一致（旧指纹 `44472945…`）；生产库 SHA-256 = `857fda164fdb0a46853a8f9a716d2bc0099ebce898984228b208d4f16e6d2a2f`；permit 不存在；`/Applications` 可执行实测哈希 = §2 目标指纹；`pgrep` 按 bundle id 无运行进程。任何不符 → 停止报告。
2. **落档授权**：生成 §2 授权文件并登记哈希。
3. **审计副本**：按 §1 留两份副本 + 全部 SHA-256 登记表。
4. **重绑定**：写一次性脚本入 repo（如 `scripts/r13b-rebind-candidate-binding.mjs`，支持 `--dry-run` 打印字段 diff），严格按 §3 执行；**原子写**（临时文件 + rename，保持原文件权限——台账 0600、其余 0644）；逐件回读校验哈希。
5. **轮换日志**：生成 `production-v8-hotfix-rotations.json`（内容含 §1 语义说明、授权 ID、旧/新指纹、时间、审计副本路径与哈希、授权文件哈希）。
6. **收尾验收**：§5。
7. **证据归档**：§6；红线自查 §7 后写回执。

## 5. 验收（沿用 R13 §5，一项不过即 PARTIAL/BLOCKED）

1. 启动 `/Applications/Personal Finance Console.app`：**必须正常进入首页**，无「暂时打不开账本」、无 panic（若仍报门闸错误，把错误码原文留证并停止——不同错误码对应不同字段问题，不得自行扩大处置）。
2. 界面回读：
   - 首页「已花」= **8,635.27**（当月口径；勘误后锚点，见 §5.6）；
   - 债务 5 笔、本月必须还款 **14,518.73**；
   - 现金 **5,325.93** / 安全资源 **25,325.93**（修订表口径）；
   - 仪表盘 F1 未接线占位/收入 0.00 不判失败。
3. SQL 只读复核（`sqlite3 "file:$DB?mode=ro&immutable=1"`）：`expenses=825 / expense_records=826 / import_batches=12`、导入总额 100,450.11、0 元行仍 14 行（2026-10 内 3 行）、2026-10 债务合计 172,579.53、`expense_records` 全量累计 **100,513.11**（库侧锚点，不是首页读数）。
4. **退出重开**一遍，启动仍正常。
5. 库文件哈希复核：应仍为 `857fda16…`；若变化，必须指明是哪个应用功能经界面产生的合法写入并留证，说不清 = 停止报告。

**勘误（2026-10-23 审核员验收复核）**：原 §5.2 把「首页已花」写成 100,513.11，系**口径误标**——100,513.11 是 `expense_records` 全量累计（导入 100,450.11 + 非导入 63.00），而首页「已花」按产品定义是**当月**支出（`currentMonthSpending` → `model.spending.actualVariableSpending`，只统计目标月），2026-10 实测 **8,635.27**，与库内 2026-10 合计精确相等。两个数各自精确对库，均是正确读数；本勘误只更正锚点标注，**不要求重跑执行**。教训：验收锚点必须写明时间口径——「当月已花」与「全量累计」不得混用；该误标源头在 R12/R13 规划期，本条一并更正。

## 6. 证据

`evidence/r13b-hotfix-release-rebind-20261022/`：`RECEIPT.md` + 预检日志 + 授权文件哈希登记 + 审计副本哈希登记（**不放副本原文**）+ dry-run 字段 diff + 轮换日志哈希登记 + 启动/首页截图（已花、债务、现金）+ 退出重开截图或录屏 + SQL 只读日志。行级数据与含钥匙文件不进 evidence/、不进 git。

## 7. 红线（违反即作废）

1. SQL 一律只读；不删、不改库内任何数据行；不动 `production_integrity_state`。
2. **零代码变更、零重建**：不改 `src/`、`src-tauri/`、`tests/`、UI；预检发现必须重建才能完成 → 停止报告。
3. 三件套只允许按 §3 清单改动；permit 永不得创建；两份迁移备份、`.v8-quarantined`、库文件不动。
4. 改动前后均留审计副本与哈希登记；任何字段 diff 超出清单 = 保留现场、停止、报告。
5. 发现校验报错或数据异常：**保留现场，停止，先报告**，不自行扩大处置。
6. 回执不写 COMPLETED；结论用 `R13B_PASS / R13B_PARTIAL / R13B_BLOCKED`。

## 8. 流程教训与后续项（写进回执确认知悉）

1. 本批机制是「户主授权下的字段级重绑定 + 审计留痕」。门闸原生的热修轮换链（台账允许多条、校验链式绑定、专用 CLI）列为**后续加固项**，待 App 稳定后在正式窗口做；做之前本机制照用。
2. 以后凡「改代码重建」类任务书，**必须带热修发布授权段**（本任务书 §2–§4 为模板），否则必然被门闸拒启。这一条取代 R13 流程教训第 4 条的「先确认」——现在有了合规通道。
3. R13 零元热修代码已封存有效（444/0/80 全绿），本批只是给它「上户口」（绑定进生产授权链）；不得顺手再改。

## 9. 回执格式

```text
R13B_PASS / R13B_PARTIAL / R13B_BLOCKED
预检：三件旧指纹 / 库哈希 / permit 状态 / 当前包指纹实测
授权文件：ID / nonce / SHA-256（不进 git）
审计副本：路径与哈希登记表位置
字段 diff（应仅 §3 清单项）：
轮换日志：路径与 SHA-256
真库启动：正常 / 报错（错误码原文）
界面回读：已花 / 债务（笔数、本月必须还）/ 现金 / 安全资源
SQL 只读复核：expenses / expense_records / import_batches / 导入总额 / 0 元行 / 债务合计
退出重开复核：
库文件哈希（验收后）：
异常/偏差：
```

## 10. 范围外

V0.2 全部功能批（编辑/删除、F5–F8 写入口、F1 仪表盘接线、图标、B3/B4 等）不在本批；不重跑任何迁移；不动 R13 代码；门闸代码改造（加固项）不在本批。
