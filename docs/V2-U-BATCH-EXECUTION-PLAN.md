# V2 U 系列执行方案（build-28 起）

**状态：** READY_FOR_EXECUTION
**前置依赖：** build-27 已提交且全量测试通过（1480 passed / 0 failed）
**日期：** 2026-10-20

---

## 一、批次目标

将已就绪的 V2 服务层（expense-service、import-service）连接到真实用户界面，实现产品设计文档 `XIAOQIANJIA_PRODUCT_DESIGN_V2.md` 中定义的**核心日常使用循环**：

```
快速记账（3-5 秒完成）
  → 首页今日任务卡 + 即时结果
    → 导航重构（4 目的地）
      → 进展路径页
```

**不改变：** Financial Model V1.0 冻结、Production App/DB 不触碰、`src/model/v2-*.ts` 只读引用。

---

## 二、任务拆分

### EXEC-U-01：快速记账组件（记录页核心）

**产出文件：**
- 新增 `src/ui/v2-quick-entry.tsx`
- 新增 `src/ui/v2-quick-entry.css`
- 新增 `tests/v2-ui/quick-entry-flow.test.tsx`

**实现范围：**

产品设计 §4.3 的完整交互流：

1. 金额输入自动聚焦，数字键盘友好（`inputMode="decimal"`）
2. 类别为可选图标行（从 `repositories.listCategories(profileId)` 加载，只显示 `active: true`）
3. 账户选择（从 `repositories.listAccounts(profileId)` 加载，只显示 `active: true` 且 `kind === "CASH"`）
4. 备注为可选文本
5. 日期默认今天（`getDefaultBusinessDate()`），可修改
6. 保存调用 `V2ExpenseService.recordCashDebitExpense`
7. 保存成功后：清空表单、显示轻量成功反馈（"已记入本月消费，本月还剩 ¥X"）、刷新列表
8. 保存失败：保留输入、显示明确错误原因

**金额验证：**
- 使用 `validateQuickEntry` 纯函数（已有）
- 错误时保留输入并说明原因（`AMOUNT_REQUIRED` / `AMOUNT_ZERO` / `AMOUNT_NEGATIVE` / `AMOUNT_TOO_LARGE` / `AMOUNT_INVALID`）

**验收标准：**
- [ ] 金额输入自动聚焦
- [ ] 类别图标行从 DB 加载，只显示 active 类别
- [ ] 保存后表单清空、成功反馈出现
- [ ] 零金额/负数/超大金额/非数字均被拦截并显示中文原因
- [ ] 保存失败不显示成功反馈
- [ ] 不修改 `src/model/v2-quick-entry.ts`（只读引用）
- [ ] 组件可独立渲染，不依赖全局路由

---

### EXEC-U-02：导航重构与页面骨架

**产出文件：**
- 修改 `src/ui/V2HomeSurface.tsx`
- 修改 `src/ui/v2-surface.css`
- 新增 `tests/v2-ui/navigation.test.tsx`

**实现范围：**

将当前 3-tab（总览/趋势/导入）重构为产品设计的 4 目的地：

| Tab | 标签 | 内容 |
|---|---|---|
| today | 今天 | 今日任务卡 + 即时结果 + 最近记录 |
| record | 记录 | 快速记账（U-01）+ 最近记录列表 |
| progress | 进展 | 四维路径（U-04） |
| mine | 我的 | 分组列表（本批次为占位） |

**导航规则：**
- 顶部水平导航（macOS 风格），4 个按钮始终可见
- 导入功能移入"我的"子页面（不再占顶级导航）
- "记一笔"主按钮固定在导航栏右侧（macOS 顶部），点击切换到"记录"并聚焦金额输入
- 响应式：640px 以下导航变为底部固定

**验收标准：**
- [ ] 4 个导航按钮正确切换
- [ ] "记一笔"按钮存在且点击后跳转到记录页
- [ ] 导入功能仍可用（在"我的"内）
- [ ] 640px 以下导航变为底部固定
- [ ] 不破坏现有 dashboard/trends 组件

---

### EXEC-U-03：今天页 — 即时结果与最近记录

**产出文件：**
- 新增 `src/ui/v2-today.tsx`
- 新增 `src/ui/v2-today.css`
- 新增 `tests/v2-ui/today-page.test.tsx`

**实现范围：**

产品设计 §4.2 的层级 3 和 5（层级 2 今日任务卡留给 U-05）：

**即时结果（层级 3）：**
- 本月已花 / 个人目标（目标暂无来源时显示"未设置"）
- 记录笔数
- 待还账单总额
- 数据来自 `V2ExpenseService.getMonthSummary`

**最近记录（层级 5）：**
- 最近 3 笔消费（按 `occurredOn` 降序）
- 每条显示：金额、类别名、日期
- "查看全部"链接（本批次点击无动作或切换到记录页）

**验收标准：**
- [ ] 即时结果从 `getMonthSummary` 正确加载
- [ ] 无数据时显示友好空状态（非"暂无数据"冷文案）
- [ ] 最近记录最多显示 3 条
- [ ] 金额使用 `font-variant-numeric: tabular-nums` 防跳动
- [ ] 加载状态有 skeleton 或"加载中"提示

---

### EXEC-U-04：进展页 — 四维路径

**产出文件：**
- 新增 `src/ui/v2-progress.tsx`
- 新增 `src/ui/v2-progress.css`
- 新增 `tests/v2-ui/progress-page.test.tsx`

**实现范围：**

产品设计 §4.4 的四维"照顾路径"：

| 节点 | 标题 | 数据来源 |
|---|---|---|
| 1 | 看清消费 | `getMonthSummary.dailyExpenseTotal` |
| 2 | 稳住现金 | 占位（现金数据在 V1 模型，本批次不接入） |
| 3 | 理清责任 | 占位（债务数据在 V1 模型，本批次不接入） |
| 4 | 建立余地 | 占位（安全垫在 V1 模型，本批次不接入） |

**本批次只实现节点 1 的真实数据，节点 2-4 为"即将开放"占位卡。**

**视觉：**
- 纵向路径，每个节点一个卡片
- 有数据的节点显示数值 + 变化方向（与上月比）
- 占位节点显示灰色"即将开放"
- 不使用红色惩罚、不显示 0-100 分

**验收标准：**
- [ ] 节点 1 显示真实月度支出数据
- [ ] 节点 2-4 为占位卡，不崩溃
- [ ] 路径视觉有完成感但未达标不显示红色
- [ ] 响应式：640px 以下卡片全宽

---

### EXEC-U-05：今日任务卡（确定性选择）

**产出文件：**
- 新增 `src/ui/v2-today-task.tsx`
- 新增 `src/model/v2-task-selector.ts`（纯函数）
- 新增 `tests/v2-ui/today-task.test.tsx`
- 新增 `tests/v2-ledger/task-selector.test.ts`

**实现范围：**

产品设计 §4.2 层级 2 — 根据现有确定性模型选择今日任务：

**选择逻辑（纯函数 `selectTodayTask(context)`）：**

```ts
interface TaskContext {
  hasStructuralDeficit: boolean;   // 结构性缺口
  cashFloorMet: boolean;           // 现金安全线是否达标
  hasMissingDebtFact: boolean;     // 债务本月事实缺失
  hasExpenseGap: boolean;          // 安全垫有缺口但无硬闸门
  monthExpenseCount: number;       // 本月记录笔数
}

type TaskId = "CLARIFY_GAP" | "SECURE_CASH" | "RECORD_EXPENSE" | "CONFIRM_DEBT" | "CHECK_SAFETY" | "DEFAULT_RECORD";
```

优先级（从高到低）：
1. `hasStructuralDeficit` → `CLARIFY_GAP`（先把本月收支缺口理清）
2. `!cashFloorMet` → `SECURE_CASH`（先让手里的现金安心一点）
3. `hasMissingDebtFact` → `CONFIRM_DEBT`（确认本月要还多少）
4. `hasExpenseGap` → `CHECK_SAFETY`（看看安全垫离目标还有多远）
5. 其余 → `RECORD_EXPENSE`（记下一笔今天的花销）

**本批次 context 来源：**
- `hasStructuralDeficit` / `cashFloorMet` / `hasMissingDebtFact` / `hasExpenseGap`：本批次全部硬编码为 `false`（V1 模型数据接入留给后续批次）
- `monthExpenseCount`：从 `getMonthSummary.entryCount` 获取

**因此本批次实际只会选中 `RECORD_EXPENSE`。** 但纯函数逻辑必须完整实现并测试。

**任务卡 UI：**
- 标题 + 为什么出现 + 预计耗时 + 主按钮
- 主按钮点击跳转到"记录"页
- 完成后按钮变为已完成状态

**验收标准：**
- [ ] `selectTodayTask` 纯函数覆盖所有 6 种情况
- [ ] 当前数据下显示"记下一笔今天的花销"
- [ ] 点击主按钮跳转到记录页
- [ ] 不修改 `src/model/v2-cashflow.ts` 等只读模型文件
- [ ] 任务卡不出现 5 个并列任务

---

## 三、执行顺序

```
EXEC-U-01 → EXEC-U-02 → EXEC-U-03 → EXEC-U-04 → EXEC-U-05
（U-01 是 U-02 的前置；U-03/U-04/U-05 依赖 U-02 的导航骨架）
```

建议分 2-3 个 build 提交：
- build-28：U-01 + U-02
- build-29：U-03 + U-04
- build-30：U-05

---

## 四、批次边界（全批次共同约束）

- **不触碰** Production App、Production DB、已安装的 V0.1 运行时
- **不修改** `src/model/v2-cashflow.ts`、`v2-savings-goal.ts`、`v2-trends.ts`、`v2-reconciliation.ts`、`v2-expense.ts`、`v2-quick-entry.ts`（只读引用）
- **不修改** Financial Model V1.0 相关代码（`src/model/money.ts`、`financial-model.ts` 等）
- **不接入** V1 模型的债务/资产/安全垫数据（本批次进展页节点 2-4 为占位）
- **不注册** 真实全局快捷键、不访问真实 Tauri 窗口
- **不实现** 网络请求、云同步、AI 建议
- 所有新测试在 `NODE_ENV=test` 下通过
- 每个任务完成后提交独立回执，由审核员验收后方可进入下一任务
- 视觉遵循 `XIAOQIANJIA_PRODUCT_DESIGN_V2.md` §5 的颜色/排版/动效规范

## 五、风险与注意事项

| 风险 | 缓解 |
|---|---|
| 导航重构破坏现有测试 | U-02 必须保持现有 `v2-ui.test.tsx` 通过 |
| 类别/账户为空时 UI 崩溃 | 所有列表组件必须处理空数组 |
| 快速记账金额精度 | 全部走 `decimal.js`，UI 层不做浮点运算 |
| 今日任务选择器过度设计 | 本批次为纯函数 + 硬编码 context，不引入状态机 |
| CSS 变量冲突 | 所有新组件复用 `v2-surface.css` 已定义的 CSS 变量 |

</content>