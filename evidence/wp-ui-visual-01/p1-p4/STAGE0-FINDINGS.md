# STAGE 0 · 只读核查报告（P1–P4）

- 任务书：`docs/WP-UI-VISUAL-01-P1-P4-EXECUTION-TASKBOOK-20261028.md` §13.1 段 0
- 执行人：小钱家执行员（AI）
- 执行时间：2026-10-28 13:50–13:55（+0800）
- 代码基线：`e21f1e5`（工作区含既有未提交文档改动；`src/`、`tests/` 本段零改动）
- 结论状态：**`PASS_WITH_CONDITIONS` 不变**；F-06 仍为部分通过（本段未重新判定）
- 本段性质：只读核查 + 探针测试；**未改 `src/`、未改 `tests/`、未碰生产库、未提交**

---

## 0. 一句话结论

收入四态**只在 `income_records(kind=ACTUAL)` 这条“财务维护”通道里齐全**，而用户日常用的 `income_entries`（记收入）没有状态、不收 0/负数——**选哪本账做“实际收入”必须先裁决**；上月月末**取不到**真实的固定支出/规划收入/设置历史（债务只有“当月写过才有”的事实），**P4 的「上月」按现数据结构不可靠**；固定支出与月供**没有任何同笔识别**，同一笔房贷会被算成 6500。这三条都落在 §13.2 停手条件上，**段 1 暂不放行**。

---

## 1. 结论① 收入「缺失 / 待确认 / 为 0 / 为负」能否在数据层真正区分

### 1.1 结论

| 状态 | `income_entries`（V2 记收入，日常入口） | `income_records(kind=ACTUAL)`（财务维护入口） | 家庭总览聚合 `HomeApplicationState` |
|---|---|---|---|
| 缺失（没有记录） | 可判：0 行 | 可判：0 行 | **不可判**：只给 `planningIncome`，缺失与 0 同为 `"0"` |
| 为 0 | **不可表达**：`assertPositiveIncomeAmount` 拒绝 0 与负数 | 可表达：`validateActualIncomeEntries` 允许 `"0.00"` | 不可判 |
| 待确认 | **不可表达**：表里没有 `status` 字段 | 可表达：`status='PENDING'`（另有 `EXPECTED`） | 不可判：`actualIncomeRecordCount` 只给条数，不给状态分布 |
| 为负 | **不可表达**：`INVALID_INCOME_AMOUNT` | 可表达：`-200.00` 实测通过 | 不可判 |

### 1.2 实测证据（探针 `x3*`）

```
x3MissingRows  {"listIncomeRows":0,"planningResolutionAmount":null,"planningResolutionSource":"STABLE_BASELINE"}
x3ExplicitZero {"listIncomeRows":1,"planningRows":["0"],"homePlanningIncome":"0","essentialExpenses":"2000","baseSurplus":"-2100"}
x3Status {
  "actualStatuses":["PENDING"],
  "homeFieldsWithIncome":["actualIncomeRecordCount","planningIncome"],
  "homePlanningIncome":"10000",
  "homeActualIncomeRecordCount":1,
  "negativeActualResult":"OK",
  "negativePlanningResult":"OK",
  "negativePlanningHome":{"planningIncome":"-500","baseSurplus":"-2600"},
  "v2NegativeResult":"INVALID_INCOME_AMOUNT",
  "v2PositiveResult":"OK",
  "homeAfterV2":{"planningIncome":"10000","actualIncomeRecordCount":2},
  "v2DashboardIncome":"8000.00",
  "countBeforeNegative":1,"countAfterNegative":2
}
```

### 1.3 关键事实：产品里同时存在两套「收入」，互不连通

1. **首页结构卡**读 `home.planningIncome`（`src/ui/V2StructureCard.tsx:43,128,138`），来源是 `income_records` 的 `PLANNING` 求和（`src/application/monthly-model-service.ts:52-54`），缺失时由稳定基线兜底（`resolvePlanningIncomeForMonth` 返回 `source:"STABLE_BASELINE"`）。
2. **V2 仪表盘/账本**读 `income_entries`（`src/application/v2-expense-service.ts:370` 起的 `getDashboardProps`，实测 `ledger.income="8000.00"`），与结构卡毫无关系。
3. **财务维护**写 `income_records(kind=ACTUAL)`（`validateActualIncomeEntries`，`src/application/financial-maintenance-service.ts:392`），带 `status`，能被 `actualIncomeRecordCount` 数到，但**没有金额和状态被聚合成任何首页字段**。
4. 同月实测：模型口径 ACTUAL 合计 = `5000 + (-200) = 4800`，V2 账本口径 = `8000`，结构卡口径 = `10000`。**三个“收入”同时存在，没有任何一处对外说明它们是不同的东西。**
5. `actualIncomeRecordCount` 把 `PENDING`、`EXPECTED` 一起计数（实测条数 1→2），所以它也不能当“已确认收入”的信号。

### 1.4 对 X-3 的直接回答

- **不需要改库**就能四态齐全——前提是「实际收入」采用 `income_records(kind=ACTUAL)`。
- **若采用 `income_entries`**（更符合用户“记收入”的日常入口，也与 B-01「未入账即缺失」语义一致），则 **0 / 待确认 / 负收入三种状态在当前 schema 下不可表达**；要让它们可表达就必须改表（新增 status、放开正数约束），**触发 §13.2「收入四态需要改 schema」停手条件**。
- `HomeApplicationState` 只做“状态适配”不够：它现在没有实际收入金额、没有状态分布，X-1 落地必然要新增只读字段（允许），但**字段语义取决于用哪本账**。

---

## 2. 结论② 上月月末能否取到固定支出 / 设置 / 债务的真实历史版本

### 2.1 结论：**不能**（三类资料三种坏法）

以「今天 2026-10-03、查上月 2026-09-30」为实测场景：

| 资料 | 读接口 | 9-30 实测结果 | 真实性 |
|---|---|---|---|
| 规划收入 | `resolvePlanningIncomeForMonth("2026-09","2026-09-30")` | `amount:null`，模型把空值算成 `"0"` | **假 0**（不是“当时收入为 0”，是“当时没有记录”） |
| 固定支出 | `listEssentialExpensesAt("2026-09-30")` | `[]`，模型 `essentialExpenses="0"` | **假 0**（快照 `as_of_date=2026-10-03`，早于它的日期一律查不到） |
| 设置 | `getSettingsAt("2026-09","2026-09-30")` | 返回 `1/1/…`（非 null） | **静默回落**到 `financial_settings` 基行（`repositories.ts:279` `if (!row) return this.getSettings()`），调用方无法区分“9 月真实版本”与“回落值”；连 2026-08（建账前）也返回同一份设置 |
| 债务 | `debtsAt("2026-09","2026-09-30")` | 若债务建于 10-03 → 视为“当时无此债”，`debts=[]`，模型照算；若债务建于 9 月之前但缺 9 月事实 → **抛 `MISSING_DEBT_SNAPSHOT`** | **两种坏法**：要么漏掉整笔债，要么整页报错 |

### 2.2 实测证据

```
x2Before {
  "essentialItemsAtPrevMonthEnd":0,
  "settingsAtPrevMonthEnd":{"safetyCoverageTargetMonths":1,"minimumCashCoverageMonths":1,"desiredMonthlyDiscretionarySpending":"1000"},
  "planningAtPrevMonthEnd":{"amount":null,"source":"STABLE_BASELINE","periodMonth":"2026-09","asOfDate":"2026-09-30","effectiveDate":null},
  "actualRowsAtPrevMonthEnd":0,
  "buildPrevPlanningIncome":"0",
  "buildPrevDebts":0,
  "modelPreviousSnapshotAsOfDate":"2026-10-05",
  "buildNovWithoutFact":"MISSING_DEBT_SNAPSHOT",
  "settingsBeforeOnboardingMonth":{"safetyCoverageTargetMonths":1,...}   // 查 2026-08，建账前，仍返回设置
}
x2MissingFact {"buildPrev":"MISSING_DEBT_SNAPSHOT","homePrev":"MISSING_DEBT_SNAPSHOT"}
x2AfterSeed   {"planningIncome":"0","essentialExpenses":"0","mandatoryDebtService":"100","baseSurplus":"-100","settingsUsedForPrevMonth":{1,1}}
x2EssentialVersions {"atPrevMonthEnd":[],"atRevisionDate":["2600.00"]}
```

### 2.3 两个必须点名的结构性缺口

1. **历史债务事实只有“当月写过才有”。** `financial-maintenance-service.ts:305` 把 `targetMonth` 固定为 `asOfDate.slice(0,7)`，`debt_period_facts` 只在当月写入；`debtsAt` 要求精确月份事实（`repositories.ts:1505`）。因此**用户无法在当前 UI 里补写上月债务事实**，上月视图对“早就存在的债”几乎必然 `MISSING_DEBT_SNAPSHOT`。
2. **`previousComparableDate` 语义与 X-2 冲突。** 模型自带的 `previousSnapshot` 是“上月同日”（实测 `asOfDate=2026-11-05` → 上一期 `2026-10-05`，`monthly-model-service.ts:268`），而 X-2 要的是“上月月末”。两者不能复用；P4 必须另算 `asOf`，且**不得改动模型既有 `previousSnapshot` 输出**。

### 2.4 对 X-2 的直接回答

- **固定支出/规划收入**：早于快照日期的月份一律查不到，只能显示假 0。
- **设置**：永远能“查到”，但可能是回落值，没有“该月无版本”的信号。
- **债务**：只有当月写过事实的月份才可得；其余要么漏债、要么整页错误。
- 结论：**按现数据结构，P4 的「上月」无法满足“真实历史版本”**。三条可选路径（均需裁决，见 §8）：
  a. 只读适配 + **显式“该月无留存资料”分块状态**，不显示 0、不显示数字（最保守，符合 B-05 部分错误语义）；
  b. 允许“按当前资料回填”并加显著徽标（会与“历史版本”语义冲突，需 Owner 确认）；
  c. 写历史快照/补事实（跨出本段只读与 P4 范围，需单独授权）。

---

## 3. 结论③ 固定支出与月供是否存在“同一笔支付”重复源

### 3.1 结论：**存在，且系统完全没有同笔识别**

同一笔房贷同时建成「固定支出·房贷 3000」和「债务·房贷 currentMonthDue 3000」时：`essentialExpenses=3500`（含另一项 500）、`mandatoryDebtService=3000`、负担合计 **6500**，两项各自独立相加，没有任何去重、没有关联字段、没有提示。

### 3.2 实测证据

```
x6Duplicate {
  "essentialExpenses":"3500",
  "mandatoryDebtService":"3000",
  "burden":"6500",
  "debtPaymentSources":["CURRENT_MONTH_DUE"],
  "countedMonthlyPayment":["3000"]
}
x6Payment {
  "afterPaymentEssentialExpenses":"2000",
  "monthTotal":"2000",
  "modelExpenseKinds":["ESSENTIAL"],
  "modelEssentialExpenses":"2000",
  "variableSpending":"0"
}
```

### 3.3 支付动作本身不二次计入，但这不解决计划口径的双计

- `recordEssentialPayment` 只写 `expense_records(kind='ESSENTIAL')`，并写 `ESSENTIAL_PAYMENT_KEY` 元数据；模型只把 `VARIABLE` 行计入可变消费，实测 `variableSpending="0"`，**支付动作不会二次计入**。
- 但 `home.essentialExpenses` / `mandatoryDebtService` 是**计划口径**，双计发生在计划层（同一笔月供既是固定支出又是债务月供），支付记录的隔离对此无效。
- `fixed_expense_plans`（v8 建表）实际上未被首页/模型使用，**不能拿它当“去重来源”**。
- P2 的条目级进度只能靠 `listEssentialPayments(month).itemId`，而历史支付行没有元数据时 `itemId=""`（`ux-ledger-service.ts:574`），会退化成按 category 匹配——**旧数据的条目归属不可靠**。

---

## 4. 结论④ 除任务书三条外，本段新发现且会卡住 P1/P4 的冲突

| 编号 | 冲突 | 证据 | 影响 |
|---|---|---|---|
| R-1 | **“实际收入”有两本账，产品同时展示三个收入数** | §1.3；结构卡 10000 / 维护 ACTUAL 4800 / V2 账本 8000 | X-1 无法在实现层自选；选错会导致 P1 环心与用户“记收入”的心智不一致 |
| R-2 | **主卡公式与模型输出会打架**：D-01 `(月收入−固定支出−月供)÷月收入` 若用实际收入，而 `baseSurplus` 仍由 `planningIncome` 派生，则同一张卡上 8000 的收入配 7900 的余量 | `monthly-model.ts:13`、`spending.ts:24`、`safety.ts:76`；实测 `baseSurplus="7900"`，若环心换 8000 则手算应为 `5900` | 直接违反 D-01 与验收“UI 金额/比例 = 纯函数输出 = 手算”；改模型输出被禁止 → **必须裁决**，不能由实现层“显示层另算一套”糊过去 |
| R-3 | **负数收入只有维护通道能录**；且负的 *规划* 收入会直接进模型（`baseSurplus="-2600"`） | `x3Status` | B-04 负收入态到底绑定哪本账、哪个字段，需明确；否则“负收入”分支永远不可达或误触发 |
| R-4 | **月份切换没有请求令牌**，`useCardsRefresh.track` 只聚合 loading，不保证顺序；`App.tsx` 多处 `setHome(await ...)` 都是“最后返回者赢” | `use-cards-refresh.ts:28-45`；`App.tsx:78-82,110,133` | B-05「旧月份响应覆盖新月份」是**现网真实缺陷**，P4 必须加 request id/序号守卫 |
| R-5 | **历史月整页硬失败**：`MISSING_DEBT_SNAPSHOT` 会从 `buildMonthlyModelInput` 抛出，当前 UI 是整页错误，不是分块错误 | `x2MissingFact`；`product-service.ts:388` 起的 home 构建 | B-05 要求分块「这一块没读出来，点这里重试」；需要决定“哪些块允许降级、哪些整页失败” |
| R-6 | **任务书 P2 行号/入口有偏差**：`FixedExpensesPage.tsx:237` 实际是「添加一项固定支出」按钮，页面**没有导出入口**；`:174` 才是「这个月固定支出」，`:180` 提示行、`:187` 空态基本对得上 | 见 §5.2 | 若照任务书找“导出备份”会改错地方；本轮本来就不新增导出，按现网为准 |
| R-7 | **“所选月份已付占比”在现网不存在**，也没有任何占比展示；它不在 D-01…D-10 的具名文案里 | `grep 已付占比` = 0；`FixedExpensesPage` 无圆环 | 属新增可见文案/新增视觉，需确认已获 Owner 授权（chris 口头点过名），否则触 §13.2「新增文案」 |
| R-8 | **200% 字号阻塞点仍未闭环**：产品目前没有双环，参考资产在 200% 下断行 4 处 | 参考资产 F-01/F-02；产品 `V2StructureCard` 只有对比条 | P1 必须在实现前先定“增长哪条、让位哪条”，并补 200% 实测；纯缩字/藏金额被禁止 |

---

## 5. 结论⑤ P1–P4 差异清单（对现网代码，非对设计稿）

### 5.1 P1 首页结构卡 / 双环

| # | 现网 | 目标 | 位置 | 类型 |
|---|---|---|---|---|
| 1 | 环心/副标题/底行都用 `home.planningIncome` | 环心 = 所选月实际收入；固定支出/月供各自 ÷ 收入 | `V2StructureCard.tsx:43,128,138` | **口径改动（R-1/R-2，阻断）** |
| 2 | 无圆环，只有 `V2StructureCompareBar`（分母 `max(收入,负担)`，`V2StructureCompareBar.tsx:18`） | 双同心环：外环固定支出/收入、内环月供/收入；环心收入 | 新增 `src/ui/*Ring*.tsx` + `ring-model.ts` | 新增视觉 |
| 3 | 三点 `v2-structure-dots` | 删除 | `V2StructureCard.tsx:116-125` | 删除 |
| 4 | 底行 `收入 X · 固定支出 Y · 月供 Z` 重复汇总 | 删除，改为两行“固定支出 金额/占比”“月供 金额/占比” | `V2StructureCard.tsx:133-143` | 结构重排 |
| 5 | 待确认时整行 `收入 — · 固定支出 — · 月供 待确认` | 只对未确认的债务项显示“待确认”，其余保留金额 | `V2StructureCard.tsx:135` | 文案/状态 |
| 6 | 无行/环交互 | 行是主要入口，环为辅助（`aria-pressed`），点击行 → 固定支出/债务页 | `V2StructureCard.tsx` 整卡 | 新增交互 |
| 7 | 无 200% 保障 | 200% 下不断行/不重叠；增长项与让位项先定 | 新增样式 + 证据 | 阻塞验收 |

### 5.2 P2 固定支出页

| # | 现网 | 目标 | 位置 | 类型 |
|---|---|---|---|---|
| 1 | `h1 固定支出` + 面板 `h2 这个月固定支出` + 句子「计划每月 X，本月已经付了 Y。」 | 标题「固定支出·{n}项」，删副标题句 | `FixedExpensesPage.tsx:172,174,176-179` | 文案/结构 |
| 2 | 提示行「记一笔实际支付只进固定支出账…」 | 删除（D-05） | `:180` | 删除 |
| 3 | 空态「还没有固定支出，先在下面加一项。」 | 「暂无固定支出」（D-07），无图标/CTA | `:187` | 文案 |
| 4 | 列表只有名称/类别/月额/改/停用 | 简洁列表 + 细进度线「已付/计划」，五态（未付/部分/已付/超付/待确认） | 列表 `:189-230` | 新增（B-03） |
| 5 | 无「待付」字样 | 统一「未付」 | 全页 grep=0 | 无残留，仅新增态 |
| 6 | 无占比展示 | 「所选月份已付占比」可见名称 | 新增 | 新增（R-7，需确认） |
| 7 | 无导出入口 | 本轮不加 | `:237` 实际是“添加一项固定支出” | 任务书偏差（R-6） |
| 8 | 页面宽度 800（`.detail-page`） | 640 居中、移动端满宽 | `style.css` | 样式 |

### 5.3 P3 付款面板

| # | 现网 | 目标 | 位置 | 类型 |
|---|---|---|---|---|
| 1 | 页内平铺 `section`（`:288-340`） | 底部付款面板（D-04），遮罩、`role="dialog"`/`aria-modal` | 新增组件 | 新增 |
| 2 | 日期、备注常驻 | 常用项在前，「日期与备注」可折叠；折叠时摘要用真实值，展开保留输入 | 新增 | 新增交互 |
| 3 | 无「取消」；提交按钮「记下这笔支付」 | 「取消」+「确认付款」 | `:336` | 文案（D-04 已签） |
| 4 | 无 `aria-controls`/展开语义 | 折叠按钮 `aria-expanded` + `aria-controls` | 新增 | 可访问性 |
| 5 | 无草稿暂存 | 切换/重开保留 | 新增 | 交互 |
| 6 | 无 44px 触控/短视口/宽屏两行约束 | 见 D-04 | `style.css` | 样式 |
| 7 | — | 真机软键盘、iOS 动态字体、原生日期 | OPEN-F6 | **P3 只能 PARTIAL** |

### 5.4 P4 月份切换

| # | 现网 | 目标 | 位置 | 类型 |
|---|---|---|---|---|
| 1 | `sessionAsOfDate = localDate(new Date())`，无用户月份状态 | 一处共享、紧凑的月份控件（当前/上月） | `App.tsx:35` | 新增状态 |
| 2 | 只有 `__WP03_PREVIEW_BUILD__` 的验收日期控件（生产构建为 false） | 不复用它当用户功能 | `App.tsx:380`、`WP03PreviewDateControl.tsx` | 禁止复用 |
| 3 | 所有服务调用已接受任意 `asOfDate`（**无需新增月份参数**），但 `debtsAt` 依赖逐月事实 | 切换时按 X-2 算 `asOf`（当月→今天，历史→月末） | `product-service.ts:388`、`monthly-model-service.ts:268` | 只读适配（任务书说“新增月份参数”可降级为“确认已有参数”） |
| 4 | `useCardsRefresh` 无请求序号，旧响应可覆盖新月份 | 请求 id/序号守卫 + 丢弃过期响应 | `use-cards-refresh.ts:28-45` | **修缺陷（B-05）** |
| 5 | 加载骨架已有 300ms 阈值 | 保留原布局，不出现加载文案 | `use-cards-refresh.ts:7` | 复用 |
| 6 | 无「这一块没读出来，点这里重试」 | 分块错误态 | 新增 | 新增文案（已签） |
| 7 | 无月份切换动效令牌 | 180/220/160/140ms，只动卡片内部，不做整页入场 | `style.css` | 样式 |
| 8 | `home.currentMonth` 已随 `asOfDate` 变化 | 切换后所有块同月 | 实测 `currentMonth:"2026-10"` | 复用 |

---

## 6. 测试计划（每段可执行、可留证）

### 6.1 公共门禁（每段交付前）

```bash
npm run lint
npm run typecheck
npm run test:product
```

- 基线：`lint` 0；`typecheck` 0；`test:product` **51 文件 / 528 passed / 44 skipped**（本段实测）。
- 禁 `--no-verify`；不提交，等复核。
- 证据落在 `evidence/wp-ui-visual-01/p1-p4/<stage>/`，命名 `<序号>-<主题>.{md,json,png}`。

### 6.2 P1

1. **纯函数** `src/ui/ring-model.ts`：输入 `{income, essential, debt, pendingDebt}`，输出 `{center, outerPercent, innerPercent, overhang, detailRows, state}`。
   - 用例表（≥12）：收入 0/负/缺失/待确认；负担 0；负担=收入；负担=1.01×收入；负担=2×收入；负担>2×收入；小数四舍五入；超 100% 只封顶一圈；每环独立分母。
   - 断言：`outerPercent ≤ 100`、`innerPercent ≤ 100`、超限时 `overhang=true` 且**文案全量**、负收入时 `state="NEGATIVE"` 且不输出比例/余量。
2. **DOM** `tests/v2-ui/structure-ring.test.tsx`：环 `aria-hidden`；收入金额可读；两条明细行金额/占比与纯函数一致；行可点击且有 `aria-pressed`；待确认只影响对应行。
3. **手算对拍**：固定 fixture（收入 10000、固定 2000、月供 1200）→ 外 20.00%、内 12.00%、余量 6800，逐字比对。
4. **200% 字号**：构建后浏览器（用 Studio 内置浏览器）390px 宽、根字号 ×2 截图；断言不重叠/不截断；若断行，记录“增长项/让位项”决策。此项不替代 OPEN-F6，只作 P1 证据。
5. **禁止项回归**：无 `#C2503C` 填充；无新断点（只允许 760/620）；无新增页面。

### 6.3 P2

1. **纯函数** `paymentProgress(plan, paid)`：未付/部分（含 0.01）/已付/超付（含 1 分）/待确认 五态 + 金额格式（两位小数、千分位）。
2. **DOM** `tests/v2-ui/fixed-expenses-page.test.tsx`：标题「固定支出·{n}项」；无副标题句；提示行不存在；空态仅两行；条目行「已付/计划」逐字；「未付」出现且「待付」为 0；占比标签为「所选月份已付占比」。
3. **数据边界**：条目 0 个；计划 0（不显示 NaN/∞）；支付 > 计划；跨月支付不计入（`business_date` 过滤）；旧支付 `itemId=""` 时降级按 category，界面上不冒充精确条目。
4. **残留 grep**：`待付`、`本月已付占比`、`导出` 在该页为 0。
5. **视觉**：800→640 居中、移动端满宽、200% 字号截图。

### 6.4 P3

1. **DOM** `tests/v2-ui/payment-sheet.test.tsx`：打开/关闭；`aria-expanded`+`aria-controls`；折叠后再展开保留输入；取消不落库；确认落库一次；ESC/遮罩关闭；焦点回到触发点。
2. **金额/日期**：0、负、超上限、未来日期、月初月末边界。
3. **视口**：≥880 两行；760–880 降级；<760 单列；短视口滚动。
4. **真机**：软键盘、iOS 动态字体、原生日期 → **无设备即 `PARTIAL`**，证据里写明未覆盖项。

### 6.5 P4

1. **状态机**：当前月→今天；历史月→月末；切回当前月恢复今天。
2. **竞态**（B-05 专项）：用可控 deferred 让 9 月请求晚于 10 月返回，断言界面仍显示 10 月；连续快速切换 3 次，最终只保留最后一次；卸载后不 `setState`。
3. **加载**：<300ms 不闪骨架；>300ms 骨架保持原布局、无“加载中”文案；失败块显示「这一块没读出来，点这里重试」且其它块可用。
4. **历史数据**：有 9 月债务事实 → 正常；缺事实 → 分块错误（按 §8 裁决结果断言）；设置回落 → 是否有“按当前资料”标记（按裁决）。
5. **动效**：`prefers-reduced-motion` 下无位移/缩放；仅卡片内部过渡；无整页入场。
6. **回归**：切月后固定支出/债务/现金页与首页同月；写操作仍写“当前月”，不因浏览历史月而改历史。

### 6.6 手工验收证据（每段）

- 三个视口截图：390（200% 字号）、768、1280。
- 逐字文案 diff（与 §5 表一致）。
- 手算表：收入、固定、月供、余量、两个比例，逐项对拍。

---

## 7. 阻断清单

| 任务 | 状态 | 依据 |
|---|---|---|
| P1-b 收入口径 / 四态落位 | **阻断** | §1（R-1）、R-3；需裁决用哪本账 |
| P1 主卡数字（环心/余量/比例） | **阻断** | R-2：与冻结模型 `baseSurplus` 冲突，改模型输出被禁 |
| P1-a 布局骨架、环的纯视觉、200% 试验 | 可开工（不接收入数字） | 仅展示层；但交付时不得声称达标 |
| P2 文案/空态/列表进度（现月） | 可开工 | 数据可得；`所选月份已付占比` 待 R-7 确认 |
| P2 条目级进度对旧支付 | 有条件 | `itemId=""` 退化，需定降级口径 |
| P3 面板/折叠/取消/44px | 可开工 | 数据与文案已签 |
| P3 真机（软键盘/iOS 动态字体/原生日期） | **无法闭环** | OPEN-F6；最多 `PARTIAL` |
| P4 月份控件 + 竞态修复 | 可开工 | 现有 `asOfDate` 参数够用 |
| P4「上月」真实历史 | **阻断** | §2：固定支出/收入/设置/债务都取不到可信历史 |
| 最终视觉验收 | **未闭环** | `#C2503C` 实测对比、200% 字号、OPEN-F6、读屏 |

结论状态保持 **`PASS_WITH_CONDITIONS`**；F-06 仍 **部分通过**，本段未改写。

---

## 8. 需要审核员 / Owner 裁决的问题（按优先级）

**Q-1（最高，卡 P1/P4）「实际收入」用哪本账？**
- A. `income_entries`（记收入）：符合日常心智与 B-01，但 0/待确认/负收入不可表达 → B-02 的“待确认”、B-04 的“负收入”分支不可达；若要可达需改 schema（停手）。
- B. `income_records(ACTUAL)`（财务维护）：四态齐全、不改库，但用户日常记账不进这里，需要把“记收入”也导到这条通道（跨写路径，需单独授权）。
- C. 两本合并展示（合计 + 来源标记）：口径最复杂，且与 D-01 手算冲突最大。

**Q-2（卡 P1 数字）环心换实际收入后，`baseSurplus`/比例怎么算？**
- A. 主卡只显示“实际收入 − 固定 − 月供”的**展示层派生值**，并明确它不等于模型 `baseSurplus`（有“两套余量”风险）。
- B. 维持 `baseSurplus` 作为唯一余量，环心仍用规划收入（X-1 落空）。
- C. 授权读层新增“实际收入余量”字段（不改模型输出，但新增口径需验收定义）。

**Q-3（卡 P4 上月）历史月缺资料时怎么显示？**
- A. 分块“该月无留存资料”，不显示 0/数字（保守，符合 B-05）。
- B. 按当前资料回填 + 徽标“按当前资料估算”。
- C. 补写历史事实/快照（跨范围，需新授权）。

**Q-4（P2）「所选月份已付占比」是否已获准新增？** 现网无此视觉与文案；若准，P2 新增占比展示，否则删除该项。

**Q-5（P2）旧支付无 `itemId` 时，条目进度如何降级？** 按 category 归属（可能串项）或不显示条目进度只显示页面总进度。

---

## 9. 复现与证据

```bash
# 只读探针（不跑产品套件，不改 tests/）
npx vitest run --config evidence/wp-ui-visual-01/p1-p4/probes/vitest.stage0.config.ts
# → 10 passed

npm run lint        # 0
npm run typecheck   # 0
npm run test:product# 51 files / 528 passed / 44 skipped
```

- 探针：`evidence/wp-ui-visual-01/p1-p4/probes/stage0.probe.test.ts`
  `sha256 6ee8608e…`（以文件为准，改后重算）
- 配置：`evidence/wp-ui-visual-01/p1-p4/probes/vitest.stage0.config.ts`
  `sha256 add6f992…`
- 基线文件哈希（供后续 diff）：

| 文件 | sha256（前 16） |
|---|---|
| `src/ui/V2StructureCard.tsx` | `4601e5ec8aa0c565` |
| `src/ui/FixedExpensesPage.tsx` | `035266b9fc5dc3b2` |
| `src/ui/V2HomeSurface.tsx` | `e75685d8a1e06616` |
| `src/ui/V2StructureCompareBar.tsx` | `d4e3a9b65167a944` |
| `src/application/product-service.ts` | `b87fd89c40b768ae` |
| `src/application/monthly-model-service.ts` | `7cc5f40f37108248` |
| `src/application/financial-maintenance-service.ts` | `916252868dd3bd98` |
| `src/persistence/repositories.ts` | `fe7f8d3717d907bc` |
| `src/model/monthly-model.ts` | `2a9c07caf6893ea6` |
| `src/style.css` | `1d0775365dfd23f6` |

- `git status --porcelain -- src tests` 为空；本段只新增 `evidence/…/probes/` 两个文件与本报告。
- 所有数据库均为 `:memory:`（`NodeSqliteDatabase`），**未打开、未读取、未写入生产库**；未执行任何 rebind / 审计副本 / 真实支付操作。

---

## 10. 状态

段 0 交付完成，等待复核。**不进入段 1（F-08），不连跑。**
