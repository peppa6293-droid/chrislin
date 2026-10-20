# EXEC-U-05 执行指令（build-31）

**角色：** 执行者
**基线：** `163d8bf`（build-30，U-03 + U-04 已验收）
**目标：** 实现今天页今日任务卡（确定性选择，产品设计 §4.2 层级 2），接入 V2Surface today 页
**日期：** 2026-10-20
**修订：** r2 — 完成态改为数据推导；放开 `v2-today.tsx` 空状态按钮以保证单一 CTA；标志位重命名对齐 V1 模型；提交改为显式文件列表

---

## 一、背景与边界

**已完成：**
- build-28：`src/ui/v2-quick-entry.tsx`（U-01 快速记账）
- build-29：`src/ui/v2-surface.tsx`（U-02 四目的地导航）
- build-30：`src/ui/v2-today.tsx` + `src/ui/v2-progress.tsx`（U-03/U-04）

**本批次允许改动的文件（共 9 个，除此之外一律不动）：**

| 类型 | 文件 |
|---|---|
| 新增 | `src/model/v2-task-selector.ts` |
| 新增 | `tests/v2-ledger/task-selector.test.ts` |
| 新增 | `src/ui/v2-today-task.tsx` |
| 新增 | `src/ui/v2-today-task.css` |
| 新增 | `tests/v2-ui/today-task.test.tsx` |
| 修改 | `src/ui/v2-surface.tsx`（today 页插入任务卡） |
| 修改 | `tests/v2-ui/v2-surface.test.tsx`（追加断言） |
| 修改 | `src/ui/v2-today.tsx`（**仅**删除空状态里的「记一笔」按钮，见第七节） |
| 修改 | `tests/v2-ui/today-page.test.tsx`（**仅**同步上一项） |

**禁止触碰：**
- `src/ui/v2-progress.tsx`、`src/ui/v2-quick-entry.tsx`、`src/ui/V2HomeSurface.tsx`、`src/ui/v2-dashboard.tsx`、`src/ui/v2-trends.tsx`、`src/ui/v2-surface.css`、`src/ui/v2-today.css`
- `src/model/` 下所有现有文件（含 `priority-action.ts`、`types.ts`）
- `src/application/` 与 `src/persistence/` 全部文件
- 工作区中与本批次无关的未跟踪文件（当前有 `.claude/`、`pelican-bike.html`、`pelican-cycling.html`）——**不得提交、不得删除**

---

## 二、纯函数：`src/model/v2-task-selector.ts`

### 2.1 类型

```ts
export interface TaskContext {
  hasStructuralDeficit: boolean;      // 结构性缺口
  belowCashFloor: boolean;            // 现金低于安全线（硬闸门激活）
  consumptionIsPrimaryDrag: boolean;  // 主要拖累是消费
  hasMissingDebtFact: boolean;        // 债务本月事实缺失
  hasSafetyGap: boolean;              // 安全垫有缺口但无硬闸门
  monthExpenseCount: number;          // 本月记录笔数
}

export type TaskId =
  | "CLARIFY_GAP"
  | "SECURE_CASH"
  | "CONFIRM_DEBT"
  | "CHECK_SAFETY"
  | "RECORD_EXPENSE"
  | "DEFAULT_RECORD";

export function selectTodayTask(context: TaskContext): TaskId;
export function isRecordTask(taskId: TaskId): boolean; // RECORD_EXPENSE / DEFAULT_RECORD 为 true
```

> 所有布尔标志均为"有问题时为 true"。全部为 `false` 即"无问题"，与批次方案"四个标志硬编码 false"一致。**不得**使用 `cashFloorMet` 这类反向命名。

### 2.2 优先级（从高到低，对应产品设计 §4.2 列表顺序）

用 `recordTask = monthExpenseCount === 0 ? "DEFAULT_RECORD" : "RECORD_EXPENSE"` 表示记录类任务：

1. `hasStructuralDeficit` → `CLARIFY_GAP`
2. `belowCashFloor` → `SECURE_CASH`
3. `consumptionIsPrimaryDrag` → `recordTask`
4. `hasMissingDebtFact` → `CONFIRM_DEBT`
5. `hasSafetyGap` → `CHECK_SAFETY`
6. 其余 → `recordTask`

注意第 3 条：消费是主要拖累时，它压制债务（4）和安全垫（5）。

### 2.3 后续批次的 V1 映射（本批次**不实现**，只写成文件顶部注释）

| TaskContext 字段 | V1 来源 |
|---|---|
| `hasStructuralDeficit` | `SpendingResult.status === "STRUCTURAL_DEFICIT"` |
| `belowCashFloor` | `SafetyResult.cashSafetyGateStatus === "ACTIVE"` |
| `consumptionIsPrimaryDrag` | `trend.result.primaryDrag === "CONSUMPTION"` |
| `hasMissingDebtFact` | V1 暂无直接字段，接入批次再定 |
| `hasSafetyGap` | `SafetyResult.safetyGap.gt(0)` |

### 2.4 要求

- 纯函数，无副作用；**不导入** React / DOM / decimal.js / `./types.js`，也不导入任何其他文件（映射只写注释）
- 同文件导出文案表 `TASK_COPY: Record<TaskId, { title: string; reason: string; duration: string; action: string }>`：

| TaskId | title | reason | duration | action |
|---|---|---|---|---|
| CLARIFY_GAP | 把本月收支缺口理清 | 本月支出超过了收入，先看清现状 | 约 3 分钟 | 去记录 |
| SECURE_CASH | 先让手里的现金安心一点 | 现金低于安全线，先稳住手头 | 约 3 分钟 | 去记录 |
| CONFIRM_DEBT | 确认本月要还多少 | 本月债务事实还没确认 | 约 2 分钟 | 去记录 |
| CHECK_SAFETY | 看看安全垫离目标还有多远 | 安全垫还有缺口 | 约 2 分钟 | 去记录 |
| RECORD_EXPENSE | 记下一笔今天的花销 | 每一笔记录都让画面更完整 | 约 10 秒 | 去记录 |
| DEFAULT_RECORD | 记下第一笔花销 | 从第一笔开始，建立你的财务画面 | 约 10 秒 | 去记录 |

> 所有 action 统一为「去记录」。**不得**使用「记一笔」——顶部导航按钮的可访问名称就是「记一笔」，重名会让 `getByRole("button", { name: "记一笔" })` 命中多个元素，导致现有 `v2-surface.test.tsx` 失败。

---

## 三、纯函数测试：`tests/v2-ledger/task-selector.test.ts`

用一个 `base: TaskContext`（全部 false、`monthExpenseCount: 3`）配合展开覆盖。至少包含：

1. 每条规则单独为 true 时命中对应 TaskId（规则 1、2、4、5 各一例；规则 3 在 count=0 和 count>0 时各一例）
2. 压制关系，每对相邻优先级各一例：
   - 1 + 2 → `CLARIFY_GAP`
   - 2 + 3 → `SECURE_CASH`
   - 3 + 4 → 记录类任务（不是 `CONFIRM_DEBT`）
   - 4 + 5 → `CONFIRM_DEBT`
   - 全部为 true → `CLARIFY_GAP`
3. 全 false + count 0 → `DEFAULT_RECORD`；全 false + count 3 → `RECORD_EXPENSE`
4. `isRecordTask`：两个记录类返回 true，其余四个返回 false
5. `TASK_COPY` 的键集合与六个 TaskId 完全相等；每条的四个字段都是非空字符串；没有任何 action 等于「记一笔」

---

## 四、组件：`src/ui/v2-today-task.tsx`

### 4.1 签名

```tsx
export function V2TodayTask({
  repositories,
  profileId,
  onGoRecord,
}: {
  repositories: Repositories;
  profileId: string;
  onGoRecord: () => void;
})
```

### 4.2 数据加载

- 结构**照抄** `V2Today` 的 `useEffect`：`let cancelled = false` 卸载保护、`void load()`、依赖数组 `[profileId, repositories]`
- 日期一律使用 `./date.js` 的 `localDate`，**不得**使用 `toISOString()`（存在时区偏差）

```ts
const today = localDate(new Date());
const expenses = await repositories.listV2Expenses(profileId, today.slice(0, 7));
const context: TaskContext = {
  hasStructuralDeficit: false,
  belowCashFloor: false,
  consumptionIsPrimaryDrag: false,
  hasMissingDebtFact: false,
  hasSafetyGap: false,
  monthExpenseCount: expenses.length,
};
const taskId = selectTodayTask(context);
const todayCount = expenses.filter((expense) => expense.occurredOn === today).length;
```

> 批次方案原文写 `monthExpenseCount` 取自 `getMonthSummary.entryCount`，但 `getMonthSummary` 的返回值没有这个字段（只有 `dailyExpenseTotal`、`billStatuses`），所以改为 `listV2Expenses().length`，与 `V2Today` 的「记录笔数」口径一致。

### 4.3 完成态（由数据推导，**不使用**本地 state）

背景：V2Surface 的 tab 是条件渲染。用户点「去记录」后任务卡会卸载，返回今天页时重新挂载并重新加载数据。如果完成态存在组件本地 state，切回来就丢了。所以完成态必须由数据推导：

- `done = isRecordTask(taskId) && todayCount > 0`
- 非记录类任务本批次没有完成来源，`done` 恒为 `false`

也就是说，今天第一次打开（今天 0 笔）时显示可点的「去记录」；记完一笔回到今天页时，任务卡自动变为完成态。

### 4.4 渲染

| 状态 | 渲染 |
|---|---|
| 加载中 | `return null`（今天页的「加载中…」由 `V2Today` 显示，避免出现两行） |
| 加载失败 | `return null`（错误提示由 `V2Today` 显示，避免重复） |
| 未完成 | 卡片：title、reason、duration、主按钮（`TASK_COPY[taskId].action`），点击调用 `onGoRecord` |
| 已完成 | 卡片：title 不变；主按钮文案「已完成」并设 `disabled`；按钮下方一行小字「今天已记 {todayCount} 笔」 |

DOM 结构（类名固定，测试和样式都依赖这些类名）：

```tsx
<section className="v2-today-task" aria-label="今日任务">
  <h2 className="v2-today-task__title">{copy.title}</h2>
  <p className="v2-today-task__reason">{copy.reason}</p>
  <p className="v2-today-task__duration">{copy.duration}</p>
  <button type="button" className="v2-today-task__action" ...>…</button>
  {done ? <p className="v2-today-task__done-note">今天已记 {todayCount} 笔</p> : null}
</section>
```

- 同一时间只渲染 1 个任务
- 只用 `title`、`reason`、`duration`、`action` 四个文案字段，**不渲染** TaskId 原文

---

## 五、样式：`src/ui/v2-today-task.css`

在组件文件顶部 `import "./v2-today-task.css";`。只使用 `v2-surface.css` 中已定义的变量。

```css
.v2-today-task {
  display: grid;
  gap: 8px;
  justify-items: start;
  margin-bottom: 16px;
  padding: 20px;
  border: 1px solid var(--v2-line);
  border-radius: var(--v2-radius);
  background: var(--v2-surface);
}

.v2-today-task__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.v2-today-task__reason,
.v2-today-task__duration,
.v2-today-task__done-note {
  margin: 0;
  color: var(--v2-muted);
  font-size: 13px;
}

/* 与 .v2-surface-nav__record-btn 一致 */
.v2-today-task__action {
  margin-top: 4px;
  padding: 8px 16px;
  border: none;
  border-radius: var(--v2-radius);
  background: var(--v2-teal);
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.v2-today-task__action:hover:not(:disabled) {
  background: var(--v2-teal-dark);
}

.v2-today-task__action:disabled {
  background: var(--v2-line);
  color: var(--v2-muted);
  cursor: default;
}

@media (max-width: 640px) {
  .v2-today-task {
    justify-items: stretch;
  }
}
```

- **不使用** `--v2-danger`、`--v2-coral`；不显示任何分数
- 允许在此基础上微调间距，但不得新增颜色变量

---

## 六、组件测试：`tests/v2-ui/today-task.test.tsx`

### 6.1 测试约定

- 文件头 `// @vitest-environment happy-dom`；`afterEach` 中 `cleanup()` + `vi.clearAllMocks()` + `vi.useRealTimers()`
- **固定日期**：在 `beforeEach` 中执行 `vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(2026, 9, 20, 12, 0, 0));`，即本地时间 2026-10-20 12:00。只伪造 `Date`，不伪造定时器，否则 `userEvent` 和 `findBy*` 会卡住
- mock 写法沿用 `today-page.test.tsx`：`{ listV2Expenses: vi.fn() } as unknown as Repositories`，返回数据用 `as never`
- 断言 `listV2Expenses` 被调用时的参数为 `("profile-v2", "2026-10")`

### 6.2 用例（至少 8 个）

1. 0 笔记录：显示「记下第一笔花销」、「从第一笔开始，建立你的财务画面」、「约 10 秒」，以及可用的「去记录」按钮
2. 本月有记录但今天没有（例如 `occurredOn: "2026-10-18"`）：显示「记下一笔今天的花销」，按钮可用
3. 今天已有 2 笔（`occurredOn: "2026-10-20"`）：按钮文案为「已完成」且 `disabled`，并显示「今天已记 2 笔」
4. 点击「去记录」后 `onGoRecord` 被调用 1 次
5. 完成态下点击按钮，`onGoRecord` 调用次数为 0
6. 加载中（mock 返回永不 resolve 的 Promise）：`container` 为空，页面上没有「加载中…」
7. 加载失败（mock reject）：等待一个 tick 之后 `container` 仍为空
8. 无红色、无分数，在用例 1 和用例 3 的渲染结果上都要断言：
   - `container.innerHTML` 不包含 `danger`
   - `container.textContent` 不匹配 `/\d+\s*\/\s*100/`
   - `container.textContent` 不匹配 `/\d+\s*分(?!钟)/`

   > **不要**照抄 U-04 的 `not.toContain("分")`。四条任务文案含「约 N 分钟」，接入 V1 后会误报失败。
9. 整个页面上只有 1 个 `section.v2-today-task`

---

## 七、单一 CTA：`src/ui/v2-today.tsx`（放开的唯一改动）

背景：产品设计 §4.2 要求今日任务"只出现一个主要 CTA"。今天页 0 笔记录时，`V2Today` 的空状态还有一个「记一笔」按钮，会和任务卡的主按钮并列。

**改动范围仅限于：**
- 删除空状态里的 `<button type="button" onClick={onGoRecord}>记一笔</button>`
- 保留文案 `<p>还没有记录，记下第一笔吧。</p>` 和外层 `v2-today__empty` 容器
- 「查看全部」按钮、`onGoRecord` prop、数据加载逻辑、其余 JSX 一律不动

**同步改 `tests/v2-ui/today-page.test.tsx`：**
- 用例 `"shows the friendly empty state and record button"` 重命名为 `"shows the friendly empty state without a duplicate record button"`
- 断言改为：空状态文案存在，且 `screen.queryByRole("button", { name: "记一笔" })` 为 `null`
- 其他用例不动

---

## 八、接线：`src/ui/v2-surface.tsx`

today 页改为：

```tsx
{tab === "today" ? (
  <>
    <V2TodayTask repositories={repositories} profileId={profileId} onGoRecord={goRecord} />
    <V2Today
      expenseService={expenseService}
      repositories={repositories}
      profileId={profileId}
      onGoRecord={goRecord}
    />
  </>
) : null}
```

- 新增 `import { V2TodayTask } from "./v2-today-task.js";`
- record、progress、mine 页以及顶部「记一笔」按钮的逻辑不变
- 已知问题，本批次接受：任务卡和 `V2Today` 各请求一次 `listV2Expenses`。合并成一次请求需要把数据加载提升到 Surface 层，留给后续批次

**`tests/v2-ui/v2-surface.test.tsx` 追加（必须做，不是可选）：**

1. 默认 today 页：`await screen.findByText("记下第一笔花销")`，同时保留现有「这个月」断言
2. 新用例 `"routes the today task CTA to the record page and focuses amount"`：
   - 点击 `await screen.findByRole("button", { name: "去记录" })`
   - 断言「快速记账」区域出现；「记录」tab 的 className 包含 `is-active`
   - `await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("金额")))`
3. 现有用例 `"opens the record page from the top record button"` **不得修改**。它用 `getByRole("button", { name: "记一笔" })`，本批次完成后这个名称在页面上必须仍然唯一。它能继续通过，就证明第二节和第七节的重名处理生效了

---

## 九、提交前验证

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
npx tsc --noEmit
npm run build:web
NODE_ENV=test npx vitest run
```

要求：
- `tsc --noEmit`：零错误
- `build:web`：成功
- 全量测试：0 failed；passed 数 ≥ 1506（build-30 基线）+ 本批次新增测试数。修改过的 `today-page` 用例不计入新增

---

## 十、提交

**禁止使用 `git add -A` 或 `git add .`**，只按文件名添加：

```bash
git add \
  src/model/v2-task-selector.ts \
  tests/v2-ledger/task-selector.test.ts \
  src/ui/v2-today-task.tsx \
  src/ui/v2-today-task.css \
  tests/v2-ui/today-task.test.tsx \
  src/ui/v2-surface.tsx \
  tests/v2-ui/v2-surface.test.tsx \
  src/ui/v2-today.tsx \
  tests/v2-ui/today-page.test.tsx
git diff --cached --stat   # 必须恰好 9 个文件
git status --short         # .claude/、pelican-*.html 必须仍为 ?? 未跟踪
git commit -m "build-31: U-05 deterministic today task card wired into today page"
```

---

## 十一、禁止

- 不修改第一节允许列表之外的任何文件
- 不接入 V1 模型数据（五个布尔标志保持硬编码 `false`）
- 不引入新依赖、状态机或任何存储；完成态不得写入 localStorage 或数据库
- 不触碰 Production App/DB
- 不使用红色（`--v2-danger`、`--v2-coral`），不显示 0–100 分
- 任务卡同一时间只显示 1 个任务
- 不删除测试；只允许按第七节修改 `today-page.test.tsx` 中的那一个用例

---

## 十二、回执要求

1. 最终 commit hash（完整 40 位）
2. `git show --stat HEAD` 的输出（应为 9 个文件）
3. 三项验证的证据：测试总数和通过数，与基线 1506 对比
4. 新增测试数量，按文件分别列出
5. `git status --short` 的输出，证明无关文件未被提交
6. 任何偏离本指令的操作及原因（没有偏离也要写"无偏离"）
