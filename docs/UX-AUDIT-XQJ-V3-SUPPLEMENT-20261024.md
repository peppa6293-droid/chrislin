# 小钱家 V3 · UX 审计定向补证报告 — 2026-10-24

- 定位：对 `docs/UX-AUDIT-XQJ-V3-20261024.md`（原报告，保留不覆盖）的定向补证。不做全量重审、不改生产代码/数据库、不进入开发。
- 方法：真实 App 只读走查（macOS 辅助功能树为主 + 窗口级截图为辅）+ 只读代码核对。凡「代码」结论均已注明，未冒充实际体验。
- 取证目录：`/tmp/xqj-sup-20261024/`
- 遮挡说明：ChatGPT 桌面端持续占据前台。`screencapture -l<WID>` 窗口级截取成功 4 页（数据与隐私 / 流水 / 记一笔 / 债务）；「设置安全目标」「资产详情」两页窗口 ID 无法解析，像素证据缺失，仅以 AX 树为准（标记 NOT_TESTED-pixel）。

## 1. 补齐的真实界面走查（5 页）

| 页面 | 判定 | 入口 | 实测内容 | 证据 |
|---|---|---|---|---|
| 财务概览 | VERIFIED（AX） | 我的财务 → 财务概览 | 收入 ¥0.00 / 经常性收入 ¥0.00 / 日常支出 ¥9,359.32 / 账户现金 ¥5,325.93；信用卡「当前没有待还账单。」；储蓄「还没有设定储蓄目标。」；**资产 / 债务 / 资产更新 三项均「待接入」**；趋势「暂无趋势数据。」 | `ax-overview.txt` |
| 设置安全目标 | PARTIAL（仅 AX） | 我的财务 → 设置安全目标 | 编辑安全目标 / 查看安全目标历史；「安全垫目标：」「最低现金保障：」（含 2/6/个月 片段） | `ax-safety.txt`；像素 NOT_TESTED（遮挡） |
| 数据与隐私 | VERIFIED（AX+像素） | 我的财务 → 数据与隐私 | 三卡：数据存在哪 / 备份与迁移 / 导出格式；明言「当前版本还没有整包恢复入口」 | `ax-privacy2.txt` + `re-04-privacy.png` |
| 全部流水 | VERIFIED（AX+像素） | 记录 → 查看全部流水 | 上一月/下一月切换、自动归类、导出备份、每条记录 编辑/删除 | `ax-ledger.txt` + `re-05-ledger.png` |
| 记一笔（完整表单） | VERIFIED（AX+像素） | 顶栏 + 记一笔 | 仅消费：金额 / 分类 chips（吃饭·出行·买东西·娱乐·日用·其他）/ 日期 / 备注（选填）/ 保存消费。**无事件类型选择器**——转账、还款、收入、退款均无入口 | `ax-entry.txt` + `re-06-entry.png` |

![数据与隐私](/tmp/xqj-sup-20261024/re-04-privacy.png)
![全部流水](/tmp/xqj-sup-20261024/re-05-ledger.png)
![记一笔表单](/tmp/xqj-sup-20261024/re-06-entry.png)
![债务详情](/tmp/xqj-sup-20261024/re-08-debt.png)

关键发现：

1.1 **概览页与详情页数据源断裂**。财务概览把资产/债务标为「待接入」、收入 ¥0.00，但债务详情页实有 ¥172,579.53（5 笔）、资产详情页有 6 项资产、我的财务四卡有值。概览读的是 V8 `income_entries`（无生产写入口，恒为空，见 §2），而结构卡读 V1 规划收入——同一 App 内两套收入口径并存，与 2026-10-23 用后反馈「卡片口径混搭」同源。

1.2 **记一笔闭环缺口在 GUI 层坐实**：表单仅消费一类，转账/还款/收入/退款无入口（与 §3 代码结论一致）。

1.3 **备份是单向的**：数据与隐私页自述「当前版本还没有整包恢复入口」，换机迁移只能保数据目录，无 UI 恢复路径。

## 2. V8 数据接线核查（只读，未删任何表/字段/迁移）

| 结构 | 生产写方 | 生产读方 | UI 入口 | 测试 | 判定 |
|---|---|---|---|---|---|
| `fixed_expense_plans` | 无。`create/update/deactivateFixedExpensePlan`（repositories.ts:1234-1321）仅 tests 调用 | `getMonthlyCoreObligations`（v2-expense-service.ts:425-435）——但该方法**生产零消费者**（仅 tests:573-574） | 无。固定支出页 `FixedExpensesPage.tsx` 走的是 V1 `essential_*`（listEssentialPayments / recordEssentialPayment，:59-144），不读此表 | v2-expense-service.test.ts:502-631 | **仅存在数据库结构**（读写双悬空；「固定支出」的真实 UI 载体是 V1 essential 路径） |
| `income_entries`（含 `one_time`） | 无。`recordIncomeEntry`（v2-expense-service.ts:319）仅 tests 调用；维护弹窗「记录本月收入」写 `income_records`（V1，financial-maintenance-service.ts:327 → repositories.saveIncome :744 INSERT INTO income_records） | 活。`getDashboardProps`（:373-389）汇总 income / recurringIncome / incomeIncludesOneTime → 概览页「收入 ¥0.00 / 经常性收入 ¥0.00」 | 间接（概览展示） | dashboard-route.test.tsx:128,137,255；v2-expense-service.test.ts:298-586 | **接线不完整（读通写断）**：UI 恒显 ¥0.00，与实测一致 |
| `cash_accounts.reserved_amount` | 无。`setCashAccountReservedAmount`（repositories.ts:1210）仅 tests 调用 | 活。安全储备计算 `freeCash = safetyResources − reserved`（v2-expense-service.ts:405-425） | 无。维护弹窗勾选框是 `include_in_safety_resources`，**不同字段** | v2-expense-service.test.ts:415-613 | **接线不完整（读通写断）** |

结论：原报告 §3.6「schema V8 疑似悬空」**坐实且比疑似更重**——三者均无生产写入口；`fixed_expense_plans` 连读链也断（唯一读者无生产调用方）。本报告依任务约束不建议删表删列，接线/保留/重排由产品规划裁决。

## 3. 财务操作现状（GUI 实测与代码结构分开陈述）

| 操作 | GUI 实测结论 | 代码结构结论 | 综合 |
|---|---|---|---|
| 转账记录 | 记一笔表单无转账入口（VERIFIED，`re-06-entry.png`） | 无 TRANSFER kind、无转账服务/仓储方法 | **未实现**（两侧一致） |
| 信用卡还款 | 债务详情页列表/编辑/停用/新增/查看历史 VERIFIED（`re-08-debt.png`）；「记一笔还款」面板代码存在（HomeScreen.tsx:862-958，route DEBT_DETAIL「债务还款」:53），但本轮走查未截到进入该面板的按钮 | `recordDebtRepayment`（ux-ledger-service.ts:570）：双写 `debt_revisions`+`debt_period_facts`、校验超额、对账反馈；**不扣现金账户、无本金/利息拆分** | **部分实现**（仅债务侧；现金联动与利息缺失） |
| 资产估值维护 | 资产详情页 新增/编辑/停用/查看历史 + 纳入/不纳入安全储备 VERIFIED（`ax-asset.txt`）；**异常：页内总额 0.00 vs 仪表盘卡 ¥40,000** | `saveAssetSnapshot`（repositories.ts:1113）两条写路：onboarding（product-service.ts:351）与维护 patch（financial-maintenance-service.ts:353/521 mergeRows） | **入口存在**；显示口径异常待查（§5.3） |
| 退款 | 无入口（VERIFIED：表单仅消费） | 无代码 | **未实现** |
| 一次性收入 | 无入口（VERIFIED） | 字段存在但生产无写方（§2） | **不可用**（结构先行） |
| 周期账单处理 | 固定支出页可达（V2StructureCard.tsx:85-100「查看固定支出」→ route FIXED_EXPENSES，HomeScreen.tsx:274） | V1 essential 路径活（list/save/recordEssentialPayment）；V8 `fixed_expense_plans` 悬空（§2） | **部分实现**（V1 载体在跑，V8 计划表未接） |

**对原报告 §3.2 的修正**：原文将还款整体列为缺失；补证确认债务侧还款原语已存在（服务 + UI 面板 + 双账本写入 + 对账反馈）。真实缺口收窄为三点：还款不联动现金账户、无本金/利息处理、还款不进流水口径。依任务约束「不以增加枚举字段为前提直接制定数据库迁移」，本报告只陈述缺口，实现路径（扩枚举、独立表、或复用 essential-payment 模式）交由产品规划比较。

## 4. 原报告修正项

**4.1 边界更正（原 §4 新增 #5）**——原文「子分类、多账本：明确不做或推迟——单用户本地 app 收益低、复杂度高」**越权**：Owner 已将多账本、自定义分类、分类下钻列为 V3 核心规划（`PRODUCT-VISION-XQJ-V3-20261024.md` 第 3、6 章）。本报告撤回该「不做」处置，需求原样保留；仅提供成本/依赖评估供规划参考：

- 子分类：`expense_categories` 扁平（migrations.ts:267-281，无 parent/sort 列）；改造波及记一笔 chips、进展页环形图聚合、导入自动分类规则、CSV 导出字段四处读路径。
- 多账本：现表以 `profile_id` 单值隔离；所有汇总查询（概览/趋势/四卡/核心义务）需增加账本维度；双账本 revision+fact 模式已有先例可沿用。
- 架构障碍评估：两者均非高难，但触碰全部聚合读路径；建议排在 V0.2 写入口（转账/还款联动）之后，避免汇总口径二次返工。**最终排期归 Owner / 产品规划。**

**4.2 状态升级/更正**：

| 原条目 | 原判 | 补证后 |
|---|---|---|
| #16 财务概览 | 入口存在，页面未到达 | 已到达（AX）；新增发现「待接入」×3 + 收入 ¥0.00 口径断裂（§1.1） |
| #17 设置安全目标 / 数据与隐私 | 入口存在，页面未到达 | 均已到达；安全目标仅 AX（像素被遮挡），隐私 AX+像素 |
| #18 V8 三结构 | schema 先行，UI 接线未验证 | 已验证：三者全部无生产写入口，`fixed_expense_plans` 读链亦断（§2） |
| #20 还款 | 未实现 | **部分实现**：债务侧原语存在（服务+UI 面板），缺现金联动/利息/流水口径（§3） |
| #21 资产估值维护 UI | 记账式入口未见 | **入口存在**：新增/编辑/停用/历史按钮 AX 实证；附总额显示异常 |
| #25 债务还清预测 | 未实现 | 维持未实现；补充：`debt_period_facts` 已有逐期余额事实，可作纯展示层计算基础（原新增 #4 依据成立） |
| #14 streak | 前端可见性未验证 | 仍 NOT_TESTED：本轮全部 AX 清单无 streak 字样 |

**4.3 维持不变**：#1–#13、#15、#19、#22、#23、#24 的事实结论不变（#23/#24 的「未实现」是现状描述；其「不做」处置已由 4.1 撤回）。

## 5. 仍未确认的风险

1. 设置安全目标、资产详情两页像素截图未取得（前台遮挡、WID 解析失败）——视觉层问题（截断/重叠/对比度）未覆盖，仅有 AX 文本。
2. 「记一笔还款」面板的 GUI 进入按钮本轮未截到（代码 route 存在）——可达性 PARTIAL，下轮点击验证。
3. 资产页总额 0.00 vs 仪表盘卡 ¥40,000——口径断裂或渲染 bug，待开发侧定位。
4. 财务概览「待接入」×3 与详情页真实数据并存——是 V3 占位设计还是接线遗漏，需产品口径确认；若是占位，当前文案会让用户以为功能缺失。
5. 安装包装配核验缺口：Bundle Resources 标记 grep 为空（资源疑嵌入二进制），本报告代码结论基于 worktree 源码（HEAD 2026-10-22，二进制 mtime 2026-10-23 18:37），未反编译比对——存在「源码有、包装备无」或反向的理论可能。
6. `income_entries` 读路活而写路断：未来若换表接线，`getDashboardProps` 现有聚合需同步改动，构成隐藏耦合。

## 6. 证据索引

- AX 清单：`/tmp/xqj-sup-20261024/ax-overview.txt`、`ax-safety.txt`、`ax-privacy2.txt`、`ax-ledger.txt`、`ax-entry.txt`、`ax-debt.txt`、`ax-asset.txt`
- 窗口级像素（未被遮挡污染）：`re-04-privacy.png`、`re-05-ledger.png`、`re-06-entry.png`、`re-08-debt.png`
- 像素失败页：设置安全目标 / 资产详情（`re-10-safety.png` 未生成，WID 空）
- 代码：`src/persistence/migrations.ts`（V6–V8）、`src/persistence/repositories.ts`（:744/:1113/:1167/:1210/:1234-1321）、`src/application/v2-expense-service.ts`（:319/:373-435）、`src/application/financial-maintenance-service.ts`（:327/:353/:521）、`src/application/ux-ledger-service.ts`（:570/:822）、`src/application/product-service.ts`（:351）、`src/ui/HomeScreen.tsx`（:46/:53/:274/:288/:862-958）、`src/ui/FixedExpensesPage.tsx`（:59-144）、`src/ui/V2StructureCard.tsx`（:85-100）、`src/ui/V2RepaymentDetail.tsx`
- 测试：`tests/v2-ledger/v2-expense-service.test.ts`（:298-631）、`tests/v2-ui/dashboard-route.test.tsx`（:128-255）