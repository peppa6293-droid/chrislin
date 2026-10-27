# WP-UI-COPY-01 执行任务书（v2 · 可完整执行版）

- 授权：Owner 2026-10-26 批准首批范围；M7、M8-B **DEFERRED**。
- 基线：`main`，HEAD `5443bcb`，工作区 83 条（原有 82 + 本文件）。
- 本文件取代上一版同名文件。**文案与状态机以本文件为唯一来源**，任何改写、润色、换标点都视为不通过。
- 你（执行方）读完这一份就能开工，不需要再问设计问题；遇到本文件没覆盖的岔路，按 §13 停手回执，不要猜。
- 代码块里的换行与缩进允许按 `biome` 格式化调整；**文案、类名、字段名、状态优先级不得改**。

---

## 0. 完成定义

全部满足才算完成：

1. `npx tsc --noEmit` exit 0；`npx biome check src tests` 0 error；`npx vitest run` 0 failed 且 skipped 不超过 44。
2. §11.2 的 16 条逐字 grep 全部为 1，§11.3 的 13 条全部为 0。
3. §10.2 的行为用例全过（结构 11 条、月卡 7 条）。
4. §11.4 的 `git diff --name-only` 只出现白名单文件，工作区条目数 ≥ 83。
5. §12 的三宽截图无横向滚动，1000px 两卡等高。
6. 按 §15 模板交出回执。

---

## 1. 开工前：快照（T0，必做）

工作区里 `src/application/product-service.ts`（+112/−12）与 `src/ui/V2StructureCard.tsx`（+1/−12）**已经带着别的工单的未提交改动**，它们属于必须保护的 82 条。

```bash
cd "个人财务模型app开发项目 2"
mkdir -p /tmp/wp-copy01-baseline
cp src/application/product-service.ts /tmp/wp-copy01-baseline/
cp src/ui/V2StructureCard.tsx         /tmp/wp-copy01-baseline/
cp src/ui/V2MonthlySpendCard.tsx      /tmp/wp-copy01-baseline/
cp src/ui/v2-home-revamp.css          /tmp/wp-copy01-baseline/
cp tests/v2-ui.test.tsx               /tmp/wp-copy01-baseline/
shasum -a 256 /tmp/wp-copy01-baseline/* | tee /tmp/wp-copy01-baseline/SHA256SUMS
git status --porcelain | wc -l        # 记下，应为 83
git rev-parse --short HEAD            # 应为 5443bcb
```

**回退只允许从这里 `cp` 回来**。全程禁止 `git checkout`、`git reset`、`git stash`、`git clean`、`git add -A`。

---

## 2. 任务总览

| # | 任务 | 文件 | 依赖 | 验收 |
|---|---|---|---|---|
| T0 | 快照与基线 | `/tmp/wp-copy01-baseline/` | — | sha256 记录在案 |
| T1 | 只读计数字段 | `product-service.ts` | T0 | `tsc` 列出待补 fixture |
| T2 | 20 句轮换模块 | `v2-month-copy.ts`（新） | — | 20 句逐字、顺序一致 |
| T3 | fixture 补齐 | `tsc` 点名的测试/夹具 | T1 | `tsc` exit 0，测试仍全绿 |
| T4 | 双条组件 | `V2StructureCompareBar.tsx`（新） | — | `tsc` 通过 |
| T5 | 结构卡重写 | `V2StructureCard.tsx` | T1、T4 | §10 结构 11 条 |
| T6 | 月卡重写 | `V2MonthlySpendCard.tsx` | T2、T3 | §10 月卡 7 条 |
| T7 | 样式增量 | `v2-home-revamp.css` | T4、T5、T6 | §12 目测 |
| T8 | 旧断言更新（4 处） | `tests/v2-ui.test.tsx` | T5、T6 | 定向测试绿 |
| T9 | 新用例 | `tests/v2-ui.test.tsx` | T5、T6 | 定向测试绿 |
| T10 | 全量验收 | — | 全部 | §11 全表 |
| T11 | 三宽截图 + 回执 | — | T10 | §12、§15 |

顺序建议：T0 → T1 → T2 → T3 → T4 → T5 → T8 → T6 → T9 → T7 → T10 → T11。
T7 放最后，先让结构稳定再调间距。

---

## 3. T1 只读计数字段

### 3.1 类型（`src/application/product-service.ts`）

在 `HomeApplicationState` 的 `currentMonthSpending: string;` 之后插入：

```ts
  /** 本月全部可变支出记录数（按 businessDate 的月份统计，不用 asOfDate 截断）。 */
  currentMonthVariableExpenseCount: number;
```

**必须必填**：不要 `?`、不要默认 0，让 `tsc` 把所有待补 fixture 点出来。

### 3.2 映射（同一文件，home 映射对象里 `currentMonthSpending` 那一行之后）

```ts
    currentMonthVariableExpenseCount: built.input.facts.expenses.filter(
      (expense) =>
        expense.kind === "VARIABLE" && expense.businessDate.slice(0, 7) === asOfDate.slice(0, 7),
    ).length,
```

规则：

- 数据源必须是 `built.input.facts.expenses`（与 `currentMonthSpending` 同源）。
- **不得**用 `recentExpenses`（只有最近 3 条）、不得用 `listV2Expenses`、不得按 `day <= asOfDate` 截断。
- 不改表结构、不改 `src/model/**`。

---

## 4. T2 轮换模块

新建 `src/ui/v2-month-copy.ts`，照抄（20 句顺序即数组顺序，一句不多一句不少）：

```ts
/** 首页「本月消费」卡无记录时的 20 句轮换文案。顺序即批准顺序，不得改写或重排。 */
export const MONTH_ROTATION_LINES = [
  "不是哥们，账本开无痕模式了？",
  "我请问呢，今天的流水呢？",
  "钱包：我出场了。账本：你谁？",
  "好好好，账本主打一个查无此人。",
  "记账？包的！动手？下次一定。",
  "账本：我嘞个豆，怎么还是空的？",
  "爱你老己，别光爱付款码啊！",
  "花没花不知道，账是一笔没记。",
  "这账本安静得像开了静音外挂。",
  "我要验牌！消费记录请出示！",
  "账本进入大睡理论，叫不醒一点。",
  "今日含账量：0，抽象浓度：拉满。",
  "钱包演悬疑剧，账本连剧本都没拿。",
  "不是，你的记账按钮被封印了？",
  "小钱家：记录呢？你：在路上了。",
  "账本都长草了，真不来拔一下？",
  "这波属于是赛博失忆，谁懂啊！",
  "先记一笔，主打一个不烧心。",
  "强者喝大水，王者记流水！",
  "再不记账，钱包要申请当场对质了。",
] as const;

/** 同一个本地自然日恒定一句；次日顺延；第 21 天回到第 1 句。用 home.asOfDate，不用 new Date()。 */
export function pickDailyLine(asOfDate: string): string {
  const [year = 1970, month = 1, day = 1] = asOfDate.split("-").map(Number);
  const dayIndex = Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
  const size = MONTH_ROTATION_LINES.length;
  return MONTH_ROTATION_LINES[((dayIndex % size) + size) % size] ?? MONTH_ROTATION_LINES[0];
}
```

`noUncheckedIndexedAccess` 已开启，`?? MONTH_ROTATION_LINES[0]` 不能省。

---

## 5. T3 fixture 补齐

1. 跑 `npx tsc --noEmit`，它会列出所有缺 `currentMonthVariableExpenseCount` 的对象。
2. 逐个补字段，取值必须与同对象的 `currentMonthSpending` 自洽：
   - 花销为 `"0"` / `"0.00"` → 计数写 `0`；
   - 花销 > 0 → 写 ≥ 1 的整数（默认 `1`，已知条数就按条数）。
3. `tests/v2-ui.test.tsx` 里共享的 `home` fixture 花销 `"125.50"`，补 `currentMonthVariableExpenseCount: 2`（紧跟 `currentMonthSpending` 下一行）。
4. **只补字段**，不动其它值、不动断言。

若报错文件落在白名单外（`src/model/**`、`src/persistence/**` 等），停下按 §13 回执。

验收：`npx tsc --noEmit` exit 0，且此时 `npx vitest run` 仍全绿（界面还没改，行为不变）。

---

## 6. T4 双条组件

新建 `src/ui/V2StructureCompareBar.tsx`：

```tsx
import { money } from "../model/money.js";
import { formatCurrency } from "./money-format.js";

/** 收入 / 固定负担双条对比。轨道 aria-hidden，金额以文本给出，不做 progressbar。 */
export function V2StructureCompareBar({
  income,
  essentialExpenses,
  mandatoryDebtService,
}: {
  income: string;
  essentialExpenses: string;
  mandatoryDebtService: string;
}) {
  const incomeValue = money(income);
  const essential = money(essentialExpenses);
  const debt = money(mandatoryDebtService);
  const burden = essential.plus(debt);
  const scale = incomeValue.gt(burden) ? incomeValue : burden;
  const share = (value: typeof burden) =>
    scale.lte(0) ? 0 : value.dividedBy(scale).times(100).toNumber();

  const incomePercent = share(incomeValue);
  const essentialPercent = share(essential);
  const debtPercent = share(debt);
  const burdenPercent = share(burden);
  const overhang = burden.gt(incomeValue);

  return (
    <div className="v2-structure-bar">
      <div className="v2-structure-bar__row">
        <span className="v2-structure-bar__label">收入</span>
        <span className="v2-structure-bar__track" aria-hidden="true">
          <span
            className="v2-structure-bar__fill is-income"
            style={{ width: `${incomePercent}%` }}
          />
        </span>
        <span className="v2-structure-bar__amount">{formatCurrency(income)}</span>
      </div>
      <div className="v2-structure-bar__row">
        <span className="v2-structure-bar__label">固定负担</span>
        <span className="v2-structure-bar__track" aria-hidden="true">
          <span
            className="v2-structure-bar__fill is-essential"
            style={{ width: `${essentialPercent}%` }}
          />
          <span className="v2-structure-bar__fill is-debt" style={{ width: `${debtPercent}%` }} />
          {overhang && (
            <>
              <span
                className="v2-structure-bar__overhang"
                style={{ left: `${incomePercent}%`, width: `${burdenPercent - incomePercent}%` }}
              />
              <span className="v2-structure-bar__tick" style={{ left: `${incomePercent}%` }} />
            </>
          )}
        </span>
        <span className="v2-structure-bar__amount">{formatCurrency(burden.toString())}</span>
      </div>
    </div>
  );
}
```

约束：

- 量程 `scale = max(income, burden)`，两条轨道等宽；负担条两段相加等于负担宽度。
- 负担 > 收入时：负担条画满，`incomePercent` 处一条刻度线，`incomePercent → burdenPercent` 之间盖 `is-overhang` 告警段。
- 不给 `role="progressbar"`，不做百分比数字。

---

## 7. T5 结构卡重写

整文件替换 `src/ui/V2StructureCard.tsx`：

```tsx
import { ArrowRight, WalletCards } from "lucide-react";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { V2StructureCompareBar } from "./V2StructureCompareBar.js";
import { formatCurrency } from "./money-format.js";

const KICKER = "每月固定收支";
const INCOMPLETE_TITLE = "资料不齐，花点时间补一下";

const STRUCTURE_BANDS = {
  STEADY: "账单：不是，他怎么还剩钱？",
  TIGHT: "钱包：还活着，先别开香槟。",
  EVEN: "工资：来过，爱过，没留过。",
  MILD_DEFICIT: "工资：你们分赃怎么不带我商量？",
  DEEP_DEFICIT: "收入：我一个人打五个？",
} as const;

const ZERO_INCOME_COPY = {
  WITH_BURDEN: "收入：暂未出场。账单：戏份拉满。",
  ALL_ZERO: "收入：你不来？账单：那我也不来了。",
} as const;

type StructureBand = keyof typeof STRUCTURE_BANDS;

/** Long-term structure: income minus fixed expenses and debt service. */
export function V2StructureCard({
  home,
  pendingDebtFactNames,
  onOpenFixedExpenses,
  onOpenDebt,
  onOpenCashflow,
}: {
  home: HomeApplicationState;
  pendingDebtFactNames: string[];
  onOpenFixedExpenses: () => void;
  onOpenDebt: () => void;
  onOpenCashflow: () => void;
}) {
  const income = money(home.planningIncome);
  const essentialExpenses = money(home.essentialExpenses);
  const mandatoryDebtService = money(home.mandatoryDebtService);
  const burden = essentialExpenses.plus(mandatoryDebtService);
  const surplus = money(home.baseSurplus);

  const pending = pendingDebtFactNames.length > 0;
  const ratio = pending || !income.gt(0) ? null : surplus.dividedBy(income);
  const band: StructureBand | null =
    ratio == null
      ? null
      : ratio.gte("0.2")
        ? "STEADY"
        : ratio.gt(0)
          ? "TIGHT"
          : ratio.eq(0)
            ? "EVEN"
            : ratio.gt("-0.1")
              ? "MILD_DEFICIT"
              : "DEEP_DEFICIT";

  const title = pending
    ? INCOMPLETE_TITLE
    : band != null
      ? STRUCTURE_BANDS[band]
      : burden.gt(0)
        ? ZERO_INCOME_COPY.WITH_BURDEN
        : ZERO_INCOME_COPY.ALL_ZERO;

  const tone = pending ? "" : surplus.lt(0) ? "is-short" : surplus.eq(0) ? "is-even" : "is-steady";

  return (
    <section
      className={`v2-card v2-card--soft v2-today-snapshot v2-structure-card ${tone} ${
        !pending && surplus.lt(0) ? "v2-card--over" : ""
      }`}
      aria-labelledby="v2-structure-title"
    >
      <div className="v2-card__head">
        <span className="v2-card__kicker">{KICKER}</span>
        <button className="v2-text-button" type="button" onClick={onOpenCashflow}>
          为什么 <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      <h2 id="v2-structure-title" className="v2-card__title">
        {title}
      </h2>
      <div className="v2-card__value v2-structure-value">
        {pending ? (
          <span role="img" aria-label="结构余量待确认">
            —
          </span>
        ) : (
          <MoneyAmount value={home.baseSurplus} size="summary" />
        )}
        <small>结构余量 · 收入 − 固定支出 − 月供</small>
      </div>
      {!pending && (
        <div className="v2-structure-dots" aria-hidden="true">
          <span className={`v2-dot ${tone === "is-steady" ? "is-on" : ""}`} />
          <span className={`v2-dot ${tone === "is-steady" ? "is-on" : ""}`} />
          <span
            className={`v2-dot ${
              tone === "is-short" ? "is-over" : tone === "is-even" ? "is-warn" : "is-on"
            }`}
          />
        </div>
      )}
      {band != null && (
        <V2StructureCompareBar
          income={home.planningIncome}
          essentialExpenses={home.essentialExpenses}
          mandatoryDebtService={home.mandatoryDebtService}
        />
      )}
      <p className="v2-card__line">
        {pending ? (
          <>收入 — · 固定支出 — · 月供 待确认</>
        ) : (
          <>
            收入 {formatCurrency(home.planningIncome)} · 固定支出{" "}
            {formatCurrency(home.essentialExpenses)} · 月供{" "}
            {formatCurrency(home.mandatoryDebtService)}
          </>
        )}
      </p>
      <div className="v2-card__actions">
        <button className="v2-btn v2-btn--secondary" type="button" onClick={onOpenFixedExpenses}>
          <WalletCards size={16} aria-hidden="true" />
          查看固定支出
        </button>
        {(pending || surplus.lt(0)) && (
          <button className="v2-btn v2-btn--secondary" type="button" onClick={onOpenDebt}>
            查看债务
          </button>
        )}
      </div>
    </section>
  );
}
```

关键点（做错即不通过）：

- 删掉 `structureCopy`（三句旧文案）、删掉 `missingData`、删掉「长期格局，不用每月盯。」整段、删掉 `.v2-dots` 三个点。
- 状态优先级：**待确认 > 五档 > 收入为 0**。`pending` 时不显示任何 home 快照金额。
- 收入为 0 时显示真实金额（可能是负数），但没有对比条、不套五档。
- 五档只用 `Decimal` 比较；比例 = `baseSurplus / planningIncome`。

---

## 8. T6 月卡重写

整文件替换 `src/ui/V2MonthlySpendCard.tsx`：

```tsx
import { ArrowRight, ReceiptText } from "lucide-react";
import type { HomeApplicationState } from "../application/product-service.js";
import { money } from "../model/money.js";
import { MoneyAmount } from "./MoneyAmount.js";
import { V2ProgressBar } from "./V2ProgressBar.js";
import { formatCurrency } from "./money-format.js";
import { pickDailyLine } from "./v2-month-copy.js";

const KICKER = "本月消费";
const FUTURE_RECORD_TITLE = "本月还没有已发生的消费。";

const SPEND_BANDS = {
  LOW: "支付软件：你是不是把我卸了？",
  SAFE: "钱包：目前还没申请工伤。",
  WATCH: "预算：我感觉有人在试探我的底线。",
  EDGE: "预算：现在撤回付款还来得及吗？",
  OVER: "预算：我先走一步，剩下你俩聊。",
} as const;

type SpendBand = keyof typeof SPEND_BANDS;

/** This month's discretionary spending against the owner's target. */
export function V2MonthlySpendCard({
  home,
  savedExpenseId,
  onOpenDetail,
  onOpenLedger,
  onOpenExpense,
}: {
  home: HomeApplicationState;
  savedExpenseId: string | null;
  onOpenDetail: () => void;
  onOpenLedger: () => void;
  onOpenExpense: () => void;
}) {
  const spent = money(home.currentMonthSpending);
  const targetText = home.desiredMonthlyDiscretionarySpending;
  const hasTarget = targetText != null && money(targetText).gt(0);
  const count = home.currentMonthVariableExpenseCount;

  const ratio = hasTarget && targetText != null ? spent.dividedBy(money(targetText)) : null;
  const remaining = hasTarget && targetText != null ? money(targetText).minus(spent) : null;

  const band: SpendBand | null =
    ratio == null || !spent.gt(0)
      ? null
      : ratio.lt("0.4")
        ? "LOW"
        : ratio.lt("0.7")
          ? "SAFE"
          : ratio.lt("0.9")
            ? "WATCH"
            : ratio.lte(1)
              ? "EDGE"
              : "OVER";

  const state: "unknown" | "empty" | "future" | "band" | "no-target" = !Number.isFinite(count)
    ? "unknown"
    : count === 0 && spent.eq(0)
      ? "empty"
      : spent.eq(0)
        ? "future"
        : band != null
          ? "band"
          : "no-target";

  const title =
    state === "empty"
      ? pickDailyLine(home.asOfDate)
      : state === "future"
        ? FUTURE_RECORD_TITLE
        : band != null
          ? SPEND_BANDS[band]
          : "";

  const line =
    band === "OVER" && remaining != null
      ? `已超出 ${formatCurrency(remaining.abs().toFixed(2))}`
      : band != null && remaining != null
        ? `剩余 ${formatCurrency(remaining.toFixed(2))}`
        : state === "future" && remaining != null
          ? `剩余 ${formatCurrency(remaining.toFixed(2))}`
          : state === "no-target"
            ? "目标 —"
            : null;

  return (
    <section
      className={`v2-card v2-today-snapshot v2-month-card ${
        band === "OVER" ? "is-over-budget v2-card--over" : ""
      }`}
      aria-labelledby="v2-month-title"
    >
      <div className="v2-card__head">
        <span className="v2-card__kicker">{KICKER}</span>
        <button className="v2-text-button" type="button" onClick={onOpenDetail}>
          消费详情 <ArrowRight size={15} aria-hidden="true" />
        </button>
      </div>
      <h2 id="v2-month-title" className="v2-card__title" aria-label={title ? undefined : KICKER}>
        {title}
      </h2>
      {state !== "empty" && (
        <div className="v2-card__value">
          <MoneyAmount
            value={home.currentMonthSpending}
            size="summary"
            className={savedExpenseId ? "is-expense-value-emphasis" : ""}
          />
          <small>
            {hasTarget && targetText != null
              ? `本月已花 · 目标 ${formatCurrency(targetText)}`
              : "本月已花"}
          </small>
        </div>
      )}
      {state === "empty" ? (
        <div className="v2-month-empty">
          <ReceiptText size={40} aria-hidden="true" />
          <span className="v2-month-empty__bar" aria-hidden="true" />
        </div>
      ) : state === "future" && hasTarget ? (
        <V2ProgressBar value={0} max={100} tone="normal" label="本月消费占目标比例" />
      ) : state === "band" && ratio != null ? (
        <V2ProgressBar
          value={ratio.times(100).toNumber()}
          max={band === "OVER" ? 120 : 100}
          tone={band === "OVER" ? "over" : band === "EDGE" ? "warn" : "normal"}
          showEnd={band !== "OVER"}
          label="本月消费占目标比例"
        />
      ) : null}
      <div className="v2-card__actions">
        {line != null && <span className="v2-card__line">{line}</span>}
        <button
          className={`v2-btn ${state === "empty" ? "v2-btn--primary" : "v2-btn--secondary"}`}
          type="button"
          onClick={state === "empty" ? onOpenExpense : onOpenLedger}
        >
          <ReceiptText size={16} aria-hidden="true" />
          {state === "empty" ? "记第一笔" : "查看本月记录"}
        </button>
      </div>
    </section>
  );
}
```

关键点（做错即不通过）：

- 删掉 `heading` / `note` 两张旧文案表、删掉 `.v2-badge--danger`（含「超出目标」四个字）、删掉旧的 `.v2-dots` 分支。
- 状态优先级：**未知(无计数) > 无记录 > 未来记录 > 五档 > 无预算**。
- 无记录 = 计数为 0 **且** 已花为 0；已花为 0 但已有记录 → 未来记录态。
- 未来记录态用固定句，**不得**用 20 句轮换，也不得出现「消费：来了，又走了。」。
- 无预算态不显示比例、进度、余额；不写「尚未设置」「定个目标」。
- 档 5 只有一个金额标签「已超出 ¥x」；档 1–4 与未来记录态只有「剩余 ¥x」。

---

## 9. T7 样式增量

追加到 `src/ui/v2-home-revamp.css`，紧跟 `.v2-structure-dots .v2-dot` 规则之后：

```css
.v2-structure-bar {
  display: flex;
  flex-direction: column;
  gap: var(--v2-space-2);
}

.v2-structure-bar__row {
  display: grid;
  grid-template-columns: 52px minmax(0, 1fr) 88px;
  align-items: center;
  gap: var(--v2-space-2);
}

.v2-structure-bar__label {
  color: var(--v2-muted);
  font-size: 12px;
  line-height: 18px;
}

.v2-structure-bar__track {
  position: relative;
  display: flex;
  height: 10px;
  overflow: hidden;
  background: var(--v2-line);
  border-radius: var(--v2-radius-pill);
}

.v2-structure-bar__fill {
  height: 100%;
}

.v2-structure-bar__fill.is-income {
  background: var(--v2-teal);
}

.v2-structure-bar__fill.is-essential {
  background: var(--v2-ink-strong);
  opacity: 0.55;
}

.v2-structure-bar__fill.is-debt {
  background: var(--v2-muted-light);
}

.v2-structure-bar__overhang {
  position: absolute;
  top: 0;
  bottom: 0;
  background: var(--v2-coral);
}

.v2-structure-bar__tick {
  position: absolute;
  top: -2px;
  bottom: -2px;
  width: 2px;
  background: var(--v2-ink);
}

.v2-structure-bar__amount {
  color: var(--v2-muted);
  font-size: 12px;
  line-height: 18px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.v2-month-empty {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: var(--v2-space-3);
  min-height: 112px;
  color: var(--v2-muted-light);
}

.v2-month-empty__bar {
  display: block;
  height: 10px;
  background: var(--v2-line);
  border-radius: var(--v2-radius-pill);
}
```

- `.v2-dots` / `.v2-dot` 的既有样式**保留**，只是两张卡都不再使用 `.v2-dots`。
- 不改 `v2-card.css`、`v2-tokens.css`，不新增 CSS 文件。

---

## 10. T8 / T9 测试

### 10.1 改 4 处旧断言（只这 4 处）

| 位置 | 原文 | 改成 |
|---|---|---|
| `tests/v2-ui.test.tsx` 首个用例，结构卡标题 | `{ name: "长期看，每个月能留下一点" }` | `{ name: "账单：不是，他怎么还剩钱？" }` |
| 同用例，月卡标题 | `{ name: "这个月的花销还在目标里" }` | `{ name: "支付软件：你是不是把我卸了？" }` |
| 「keeps the expense sheet dismissible…」用例 | `{ name: "这个月的花销还在目标里" }` | `{ name: "支付软件：你是不是把我卸了？" }` |
| 「keeps one four-destination navigation…」用例 | `{ name: "这个月的花销还在目标里" }` | `{ name: "支付软件：你是不是把我卸了？" }` |

依据：默认 fixture `baseSurplus 8672 / planningIncome 13000 = 66.7% → 档 1`；`spent 125.50 / target 1600 = 7.8% → 档 1`。

**不要改**这两个用例里的断言（进展页三档文案，本轮不动）：

- `screen.getByText("长期看，每个月有个缺口")`
- `screen.getByText("长期看，每个月刚好打平")`

### 10.2 新用例（结构 11 条、月卡 7 条）

> 断言一律限定在卡片内取，避免与进展页/详情页同名元素冲突：
> `const card = document.querySelector<HTMLElement>(".v2-structure-card")!;`
> 然后 `within(card).getByRole(...)` / `card.querySelectorAll(".v2-dot")`。
> 月卡同理用 `.v2-month-card`。

先把 `renderHome` 扩成可传组件 props（只加参数，不改默认行为）：

```tsx
function renderHome(
  overrides: Partial<HomeApplicationState> = {},
  props: { pendingDebtFactNames?: string[]; asOfDate?: string } = {},
) {
  // ...原实现不变
  <HomeScreen
    home={{ ...home, ...overrides }}
    asOfDate={props.asOfDate ?? "2026-10-14"}
    pendingDebtFactNames={props.pendingDebtFactNames}
  // ...
}
```

结构卡：

| # | 覆盖 | 断言 |
|---|---|---|
| S1 | 默认 fixture | 标题「账单：不是，他怎么还剩钱？」；`.v2-structure-bar` 存在；收入条 `style.width = 100%` |
| S2 | `baseSurplus: "1000"` | 「钱包：还活着，先别开香槟。」 |
| S3 | `baseSurplus: "0"` | 「工资：来过，爱过，没留过。」；`.v2-structure-card.is-even` |
| S4 | `baseSurplus: "-500"` | 「工资：你们分赃怎么不带我商量？」；`.v2-card--over` 存在 |
| S5 | `baseSurplus: "-2000"` | 「收入：我一个人打五个？」 |
| S6a | `baseSurplus: "2600"`（正好 20%） | 档 1（`gte("0.2")` 含等号） |
| S6b | `baseSurplus: "-1300"`（正好 −10%） | 档 5（`gt("-0.1")` 不含等号） |
| S7 | `planningIncome: "0"`、`essentialExpenses: "3528"`、`mandatoryDebtService: "800"`、`baseSurplus: "-4328"` | 「收入：暂未出场。账单：戏份拉满。」；无 `.v2-structure-bar`；出现 `-¥4,328.00` |
| S8 | `planningIncome: "0"`、其余三项 `"0"` | 「收入：你不来？账单：那我也不来了。」；无对比条；`.v2-structure-card .v2-dot` 为 3 |
| S9 | `props.pendingDebtFactNames = ["房贷"]` | 标题「资料不齐，花点时间补一下」；卡片内不出现 `¥8,672.00` 与 `¥13,000.00`；`.v2-structure-card .v2-dot` 为 0；无对比条；`查看债务` 存在 |
| S10 | `planningIncome: "3000"`、`essentialExpenses: "3528"`、`mandatoryDebtService: "800"`、`baseSurplus: "-1328"` | `.v2-structure-bar__overhang` 与 `.v2-structure-bar__tick` 均存在；收入条宽度 69.31%±0.1 |

月卡：

| # | 覆盖 | 断言 |
|---|---|---|
| M1 | `currentMonthSpending: "0"`、`currentMonthVariableExpenseCount: 0` | 标题 = `pickDailyLine("2026-10-14")`；图标 `width=40`；`.v2-month-empty__bar` 存在；无 `progressbar`；按钮「记第一笔」带 `v2-btn--primary` |
| M2 | 同 M1，`asOfDate: "2026-10-15"` | 标题 = `pickDailyLine("2026-10-15")`，且与 M1 不同 |
| M3 | `currentMonthSpending: "0"`、`currentMonthVariableExpenseCount: 2` | 标题「本月还没有已发生的消费。」；不等于 §4 任一轮换句；`progressbar` 的 `aria-valuenow=0`；`剩余 ¥1,600.00` |
| M4 | 五档：`"100"` / `"700"` / `"1200"` / `"1500"` / `"1700"` | 依次命中 5 句；EDGE 带 `v2-progress--warn`；OVER 带 `v2-progress--over`、`aria-valuemax=120`、`已超出 ¥100.00` |
| M5 | 边界：`"1599"` / `"1600"` / `"1600.01"` | 前两个档 4，第三个档 5 |
| M6 | `desiredMonthlyDiscretionarySpending: null`、花销 `"100"`、计数 1 | 无 `progressbar`；`目标 —` 存在；无「尚未设置」「定个目标」；按钮「查看本月记录」 |
| M7 | 默认 fixture | `.v2-badge--danger` 为 null；下列文本全部为 null：「这个月还没开始记录」「这个月的花销还在目标里」「这个月已经超过目标」「快到目标了」「先给这个月定个目标」「在财务管理里设置目标」 |

轮换补充断言（并入 M1/M2）：同一日期两次调用结果相同；「2026-10-15」是「2026-10-14」的下一句。

---

## 11. T10 全量验收

### 11.1 静态与测试

```bash
npx tsc --noEmit                      # exit 0
npx biome check src tests             # 0 error
npx vitest run tests/v2-ui.test.tsx   # 0 failed
npx vitest run                        # 0 failed；skipped ≤ 44
```

### 11.2 逐字命中（期望 1）

```bash
grep -Fc '每月固定收支'                       src/ui/V2StructureCard.tsx
grep -Fc '账单：不是，他怎么还剩钱？'          src/ui/V2StructureCard.tsx
grep -Fc '钱包：还活着，先别开香槟。'          src/ui/V2StructureCard.tsx
grep -Fc '工资：来过，爱过，没留过。'          src/ui/V2StructureCard.tsx
grep -Fc '工资：你们分赃怎么不带我商量？'      src/ui/V2StructureCard.tsx
grep -Fc '收入：我一个人打五个？'              src/ui/V2StructureCard.tsx
grep -Fc '收入：暂未出场。账单：戏份拉满。'     src/ui/V2StructureCard.tsx
grep -Fc '收入：你不来？账单：那我也不来了。'   src/ui/V2StructureCard.tsx
grep -Fc '资料不齐，花点时间补一下'            src/ui/V2StructureCard.tsx
grep -Fc '本月消费'                            src/ui/V2MonthlySpendCard.tsx
grep -Fc '支付软件：你是不是把我卸了？'        src/ui/V2MonthlySpendCard.tsx
grep -Fc '钱包：目前还没申请工伤。'            src/ui/V2MonthlySpendCard.tsx
grep -Fc '预算：我感觉有人在试探我的底线。'    src/ui/V2MonthlySpendCard.tsx
grep -Fc '预算：现在撤回付款还来得及吗？'      src/ui/V2MonthlySpendCard.tsx
grep -Fc '预算：我先走一步，剩下你俩聊。'      src/ui/V2MonthlySpendCard.tsx
grep -Fc '本月还没有已发生的消费。'            src/ui/V2MonthlySpendCard.tsx
```

17 条（含 20 句轮换在 `v2-month-copy.ts` 中逐句为 1，可用下一行整体核对）：

```bash
sed -n '/MONTH_ROTATION_LINES = \[/,/\] as const/p' src/ui/v2-month-copy.ts | wc -l   # 22（20 句 + 两行首尾）
```

### 11.3 旧文案清零（期望 0）

```bash
grep -Fc '长期格局，不用每月盯。'   src/ui/V2StructureCard.tsx
grep -Fc '长期看，每个月'           src/ui/V2StructureCard.tsx
grep -Fc '这个月还没开始记录'       src/ui/V2MonthlySpendCard.tsx
grep -Fc '这个月的花销还在目标里'   src/ui/V2MonthlySpendCard.tsx
grep -Fc '这个月已经超过目标'       src/ui/V2MonthlySpendCard.tsx
grep -Fc '快到目标了'               src/ui/V2MonthlySpendCard.tsx
grep -Fc '先给这个月定个目标'       src/ui/V2MonthlySpendCard.tsx
grep -Fc '在财务管理里设置目标'     src/ui/V2MonthlySpendCard.tsx
grep -Fc '超出目标'                 src/ui/V2MonthlySpendCard.tsx
grep -Fc 'v2-dots'                  src/ui/V2StructureCard.tsx
grep -Fc 'v2-badge'                 src/ui/V2MonthlySpendCard.tsx
grep -Fc 'role="progressbar"'       src/ui/V2StructureCard.tsx
grep -Fc '消费：来了，又走了。'      src/ui/V2MonthlySpendCard.tsx
```

`grep -Fc` 无匹配时退出码为 1，属正常；把命令串起来时用 `|| true`。

### 11.4 范围

```bash
git diff --name-only                                 # 只允许白名单 + 2 个新文件
git status --porcelain | wc -l                        # ≥ 83
git status --porcelain -- src/model src/persistence   # 空
```

---

## 12. T11 三宽界面检查

用现有 Vite dev server + 无头 Chrome，在 1440 / 1000 / 760 各截首页两卡：

- 无横向滚动条
- 1000px 两卡等高（差 ≤ 2px）
- 双条不溢出卡片；负担 > 收入时超出段与刻度线可见
- 空态 40px 图标与灰轨道可见

截图存 `/tmp/wp-copy01/`，回执列路径。

---

## 13. 越界与卡住

出现下列任一情况：**停下对应部分**，不动其它部分，回执写清「需要哪个文件 / 为什么绕不开 / 最小改法」：

1. 必须改白名单外的文件（含 `src/model/**`、`src/persistence/**`、`App.tsx`、`V2HomeSurface.tsx`、`V2ProgressBar.tsx`、Onboarding、维护对话框、配置）。
2. 本文件没有覆盖的文案或状态（例如要你决定无预算态标题写什么）。
3. 数据对不上：`baseSurplus` 与「收入 − 固定支出 − 月供」差超过 0.00 元（以 `baseSurplus` 展示，报出差额）。
4. 某条验收怎么都过不了，且怀疑是任务书本身的问题。

禁止的绕过手法：`as` / `any` / `@ts-expect-error` / `test.skip` / `it.only` / 删测试 / 把断言放宽成 `toContain("")`。

---

## 14. 禁止项

1. 改 `src/model/**`、`src/persistence/**`、任何迁移或表结构。
2. 实现 M7（预算是否已配置）或 M8-B（净额 0 有记录）。
3. 用未来日期记录冒充「已发生消费」，或为 M8-B 编造测试场景。
4. 顺手同步进展页（`V2HomeSurface.tsx`）的旧三档文案；两页文案不同是批准结果。
5. 新增依赖、图表库、AI 调用、通知、弹窗。
6. 改 `V2ProgressBar` 的 ARIA 行为。
7. 删除或弱化现有测试。
8. `git checkout` / `reset` / `stash` / `clean` / `add -A`；清理工作区里其它 82 条改动。

---

## 15. 回执模板（照抄填写）

```markdown
## WP-UI-COPY-01 执行回执

基线：HEAD 5443bcb；开工前工作区 83 条；收尾 ___ 条。
快照：/tmp/wp-copy01-baseline（sha256 ___）

### 改动文件
| 文件 | 性质 | 行数变化 |
|---|---|---|
| product-service.ts | 改 | +_/−_ |
| v2-month-copy.ts | 新增 | +_ |
| V2StructureCompareBar.tsx | 新增 | +_ |
| V2StructureCard.tsx | 改 | +_/−_ |
| V2MonthlySpendCard.tsx | 改 | +_/−_ |
| v2-home-revamp.css | 改 | +_ |
| tests/v2-ui.test.tsx | 改 | +_/−_ |
| 其它 fixture | 补字段 | _ 个文件 |

### 验收
- tsc：___
- biome：___
- vitest 定向：___；全仓：___ passed / ___ skipped / ___ failed
- §11.2 逐字命中：___/16
- §11.3 清零：___/13 为 0
- §10.2 用例：结构 __/11、月卡 __/7
- git diff 白名单：___
- 截图：/tmp/wp-copy01/1440.png、1000.png、760.png

### 与任务书的偏差
（没有写「无」；有就写哪一条、为什么、影响）

### 遗留 / 需要 Owner 决策
```

---

## 16. 暂缓登记（本轮不做）

| 项 | 原因 |
|---|---|
| M7 无预算态「尚未设置」 | 库里没有「是否已配置预算」的标记，显式 0 与未设置无法区分 |
| M8-B 「消费：来了，又走了。」 | 无退款、金额恒 > 0，净额 0 有记录的状态不可达 |
| S7 / S8 结构卡补充文案 | 属 D3 |
| D4 字体 token | 独立工单 |
| 进展页三档文案 | 独立页面，本轮不动 |

---

## 附录 A：逐字文案（唯一来源）

### A.1 结构卡

| 条件 | 文案 |
|---|---|
| 待确认债务 | `资料不齐，花点时间补一下` |
| 余量 ÷ 收入 ≥ 20% | `账单：不是，他怎么还剩钱？` |
| > 0 且 < 20% | `钱包：还活着，先别开香槟。` |
| = 0 | `工资：来过，爱过，没留过。` |
| > −10% 且 < 0 | `工资：你们分赃怎么不带我商量？` |
| ≤ −10% | `收入：我一个人打五个？` |
| 收入 0，负担 > 0 | `收入：暂未出场。账单：戏份拉满。` |
| 收入 0，负担 = 0 | `收入：你不来？账单：那我也不来了。` |

### A.2 月卡

| 条件 | 文案 |
|---|---|
| 已花 ÷ 预算 ∈ (0, 40%) | `支付软件：你是不是把我卸了？` |
| [40%, 70%) | `钱包：目前还没申请工伤。` |
| [70%, 90%) | `预算：我感觉有人在试探我的底线。` |
| [90%, 100%] | `预算：现在撤回付款还来得及吗？` |
| > 100% | `预算：我先走一步，剩下你俩聊。` |
| 有记录但已花为 0（未来日期） | `本月还没有已发生的消费。` |

### A.3 数据标签（允许存在，不得新造句子）

`已超出 ¥x`、`剩余 ¥x`、`目标 ¥x`、`待确认`、`记第一笔`、`查看本月记录`、`查看固定支出`、`查看债务`、`消费详情`、`为什么`、`收入`、`固定支出`、`月供`、`固定负担`、`结构余量`。

### A.4 20 句轮换

见 §4 数组，顺序即批准顺序。
