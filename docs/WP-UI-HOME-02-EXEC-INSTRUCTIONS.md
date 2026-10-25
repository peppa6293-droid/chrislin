# WP-UI-HOME-02 首页两卡收口 · 执行任务书

发布者：审核 agent ｜ 日期：2026-10-25 ｜ 执行者：实现 agent（**非**本次审核者）
性质：承接 WP-UI-HOME-01（已通过静态复验 + 视觉实测），收口最后 1 处视觉偏差 + 1 处 ARIA 缺陷。

---

## 0. 你的角色与边界

你只做 §2 的三项机械改动，并按 §5 自验、按 §6 交付原始证据。

- 不做设计判断：§3 的 D1–D4 一律登记，不修。
- 不启动 App / Tauri、不读写 SQLite、不构建生产包、不执行 `git commit`。
- 发现任务书之外的问题：写进报告「范围外登记」，不要顺手改。

---

## 1. 你的基线（审核员已实测，不必重做）

| 视口 | `.v2-page` 宽 | 列数 | 两卡高度 | 横向溢出 |
|---|---|---|---|---|
| 1440 | 900 | 2（442/442） | 395 / 395 | 无 |
| 1000 | 812 | 2（398/398） | 395 / 395 | 无 |
| 900 | 722 | 2（353/353） | 413 / 413 | 无 |
| 880 | 704 | 2（344/344） | — | 无 |
| 875 | 700 | **1** | — | 无 |
| 870 | 695 | 1 | — | 无 |
| 760 | 596 | 1 | — | 无 |

结论：**布局、等高、断点、超长金额、无横向滚动全部通过**。以下两项是遗留偏差，其余不动。

以下按层叠推导无问题，**本包不要动**（T1 的 computed style 会顺带复核）：

- 结构卡底色：`.v2-card--soft`（v2-card.css）在后导入，压过 style.css 的 `.v2-structure-card`，取 `--v2-surface-soft` #F5FBF8，符合 §4.1；
- 消费卡常态底色：`.v2-card` 的 `--v2-surface` 白，符合 §4.1；
- 卡片圆角：`--v2-radius` 20px，符合 §2.2；
- 两卡 DOM 顺序：结论 → 金额 → 说明 → 进度。

---

## 2. 任务

### T1（唯一视觉改动）超支卡整卡暖红底 → 白底，并让左条恢复真正的 coral

**现状** `src/style.css:3814-3817`

```css
.v2-month-card.is-over-budget {
  border-color: #e6b8a8;
  background: #fff4ef;
}
```

**为什么错**

1. §4.1 规定「消费卡白底」；§4.3 的 >100% 只规定 coral 填充与「超出 ¥x」，没有规定整卡换底色。
2. §1.2 明确禁止把红色当主要反馈（「不使用大号红色数字作为唯一反馈」）。
3. 副作用：该规则的 `border-color`（0,2,0）压过 `.v2-card--over` 的 `border-left`（0,1,0），把本该 coral 的 4px 左条染成 #e6b8a8，等于既多了红底、又丢了状态线索。

**改法**：整块删除（4 行，含花括号）。删除后自动得到：

- 底卡回落 `.v2-card { background: var(--v2-surface) }` → `#ffffff`
- 左条回落 `.v2-card--over { border-left: 4px solid var(--v2-coral) }` → `rgb(244,123,104)`
- 状态仍是三重表达：coral 金额（`.v2-month-card.is-over-budget .v2-card__value`）、`超出目标` 徽章、coral 左条

**禁止**：新增任何颜色变量、加 box-shadow、改 `.v2-card--over`、改结构卡的 `v2-card--over` 用法（结构缺口态本来就只有左条、背景不变，符合 §4.2，别动）。

同文件 3807-3811 的 `.v2-month-card { border-color:#ecdfd3; background:#fffaf3 }` 与 `.v2-snapshot-rule` 两条**已被后导入的 `v2-card.css` 覆盖/已无组件渲染**，属死规则。**本包不动**（避免 style.css 出现大段无关 diff），只登记。

### T2 V2ProgressBar 的 ARIA 区间越界

**现状** `src/ui/V2ProgressBar.tsx:26` 恒为 `aria-valuemax={100}`；消费卡在超支时传 `max={120}` 且 `value` 可 >100，导致 `aria-valuenow` 大于 `aria-valuemax`（无效区间，读屏会读出越界值）。

**改法**（只改这一个组件）

```tsx
const clamped = Math.min(max, Math.max(0, value));
...
<div
  role="progressbar"
  aria-label={label}
  aria-valuenow={Math.round(clamped)}
  aria-valuemin={0}
  aria-valuemax={Math.round(max)}
  aria-valuetext={`${Math.round(value)}%`}
>
  <span className="v2-progress__fill" style={{ width: `${clamped}%` }} />
```

理由：进度条视觉最多画到 `max`（设计稿 §4.3 的 120% 上限），`aria-valuetext` 负责如实播报真实百分比（如 188%），两者都要有。

**新增** `tests/v2-progress-bar.test.tsx`（happy-dom + @testing-library/react，仓库已装）：

- `value=188, max=120` → `aria-valuenow="120"`、`aria-valuemax="120"`、`aria-valuetext="188%"`
- 默认 `max=100`、`value=3` → `aria-valuemax="100"`、`aria-valuetext="3%"`
- `value=-5` → `aria-valuenow="0"`

不要修改 `V2RepaymentDetail.tsx`（它自带独立 progressbar，不属本包）。

### T3（只改注释，不改行为）

`src/ui/v2-home-revamp.css:3-4` 的注释补上真实换算，避免下一个人再算错：

```
/* The cards switch between one and two columns from the actual content width
   (container). With the 88px nav rail and the shell's clamp(20px,5vw,72px)
   padding, the 700px container threshold equals a ~876px viewport. */
```

不要求改任何声明；该文件除注释外必须零 diff。

---

## 3. 明确不做（登记为待 Owner 决策）

| 编号 | 事项 | 为什么不放进本包 |
|---|---|---|
| D1 | 结构卡同时有进度条 + 三阶段点，§4.2 只写了「3 个进度点」 | 信息取舍，需 Owner 一句话；建议删进度条、留三个阶段点与阶段文案 |
| D2 | 文案与设计稿不一致（§4.2「长期结构是稳的」vs 代码「长期看，每个月能留下一点」；§4.3 同理） | 属产品口径，且 `tests/v2-ui.test.tsx:140,390,413` 已锁死当前文案；改文案要同步测试，另开 WP |
| D3 | §4.2 的「加载 → 三条 shimmer」「禁用 → opacity .56」未实现 | 组件没有对应数据来源，要新增业务状态，另开 WP |
| D4 | `--v2-text-*` / `--v2-money-*` 存的是 `font` 简写值，被用在 `font-size:` 上属无效声明，全站 20+ 处静默继承 | 影响面大，需逐页回归，另开 WP；本包禁止动 token |
| D5 | `V2StructureCard.tsx`、`V2MonthlySpendCard.tsx`、`v2-home-revamp.css` 等 26 个文件在 git 中**未跟踪** | 需要 Owner 决定提交批次；本包用 §5.3 的基线副本对冲 |

---

## 4. 文件白名单

允许修改：

- `src/style.css`（**仅** §2 T1 那一个规则块，4 行）
- `src/ui/V2ProgressBar.tsx`
- `src/ui/v2-home-revamp.css`（**仅**注释，T3）
- 新增 `tests/v2-progress-bar.test.tsx`
- 新增 `evidence/wp-home-02-20261025/`

禁止：`src/ui/V2StructureCard.tsx`、`V2MonthlySpendCard.tsx`、`V2HomeSurface.tsx`、任何 token/卡片 CSS、`src/model|application|persistence|runtime`、`src-tauri`、`migrations`、既有测试文件、任何 `*.json` 配置、`docs/` 设计稿、git 提交。

---

## 5. 自验程序（必须附原始输出，不准只写「通过」）

### 5.1 静态与测试

```bash
cd "个人财务模型app开发项目 2"
npx tsc --noEmit
npx biome check src/ui/V2ProgressBar.tsx tests/v2-progress-bar.test.tsx
npx vitest run tests/v2-ui.test.tsx tests/v2-progress-bar.test.tsx
```

期望：`tsc` exit 0；biome clean；`v2-ui` 仍 19/19 全绿（证明 T1 没碰文案与逻辑），新增测试全绿。

### 5.2 视觉（无头 Chrome，不启动 App、不碰数据库）

按附录 A 建临时验收页，然后：

```bash
npx vite --host 127.0.0.1 --port 1420 --strictPort
CH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
mkdir -p /tmp/wp02
for spec in "1000,normal" "900,normal" "875,normal" "880,normal" "760,over" "1000,over"; do
  IFS=, read -r w v <<< "$spec"
  "$CH" --headless=new --disable-gpu --no-first-run --user-data-dir=/tmp/wp02-profile \
    --hide-scrollbars --force-device-scale-factor=1 --window-size="$w,1400" \
    --virtual-time-budget=4000 --screenshot="/tmp/wp02/after-$w-$v.png" \
    "http://127.0.0.1:1420/preview-check/?embed=1&v=$v"
done
```

指标核对（同一页面用 `--dump-dom` 抓附录 A 输出的 `METRICS {...}` 并转 JSON）：

| 检查项 | 期望 |
|---|---|
| 1000px `.v2-page` 宽 / 卡片列 | `812` / `398px 398px` |
| 1000px 两卡高度（normal） | 395 / 395（±4 可接受） |
| 1000px 两卡高度（over） | 413 / 413 —— 10 位收入让明细行折成两行（+18px 行高），Grid 等高后两卡同步，属正常 |
| 900px 两卡高度 | 413 / 413（±4 可接受） |
| 875px 列数 | 单列（`695.5px` 或单个值） |
| 880px 列数 | 两列 |
| 760 / 870 / 1000 / 1440 `document.scrollWidth` | 等于 `innerWidth`（无横向滚动） |
| `.v2-month-card.is-over-budget` 计算背景 | `rgb(255, 255, 255)` |
| `.v2-month-card.is-over-budget` 左边框 | `4px solid rgb(244, 123, 104)` |
| `.v2-structure-card` 计算背景 | `rgb(245, 251, 248)`（不得变） |
| 超支场景 `[role=progressbar][aria-label="本月消费占目标比例"]` | `aria-valuenow=118`、`aria-valuemax=120`、`aria-valuetext="118%"` |
| 卡内 padding | `24px`（旧 `.v2-today-snapshot` 未回渗） |

### 5.3 证据与基线（因文件未入 git）

```bash
mkdir -p /tmp/wp02-baseline
cp src/style.css src/ui/V2ProgressBar.tsx /tmp/wp02-baseline/
# 改完后：
diff -u /tmp/wp02-baseline/style.css src/style.css
diff -u /tmp/wp02-baseline/V2ProgressBar.tsx src/ui/V2ProgressBar.tsx
```

交付物放 `evidence/wp-home-02-20261025/`：前后截图各 2（1000 / 760，normal 与 over）、`metrics.json`、`diff.txt`、测试原始输出，以及**临时目录已删除**后的 `git status --porcelain`。

> 计数说明：写本任务书之前基线是 97 条；本文件与你的 `evidence/` 目录都会让条目 +1、+1。判据不是绝对数字，而是「除本任务书和你的 evidence 目录外，不得新增/删除任何条目」。

---

## 6. 交付格式与红线

报告按：`改了什么 → 逐行 diff → 自验原始输出 → 未验证项 → 范围外登记`。

- 不得把「测试通过」写成「验收通过」；最终由审核 agent 用 §5.2 同一套读数复核。
- 红线（触犯即退回）：改文案/改 token/动白名单外文件/跑 Tauri/碰数据库/`git add|commit`/把临时验收目录留在工程里。

---

## 7. Owner 决策（2026-10-25 已批）

- **Q1 已批准**：超支卡改为白底（保留 coral 左条 + 徽章 + coral 金额）。**T1 照做**。
- **Q2 未决**：结构卡进度条是否删除——**本包不做**，Owner 另行拍板后才议是否开新 WP。
- **批准范围仅限 T1–T3**。D2 文案、D3 加载/禁用态、D4 字体 token、D5 git 提交**均未获准**，不得顺手做。

> 开工前先把本文件从头读一遍再动手；§4 白名单之外一个字符都不要改。

---

## 附录 A · 临时验收页（照抄，收尾删除整个 `preview-check/`）

`preview-check/index.html`

```html
<!doctype html>
<html lang="zh-CN">
  <head><meta charset="UTF-8" /><title>home cards check</title></head>
  <body><div id="root"></div><script type="module" src="/preview-check/main.tsx"></script></body>
</html>
```

`preview-check/main.tsx`（**注意**：`V2HomeSurface` 自身已渲染 `<main class="v2-shell">` + 顶栏 + 导航，**不要再包一层 shell**，否则内容宽度被压，会得到"两列消失"的假结果）

```tsx
import { createRoot } from "react-dom/client";
import type { HomeApplicationState } from "../src/application/product-service.js";
import { V2HomeSurface } from "../src/ui/V2HomeSurface.js";

import "../src/style.css";
import "../src/ui/trial-experience.css";
import "../src/ui/pixel-world.css";
import "../src/ui/duo-guide.css";
import "../src/ui/v2-surface.css";
import "../src/ui/v2-tokens.css";
import "../src/ui/v2-card.css";
import "../src/ui/v2-home-revamp.css";
import "../src/ui/v2-feedback.css";
import "../src/ui/v2-calendar-picker.css";
import "../src/ui/v2-detail-visual.css";
import "../src/ui/v2-savings-room.css";

const base: HomeApplicationState = {
  status: "READY", asOfDate: "2026-10-14", currentMonth: "2026-10",
  profileDisplayName: "小钱", actualIncomeRecordCount: 0, currentCash: "5000",
  currentMonthSpending: "125.50", totalDebt: "800", liquidAssets: "1500",
  desiredMonthlyDiscretionarySpending: "1600", planningIncome: "13000",
  essentialExpenses: "3528", mandatoryDebtService: "800", monthlyCoreObligations: "4328",
  baseSurplus: "8672", eligibleCash: "5000", eligibleLiquidInvestmentAssets: "1500",
  safetyResources: "6500", safetyTargetResources: "25968", safetyCoverageMonths: "1.50",
  safetyCoverageStatus: "NORMAL", safetyCoverageTargetMonths: 6,
  recommendedMonthlySpending: "1000", remainingSpendingCapacity: "874.50",
  amountAboveRecommendation: "0", cashCoverageMonths: "1.15", minimumCashCoverageMonths: 2,
  safetyGap: "19468", debts: [], spendingStatus: "NORMAL", cashSafetyGateStatus: "CLEAR",
  cashFloorMet: true, consumptionUtilization: { status: "CALCULATED", value: "0.12" },
  trendState: "BASELINE_BUILDING",
  trendDimensions: {
    LIQUIDITY_SAFETY: { direction: "NO_BASELINE", reason: "no baseline" },
    DEBT: { direction: "NO_BASELINE", reason: "no baseline" },
    CONSUMPTION: { direction: "NO_BASELINE", reason: "no baseline" },
    WEALTH: { direction: "NO_BASELINE", reason: "no baseline" },
  },
  primaryImprovement: null, primaryDrag: null,
  priorityAction: { action_code: "NO_ACTION", reason: "No clear issue." },
  recentExpenses: [],
};

const over: HomeApplicationState = {
  ...base, currentMonthSpending: "1880.00",
  baseSurplus: "1234567890.12", planningIncome: "12345678901.00",
};

const noop = () => {};
const noopAsync = async () => ({
  status: "CONFIRMED" as const, writeSignal: "RESOLVED" as const,
  record: { id: "x", amount: "1", dateTime: "2026-10-14T00:00:00.000Z",
    businessDate: "2026-10-14", kind: "VARIABLE" as const },
  home: base,
});

const root = document.getElementById("root")!;
const p = new URLSearchParams(location.search);
const home = p.get("v") === "over" ? over : base;

setTimeout(() => {
  const box = (sel: string) => {
    const el = document.querySelector(sel) as HTMLElement | null;
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return { w: Math.round(r.width), x: Math.round(r.x), grid: s.gridTemplateColumns,
      bg: s.backgroundColor, borderLeft: `${s.borderLeftWidth} solid ${s.borderLeftColor}`,
      pad: s.padding };
  };
  const bar = document.querySelector('[role="progressbar"][aria-label="本月消费占目标比例"]');
  const metrics = {
    innerWidth, scrollWidth: document.documentElement.scrollWidth,
    page: box(".v2-today-page"), cards: box(".v2-home-cards"),
    cardHeights: [...document.querySelectorAll(".v2-home-cards > .v2-card")]
      .map((e) => Math.round(e.getBoundingClientRect().height)),
    structureBg: getComputedStyle(document.querySelector(".v2-structure-card")!).backgroundColor,
    monthBg: getComputedStyle(document.querySelector(".v2-month-card")!).backgroundColor,
    monthBorderLeft: getComputedStyle(document.querySelector(".v2-month-card")!).borderLeft,
    progress: bar && {
      now: bar.getAttribute("aria-valuenow"),
      max: bar.getAttribute("aria-valuemax"),
      text: bar.getAttribute("aria-valuetext"),
    },
  };
  const pre = document.createElement("pre");
  pre.id = "metrics";
  pre.textContent = `METRICS ${JSON.stringify(metrics)}`;
  pre.style.cssText = "position:fixed;bottom:0;left:0;z-index:9;font:10px monospace;background:#fff";
  document.body.append(pre);
}, 500);

createRoot(root).render(
  <V2HomeSurface
    home={home} asOfDate={home.asOfDate} selectedTab="TODAY"
    onSelectTab={noop} onRecordExpense={noopAsync} onOpenDetail={noop}
    onOpenFinance={noop} onOpenFixedExpenses={noop} onOpenLedger={noop}
    onOpenSettings={noop}
  />,
);
```

抓读数：

```bash
"$CH" --headless=new --disable-gpu --user-data-dir=/tmp/wp02-profile --window-size=1000,1400 \
  --virtual-time-budget=5000 --dump-dom "http://127.0.0.1:1420/preview-check/?embed=1&v=over" \
  | grep -o 'METRICS {.*}' | sed 's/^METRICS //' | python3 -m json.tool
```
