# WP-UI-HOME-03 首页收尾 · 执行任务书

发布者：审核 agent ｜ 日期：2026-10-26 ｜ 执行者：实现 agent（非审核者）
**Owner 决策：Q2 选 A —— 删除结构卡重复的进度条，只保留三阶段点。** 本包 T1 + T2 全部可执行。

---

## 0. 边界

允许改：`src/ui/V2ProgressBar.tsx`、`src/ui/V2StructureCard.tsx`、`tests/v2-progress-bar.test.tsx`。
禁止：文案、token、`V2MonthlySpendCard.tsx`、`V2HomeSurface.tsx`、卡片 CSS、`style.css`、任何数据字段与计算。
不启动 App/Tauri、不碰 SQLite、不 `git add`/`commit`。

---

## 1. 现状（审核员实测）

| 项 | 现状 |
|---|---|
| 负值进度条 | `value=-5` → `valuenow="0"`，但 `aria-valuetext="-5%"`，读数自相矛盾 |
| 结构卡 | 进度条（label「结构余量占收入比例」）+ 三阶段点同时存在，同一状态画两遍；设计稿 §4.2 只写了点 |

---

## 2. T1 负值时的 `aria-valuetext`

`src/ui/V2ProgressBar.tsx:27`

```diff
-      aria-valuetext={`${Math.round(value)}%`}
+      aria-valuetext={`${Math.round(Math.max(0, value))}%`}
```

`tests/v2-progress-bar.test.tsx` 第三个用例（负值）补一行：

```ts
expect(bar.getAttribute("aria-valuetext")).toBe("0%");
```

---

## 3. T2 删除结构卡进度条（Owner 已选 A）

`src/ui/V2StructureCard.tsx`

```diff
-import { V2ProgressBar } from "./V2ProgressBar.js";
...
-  const percent = missingData
-    ? 0
-    : Math.min(100, Math.max(0, surplus.dividedBy(income).times(100).toNumber()));
...
-      {missingData ? (
+      {missingData && (
         <span className="v2-dots" aria-hidden="true">
           <span className="v2-dot" />
           <span className="v2-dot" />
           <span className="v2-dot" />
         </span>
-      ) : (
-        <V2ProgressBar
-          value={percent}
-          tone={deficit ? "over" : "normal"}
-          showEnd
-          label="结构余量占收入比例"
-        />
       )}
```

改完后的卡片顺序（这是设计稿 §4.2 的形态）：

```
kicker + 为什么
标题（结论）
金额 + 一行算式小字
说明句
【数据缺失时才出现的三个灰点】
三个阶段点（is-steady / is-even / is-short）
收入·固定支出·月供
操作按钮
```

**不许**顺手改：三个点的色调逻辑、缺口态的左条与「查看债务」按钮、`v2-structure-dots` 样式、`min-height: 260px`。

---

## 4. 验收（必须贴原始输出）

```bash
npx tsc --noEmit
npx biome check src/ui/V2ProgressBar.tsx src/ui/V2StructureCard.tsx tests/v2-progress-bar.test.tsx
npx vitest run tests/v2-progress-bar.test.tsx tests/v2-ui.test.tsx   # 22 passed
```

DOM 断言（无头 Chrome + 审核附录 A 的临时页）：

| 检查项 | 期望 |
|---|---|
| `.v2-structure-card [role="progressbar"]` | **0 个** |
| `.v2-month-card [role="progressbar"]` | 仍 1 个（消费卡的不要动） |
| 结构卡 `.v2-structure-dots .v2-dot` | 3 个，且 `is-short` / `is-even` / `is-steady` 三态颜色不变 |
| 1000px 两卡高度 | 仍等高（差 0），且都 ≥ 260 |
| 1000px `.v2-page` / 列宽 | 812 / `398px 398px`（不得因删条而变化） |
| 760–1440 `scrollWidth` | 等于 `innerWidth` |

截图：1000px 正常态、1000px 结构缺口态（`spendingStatus=STRUCTURAL_DEFICIT` 且 `baseSurplus<0`，用于证明 coral 左条与「查看债务」仍在）各一张。

---

## 5. 交付

- `/tmp/wp03-baseline/` 存开工前副本，交付 `diff -u`（含两个源文件与测试）；
- 三条命令原始输出 + 上表实测值 + 两张截图；
- 明确写「T1、T2 均已执行」或逐项说明未执行原因。
