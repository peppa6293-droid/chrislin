# EXEC-R13 月度模型容忍 0 元支出热修任务书（交执行者）

发布者：审核员 ｜ 发布日期：2026-10-22 ｜ 执行者：**执行员**（非审核员本人）
前置裁决：**审核员建议恢复路径 A（修应用口径 + 重建包），待户主拍板后本任务书方可下发执行**。若户主另选他路，本任务书作废重写。
性质：**P0 热修**——R12 导入后 App 启动被自身模型校验拦死（事故单 `evidence/r12-consumption-import-20261022/INCIDENT-20261022-startup-block.md`）。修的是根因，不动已导入真数。

---

## 0. 事故摘要（已由审核员独立复核）

12 批导入本身完整、精确（`expenses=825 / expense_records=826 / import_batches=12 / 导入总额=100,450.11`，债务 5 笔 172,579.53 未动）；但重新启动后 App 停在「暂时打不开账本 / Stored facts or settings could not be used to calculate the monthly model.」。

根因链（审核员已逐层定位）：

1. 真实账单含 **14 行金额 0.00 的支出**（13 行医院「医保支付(不含自费)」+ 1 行「0 元付定」），按 R12 任务书 §2「金额原样」导入；对金额合计无影响（0.00）。
2. 导入服务（`src/application/v2-import-service.ts:158-166` `moneyText`）只校验金额**格式**，0.00 合法 → 入库成功。
3. 月度模型输入校验（`src/model/validation.ts:223-228`）对 `facts.expenses[].amount` 执行 **POSITIVE** 规则（`>0`），0.00 触发 `NON_POSITIVE_VALUE` → `ModelValidationError`。
4. `src/application/product-service.ts:394-396` 将其包装为 `ApplicationModelError`，`src/ui/App.tsx:287` 渲染全屏报错页 → **整个 App 不可用**。
5. 当月（2026-10）命中 3 行 0.00（10-11 两行医保、10-18 一行 0 元付定），所以立即触发；11 月后只属「绕过」，缺陷仍在（以后再导入含 0 元行的账单会复现）。

**这是应用自身「导入收 0 元、模型拒 0 元」的口径不一致缺陷**，不是转换错误、不是行数/金额锚点不符、不是数据损坏（库 `integrity_check=ok`，行数/金额/债务与锚点逐项对上）。

## 1. 裁决记录（恢复路径为什么选 A）

| 方案 | 裁决 | 理由 |
|------|------|------|
| **A. 修应用口径 + 重建包** | **采纳（本任务书）** | 唯一不丢数据、修根因、且有合法写路径的路线。14 行 0 元是真实消费记录（医保 0 自费支付），留在账本里才是对的；它们对任何金额汇总贡献 0.00。 |
| B. 删掉 14 行 | 否决 | **不存在合规通道**：App 无删除入口（B1）；报错页的恢复面板只能改收支/资产/债务（`financial-maintenance-service.ts`），无支出删除；SQL 直删会触发启动完整性门闸（与 R11 同一堵墙 `PRODUCTION_INTEGRITY_STATE_CONTENT_MISMATCH`），照样打不开。要造「专用删除通道」= 还是改代码重建包，成本不低于 A，还丢真实数据、把锚点改成 810、根因仍在。 |
| C. 等 11-01 | 否决 | App 要瘫到 11 月 1 日，且缺陷未修，每月含 0 元行就复发。 |
| D. 回滚重导 | 否决 | 无 R12 前备份（这是流程教训，见 §8）；现有备份会丢 R11/R11B 真数与户主记账，重放+重导的成本远高于 A，且根因仍在。 |

**修复设计（审核员定案）**：在**应用层边界**把 0 元行挡在月度模型输入之外——`src/model/` 是冻结模型核心（Model Core），**禁止**改 `validation.ts` 的 POSITIVE 规格；正确做法是在 `src/application/monthly-model-service.ts` 组装 `facts.expenses` 处（`monthly-model-service.ts:242`，源数据来自 `:47` 的 `listExpenses`）过滤掉 `amount <= 0` 的行。语义：0 元记录是账本事实（它发生了），但不是「花钱事件」，不进月度计算——对一切金额汇总零影响。

## 2. 修复范围（最小热修，禁止顺手加东西）

**只做三件事：**

1. **过滤**：`buildMonthlyModelInput` 组装 `facts.expenses` 时只保留 `amount > 0` 的支出行（0 元行留在库内、留在流水/导入记录里，只是不进模型输入）。实现用仓库既有金额工具（如 `money(...).gt(0)` / `Decimal`），保持两位小数口径。**只改 `src/application/` 一处**；若你发现其它把支出行喂给 `calculateMonthlyModel`/`calculateSafety` 的入口（如 `financial-maintenance-service.ts` 的 `buildMaintenanceModelInput`），须在回执里列出并同样处理或说明为何不需处理。
2. **回归测试**（`tests/` 内新增）：构造含 1 行 `amount="0.00"` 支出的模型输入 → 不抛错、各汇总金额与不含该行时完全一致；再加一例「全部为 0 元行」的极端。放靠近既有月度模型/应用层测试的位置。
3. **全量验证 + 重建 + 安装 + 真库验证**（§4、§5）。

**明确不做：**

- 不改 `src/model/`（冻结 Model Core，含 `validation.ts` 的 POSITIVE 规则）——0 元行根本不该到达它。
- 不改导入服务行为（导入继续收真实账单的 0 元行，与新口径自洽：账本留痕、模型不计）。
- **不删、不改任何数据行**（14 行 0 元照原样保留；825/826/12 锚点不变）。
- 不改 `src-tauri/`、不动完整性门闸、不改 UI 文案/样式、不做 V0.2 功能（图标/编辑删除/写入口等一律不带）。

## 3. 测试与静态检查

1. 新增回归测试通过。
2. 全量：`npm run test`（基线 442 passed / 80 skipped，允许新增测试后 passed 数上浮，**0 failed**）。
3. `npm run typecheck`、`npm run lint` 全绿。
4. 测试基线变化写进回执（旧基线 442/0/80 → 新基线如实记录）。

## 4. 重建与安装（新候选流程）

1. **安装前留档**：把生产库文件整体复制到 `~/Library/Application Support/com.personalfinance.console/backups/pre-r13-<时间戳>.sqlite3`（只复制文件，不写库）。这是补上 R12 缺失的「操作前备份」纪律。
2. 按 bundle id 退出运行中的 App（不 kill 进程）。
3. 构建：`npm run build` → `npm run tauri:build`（沿用既有开发签名流程）。
4. 安装到 `/Applications/Personal Finance Console.app`（替换）。
5. 登记新锚点：可执行文件与 `Info.plist` 的 SHA-256、包路径。**本次重建是户主批准的热修**，与冻结候选 `e6aa8d5` 的差异如实记为「授权热修漂移」，不是事故。
6. 不动两份迁移备份、`.v8-quarantined`、terminal/receipt/permit 文件。

## 5. 真库启动与回读验收（完成 R12 收尾）

1. 启动 `/Applications/Personal Finance Console.app`：**必须正常进入首页**，无「暂时打不开账本」。
2. 界面回读（R12 §5 顺带收口）：
   - 首页「已花」= **100,513.11**（13.10 + 49.90 + 100,450.11）；
   - 债务读数不因本次变化（5 笔、本月必须还款 14,518.73 一线不崩）；
   - 现金/安全资源按修订表口径（现金 5,325.93 / 安全 25,325.93 一带，见 EXEC-A01 §1.1）不因本次变化；
   - 仪表盘允许仍显示既有 F1 未接线占位/收入 0.00（已知未接线，不判失败）。
3. SQL 只读复核（`sqlite3 "file:$DB?mode=ro&immutable=1"`）：`expenses=825 / expense_records=826 / import_batches=12`、导入总额 100,450.11、0 元行仍 14 行原样。
4. 退出重开一遍，启动仍正常（持久化复核）。

## 6. 证据

`evidence/r13-hotfix-zero-amount-20261022/`：`RECEIPT.md` + 测试/类型/lint 日志 + 新包哈希登记 + 界面回读截图（首页已花、债务、现金）+ SQL 只读日志 + 启动正常录屏或截图至少 1 份。行级数据不进 evidence/、不进 git。

## 7. 红线（违反即作废）

1. 不删、不改库内任何数据行（含 14 行 0 元）；SQL 一律只读。
2. 不改 `src/model/`（冻结 Model Core）；不改导入服务行为；不带任何 V0.2 范围外改动。
3. 不动 `production_integrity_state`、terminal/receipt/permit、两份迁移备份、`.v8-quarantined`。
4. 发现数据异常或修复后仍打不开：**保留现场，停止，先报告**，不自行扩大处置。
5. 回执不写 COMPLETED；结论用 `R13_PASS / R13_PARTIAL / R13_BLOCKED`。

## 8. 流程教训（写进回执确认知悉，不用执行）

1. R12 批量导入前没有做库文件备份（R10 有双备份纪律、R12 任务书漏了）——导致「回滚」选项直接死亡。**以后凡批量写库，任务书必须含「操作前备份」步骤**（本任务书 §4.1 已补上）。
2. 转换脚本的「模拟解析通过」只证明 CSV 格式合法，**不证明应用模型接受**。以后导入任务书的验证段必须含「模型口径试算」（把样本喂进与生产相同的校验路径）。
3. 任务书 §2「金额原样」没有配套筛查 0 元行，是审核员的疏漏；本热修把这条口径补正为「0 元行照实入账、不进月度模型」。

## 9. 回执格式

```text
R13_PASS / R13_PARTIAL / R13_BLOCKED
改动文件（应只有 src/application/monthly-model-service.ts 与 tests/ 新增）：
回归测试名与结果：
全量测试：passed / failed / skipped（旧基线 442/0/80）
typecheck / lint：
新包锚点（可执行文件、Info.plist SHA-256）：
安装前库备份路径：
真库启动：正常 / 报错（截图路径）
界面回读：已花 / 债务 / 现金读数
SQL 只读复核：expenses / expense_records / import_batches / 导入总额 / 0 元行计数
退出重开复核：
异常/偏差：
```

## 10. 范围外

V0.2 全部功能批（编辑/删除、F5–F8 写入口、F1 仪表盘接线、A1 图标、B3/B4 等）不在本批；0 元行的导入端「明确拒收/跳过」选项也留 V0.2 一并裁决（当前口径已自洽，不急）。
