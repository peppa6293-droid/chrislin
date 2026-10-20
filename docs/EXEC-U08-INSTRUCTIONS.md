# EXEC-U-08 执行指令（build-35：今日任务卡接入 V1 真实信号）

**角色：** 执行者
**基线：** build-34 验收后的 HEAD `b7cb84f`；全量 378 passed / 80 skipped / 0 failed；`npm run lint` 为有效门槛
**目标：** `V2TodayTask` 的 `TaskContext` 五个硬编码 `false` 标志全部接上 V1 模型真实信号，`selectTodayTask` 首次按真实财务状况选任务；数据经 `loadHomeState` / `loadMaintenanceState` 两个 prop 注入。**不**接入 Production 入口（`App.tsx` / `main.tsx`）
**日期：** 2026-10-20
**修订：** v1

---

## 一、背景与边界

**现状：** `src/ui/v2-today-task.tsx:31-36` 的 `TaskContext` 除 `monthExpenseCount` 外全部写死 `false`，导致任务卡永远只推荐「记一笔」。

**信号映射（已由审核员拍板，`src/model/v2-task-selector.ts:1-6` 的注释即为此预留）：**

| TaskContext 标志 | 数据源 | 判定方式 |
|---|---|---|
| `hasStructuralDeficit` | `HomeApplicationState.spendingStatus` | `=== "STRUCTURAL_DEFICIT"` |
| `belowCashFloor` | `HomeApplicationState.cashSafetyGateStatus` | `=== "ACTIVE"` |
| `consumptionIsPrimaryDrag` | `HomeApplicationState.primaryDrag` | `=== "CONSUMPTION"` |
| `hasSafetyGap` | `HomeApplicationState.safetyGap`（string） | 新增纯函数 `hasPositiveSafetyGap`（第二节 2.1） |
| `hasMissingDebtFact` | `FinancialMaintenanceState.debts[].needsCurrentMonthFact` | `.some(debt => debt.needsCurrentMonthFact)` |

**只读引用（禁止修改，除非第二节明确允许）：**
- `src/application/product-service.ts` — `getHomeApplicationState(db, asOfDate)`
- `src/application/financial-maintenance-service.ts` — `getFinancialMaintenanceState(db, asOfDate)`（`financial-maintenance-service.ts:227`），返回的 `debts` 数组含 `needsCurrentMonthFact: boolean`（`:48`）
- `src/model/v2-task-selector.ts` — `selectTodayTask` 的优先级顺序与 `TASK_COPY` 文案**一字不改**

**本批次允许改动的文件（共 5 个，除此之外一律不动）：**

| 类型 | 文件 |
|---|---|
| 修改 | `src/model/v2-task-selector.ts`（仅按 2.1 新增一个纯函数并更新头部注释） |
| 修改 | `src/ui/v2-today-task.tsx` |
| 修改 | `src/ui/v2-surface.tsx`（仅新增 `loadMaintenanceState` prop 并透传） |
| 修改 | `tests/v2-ui/today-task.test.tsx`（重写） |
| 修改 | `tests/v2-ui/v2-surface.test.tsx`（同步 mock） |

**禁止触碰：**
- `src/model/`、`src/application/`、`src/persistence/` 其余全部文件（`v2-task-selector.ts` 仅允许 2.1 所述改动）
- `src/ui/App.tsx`、`HomeScreen.tsx`、`V2HomeSurface.tsx`、`v2-progress.tsx` 及其它 v2-* 组件
- 禁止把 `V2Surface` 接入 Production 入口（`App.tsx` / `main.tsx`）
- `package.json`、`biome.json`、`vitest.config.ts`、`vite.config.ts`、`src-tauri/` 全部
- 工作区未跟踪文件（`.claude/`、`pelican-bike.html`、`pelican-cycling.html`）不得提交、不得删除

---

## 二、数据接线契约

### 2.1 `src/model/v2-task-selector.ts`（模型层唯一允许的改动）

新增一个纯函数（金额比较只允许发生在模型层，使用现有 `money` 工具）：

```ts
import { money } from "./money.js";

/** 安全垫缺口是否为正（模型层判定，UI 不得自行比较金额）。 */
export function hasPositiveSafetyGap(safetyGap: string): boolean {
  return money(safetyGap).gt(0);
}
```

同时把文件头 `// V1 mapping for a future batch (do not implement here):` 六行注释更新为「映射已在 U-08/build-35 实施，判定规则见 EXEC-U08-INSTRUCTIONS.md 第一节表格」之类的现状说明。**不得**改动 `TaskContext` 类型、`TaskId`、`TASK_COPY`、`selectTodayTask`、`isRecordTask` 的任何行为与文案。

### 2.2 `src/ui/v2-today-task.tsx`

1. Props 新增两个注入函数，类型均 **type-only** 导入：

```tsx
import type { HomeApplicationState } from "../application/product-service.js";
import type { FinancialMaintenanceState } from "../application/financial-maintenance-service.js";

// props 增加：
loadHomeState: (asOfDate: string) => Promise<HomeApplicationState>;
loadMaintenanceState: (asOfDate: string) => Promise<FinancialMaintenanceState>;
```

2. 现有 `useEffect` 内改为 `Promise.all` 并行加载三项（`repositories.listV2Expenses`、`loadHomeState(today)`、`loadMaintenanceState(today)`），沿用现有 `cancelled` 取消模式；任一失败 → 沿用现有 `setTask(null)`（组件返回 `null`）；任一未决 → 维持现状（无加载文案，与现行为一致）。
3. `TaskContext` 构造改为真实信号（第一节映射表）；`monthExpenseCount` 保持现有算法（当月 `expenses.length`）。
4. **UI 层金额零运算**：禁止在组件内导入 `money` / Decimal、禁止 `Number()` 比较金额；`hasSafetyGap` 必须调用 `hasPositiveSafetyGap(home.safetyGap)`，其余四个标志只做枚举/布尔比较。
5. 渲染部分（标题、原因、时长、按钮、完成注记）与现有 DOM 结构、class 名、文案一律不动。

### 2.3 `src/ui/v2-surface.tsx`

Props 增加 `loadMaintenanceState`（签名同 2.2），透传给 `V2TodayTask`；同时把已有的 `loadHomeState` 也传给 `V2TodayTask`。其余逻辑（导航、记一笔、focusSignal、V2Progress / V2Import 接线）一律不动。

---

## 三、测试要求

### 3.1 `tests/v2-ui/today-task.test.tsx`（重写）

- 文件头保留 `// @vitest-environment happy-dom`。
- **动手前必读**（不要猜）：
  1. 现有 `tests/v2-ui/today-task.test.tsx` — 保留仍然有效的行为用例（`onGoRecord`、完成态「今天已记 N 笔」），在其上扩展；
  2. `tests/ui.test.tsx` 的 onboarding 模式 — 确定 `completeOnboarding` 提交体形状；
  3. `src/application/debt-fact-service.ts` 与 `completeOnboarding` 的债务落库路径 — 确定**哪种提交体**会让 `getFinancialMaintenanceState` 返回 `needsCurrentMonthFact === true`（预期：债务未提供 `currentMonthDue` 时待确认），并用真实读回验证，不得凭注释推断。

- **真实链路（至少一个端到端用例）：**

```
NodeSqliteDatabase → migrateDatabase → completeOnboarding(db, submission, asOfDate)
loadHomeState = (date) => getHomeApplicationState(db, date)
loadMaintenanceState = (date) => getFinancialMaintenanceState(db, date)
```

  `asOfDate = localDate(new Date())` 在测试内动态计算，避免跨月 flaky。

- **断言铁律：** 期望任务文案不得凭空手写。每个真实链路用例先独立调用两个服务取基准对象，按第一节的映射表和 `selectTodayTask` 的优先级顺序推导预期 `TaskId`（可在测试里直接用基准数据构造 `TaskContext` 调用 `selectTodayTask` 得到期望值），再断言界面出现 `TASK_COPY[期望TaskId]` 的标题/原因文案。

- 必测用例（最少 6 个）：
  1. **端到端默认路径**：健康提交体（现金充足、无缺口、债务事实已确认、本月无记账）→ 渲染 `DEFAULT_RECORD` 文案；记一笔当月支出后（或用含当月支出的提交体）→ `RECORD_EXPENSE` 文案且「已完成/今天已记 N 笔」行为不变。
  2. **债务事实缺失**：提交体使某笔债务 `needsCurrentMonthFact === true` 且更高优先级标志均为假 → `CONFIRM_DEBT` 文案。
  3. **现金低于安全线**：提交体使 `cashSafetyGateStatus === "ACTIVE"`（且无结构性赤字）→ `SECURE_CASH` 文案。
  4. **结构性赤字**：提交体使 `spendingStatus === "STRUCTURAL_DEFICIT"` → `CLARIFY_GAP` 文案（最高优先级，即使同时存在其它标志）。
  5. **安全垫缺口**：提交体使 `safetyGap > 0`、其它四个标志为假 → `CHECK_SAFETY` 文案。若某标志无法用合理提交体单独构造，允许用 `vi.fn().mockResolvedValue(最小基准变体)` 替换对应 `load*` 函数，但基准对象必须来自真实 `getHomeApplicationState` 输出后仅改被验证的那一个字段，并在回执中说明。
  6. **失败降级**：`loadHomeState` 或 `loadMaintenanceState` 被 `mockRejectedValue` 替换时组件返回 `null`（不渲染任务卡、不抛错）。

### 3.2 `tests/v2-ui/v2-surface.test.tsx`（同步）

- mock 增加 `loadMaintenanceState: vi.fn().mockResolvedValue(最小FinancialMaintenanceState)`（含 `debts: []` 即可满足本批次用法，但类型必须完整通过）；`loadHomeState` 的最小对象沿用 build-34 已有夹具。
- 现有用例行为不得变化；「今天」页相关用例按新行为（真实任务文案）更新等待目标。

---

## 四、验证命令（逐条通过才算完成）

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"

# 4.1 专项
env NODE_ENV=test npx vitest run tests/v2-ui/today-task.test.tsx tests/v2-ui/v2-surface.test.tsx --reporter=verbose

# 4.2 全量回归（378 + 本批净增，80 skipped 不变，0 failed）
env NODE_ENV=test npx vitest run --reporter=dot

# 4.3 类型检查
npm run typecheck

# 4.4 lint（必须整体通过）
npm run lint

# 4.5 构建
npm run build
```

---

## 五、红线（违反即 RETURN）

1. 禁止修改第一节「禁止触碰」清单中的任何文件；`v2-task-selector.ts` 只允许 2.1 的新增函数与注释更新。
2. `selectTodayTask` 的优先级顺序、`TASK_COPY` 文案一字不改。
3. 禁止在 `src/ui/` 内比较金额或导入 `money` / Decimal；`hasSafetyGap` 一律走 `hasPositiveSafetyGap`。
4. 禁止把 `V2Surface` 接入 `App.tsx` / `main.tsx`。
5. 测试命令必须带 `env NODE_ENV=test`；禁止网络请求；禁止安装新依赖。
6. 不得提交未跟踪文件。

---

## 六、提交

仅提交下列文件（逐一 `git add` 显式路径）：

```
src/model/v2-task-selector.ts
src/ui/v2-today-task.tsx
src/ui/v2-surface.tsx
tests/v2-ui/today-task.test.tsx
tests/v2-ui/v2-surface.test.tsx
```

提交信息：

```
build-35: U-08 today-task flags wired to real V1 model signals
```

---

## 七、提交回执格式

```
U-08（build-35）执行回执

1. 专项测试结果：today-task X passed / v2-surface Y passed, Z failed
2. 全量测试结果：A passed, B failed, C skipped
3. TypeCheck：N errors；Lint：N problems；Build：success/failure
4. 五个标志的命中说明：每个标志由哪个用例命中、用真实提交体还是基准变体 mock
5. needsCurrentMonthFact 构造方式说明（哪种提交体产生待确认债务事实，读回验证结果）
6. HEAD：commit-hash
7. git status --short 输出
```