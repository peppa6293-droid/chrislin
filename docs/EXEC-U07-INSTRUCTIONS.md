# EXEC-U-07 执行指令（build-34：进展页节点 2-4 接入 V1 模型数据）

**角色：** 执行者
**基线：** build-33（lint 清债）验收后的 HEAD；全量 376 passed / 80 skipped / 0 failed；`npm run lint` 已是有效门槛
**目标：** 进展页（`V2Progress`）节点 2-4 从占位卡升级为展示 V1 财务模型的真实数据（现金安全线 / 债务 / 安全垫）；数据经新增 `loadHomeState` prop 注入，**不**接入 Production 入口、**不**接线 `selectTodayTask` 标志（留给 build-35）
**日期：** 2026-10-20
**修订：** v1

---

## 一、背景与边界

**数据来源（只读引用，禁止修改）：**

`src/application/product-service.ts` 的 `getHomeApplicationState(db, asOfDate)` 返回 `HomeApplicationState`（`src/application/product-service.ts:51` 起），本批次用到的字段：

| 节点 | 字段 |
|---|---|
| 2 稳住现金 | `currentCash`、`cashCoverageMonths`（string \| null）、`minimumCashCoverageMonths`（number）、`cashSafetyGateStatus`（`"ACTIVE" \| "CLEAR" \| "NOT_APPLICABLE"`） |
| 3 理清责任 | `totalDebt`、`mandatoryDebtService`、`debts`（数组，取长度与名称） |
| 4 建立余地 | `safetyResources`、`safetyTargetResources`、`safetyCoverageMonths`（string \| null）、`safetyGap`、`safetyCoverageStatus`（`SafetyCoverageStatus`，**动手前先读该类型的全部取值**） |

**本批次允许改动的文件（共 5 个，除此之外一律不动）：**

| 类型 | 文件 |
|---|---|
| 修改 | `src/ui/v2-progress.tsx` |
| 修改 | `src/ui/v2-progress.css` |
| 修改 | `src/ui/v2-surface.tsx`（仅新增并透传 `loadHomeState` prop） |
| 修改 | `tests/v2-ui/v2-surface.test.tsx`（同步 mock） |
| 修改 | `tests/v2-ui/progress-page.test.tsx`（重写为真实数据库驱动） |

**禁止触碰：**
- `src/model/`、`src/application/`、`src/persistence/` 全部文件
- `src/ui/App.tsx`、`HomeScreen.tsx`、`V2HomeSurface.tsx` 及其它 v2-* 组件
- 禁止把 `V2Surface` 接入 Production 入口（`App.tsx` / `main.tsx`）
- 禁止在 `v2-today-task.tsx` 接线 `TaskContext` 标志（build-35 范围）
- `package.json`、`biome.json`、`vitest.config.ts`、`vite.config.ts`、`src-tauri/` 全部
- 工作区未跟踪文件（`.claude/`、`pelican-bike.html`、`pelican-cycling.html`）不得提交、不得删除

---

## 二、数据接线契约

### 2.1 `v2-surface.tsx`

新增一个 prop，类型从 `product-service.js` **type-only** 导入：

```tsx
import type { HomeApplicationState } from "../application/product-service.js";

// props 增加：
loadHomeState: (asOfDate: string) => Promise<HomeApplicationState>;
```

透传给 `V2Progress`，其余逻辑（导航、记一笔、focusSignal、importService 接线）一律不动。

### 2.2 `v2-progress.tsx`

1. Props 增加同一个 `loadHomeState`；`expenseService.getMonthSummary`（节点 1）保留原样。
2. 同一个 `useEffect` 内并行加载月度汇总与 home 状态（`Promise.all`），沿用现有 `cancelled` 取消模式；任一失败 → 现有错误文案；任一未决 → 现有加载文案。
3. `asOfDate` 用 `localDate(new Date())`（与现有 `month` 计算同源，保证节点 1 与 2-4 口径一致）。
4. **金额零运算**：所有金额字符串原样渲染（两位小数已是模型输出），禁止引入 Decimal、禁止 `Number()` 比较金额。状态判定只依赖枚举字段（`cashSafetyGateStatus`、`safetyCoverageStatus`），不靠数值比较。

### 2.3 节点内容（产品设计 §4.4：不红色惩罚、不 0-100 分）

**节点 2「稳住现金」（取代占位）：**
- 数值行：`现金 ¥{currentCash}`
- 若 `cashCoverageMonths !== null`：`可覆盖 {cashCoverageMonths} 个月（最低要求 {minimumCashCoverageMonths} 个月）`；为 null 显示「覆盖月数待计算」
- 状态文案由 `cashSafetyGateStatus` 映射：`ACTIVE → 现金低于安全线`、`CLEAR → 现金高于安全线`、`NOT_APPLICABLE → 安全线暂不适用`

**节点 3「理清责任」（取代占位）：**
- `总债务 ¥{totalDebt}`
- `本月还款义务 ¥{mandatoryDebtService}`
- `{debts.length} 笔债务`（0 笔时显示「暂无债务记录」）

**节点 4「建立余地」（取代占位）：**
- `安全垫 ¥{safetyResources} / 目标 ¥{safetyTargetResources}`
- 若 `safetyCoverageMonths !== null`：`可覆盖 {safetyCoverageMonths} 个月`
- 状态文案：为 `SafetyCoverageStatus` 的**每个取值**给出中文映射（读类型定义后穷举，用 `satisfies Record<SafetyCoverageStatus, string>` 或等价 switch 保证编译期穷尽）

节点 1「看清消费」保持现状。金额一律 `tabular-nums`（沿用现有 class）。

---

## 三、测试要求

### 3.1 `tests/v2-ui/progress-page.test.tsx`（重写）

- 文件头保留 `// @vitest-environment happy-dom`。
- **真实链路搭建**（照抄 `tests/ui.test.tsx` 的 onboarding 模式，先读该文件确定 `completeOnboarding` 的提交体形状与必填字段，不要猜）：

```
NodeSqliteDatabase → migrateDatabase → completeOnboarding(db, submission, asOfDate)
loadHomeState = (date) => getHomeApplicationState(db, date)
```

- **日期确定性：** `asOfDate = localDate(new Date())` 在测试内动态计算，`completeOnboarding` 与组件内部使用同一基准，避免跨月 flaky。
- **数值断言铁律：** 期望值不得手写。每个用例先独立调用 `getHomeApplicationState(db, asOfDate)` 取基准对象，再断言界面文本包含 `基准对象.字段`（如 `screen.getByText(new RegExp(基准.currentCash))` 或 `¥${基准.currentCash}`）。
- onboarding 提交体至少准备：一笔现金账户（含余额）、一笔债务（含 `currentMonthDue`），使节点 2/3/4 均有非零真实数据。

必测用例（最少 5 个）：
1. 四个节点标题齐序渲染（看清消费/稳住现金/理清责任/建立余地），「即将开放」占位文案消失。
2. 节点 2 现金数值与状态文案 = `getHomeApplicationState` 基准（含 `cashCoverageMonths` 为 null 与非 null 两种提交体，或至少覆盖当前提交体实际产生的分支并断言对应文案）。
3. 节点 3 总债务/本月还款/笔数 = 基准。
4. 节点 4 安全垫/目标/状态 = 基准；`SafetyCoverageStatus` 映射至少覆盖当前提交体产生的取值。
5. `loadHomeState` 被 `vi.fn().mockRejectedValue` 替换时显示错误文案；未决时显示加载文案。

### 3.2 `tests/v2-ui/v2-surface.test.tsx`（同步）

- mock 对象增加 `loadHomeState: vi.fn().mockResolvedValue(最小HomeApplicationState)`；最小对象须含节点 2-4 用到的全部字段（类型以 `HomeApplicationState` 为准）。
- 现有 6 个用例行为不得变化；「进展」页用例改为等待真实节点标题出现。

---

## 四、验证命令（逐条通过才算完成）

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"

# 4.1 专项
env NODE_ENV=test npx vitest run tests/v2-ui/progress-page.test.tsx tests/v2-ui/v2-surface.test.tsx --reporter=verbose

# 4.2 全量回归（376 + 本批新增，80 skipped 不变，0 failed）
env NODE_ENV=test npx vitest run --reporter=dot

# 4.3 类型检查
npm run typecheck

# 4.4 lint（build-33 后已是门槛，必须整体通过）
npm run lint

# 4.5 构建
npm run build
```

---

## 五、红线（违反即 RETURN）

1. 禁止修改第一节「禁止触碰」清单中的任何文件。
2. 禁止在 UI 内重新计算任何模型数值（现金覆盖、安全垫缺口等一律取 `HomeApplicationState` 现成字段）。
3. 禁止金额算术与 Decimal 导入。
4. 禁止把 `V2Surface` 接入 `App.tsx` / `main.tsx`。
5. 禁止改动 `selectTodayTask` 的 `TaskContext` 传参（仍为四个 `false`，build-35 处理）。
6. 测试命令必须带 `env NODE_ENV=test`；禁止网络请求；禁止安装新依赖。
7. 不得提交未跟踪文件。

---

## 六、提交

仅提交下列文件（逐一 `git add` 显式路径）：

```
src/ui/v2-progress.tsx
src/ui/v2-progress.css
src/ui/v2-surface.tsx
tests/v2-ui/v2-surface.test.tsx
tests/v2-ui/progress-page.test.tsx
```

提交信息：

```
build-34: U-07 progress nodes 2-4 wired to V1 model home state
```

---

## 七、提交回执格式

```
U-07（build-34）执行回执

1. 专项测试结果：progress-page X passed / v2-surface Y passed, Z failed
2. 全量测试结果：A passed, B failed, C skipped
3. TypeCheck：N errors；Lint：N problems；Build：success/failure
4. SafetyCoverageStatus 映射表（类型全部取值 → 中文文案）
5. 现金覆盖/安全垫分支覆盖说明（哪些取值被测试命中）
6. HEAD：commit-hash
7. git status --short 输出
```