# EXEC-U-03 + EXEC-U-04 执行指令（build-30）

**角色：** 执行者
**基线：** `bc7e0a9`（build-29，U-02 已验收）
**目标：** 实现今天页即时结果与最近记录（U-03）+ 进展页四维路径（U-04），接入 build-29 的 V2Surface
**日期：** 2026-10-20

---

## 一、背景与边界

**已完成：**
- build-28：`src/ui/v2-quick-entry.tsx`（快速记账组件）
- build-29：`src/ui/v2-surface.tsx`（4-tab 导航宿主，today 用合成 props 的 V2Dashboard，progress 用合成 TrendPanel）

**本批次目标：**
- 新增 `src/ui/v2-today.tsx` — 今天页（即时结果 + 最近记录）
- 新增 `src/ui/v2-today.css` — 今天页样式
- 新增 `src/ui/v2-progress.tsx` — 进展页（四维路径）
- 新增 `src/ui/v2-progress.css` — 进展页样式
- 修改 `src/ui/v2-surface.tsx` — today 页改用 `V2Today`，progress 页改用 `V2Progress`
- 新增 `tests/v2-ui/today-page.test.tsx`
- 新增 `tests/v2-ui/progress-page.test.tsx`

**不修改的文件（禁止触碰）：**
- `src/ui/V2HomeSurface.tsx`
- `src/ui/v2-dashboard.tsx`、`src/ui/v2-trends.tsx`（本批次不再引用也可保留引用，二选一由实现决定）
- `src/ui/v2-quick-entry.tsx`
- `src/model/v2-*.ts` 所有文件
- `src/application/v2-expense-service.ts`、`v2-import-service.ts`
- `src/persistence/` 所有文件

---

## 二、EXEC-U-03：今天页

### 新增文件：`src/ui/v2-today.tsx`

```tsx
export function V2Today({
  expenseService,
  repositories,
  profileId,
  onGoRecord,
}: {
  expenseService: V2ExpenseService;
  repositories: Repositories;
  profileId: string;
  onGoRecord: () => void;
})
```

**数据加载：**

组件挂载时并行加载：

```ts
const month = localDate(new Date()).slice(0, 7); // YYYY-MM
const [summary, recent] = await Promise.all([
  expenseService.getMonthSummary(profileId, month),
  expenseService.listRecentExpenses(profileId, 3),
]);
```

注意：`getMonthSummary` 和 `listRecentExpenses` 是 `V2ExpenseService` 的方法（见 `src/application/v2-expense-service.ts`）。本批次 today 页**不使用** `repositories` 加载数据（预留 prop 供后续批次使用），但必须接收该 prop 以保持签名一致。

**即时结果区（产品设计 §4.2 层级 3）：**

- 标题：「这个月」
- 本月已花：`summary.dailyExpenseTotal`，格式 `¥{amount}`
- 个人目标：本批次固定显示「未设置」
- 记录笔数：`summary.entryCount`，格式「{n} 笔」
- 待还账单：本批次固定显示「暂无」

**最近记录区（产品设计 §4.2 层级 5）：**

- 标题：「最近记录」
- 最多显示 3 条（`listRecentExpenses` limit=3）
- 每条显示：金额（`¥{amount}`）、类别 ID（本批次直接显示 `categoryId`，后续批次接入类别名映射）、日期（`occurredOn`）
- 空状态：友好文案「还没有记录，记下第一笔吧。」+ 按钮「记一笔」（点击调用 `onGoRecord`）
- 非空时底部显示「查看全部」按钮（点击调用 `onGoRecord`）

**状态处理：**

- 加载中：显示「加载中…」
- 加载失败：显示「数据加载失败，请重试。」（不崩溃）
- 金额使用 `font-variant-numeric: tabular-nums`

### 新增文件：`src/ui/v2-today.css`

使用 `v2-surface.css` 已定义的 CSS 变量（`--v2-*`）。关键样式：

- 即时结果区：卡片布局，`border: 1px solid var(--v2-line); border-radius: var(--v2-radius); background: var(--v2-surface); padding: 20px;`
- 数值行：`display: flex; justify-content: space-between;`
- 金额：`font-variant-numeric: tabular-nums; font-weight: 600;`
- 最近记录列表项：`display: flex; justify-content: space-between; padding: 12px 0; border-bottom: 1px solid var(--v2-line);`
- 最近记录列表项最后一项：`border-bottom: none;`
- 响应式：640px 以下卡片全宽

### 新增文件：`tests/v2-ui/today-page.test.tsx`

测试用例（使用 `@testing-library/react`，mock `V2ExpenseService`）：

1. 渲染加载状态「加载中…」
2. 加载成功后显示本月已花金额（mock `getMonthSummary` 返回 `dailyExpenseTotal: "123.45"`，断言显示 `¥123.45`）
3. 显示记录笔数（mock `entryCount: 5`，断言显示「5 笔」）
4. 最近记录显示最多 3 条（mock `listRecentExpenses` 返回 3 条，断言 3 条可见）
5. 无记录时显示友好空状态（非「暂无数据」冷文案）和「记一笔」按钮
6. 点击「记一笔」调用 `onGoRecord`
7. 加载失败时显示错误文案，不崩溃（mock `getMonthSummary` reject）

---

## 三、EXEC-U-04：进展页

### 新增文件：`src/ui/v2-progress.tsx`

```tsx
export function V2Progress({
  expenseService,
  profileId,
}: {
  expenseService: V2ExpenseService;
  profileId: string;
})
```

**数据加载：**

```ts
const month = localDate(new Date()).slice(0, 7);
const summary = await expenseService.getMonthSummary(profileId, month);
```

**四维路径（产品设计 §4.4）：**

纵向排列 4 个卡片：

| 节点 | 标题 | 内容 |
|---|---|---|
| 1 | 看清消费 | 显示 `summary.dailyExpenseTotal`，格式「本月已花 ¥{amount}」+ 与上月对比（本批次固定显示「暂无上月数据」） |
| 2 | 稳住现金 | 占位卡，显示「即将开放」 |
| 3 | 理清责任 | 占位卡，显示「即将开放」 |
| 4 | 建立余地 | 占位卡，显示「即将开放」 |

**视觉要求：**

- 纵向路径，每个节点一个卡片
- 有数据的节点（节点 1）显示数值
- 占位节点显示灰色「即将开放」，`color: var(--v2-muted);`
- **不使用红色**（`var(--v2-danger)` 不得用于任何状态指示）
- **不显示 0-100 分**
- 响应式：640px 以下卡片全宽

**状态处理：**

- 加载中：显示「加载中…」
- 加载失败：显示「数据加载失败，请重试。」
- 金额为 0 时正常显示 `¥0.00`，不显示特殊空态

### 新增文件：`src/ui/v2-progress.css`

- 路径容器：`display: flex; flex-direction: column; gap: 16px;`
- 节点卡片：`border: 1px solid var(--v2-line); border-radius: var(--v2-radius); background: var(--v2-surface); padding: 20px;`
- 占位卡片：`background: #f5f5f2;`
- 「即将开放」文字：`color: var(--v2-muted); font-size: 13px;`
- 节点标题：`font-size: 16px; font-weight: 600; margin-bottom: 8px;`
- 响应式：640px 以下卡片全宽

### 新增文件：`tests/v2-ui/progress-page.test.tsx`

测试用例：

1. 节点 1 显示真实月度支出数据（mock `dailyExpenseTotal: "500.00"`，断言显示 `¥500.00`）
2. 节点 2-4 为占位卡，显示「即将开放」，不崩溃
3. 页面不出现红色状态指示（断言无 `--v2-danger` 相关的错误文案）
4. 页面不出现「分」或 0-100 分数值（断言无 `/100` 或百分制文案）
5. 加载中显示「加载中…」
6. 加载失败显示错误文案

---

## 四、修改文件：`src/ui/v2-surface.tsx`

**变更：**

```tsx
// today 页：
// 删除 <V2Dashboard ... /> 合成 props
// 改为：
{tab === "today" && (
  <V2Today
    expenseService={expenseService}
    repositories={repositories}
    profileId={profileId}
    onGoRecord={() => {
      setTab("record");
      setFocusSignal((n) => n + 1);
    }}
  />
)}

// progress 页：
// 删除 <TrendPanel ... /> 合成数据
// 改为：
{tab === "progress" && (
  <V2Progress expenseService={expenseService} profileId={profileId} />
)}
```

**导入更新：**
- 新增 `import { V2Today } from "./v2-today.js";`
- 新增 `import { V2Progress } from "./v2-progress.js";`
- 如果 `V2Dashboard` 和 `TrendPanel` 不再被引用，删除对应 import（保持文件整洁）

**保持不变：**
- 4-tab 导航结构
- "记一笔"按钮逻辑
- record 页 `V2QuickEntry`
- mine 页占位

**注意：** `tests/v2-ui/v2-surface.test.tsx` 中现有的 today/progress 断言需要更新：
- today 页断言从「个人财务综合面板」改为「这个月」或 `V2Today` 相关文案
- progress 页断言从「还没有可展示的收支记录。」改为「看清消费」或 `V2Progress` 相关文案
- 这些测试更新是**允许的**，因为 V2Surface 的实现已变化

---

## 五、提交前验证

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
npx tsc --noEmit
npm run build:web
NODE_ENV=test npx vitest run
```

要求：
- `tsc --noEmit`：零错误
- `build:web`：成功
- 全量测试：0 failed（现有 1496 passed 不减少，新增测试全部通过）

---

## 六、提交

```bash
git add -A
git status --short   # 核对无意外文件
git commit -m "build-30: U-03 today page with instant results, U-04 progress path page"
```

---

## 七、禁止

- 不修改 `src/ui/V2HomeSurface.tsx`
- 不修改 `src/ui/v2-dashboard.tsx` 或 `v2-trends.tsx`
- 不修改 `src/ui/v2-quick-entry.tsx`
- 不修改 `src/model/v2-*.ts` 任何文件
- 不修改 `src/application/v2-expense-service.ts` 或 `v2-import-service.ts`
- 不修改 `src/persistence/` 任何文件
- 不触碰 Production App/DB
- 不引入新依赖
- 不删除现有测试（更新断言以适应新实现是允许的）
- 不使用红色（`--v2-danger`）作为状态指示
- 不显示 0-100 分

---

## 八、回执要求

执行者提交后报告：

1. 最终 commit hash（完整 40 位）
2. `git show --stat HEAD` 文件计数
3. 三项验证的通过证据（测试总数/通过数）
4. 新增测试数量
5. 任何偏离本指令的操作及原因
</content>