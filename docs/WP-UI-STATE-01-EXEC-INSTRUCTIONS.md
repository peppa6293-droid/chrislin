# WP-UI-STATE-01 执行任务书：首页两卡「加载态 / 禁用态」

> 版本：v1.1（可执行稿 + 执行期勘误，见 §17）
> 适用仓库：`个人财务模型app开发项目 2`
> 依据：`docs/DESIGN-UX-REVAMP-20261023.md` §3 组件状态表 + §4.2 结构卡状态表（S7 加载、S8 禁用/无权限）
> Owner 决策（2026-10-27）：选 A —— **「能力 + 真实接线」**。两卡支持 `loading`（3 条 shimmer，300ms 防抖）与 `disabled`；`loading` 只在真实刷新（记录后重读、财务数据保存后重读、收入/计划/停用/债务事实保存后重读、切换验收日期）超过 300ms 时出现；`disabled` 只留能力、**不接任何入口**（当前产品没有权限模型，禁止造假状态）。
> 本包不改任何已批准文案，不重排布局，不动进展页。

---

## 0. 完成定义（DoD）

| # | 判定 | 证据 |
|---|---|---|
| 0.1 | 两卡新增 `status: "ready" \| "loading" \| "disabled"`（默认 `ready`），不传时 DOM 与现在逐字节等价 | T3/T4 + §12 用例 R1/R2/R3 |
| 0.2 | `loading` 渲染 3 条骨架条，卡内旧内容仅隐藏、**仍占位**，卡片高度与 `ready` 完全相等（差 0px） | §13 视觉验收 |
| 0.3 | 300ms 防抖：真实刷新 <300ms 不显示骨架、不闪；≥300ms 显示；刷新结束立即回到 `ready` | T2 + §12 H1–H6 |
| 0.4 | 至少 1 条真实接线：记录一笔成功后的重读；其余 8 处重读统一接入 | T6 |
| 0.5 | `disabled` 渲染 `opacity:.56`（复用 `.v2-card--disabled`）+ 标题「暂时无法查看」，无入口 | T3/T4 + §12 R2/R5 |
| 0.6 | 改完后全仓 526 例全绿、44 例 skip 不变、tsc/biome 干净 | §13 |

---

## 1. 现状证据（为什么必须先做接线，而不是只写 CSS）

1. **首屏不渲染卡片**：`src/ui/App.tsx` 在 `state.status === "LOADING"` 时直接返回整屏 `.loading-screen`（`正在打开你的本地账本…`），卡片此时不在 DOM 里。所以骨架屏不可能服务首屏——它只服务「已经渲染出来、正在重读」的窗口。
2. **无权限模型**：全仓没有鉴权、角色、只读账户概念，S8 的「禁用/无权限」没有任何生产入口。
3. **本地读很快**：`services.getHomeApplicationState()` 走本地 SQLite（Tauri IPC），正常 <50ms，300ms 阈值意味着骨架**几乎永远不出现**——这正是设计意图（宁可不闪），不是缺陷。
4. **样式已经存在**：`src/ui/v2-card.css:40` 已有 `.v2-card--disabled { opacity: .56; pointer-events: none }`，但**没有任何组件使用**（`grep -rn "v2-card--disabled" src --include=*.tsx` 为空）。
5. **全仓没有骨架屏**：`grep -rniE "shimmer|skeleton|骨架" src/` 为空，`--v2-skeleton` 之类 token 也不存在。

结论：本包 = 1 个防抖 hook + 2 个卡片状态 + 1 段 CSS + 9 处接线 + 12 个用例；不做人工延迟，不做假权限。

---

## 2. T0 基线快照（先做，不做完不许改代码）

```bash
cd "个人财务模型app开发项目 2"
git rev-parse --short HEAD                       # 期望 5443bcb
git status --porcelain | wc -l                   # 期望 90（含本任务书即为 91）
npx tsc --noEmit                                 # 期望 exit 0
npx biome check src tests                        # 期望 Checked 161 files … 0 error
npx vitest run                                   # 期望 49 files / 514 passed / 44 skipped / 0 failed
```

`git status` 里已有 **82 条**与本包无关的脏文件（前几个 WP 的产物），**全部不得碰**。开工后只允许本任务书 §3 的 9 个文件发生变化。

写出回执时，这五个数字必须原样复现。

---

## 3. 任务表

| 任务 | 文件 | 动作 | 产出 |
|---|---|---|---|
| T1 | `src/ui/card-status.ts` | 新建 | 三态类型 + 禁用文案常量（全仓唯一） |
| T2 | `src/ui/use-cards-refresh.ts` | 新建 | 300ms 防抖 + 并发计数的 `useCardsRefresh` |
| T3 | `src/ui/V2StructureCard.tsx` | 改 | `status` prop、骨架、禁用标题与 class |
| T4 | `src/ui/V2MonthlySpendCard.tsx` | 改 | 同上（注意 `aria-label` 逻辑） |
| T5 | `src/ui/v2-home-revamp.css` | 改（纯追加） | 骨架条、shimmer、隐藏规则、禁用隐藏块 |
| T6 | `src/ui/App.tsx` | 改 | 9 处 `getHomeApplicationState` 接入 `track()`，向下传 `cardsStatus` |
| T7 | `src/ui/HomeScreen.tsx` + `src/ui/V2HomeSurface.tsx` | 改 | 透传 `cardsStatus` |
| T8 | `tests/v2-cards-loading.test.tsx` | 新建 | 12 个用例 |
| T9 | — | 验收 | §13 全表 + 回执 |

**白名单（9 个，多一个都不行）**：
```
src/ui/card-status.ts（新）
src/ui/use-cards-refresh.ts（新）
tests/v2-cards-loading.test.tsx（新）
src/ui/V2StructureCard.tsx
src/ui/V2MonthlySpendCard.tsx
src/ui/v2-home-revamp.css
src/ui/App.tsx
src/ui/HomeScreen.tsx
src/ui/V2HomeSurface.tsx
```

**黑名单（一行都不许动）**：`src/model/**`、`src/persistence/**`、`src/application/**`、`src/runtime/**`、`src/ui/V2ProgressBar.tsx`、`src/ui/v2-month-copy.ts`、`src/ui/V2StructureCompareBar.tsx`、`src/ui/Onboarding.tsx`、`src/ui/FinancialMaintenanceDialog.tsx`、`src/ui/V2Dashboard*`、`src/style.css`、`src/ui/v2-card.css`、`src/ui/v2-tokens.css`、`tests/v2-ui.test.tsx` 及其它任何既有测试、`vitest.config.ts`、`vite.config.ts`、`package.json`、`docs/**`。

---

## 4. T1 `src/ui/card-status.ts`（新建，全文）

```ts
/** 首页两张卡的展示状态。loading 只在真实刷新超过防抖阈值时出现。 */
export type CardStatus = "ready" | "loading" | "disabled";

/** 禁用态标题；全仓只允许这一处定义。 */
export const CARD_DISABLED_TITLE = "暂时无法查看";
```

约束：
- 除这个文件外，`.tsx` 里不得再出现字面量 `暂时无法查看`（§13 用 `grep -rc` 卡死在 1）。
- 不要在这里放任何延时、DOM、React 依赖。

---

## 5. T2 `src/ui/use-cards-refresh.ts`（新建，全文）

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { CardStatus } from "./card-status.js";

/** 300ms 内完成的刷新不显示骨架，避免闪烁。 */
export const CARDS_LOADING_DELAY_MS = 300;

/**
 * 把「真实刷新」映射成卡片状态：
 * - 刷新开始计时，满 delayMs 仍在进行 → loading
 * - 刷新在阈值内结束 → 保持 ready（从不出现骨架）
 * - 多个刷新并发时用计数聚合，最后一个结束才回 ready
 */
export function useCardsRefresh(delayMs: number = CARDS_LOADING_DELAY_MS) {
  const [status, setStatus] = useState<CardStatus>("ready");
  const pendingCount = useRef(0);
  const timer = useRef<number | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, []);

  const track = useCallback(
    async <T>(work: Promise<T>): Promise<T> => {
      pendingCount.current += 1;
      if (pendingCount.current === 1 && timer.current === null) {
        timer.current = window.setTimeout(() => {
          timer.current = null;
          if (mounted.current) setStatus("loading");
        }, delayMs);
      }
      try {
        return await work;
      } finally {
        pendingCount.current -= 1;
        if (pendingCount.current === 0) {
          if (timer.current !== null) {
            window.clearTimeout(timer.current);
            timer.current = null;
          }
          if (mounted.current) setStatus("ready");
        }
      }
    },
    [delayMs],
  );

  return { status, track };
}
```

约束：
- 必须接收 `Promise`，不要改成 thunk；`track` 必须原样返回结果、原样抛错（调用点的 try/catch 语义不能变）。
- 不得在 hook 里 `await` 后再 `setStatus("loading")`——必须是 `setTimeout`，否则阈值失效。
- 不要导出 `setStatus`；外部只能拿到 `ready | loading`（`disabled` 由卡片 prop 直接控制）。

---

## 6. T3 结构卡 `src/ui/V2StructureCard.tsx`

### 6.1 import 与 props

在文件头 import 区加：

```ts
import { CARD_DISABLED_TITLE, type CardStatus } from "./card-status.js";
```

props 类型与解构改为（其余字段原样）：

```tsx
export function V2StructureCard({
  home,
  pendingDebtFactNames,
  onOpenFixedExpenses,
  onOpenDebt,
  onOpenCashflow,
  status = "ready",
}: {
  home: HomeApplicationState;
  pendingDebtFactNames: string[];
  onOpenFixedExpenses: () => void;
  onOpenDebt: () => void;
  onOpenCashflow: () => void;
  status?: CardStatus;
}) {
```

在 `const tone = ...` 之后加：

```tsx
  const loading = status === "loading";
  const disabled = status === "disabled";
  const titleText = disabled ? CARD_DISABLED_TITLE : title;
```

### 6.2 `<section>` 的 class 与属性

把现在的：

```tsx
    <section
      className={`v2-card v2-card--soft v2-today-snapshot v2-structure-card ${tone} ${
        !pending && surplus.lt(0) ? "v2-card--over" : ""
      }`}
      aria-labelledby="v2-structure-title"
    >
```

替换为：

```tsx
    <section
      className={[
        "v2-card",
        "v2-card--soft",
        "v2-today-snapshot",
        "v2-structure-card",
        tone,
        !pending && surplus.lt(0) ? "v2-card--over" : "",
        disabled ? "v2-card--disabled is-disabled" : "",
        loading ? "is-loading" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-labelledby="v2-structure-title"
      aria-busy={loading || undefined}
      inert={loading}
    >
```

### 6.3 标题改用 `titleText`

```tsx
      <h2 id="v2-structure-title" className="v2-card__title">
        {titleText}
      </h2>
```

### 6.4 骨架（渲染在 `</section>` 之前，作为最后一个子节点）

```tsx
      {loading && (
        <div className="v2-card__skeleton" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
```

要求：
- **恰好 3 个 `<i />`**，不加文字、不加图标、不加 `role`。
- 骨架**不要**替换或删除原有内容节点——旧内容必须留在 DOM 里占位（这是「高度不跳」的唯一保证）。隐藏由 CSS（T5）完成。
- `inert` 用 React 19 的布尔写法（`inert={loading}`），不要写成 `inert={loading ? "" : undefined}`。

---

## 7. T4 月卡 `src/ui/V2MonthlySpendCard.tsx`

与 T3 同构，差异只有标题的 `aria-label`：

1. import 同 T3。
2. props 增加 `status?: CardStatus`，解构默认 `status = "ready"`；函数体内在原有 `title` 之后加：
   ```tsx
   const loading = status === "loading";
   const disabled = status === "disabled";
   const titleText = disabled ? CARD_DISABLED_TITLE : title;
   ```
3. `<section>` class 改为数组拼接（保留原有 `band === "OVER" ? "is-over-budget v2-card--over" : ""` 这一段原样作为一项），并追加：
   ```tsx
   disabled ? "v2-card--disabled is-disabled" : "",
   loading ? "is-loading" : "",
   ```
   属性加 `aria-busy={loading || undefined}` 与 `inert={loading}`。
4. `<h2>` 改为：
   ```tsx
   <h2 id="v2-month-title" className="v2-card__title" aria-label={titleText ? undefined : KICKER}>
     {titleText}
   </h2>
   ```
   ⚠️ 这里必须继续用 `undefined`（不能用 `""`），否则会把每个档位的可达标题名覆盖成「本月消费」。禁用态 `titleText` 非空，所以不会继承 kicker，符合预期。
5. 骨架 JSX 与 T3 逐字相同，放在 `</section>` 之前。

---

## 8. T5 `src/ui/v2-home-revamp.css`（纯追加，文件末尾）

在文件最后追加下面整段（一行都不要删改已有内容）：

```css
/* WP-UI-STATE-01：加载骨架与禁用态。骨架叠在旧内容上，旧内容 visibility
   hidden 但仍占位，因此卡片高度与 ready 完全一致，不会跳动。 */
.v2-card.is-loading {
  pointer-events: none;
}

.v2-card.is-loading > *:not(.v2-card__skeleton) {
  visibility: hidden;
}

.v2-card__skeleton {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: var(--v2-space-3);
  padding: var(--v2-card-pad);
}

.v2-card__skeleton i {
  display: block;
  border-radius: 6px;
  background: linear-gradient(90deg, #e9f1ee 0%, #f6faf8 50%, #e9f1ee 100%);
  background-size: 200% 100%;
  animation: v2-card-shimmer 1.4s ease-in-out infinite;
}

.v2-card__skeleton i:nth-child(1) {
  width: 88px;
  height: 12px;
}

.v2-card__skeleton i:nth-child(2) {
  width: 62%;
  height: 28px;
}

.v2-card__skeleton i:nth-child(3) {
  width: 44%;
  height: 40px;
}

@keyframes v2-card-shimmer {
  from {
    background-position: 200% 0;
  }
  to {
    background-position: -200% 0;
  }
}

/* 禁用态：遮住金额、算式、进度与操作，只留卡头与「暂时无法查看」。
   .v2-card--disabled 的 opacity / pointer-events 已在 v2-card.css 中定义，不重复。 */
.v2-card.is-disabled .v2-card__value,
.v2-card.is-disabled .v2-card__line,
.v2-card.is-disabled .v2-card__actions,
.v2-card.is-disabled .v2-structure-value,
.v2-card.is-disabled .v2-structure-dots,
.v2-card.is-disabled .v2-structure-bar,
.v2-card.is-disabled .v2-month-empty,
.v2-card.is-disabled [role="progressbar"] {
  display: none;
}

@media (prefers-reduced-motion: reduce) {
  .v2-card__skeleton i {
    animation: none;
    background: #edf3f1;
  }
}
```

说明：
- 只用 `--v2-space-3` 与 `--v2-card-pad` 两个现有 token，不新增 token，不改 `v2-tokens.css`。
- 不加 `min-height`、不加 `height`——高度完全由旧内容撑住，这是 §13「差 0px」的来源。

---

## 9. T6 `src/ui/App.tsx` 接线

### 9.1 import 与 hook

```ts
import { useCardsRefresh } from "./use-cards-refresh.js";
```

在组件内、其它 `useState` 之后加：

```ts
  const { status: cardsStatus, track } = useCardsRefresh();
```

### 9.2 九处重读（第 10 处 `HomeRecovery` 不动；逐处替换，字符串必须逐字匹配）

**S1 / S2 / S3 是三处不同写法，S4 是 6 处完全相同的行：**

S1（切换验收日期，`pending.length === 0` 分支）：

```ts
        pending.length === 0 ? await services.getHomeApplicationState(effectiveDate) : null;
```
→
```ts
        pending.length === 0 ? await track(services.getHomeApplicationState(effectiveDate)) : null;
```

S2（记录一笔后的重读）：

```ts
      const [record, refreshed] = await Promise.all([
        services.getExpenseRecordById(writtenExpenseId),
        services.getHomeApplicationState(asOfDate),
      ]);
```
→
```ts
      const [record, refreshed] = await track(
        Promise.all([
          services.getExpenseRecordById(writtenExpenseId),
          services.getHomeApplicationState(asOfDate),
        ]),
      );
```

S3（财务数据保存后的重读）：

```ts
      [stateReadback, homeReadback] = await Promise.all([
        services.getFinancialMaintenanceState(asOfDate),
        services.getHomeApplicationState(asOfDate),
      ]);
```
→
```ts
      [stateReadback, homeReadback] = await track(
        Promise.all([
          services.getFinancialMaintenanceState(asOfDate),
          services.getHomeApplicationState(asOfDate),
        ]),
      );
```

S4（6 处，**全部替换**；`savePlanningMonthDecision` / `reviseActualIncome` / `deactivateCashAccount` / `deactivateAsset` / `deactivateDebt` / `saveCurrentMonthDebtFact` 内各一处）：

```ts
setHome(await services.getHomeApplicationState(sessionAsOfDate));
```
→
```ts
setHome(await track(services.getHomeApplicationState(sessionAsOfDate)));
```

> 第 9 处是 `saveCurrentMonthDebtFact` 里带 `try/catch` 与中文错误消息的那一处，同样是这行，一起替换即可。**不要**动 `App` 末尾 `HomeRecovery` 组件里的 `services.getHomeApplicationState(asOfDate).then(...)`（那是恢复页，不在白名单语义内）。

### 9.3 向下传

`<HomeScreen` 上加一行（放在 `pendingDebtFactNames` 之后）：

```tsx
      cardsStatus={cardsStatus}
```

---

## 10. T7 透传

### 10.1 `src/ui/HomeScreen.tsx`

1. import：
   ```ts
   import type { CardStatus } from "./card-status.js";
   ```
2. `HomeScreen` props 解构里加 `cardsStatus = "ready",`（放在 `pendingDebtFactNames` 附近）；类型里加：
   ```ts
   cardsStatus?: CardStatus;
   ```
3. `<V2HomeSurface` 上加：
   ```tsx
         cardsStatus={cardsStatus}
   ```

### 10.2 `src/ui/V2HomeSurface.tsx`

1. import 同上。
2. props 解构加 `cardsStatus = "ready",`；类型 `V2HomeSurfaceProps` 加 `cardsStatus?: CardStatus;`。
3. ⚠️ 实测提醒（§17.5）：`V2HomeSurface` 的两卡实际渲染在内部 `TodayPanel` 组件里，只改外层 props 会得到「`cardsStatus` 未使用」的编译错误。必须在**同一个文件内**给 `TodayPanel` 增加 `cardsStatus: CardStatus` 参数、类型与调用处传值，再传给两卡。

4. 两卡各加一个 prop：

```tsx
        <V2StructureCard
          home={home}
          pendingDebtFactNames={pendingDebtFactNames}
          status={cardsStatus}
```
```tsx
        <V2MonthlySpendCard
          home={home}
          savedExpenseId={savedExpenseId}
          status={cardsStatus}
```

> `V2HomeSurface` 的进展页（`V2ProgressBar` 那套）**不要**接 `cardsStatus`，也不要把 `status` 传给它。

---

## 11. T8 测试 `tests/v2-cards-loading.test.tsx`（新建）

### 11.1 测试数据

从 `tests/v2-ui.test.tsx` 复制顶部 `const home: HomeApplicationState = {` 起到该对象闭合的 `};` 为止（含 `currentMonthVariableExpenseCount: 2` 与 `recentExpenses: []`），改名为 `baseHome`。字段一个都不要改、不要删。

### 11.2 文件骨架

```tsx
// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeApplicationState } from "../src/application/product-service.js";
import { V2MonthlySpendCard } from "../src/ui/V2MonthlySpendCard.js";
import { V2StructureCard } from "../src/ui/V2StructureCard.js";
import { useCardsRefresh } from "../src/ui/use-cards-refresh.js";

// baseHome = 复制自 tests/v2-ui.test.tsx 的 home

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderStructure(status: "ready" | "loading" | "disabled" = "ready") {
  render(
    <V2StructureCard
      home={baseHome}
      pendingDebtFactNames={[]}
      onOpenFixedExpenses={() => {}}
      onOpenDebt={() => {}}
      onOpenCashflow={() => {}}
      status={status}
    />,
  );
  return document.querySelector<HTMLElement>(".v2-structure-card") as HTMLElement;
}

function renderMonth(status: "ready" | "loading" | "disabled" = "ready") {
  render(
    <V2MonthlySpendCard
      home={baseHome}
      savedExpenseId={null}
      onOpenDetail={() => {}}
      onOpenLedger={() => {}}
      onOpenExpense={() => {}}
      status={status}
    />,
  );
  return document.querySelector<HTMLElement>(".v2-month-card") as HTMLElement;
}
```

### 11.3 必须写的 12 个用例

**骨架/状态（组件层，6 个）**

| id | 断言 |
|---|---|
| S1 | `renderStructure("loading")`：`aria-busy="true"`、`inert` 存在、`.v2-card__skeleton i` 恰好 3 个 |
| S2 | 同上：`.v2-card__value` 仍存在（旧内容占位，高度不塌），且 `.v2-card__skeleton` 是最后一个子节点 |
| S3 | `renderStructure("disabled")`：标题可达名为「暂时无法查看」、class 同时含 `v2-card--disabled` 与 `is-disabled` |
| M1 | `renderMonth("loading")`：`aria-busy`、`inert`、3 条骨架 |
| M2 | `renderMonth("disabled")`：标题「暂时无法查看」、含 `is-disabled` |
| D3 | `renderStructure("ready")` 与 `renderMonth("ready")`：无 `.v2-card__skeleton`、无 `aria-busy`、无 `inert`，标题仍是正式文案（结构卡「账单：不是，他怎么还剩钱？」，月卡「支付软件：你是不是把我卸了？」） |

**防抖（hook 层，6 个）**

| id | 断言 |
|---|---|
| H1 | `vi.useFakeTimers()` 后 `track(pending)`，前进 299ms 仍是 `ready` |
| H2 | 再前进 1ms → `loading` |
| H3 | 未满 300ms 即 resolve：全程 `ready`，结束后仍 `ready` |
| H4 | 两个并发 `track`：第一个结束时仍 `loading`（若已过阈值），两个都结束才 `ready` |
| H5 | `track` 内的 Promise reject：错误原样抛出（`await expect(...).rejects.toThrow(...)`），随后状态回 `ready` |
| H6 | 卸载后前进 1000ms 不报错、不产生 state 更新（`unmount()` 后 `vi.advanceTimersByTime(1000)`） |

H1–H6 参考写法（H1/H2 合并示意，其余同构）：

```tsx
it("H1/H2 满 300ms 才进入 loading", async () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useCardsRefresh());
  let release!: () => void;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  let tracked: Promise<void> = Promise.resolve();
  act(() => {
    tracked = result.current.track(pending);
  });
  expect(result.current.status).toBe("ready");
  act(() => {
    vi.advanceTimersByTime(299);
  });
  expect(result.current.status).toBe("ready");
  act(() => {
    vi.advanceTimersByTime(1);
  });
  expect(result.current.status).toBe("loading");
  await act(async () => {
    release();
    await tracked;
  });
  expect(result.current.status).toBe("ready");
});
```

约束：
- 只能用 `vi.useFakeTimers()`，禁止 `await new Promise(setTimeout(350))` 这类真等待（会拖慢且不稳定）。
- `tests/**/*.tsx` 不在 `tsconfig` 的 `include` 里（只含 `tests/**/*.ts`），所以测试文件的类型错不会被 `tsc` 拦住——但仍必须过 `biome check`：**禁止 `!` 非空断言**（`noNonNullAssertion` 会告警），可声明时先给初值 `let tracked: Promise<void> = Promise.resolve();`。
- 并发用 `Promise.withResolvers()`（Node ≥22.3 已具备），不要手搓 `let resolve!: …`。
- 断言用 DOM/状态，不要给 CSS 类断言颜色——happy-dom 不计算外部样式表。

---

## 12. T9 验收

### 12.1 静态与测试（数字必须逐项一致）

```bash
npx tsc --noEmit                       # exit 0
npx biome check src tests              # Checked 164 files … 0 error（161 + 3 个新文件）
npx vitest run tests/v2-cards-loading.test.tsx   # 12 passed
npx vitest run                         # 50 files / 526 passed / 44 skipped / 0 failed
```

### 12.2 结构 grep（每条单独执行，结果写进回执）

| # | 命令 | 期望 |
|---|---|---|
| 1 | `grep -rc "暂时无法查看" src --include=*.ts --include=*.tsx \| grep -v ":0"` | 只有 `src/ui/card-status.ts:1` |
| 2 | `grep -c "useCardsRefresh" src/ui/App.tsx` | 2（import 1 + 调用 1）；**不得用 import 别名凑成 1** |
| 3 | `grep -c "track(" src/ui/App.tsx` | 9 |
| 4 | `grep -c "getHomeApplicationState" src/ui/App.tsx` | 10（9 接线 + 1 恢复页未改） |
| 5 | `grep -c "is-loading" src/ui/V2StructureCard.tsx src/ui/V2MonthlySpendCard.tsx \| awk -F: '{s+=$2} END {print s}'` | 2 |
| 6 | `grep -c "v2-card__skeleton" src/ui/V2StructureCard.tsx src/ui/V2MonthlySpendCard.tsx \| awk -F: '{s+=$2} END {print s}'` | 2 |
| 7 | `grep -c "setTimeout" src/ui/use-cards-refresh.ts` | 1 |
| 8 | `grep -c "inert=" src/ui/V2StructureCard.tsx src/ui/V2MonthlySpendCard.tsx \| awk -F: '{s+=$2} END {print s}'` | 2 |
| 9 | `git diff --numstat -- src/ui/v2-home-revamp.css` | 新增行 ≈ 60，删除 0 |
| 10 | `git status --porcelain \| wc -l` | 基线 B（含本任务书为 **91**）→ 实测 **B + 4 = 95**（见 §17.2） |

> 第 10 条的算法：基线（含任务书）记为 B，改完后必须是 **B + 4**——3 个新文件（`card-status.ts`、`use-cards-refresh.ts`、测试文件）+ 1 个原为干净的修改文件（`V2HomeSurface.tsx`）；`App.tsx`、`HomeScreen.tsx`、两卡、CSS 开工时已在脏文件里（前序 WP 的未提交改动），不新增条目。判断「有没有多改」不要看条数，要看 §2 的 mtime 快照 + 逐文件 diff。

### 12.3 文案回归（COPY-01 的 16 条逐字仍必须为 1）

```bash
for s in "每月固定收支" "账单：不是，他怎么还剩钱？" "钱包：还活着，先别开香槟。" \
         "工资：来过，爱过，没留过。" "工资：你们分赃怎么不带我商量？" "收入：我一个人打五个？" \
         "收入：暂未出场。账单：戏份拉满。" "收入：你不来？账单：那我也不来了。" \
         "资料不齐，花点时间补一下" "本月消费" "支付软件：你是不是把我卸了？" \
         "钱包：目前还没申请工伤。" "预算：我感觉有人在试探我的底线。" \
         "预算：现在撤回付款还来得及吗？" "预算：我先走一步，剩下你俩聊。" \
         "本月还没有已发生的消费。"; do
  printf '%s  %s\n' "$(grep -rFc "$s" src | awk -F: '{s+=$2} END {print s}')" "$s"
done
```
除 `本月消费` 外，每条必须是 `1`；`本月消费` 全 `src` 合计为 **6**（`FixedExpensesPage.tsx`、`v2-quick-entry.tsx`、`V2MonthSummary.tsx`、`v2-month-copy.ts`、`V2FeedbackStage.tsx`、`V2MonthlySpendCard.tsx` 各 1，全部为既有代码），本包的判据是**卡片作用域内仍为 1 且新增行里 0 次**：

```bash
grep -c "本月消费" src/ui/V2MonthlySpendCard.tsx        # 1
# 本包五个 tsx 的新增行中不得出现该字符串
for f in V2StructureCard.tsx V2MonthlySpendCard.tsx App.tsx HomeScreen.tsx V2HomeSurface.tsx; do
  diff "/tmp/<开工快照>/$f" "src/ui/$f" | grep '^>' | grep -c "本月消费"
done                                                      # 每项 0
```

同时复查 COPY-01 §11.3 的 13 条仍为 `0`。

### 12.4 视觉（三宽 + 骨架等高，必须自己跑）

**做法**：临时建两个文件跑无头 Chrome，量完立刻删掉，最后 `git status` 必须回到 §12.2 第 10 条的数值。

1. `wp-state01-probe.html`（仓库根）：
```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><title>probe</title></head>
  <body><div id="root"></div><script type="module" src="/src/ui/wp-state01-probe.tsx"></script></body>
</html>
```
2. `src/ui/wp-state01-probe.tsx`：`?status=ready|loading|disabled` 决定传入的 `status`，渲染
   `<div className="v2-today-page"><div className="v2-home-cards">` + 两卡（props 同测试里的 helper、`status` 用查询参数）。
   渲染完成后把测量结果写进 `document.body.dataset.metrics`：
   `{"status":"loading","width":1000,"scrollWidth":…,"heights":[…]}`，用 `requestAnimationFrame` 连等两帧再写。
3. 起服务与测量：
```bash
npx vite --port 5199 --strictPort &
sleep 4
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
for s in ready loading disabled; do
  for w in 1440 1000 760; do
    "$CH" --headless=new --window-size=$w,1400 --virtual-time-budget=5000 \
      --dump-dom "http://localhost:5199/wp-state01-probe.html?status=$s" \
      | grep -o 'data-metrics="[^"]*"' | sed "s/^/$s $w /"
  done
done
```

**判定**：
- `ready` 与 `loading` 在同一宽度下 `heights` 两个数**完全相等**（差 0px）；
- 三种状态、三个宽度下 `scrollWidth === width`（无横向滚动）；
- `loading` 截图里能看到 3 条骨架、且卡内无金额文字；
- `disabled` 截图里卡头下方为空、无按钮、整体变淡；
- 截图存 `/tmp/wp-state01/{ready,loading,disabled}-{1440,1000,760}.png`，回执列出路径。

**收尾（缺一不可）**：
```bash
rm -f wp-state01-probe.html src/ui/wp-state01-probe.tsx
pkill -f "vite --port 5199"
git status --porcelain | wc -l   # 回到 §12.2 第 10 条的数值
```

---

## 13. 禁止项

1. 禁止用 `setTimeout(...)`、`await sleep(...)` 在卡片或 App 里**人为制造** >300ms 的加载——骨架必须由真实刷新驱动。
2. 禁止给 `disabled` 接任何真实入口（没有权限模型）；也禁止把它挂到「资料不齐/待确认债务」上——那是 COPY-01 已批准的独立状态，文案不同。
3. 禁止改动卡片已有文案、算术语义、`aria-labelledby`、`V2StructureCompareBar`、`V2ProgressBar` 的任何行为。
4. 禁止把骨架做成 `min-height`/固定高度来「保证」不跳动；必须靠旧内容占位。
5. 禁止改 `v2-card.css` / `v2-tokens.css` / `style.css`；`opacity:.56` 已存在，直接复用 class。
6. 禁止动 §3 黑名单里的任何文件，禁止 `git add` / `git commit` / `git checkout` / `git reset` / `git stash`。
7. 禁止在测试里用真实计时器等待；禁止 `it.skip` / `it.only`。
8. 禁止顺手修 `tests/v2-ui.test.tsx` 里任何既有断言。
9. 禁止为了让 grep 通过而给 import 起别名、拆分/拼接字符串或改注释写法——指标错了要报告，不要迎合。

---

## 14. 暂缓与边界（写进回执，不要做）

| 项 | 说明 |
|---|---|
| `disabled` 生产入口 | 等有权限/只读账户模型；本包只交付组件能力与测试 |
| 首屏骨架 | 首屏由 `.loading-screen` 整屏接管，不做卡片骨架 |
| 骨架动效降级 | 已由 `v2-tokens.css` 的全局 `prefers-reduced-motion` 规则兜底，本包只补一条静态底色 |
| 骨架条数/形状的可配置 | 固定 3 条，不做 props 化 |

---

## 15. 回执模板

```markdown
## WP-UI-STATE-01 回执

### 1. 基线（T0）
- HEAD / git status / tsc / biome / vitest：

### 2. 改动清单
| 文件 | 类型 | numstat |
（9 行，新文件写行数）

### 3. 接线
- `grep -c "track(" src/ui/App.tsx` = 9
- 9 处清单（S1–S4 各对应哪个函数）：

### 4. 测试
- `tests/v2-cards-loading.test.tsx`：12 passed
- 全仓：50 files / 526 passed / 44 skipped / 0 failed
- tsc / biome 结果：

### 5. grep 表（§12.2 十条 + §12.3 十六条）
逐条贴输出。

### 6. 视觉
- ready/loading/disabled × 1440/1000/760 metrics（贴 JSON）
- ready 与 loading 的高度差：
- 截图路径：
- 探针文件已删除、`git status` 回到：

### 7. 偏差与遗留
（没有就写「无」；偏差必须写原因与影响）
```

---

## 16. 自检（本任务书落地前已核对）

- 9 个白名单文件与仓库现状一致（3 个新建路径未被占用）。
- `src/ui/App.tsx` 中 `getHomeApplicationState` 恰好 10 处：9 处接线（3 处不同写法 + 6 处同一行文本，`replace_all` 一次即可），第 10 处在文件末尾 `HomeRecovery` 里，**不得改**。
- `.v2-card--disabled` 确已存在于 `v2-card.css:40`，无需新增。
- `inert` 依赖 React 19（`package.json` 为 `^19.3.0`），布尔写法可用。
- `--v2-space-3`（12px）、`--v2-card-pad`（24px）均已在 `v2-tokens.css` 定义。
- 全仓 `prefers-reduced-motion` 全局规则在 `v2-tokens.css:100`，本包只补静态底色。
- 现有 44 个 skip 与本包无关，不得变动。


---

## 17. 执行期勘误（v1.1，2026-10-27）

> 以下四条是任务书自身缺陷，均已由执行方在回执中如实报告；此处登记正确答案，避免后续包重犯。

### 17.1 `grep -c "useCardsRefresh"` 期望值写错

原文要求 = 1，但正常 import + 调用必然是 2。执行方为凑数把 import 改成 `useCardsRefresh as useCardRefresh`——**这是迎合指标，不接受**。正确做法：期望 2，import 保持原名，调用点写 `useCardsRefresh()`。

### 17.2 `git status` 增量算错（B+6 → B+4）

原文假设 `App.tsx`、`HomeScreen.tsx` 开工时是干净的；实测两者已在前序 WP 中被改、已在脏文件里。实际增量 = 3 新文件 + `V2HomeSurface.tsx` = 4，91 → 95。

### 17.3 `git diff --numstat` 的 155 不是本包行数

`v2-home-revamp.css` 含 COPY-01 未提交的 84 行；本包实际追加 71 行、删除 0，合计 155。核对新增行要用「与开工快照的逐行 diff」，不要用对 HEAD 的 numstat。

### 17.4 `本月消费` 全 src 为 6，不是 1

该字符串在 6 个既有文件里各出现 1 次（见 §12.3）。任务书把「卡片作用域」的判据误写成「全 src」。正确判据：卡片内 1、新增行 0。

### 17.5 透传少写了一层

`V2HomeSurface` 内两卡位于 `TodayPanel`，需要在该组件上再传一层 `cardsStatus`。原书 T7 只写了外层 props。

### 17.6 已知弱点（不影响本包验收）

- H6 只断言「卸载后推进定时器不抛错」，没有直接证明「没有迟到的 setState」；若以后要收紧，可断言 `console.error` 未被调用。
- 本包没有 App 级集成用例（`recordExpense` → 骨架）——`ProductApplicationServices` 没有测试工厂，构造 30+ 方法 stub 的成本高于收益，接线正确性靠 9 处 grep + 逐行 diff 保证。若后续出现「接线了但没生效」类缺陷，再补。
