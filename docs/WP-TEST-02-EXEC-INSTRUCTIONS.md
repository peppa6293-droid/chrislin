# WP-TEST-02 旧 UI 测试拆回（36 运行 / 44 跳过）· 执行任务书

发布者：审核 agent ｜ 日期：2026-10-26 ｜ 执行者：实现 agent
背景：`tests/ui.test.tsx` 现在用一整块 `describe.skip`（第 315 行）罩住全部 80 例；`docs/V2_TEST_MIGRATION_DISPOSITION.md` 却写着「46 例继续运行 / 34 例跳过」。两者都错：实测是 **0 运行 / 80 跳过**，文件里不存在任何兼容补丁。
Owner 指示「拆回来」：能跑的恢复运行，不能跑的逐条标注保留跳过，并把处置记录改成实测口径。

---

## 0. 审核侧实测基线（仅供参考，不作为你的验收凭据）

审核侧做法：把第 315 行的 `.skip` 临时去掉，`npx vitest run tests/ui.test.tsx --reporter=json`，跑完立刻还原（`git checkout -- tests/ui.test.tsx`）。

结果（HEAD `5443bcb` + 未提交的 WP-UI-HOME-03 / WP-ENV-01 改动）：

- **36 passed / 44 failed / 0 skipped**
- 44 例分类：**A = 26，B = 15，C = 1，D = 2**
- 64 个 `it(`（其中 28 个为本次要加的 `it.skip(`）+ 4 个 `it.each(` 块，展开正好 80 例

执行时如果你实测的数字与上面不同（基线已变、依赖升级、flaky），**以你的实测为准**，但必须在回执里写出差异与原因，不能照抄本文数字。

---

## 1. T1：解禁 describe（1 行）

`tests/ui.test.tsx:315`

```diff
-describe.skip("Phase 3 product UI [DEPRECATED - V2 migration pending]", () => {
+describe("Phase 3 product UI（V2 兼容 36 例 · 待迁移 44 例）", () => {
```

---

## 2. T2：把 44 例逐条改成跳过（36 例保持启用）

### 2.1 写法

- 普通用例：`it("标题", ` → `it.skip("[类别] 标题", `（类别取 A/B/C/D，见 §2.3）
- `it.each` 块（共 4 个）：`  it.each([` → `  it.skip.each([`，并给生成标题加前缀：
  - 第 532 / 546 行两个块：`])("T-P2-01 %s renders unavailable progress"` → `])("[A] T-P2-01 %s renders unavailable progress"`（两处都要改）
  - 第 1784 行块：`    "Home and Safety detail preserve $label semantics",` → `    "[B] Home and Safety detail preserve $label semantics",`
  - 第 1933 行块：`    "Safety primary reason and actions are truthful for $label",` → `    "[A] Safety primary reason and actions are truthful for $label",`

> 已确认 `it.skip.each` 在 vitest 5.0.5 下可用（审核侧一次性探针验证，探针已还原）；若报错，退回写成 `it.sequential.skip.each` 或把 4 个 each 块改成显式 `for (const …) it.skip(...)` 展开，但**不许改用 `describe.skip` 包住大段**。

### 2.2 逐条清单（行号 = 当前 HEAD 文件行号，改完前 30 行会平移，请按标题匹配而不是行号）

| 行 | 测试标题（原样） | 类别 | 实测失败首行（截断） |
|---:|---|---|---|
| 335 | V2 shows current-month pending debt facts without exposing stale totals | B | `TestingLibraryElementError: Unable to find an element with the text: /首页暂不按上月应还金额估算/. This could be because the text is broken up by multiple elements` |
| 480 | V2 cash-flow detail and safety progress use existing model values | B | `AssertionError: expected '本月收支-¥5,046.73长期看，每个月有个缺口' to contain '这个月的计划有缺口'` |
| 492 | Stage 2 E/F/G. positive surplus and null coverage render truthfully | B | `AssertionError: expected '长期看，每个月能留下一点' to be '按当前计划有结余' // Object.is equality` |
| 516 | T-P2-01 target zero remains legal and shows coverage without a target progress bar | C | `Error: Invalid Chai property: toHaveTextContent` |
| 532 | T-P2-01 NaN coverage renders unavailable progress | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="home-safety-coverage"]` |
| 532 | T-P2-01 infinite coverage renders unavailable progress | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="home-safety-coverage"]` |
| 532 | T-P2-01 null coverage renders unavailable progress | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="home-safety-coverage"]` |
| 546 | T-P2-01 NaN target renders unavailable progress | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="home-safety-coverage"]` |
| 546 | T-P2-01 infinite target renders unavailable progress | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="home-safety-coverage"]` |
| 559 | T-P2-01 keeps truthful half and capped progress for normal ratios | D | `AssertionError: expected '8' to be '50' // Object.is equality` |
| 592 | Stage 2 H/J. over-target spending and Planning Income stay distinct | A | `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "收支详情"` |
| 612 | Stage 2 L. detail routes are read-only and each has a working Home action | A | `Error: Unable to find role="heading" and name "本月消费情况"` |
| 630 | Stage 3 Hub has one navigation, four read-only categories, and zero writes on visit | B | `AssertionError: expected '版本 5生效月份 · 2026-10记录日期 · 2026-10-20¥1…' to contain '未来记录日期'` |
| 1356 | preserves the local calendar date separately from the UTC instant | A | `TestingLibraryElementError: Unable to find a label with the text of: 日期和时间` |
| 1398 | 9. optional category and note are sent when provided | A | `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "餐饮"` |
| 1455 | 12. successful expense save recalculates and updates Home | A | `Error: Unable to find an element by: [data-testid="actual-variable-spending"]` |
| 1526 | 13–14. overspending keeps the recommendation and shows amount above it | A | `Error: Unable to find an element by: [data-testid="actual-variable-spending"]` |
| 1552 | A. keeps the Owner target separate from a zero safe recommendation | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="actual-variable-spending"]` |
| 1613 | C. renders model overview values from changing Home/Model fixtures | B | `TestingLibraryElementError: Unable to find an element with the text: 每月要覆盖的生活和还款. This could be because the text is broken up by multiple elements. In` |
| 1684 | 15. structural deficit is described as a core income gap without mislabeling the cash floor | B | `AssertionError: expected '长期看，每个月有个缺口' to be '这个月的计划有缺口' // Object.is equality` |
| 1717 | 16. balanced no surplus is not described as a deficit | B | `AssertionError: expected '长期看，每个月刚好打平' to be '按当前计划基本持平' // Object.is equality` |
| 1733 | 17. a failed cash floor gives a calm floor reminder | B | `Error: Unable to find an element with the text: /可用现金还没有达到/. This could be because the text is broken up by multiple elements. In this case, you can p` |
| 1760 | 18. NOT_APPLICABLE has no cash warning | B | `Error: Unable to find an element with the text: 现金安全线暂不适用. This could be because the text is broken up by multiple elements. In this case, you can pro` |
| 1784 | Home and Safety detail preserve A structural deficit with floor met semantics | B | `AssertionError: expected '长期看，每个月有个缺口' to be '这个月的计划有缺口' // Object.is equality` |
| 1784 | Home and Safety detail preserve B normal with floor failed semantics | B | `AssertionError: expected '长期看，每个月能留下一点' to be '按当前计划有结余' // Object.is equality` |
| 1784 | Home and Safety detail preserve C structural deficit with floor failed semantics | B | `AssertionError: expected '长期看，每个月有个缺口' to be '这个月的计划有缺口' // Object.is equality` |
| 1784 | Home and Safety detail preserve D normal with floor met semantics | B | `AssertionError: expected '长期看，每个月能留下一点' to be '按当前计划有结余' // Object.is equality` |
| 1784 | Home and Safety detail preserve E no core obligations semantics | B | `AssertionError: expected '稳住现金暂不可计算现金安全线已达覆盖进度暂不可计算' to contain '当前暂不适用'` |
| 1875 | 19–20. Home uses primary improvement and drag dimensions | B | `Error: Unable to find an element with the text: 改善方向. This could be because the text is broken up by multiple elements. In this case, you can provide ` |
| 1899 | preserves exact aggregate debt and payment values in V2 | A | `AssertionError: expected null to be truthy` |
| 1933 | Safety primary reason and actions are truthful for clear gate | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="safety-primary-status"]` |
| 1933 | Safety primary reason and actions are truthful for no core obligations | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="safety-primary-status"]` |
| 1933 | Safety primary reason and actions are truthful for positive surplus with floor failed | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="safety-primary-status"]` |
| 1933 | Safety primary reason and actions are truthful for structural deficit with floor failed | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="safety-primary-status"]` |
| 1933 | Safety primary reason and actions are truthful for structural deficit with floor met | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="safety-primary-status"]` |
| 1933 | Safety primary reason and actions are truthful for zero safety target | A | `TestingLibraryElementError: Unable to find an element by: [data-testid="safety-primary-status"]` |
| 2018 | Safety cash-account action opens the existing cash category page | A | `TestingLibraryElementError: Unable to find an accessible element with the role "button" and name "查看现金账户"` |
| 2042 | 22–23. restarting loads the persisted Home and spending state from services | D | `Error: Found multiple elements with the text: 88` |
| 2113 | monthly maintenance submits only changed facts through the application service | A | `Error: Unable to find an element by: [data-testid="actual-variable-spending"]` |
| 2148 | blocks an Actual Income draft with amount but no date and preserves it | A | `Error: Unable to find an element by: [data-testid="actual-variable-spending"]` |
| 2168 | blocks an Actual Income draft with date but no amount and preserves it | A | `Error: Unable to find an element by: [data-testid="actual-variable-spending"]` |
| 2188 | blocks a draft without status and blocks all rows if any started draft is incomplete | A | `Error: Unable to find an element by: [data-testid="actual-variable-spending"]` |
| 2219 | intentionally ignores a fully blank optional Actual Income draft | A | `Error: Unable to find an element by: [data-testid="actual-variable-spending"]` |
| 2235 | maintenance save failure preserves entered values for retry | A | `Error: Unable to find an element by: [data-testid="actual-variable-spending"]` |

### 2.3 类别定义（同时写进文件头注释）

- **A**：V2 不再渲染的 `data-testid`、旧按钮/标题/选择器（补 testid 不可行，V2 用 class；恢复时应改成 role/可见文案查询）
- **B**：Phase 3 文案已随 V2 改版（恢复前要确认 V2 现行口径）
- **C**：matcher 未注册（`toHaveTextContent` 等 jest-dom 扩展）
- **D**：依赖 A/B 的数值来源或交互链（进度值、重启后重复文本）

---

## 3. T3：替换文件头注释（`tests/ui.test.tsx:1-6`）

现在的 5 行注释作废，替换为：

```ts
// @vitest-environment happy-dom
// V2_MIGRATION_SPLIT (2026-10-26)：80 例经实测拆为 36 例可运行 / 44 例待迁移。
// 可运行的 36 例保持启用；44 例仍绑定 Phase 3 的 DOM 或文案，逐个 it.skip 并在标题前缀标注：
//   [A] 缺 data-testid / 旧 DOM 选择器   [B] 文案已随 V2 改版
//   [C] matcher 未注册（toHaveTextContent） [D] 依赖 A/B 的数值来源或交互链
// 迁移条件与逐条清单见 docs/V2_TEST_MIGRATION_DISPOSITION.md §四。
```

---

## 4. T4：同步 `docs/V2_TEST_MIGRATION_DISPOSITION.md`

这份文件是正式处置记录，必须改到与代码一致，具体四处：

1. **标题下加更新块**（日期 2026-10-26）：写明「原文 46/34 不成立，实测 0 运行 / 80 跳过；现已拆为 36 运行 / 44 跳过；命令与结果」。
2. **§一 表格**：数量改成实测值 —— A 26、B 15、C 1、D 2、合计 44、其余 36 恢复运行；类别 D 的名称从「交互超时」改为「数值来源/交互链已变」（44 例里没有一例是超时失败）。
3. **§二 处置决定**：改为「不删除；按例拆分，36 例恢复运行，44 例 `it.skip("[类别] …")` 逐条标注」，并说明不再使用整块 `describe.skip`。
4. **§四 清单**：把原来的「34 项」清单替换成新的 44 项清单，按 A/B/C/D 分组、组内保持文件原顺序，每条带编号；**§五 恢复条件**改为逐条适用，并写出当前基线 `36 passed | 44 skipped (80)` 与全仓数字。

**不要删除旧内容来"美化"记录**：原 34 项清单可以删（它本身就不准），但「46/34」的原始说法要在更新块里保留一句，作为漂移证据。

---

## 5. 改动白名单（只许这些）

- `tests/ui.test.tsx`
- `docs/V2_TEST_MIGRATION_DISPOSITION.md`

**禁止**：

- 改 `src/**` 任何文件（本包是测试拆分，不修产品代码）
- 改 `vitest.config.ts` / `vite.config.ts` / `package.json`
- 为了"让测试过"而放宽超时、加 `try/catch`、`expect` 改软、或用 `describe.skip` 整段包住
- `git add` / `git commit`（提交由 Owner 做）

---

## 6. 验收（回执必须贴命令与原文）

```bash
cd "个人财务模型app开发项目 2"

# 1. 本文件：36 通过 / 44 跳过
npx vitest run tests/ui.test.tsx
#    期望：Tests  36 passed | 44 skipped (80)

# 2. 计数自检：skip 数量必须正好 44，类别前缀必须可数
# 注意：`[ABCD]` 在 grep 里是字符集，要匹配标题里的字面量方括号必须转义
grep -c 'it\.skip("\[[ABCD]\] ' tests/ui.test.tsx   # 期望 28（普通用例）
grep -c 'it\.skip\.each(' tests/ui.test.tsx          # 期望 4（each 块）
grep -cE '^[[:space:]]+it\.skip' tests/ui.test.tsx    # 期望 32（28 + 4；不能用 it\.skip\( 数，它匹配不到 skip.each）

# 3. 类型与风格
npx tsc --noEmit                                      # exit 0
npx biome check tests/ui.test.tsx                     # 0 error

# 4. 全仓基线（不能倒退）
npx vitest run
#    期望：Test Files 49 passed（0 skipped）；Tests 496 passed | 44 skipped | 0 failed
#    （496 = 现有 460 + 本次恢复的 36；文件数从 48 passed | 1 skipped 变成 49 passed，
#     因为 ui.test.tsx 原来整块跳过、被计为 skipped 套件，现在有 36 例通过就计为 passed 套件）

# 5. 范围
git status --porcelain | grep -E 'tests/ui\.test\.tsx|V2_TEST_MIGRATION_DISPOSITION'
git diff --stat tests/ui.test.tsx docs/V2_TEST_MIGRATION_DISPOSITION.md
#    期望：只有这两个文件；ui.test.tsx 42+/42-（32 处 skip 改动覆盖 44 例 + describe 名 + 5 行头注释）
```

若第 5 步出现 `src/` 或配置文件的改动，视为越界，回执直接判不通过。

---

## 7. 回执格式

1. `git diff --numstat` 两个文件的数字
2. 上面 5 条命令的原文输出（含 `Tests 36 passed | 44 skipped` 与全仓 `496 passed | 44 skipped`）
3. 44 例的类别计数（A/B/C/D 各几例），与实测得到的"仍失败用例"逐条对照
4. 任何与你预期不符的现象（flaky、跳过数不同）如实写，不要掩盖

> 提交建议：本包单独一个提交（`test: 拆回 36 例可运行旧 UI 测试，44 例按 A/B/C/D 标注跳过`），不要与 WP-UI-HOME-03 / WP-ENV-01 混在一起。

---

## 8. 复核结论（2026-10-26，审核侧独立复跑）

**通过。** 执行回执与审核侧独立复测逐项一致，无越界、无凑数。

| 复核项 | 审核侧实测 |
|---|---|
| 定向 `tests/ui.test.tsx` | 36 passed / 44 skipped / 0 failed（JSON reporter） |
| 跳过集合 | 与本任务书 §2.2 的 44 条**逐条相等**（去前缀比对，双向差集为空） |
| 类别计数 | A 26 / B 15 / C 1 / D 2，44 条全部带 `[A/B/C/D]` 前缀，无未标注 skip |
| 全仓 `npx vitest run` | 49 passed files；496 passed / 44 skipped / 0 failed |
| `npx tsc --noEmit` / `npx biome check src tests` | exit 0 / 159 文件 clean |
| 改动面 | 仅 `tests/ui.test.tsx`（42+/42-，逐行记账：5 行头注释 + 1 行 describe + 28 个 it + 4 个 it.each + 4 个 each 标题）与处置记录（97+/52-）；`src/**`、配置、`package.json` 自 09:20 起零改动 |
| 处置记录 | §四 44 条与实测跳过集合完全一致，编号 1–44 连续；§一 数量、§五 基线均为实测值 |

**本任务书自身两处写错，已在 §0 / §6 更正**：`it(` 数量应为 64（不是 60）；grep 匹配 `[A]` 前缀必须转义方括号，且 `it\.skip\(` 数不到 `it.skip.each(`。执行方按等价正则复核为 28 / 4 / 32，处理正确。
