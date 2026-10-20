# EXEC-U-02 执行指令（build-29）

**角色：** 执行者
**基线：** `19e7f7f`（build-28，U-01 已验收）
**目标：** 构建独立的 V2 导航宿主组件，将 U-01 快速记账组件接入真实导航流，不修改任何现有 Production 文件
**日期：** 2026-10-20

---

## 一、背景与边界

**已完成（build-28）：**
- `src/ui/v2-quick-entry.tsx` — 独立快速记账组件（含 `V2QuickEntry`、`validateQuickEntryDraft`、`quickEntryErrorMessage`）
- `tests/v2-ui/quick-entry-flow.test.tsx` — 7 个流测试全部通过

**本批次目标：**
- 新增 `src/ui/v2-surface.tsx` — 独立 V2 导航宿主
- 新增 `src/ui/v2-surface.css` — 导航样式（已存在，本批次只增不删）
- 新增 `tests/v2-ui/v2-surface.test.tsx` — 导航层测试

**不修改的文件（禁止触碰）：**
- `src/ui/V2HomeSurface.tsx`（Production V1 surface，与 V1 状态耦合）
- `src/ui/v2-dashboard.tsx`、`src/ui/v2-trends.tsx`（已隔离组件，只读引用）
- `src/model/v2-*.ts` 所有文件
- `src/application/v2-expense-service.ts`、`v2-import-service.ts`
- `src/persistence/` 所有文件

---

## 二、实现要求

### 新增文件：`src/ui/v2-surface.tsx`

```tsx
export type V2SurfaceTab = "today" | "record" | "progress" | "mine";

export function V2Surface({
  expenseService,
  repositories,
  profileId,
}: {
  expenseService: V2ExpenseService;
  repositories: Repositories;
  profileId: string;
})
```

**导航栏：**

```
[今天] [记录] [进展] [我的]          [+ 记一笔]
```

- 顶部水平导航（macOS 风格），4 个按钮始终可见
- "记一笔"按钮固定在导航栏右侧，点击后切换到"记录"页并触发金额输入聚焦
- 默认 tab 为 `"today"`

**页面映射：**

| Tab | 内容 | 数据来源 |
|---|---|---|
| today | `<V2Dashboard>` | 本批次使用合成 mock props（见下方说明） |
| record | `<V2QuickEntry>` | 真实 `expenseService` + `repositories` |
| progress | `<V2Trends>` | 本批次使用合成 `TrendSummary` |
| mine | 导入面板占位 | 显示 `<p>导入功能即将开放</p>` |

**"记一笔"聚焦机制：**

```tsx
// V2Surface 内部维护 focusSignal state
const [focusSignal, setFocusSignal] = useState(0);

// 点击"记一笔"：
setTab("record");
setFocusSignal((n) => n + 1);

// V2QuickEntry 需要新增可选 prop：
// focusSignal?: number
// 当 focusSignal 变化时，金额输入框重新聚焦
```

**注意：** `V2QuickEntry` 需要新增 `focusSignal?: number` prop。这是对 `src/ui/v2-quick-entry.tsx` 的**唯一允许修改**（新增可选 prop，不改变现有行为）。修改后需更新 `tests/v2-ui/quick-entry-flow.test.tsx` 增加一个测试用例：`focusSignal 变化时金额输入重新聚焦`。

**V2Dashboard mock props（today 页）：**

```tsx
const mockDashboardProps = {
  ledger: { income: "0.00", dailyExpense: "0.00", accountCash: "0.00" },
  billStatuses: [],
  savingsPlans: [],
  affordableSavings: [],
  trendSummary: null,
  trendWindow: { start: "2026-01-01", end: "2026-12-31" },
  reducedMotion: false,
};
```

**V2Trends mock props（progress 页）：**

```tsx
const mockTrendSummary: TrendSummary = {
  windows: [],
  direction: "BASELINE_BUILDING",
  reason: "先记录几次，慢慢建立基准。",
};
```

---

### 修改文件：`src/ui/v2-quick-entry.tsx`（唯一允许修改）

在 `V2QuickEntryProps` 中新增：

```tsx
focusSignal?: number;
```

在组件内部新增：

```tsx
const amountRef = useRef<HTMLInputElement>(null);

useEffect(() => {
  if (focusSignal !== undefined && focusSignal > 0) {
    amountRef.current?.focus();
  }
}, [focusSignal]);
```

并将 `ref={amountRef}` 加到金额输入框上。

---

### 修改文件：`src/ui/v2-surface.css`（追加）

在文件末尾追加以下样式（不删除现有内容）：

```css
/* V2 Surface navigation */
.v2-surface-nav {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-bottom: 1px solid var(--v2-line);
  background: var(--v2-paper);
}

.v2-surface-nav__tab {
  padding: 8px 16px;
  border: none;
  border-radius: var(--v2-radius);
  background: transparent;
  color: var(--v2-muted);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
}

.v2-surface-nav__tab:hover {
  background: #e9f6f1;
  color: var(--v2-teal-dark);
}

.v2-surface-nav__tab.is-active {
  background: var(--v2-teal);
  color: white;
}

.v2-surface-nav__record-btn {
  margin-left: auto;
  padding: 8px 16px;
  border: none;
  border-radius: var(--v2-radius);
  background: var(--v2-teal);
  color: white;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

.v2-surface-nav__record-btn:hover {
  background: var(--v2-teal-dark);
}

.v2-surface-content {
  padding: 24px 20px;
}

@media (max-width: 640px) {
  .v2-surface-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 100;
    border-top: 1px solid var(--v2-line);
    border-bottom: none;
    background: var(--v2-surface);
    box-shadow: 0 -2px 8px rgb(0 0 0 / 8%);
  }

  .v2-surface-content {
    padding-bottom: 72px; /* 为底部导航留空间 */
  }
}
```

---

### 新增文件：`tests/v2-ui/v2-surface.test.tsx`

**测试用例（使用 `@testing-library/react`，mock `V2ExpenseService` 和 `Repositories`）：**

1. **渲染 4 个导航按钮**：今天、记录、进展、我的
2. **点击"记录"切换到快速记账**：断言 `V2QuickEntry` 组件出现
3. **点击"我的"显示导入占位**：断言"导入功能即将开放"文字出现
4. **"记一笔"按钮存在且点击后切换到记录页**：断言点击后 `V2QuickEntry` 出现
5. **focusSignal 变化时金额输入重新聚焦**：在 `quick-entry-flow.test.tsx` 中新增此用例
6. **现有 `v2-ui` 测试仍通过**：运行 `npx vitest run tests/v2-ui/` 确认

---

## 三、提交前验证

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
npx tsc --noEmit
npm run build:web
NODE_ENV=test npx vitest run
```

要求：
- `tsc --noEmit`：零错误
- `build:web`：成功
- 全量测试：0 failed（现有 1490 passed 不减少，新增测试全部通过）

---

## 四、提交

```bash
git add -A
git status --short   # 核对无意外文件
git commit -m "build-29: U-02 isolated V2 navigation surface with quick entry wiring"
```

---

## 五、禁止

- 不修改 `src/ui/V2HomeSurface.tsx`
- 不修改 `src/ui/v2-dashboard.tsx` 或 `v2-trends.tsx`
- 不修改 `src/model/v2-*.ts` 任何文件
- 不修改 `src/application/v2-expense-service.ts` 或 `v2-import-service.ts`
- 不修改 `src/persistence/` 任何文件
- 不触碰 Production App/DB
- 不引入新依赖
- 不删除现有测试
- 除 `focusSignal` prop 外，不修改 `src/ui/v2-quick-entry.tsx` 的任何现有逻辑

---

## 六、回执要求

执行者提交后报告：

1. 最终 commit hash（完整 40 位）
2. `git show --stat HEAD` 文件计数
3. 三项验证的通过证据（测试总数/通过数）
4. 新增测试数量
5. 任何偏离本指令的操作及原因
</content>