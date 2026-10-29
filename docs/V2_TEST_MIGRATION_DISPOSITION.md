# V2 UI 测试迁移处置记录

**项目：** 小钱家 (Personal Finance Console)
**日期：** 2026-10-16（2026-10-26 修订）
**状态：** FORMAL_DISPOSITION_RECORD
**审核依据：** 方案 C — 基线重建后冻结 build-21

> **2026-10-26 更新（WP-TEST-02）**
>
> 原文「46 例继续运行 / 34 例跳过」不成立，仅作为漂移证据保留：改动前 `tests/ui.test.tsx` 用整块 `describe.skip` 罩住全部 80 例，实测为 **0 运行 / 80 跳过**，文件中不存在任何兼容补丁。
>
> 现已按实测拆为 **36 运行 / 44 跳过**：能运行的 36 例恢复启用，仍绑定 Phase 3 DOM/文案的 44 例逐条 `it.skip("[A/B/C/D] …")` 标注，不再使用整块 `describe.skip`。
>
> 命令与结果：
>
> ```text
> $ npx vitest run tests/ui.test.tsx
> Tests  36 passed | 44 skipped (80)
>
> $ npx vitest run
> Test Files  49 passed (49)
> Tests  496 passed | 44 skipped (540)
> ```

---

## 一、背景

V2 UI（`V2HomeSurface.tsx` + `v2-surface.css`）完整替换了 Phase 3 的 DOM 结构、文案体系和导航模式。旧 `tests/ui.test.tsx` 中的 80 个测试用例，经逐条实测：**36 例可运行，44 例无法兼容**，无法兼容的原因如下（数量为实测值）：

| 失败类别 | 数量 | 根因 |
|---|---:|---|
| A. 缺 data-testid / 旧 DOM 选择器 | 26 | V2 使用 class-based 选择器，不再渲染旧 testid（如 `home-spending-status`、`home-safety-coverage`、`actual-variable-spending`），或旧按钮/标题/选择器已不存在；补 testid 不可行，恢复时应改成 role/可见文案查询 |
| B. 文案已随 V2 改版 | 15 | V2 使用口语化文案（statusCopy/dimensionCopy），旧测试硬编码 Phase 3 文案；恢复前需确认 V2 现行口径 |
| C. matcher 未注册 | 1 | 旧测试使用 jest-dom 扩展 matcher（`toHaveTextContent`），当前 Vitest + happy-dom 未加载 |
| D. 数值来源/交互链已变 | 2 | 依赖 A/B 的数值来源或交互链（进度值、重启后重复文本）；44 例中没有一例是超时失败 |
| **合计** | **44** | 其余 **36** 例恢复运行 |

## 二、处置决定

**不删除源码；按例拆分，36 例恢复运行，44 例逐条跳过并标注类别。**

- `tests/ui.test.tsx` 的整块 `describe.skip` 已恢复为 `describe("Phase 3 product UI（V2 兼容 36 例 · 待迁移 44 例）")`，不再使用整块 `describe.skip` 包住大段测试。
- 44 个仍失败的用例逐个改为 `it.skip("[A/B/C/D] 原标题")`；4 个 `it.each` 块改为 `it.skip.each`，并在生成标题前加同样的类别前缀。
- 文件头注释已替换为 `V2_MIGRATION_SPLIT` 说明，类别定义与本文一致。
- 源码保留供未来按需逐条迁移。

## 三、V2 替代覆盖证据

被跳过的 Phase 3 测试功能在 V2 测试中均有对应覆盖：

| Phase 3 测试功能域 | V2 覆盖位置 | V2 测试名称 |
|---|---|---|
| 首页安全覆盖展示 | `tests/v2-ui.test.tsx` | shows the single daily task and the four progress dimensions |
| 债务编辑与确认 | `tests/v2-ui.test.tsx` | animates the saved debt row and responsibility node after matching readback |
| 消费记录录入 | `tests/v2-ui.test.tsx` | records an expense through the existing application boundary and closes the sheet |
| 消费动画反馈 | `tests/v2-ui.test.tsx` | animates a recent expense only after the application boundary returns a confirmed readback |
| 现金流详情导航 | `tests/v2-ui.test.tsx` | opens the cash-flow explanation from the V2 path |
| 四目的地导航 | `tests/v2-ui.test.tsx` | keeps one four-destination navigation visible across destination pages |
| 花钱分布环形图 | `tests/v2-ui.test.tsx` | shows a real spending map on Progress when expense breakdown data is available |
| 模型方向与建议 | `tests/v2-ui.test.tsx` | shows model directions and explanations without creating a combined score |
| 空状态处理 | `tests/v2-ui.test.tsx` | shows the real empty state and preserves a failed expense draft without success feedback |
| 跨月消费过滤 | `tests/v2-ui.test.tsx` | does not display previous-month expenses in the current month recent list |
| 安全基线不可用 | `tests/v2-ui.test.tsx` | keeps the expense sheet dismissible and handles an unavailable safety baseline |
| 数据隐私入口 | `tests/v2-ui.test.tsx` | opens the data and privacy destination from My Finance |
| 现金安全节点 | `tests/v2-ui.test.tsx` | animates the cash safety node only after cash state is reread and matched |

**V2 测试结果：19/19 通过（NODE_ENV=test）**

## 四、44 项被跳过测试完整清单

按 A/B/C/D 分组，组内保持 `tests/ui.test.tsx` 文件原顺序；编号 1–44 连续。标题为去掉类别前缀后的原名。

### A. 缺 data-testid / 旧 DOM 选择器（26 例）

1. T-P2-01 null coverage renders unavailable progress
2. T-P2-01 NaN coverage renders unavailable progress
3. T-P2-01 infinite coverage renders unavailable progress
4. T-P2-01 NaN target renders unavailable progress
5. T-P2-01 infinite target renders unavailable progress
6. Stage 2 H/J. over-target spending and Planning Income stay distinct
7. Stage 2 L. detail routes are read-only and each has a working Home action
8. preserves the local calendar date separately from the UTC instant
9. 9. optional category and note are sent when provided
10. 12. successful expense save recalculates and updates Home
11. 13–14. overspending keeps the recommendation and shows amount above it
12. A. keeps the Owner target separate from a zero safe recommendation
13. preserves exact aggregate debt and payment values in V2
14. Safety primary reason and actions are truthful for structural deficit with floor met
15. Safety primary reason and actions are truthful for structural deficit with floor failed
16. Safety primary reason and actions are truthful for positive surplus with floor failed
17. Safety primary reason and actions are truthful for clear gate
18. Safety primary reason and actions are truthful for no core obligations
19. Safety primary reason and actions are truthful for zero safety target
20. Safety cash-account action opens the existing cash category page
21. monthly maintenance submits only changed facts through the application service
22. blocks an Actual Income draft with amount but no date and preserves it
23. blocks an Actual Income draft with date but no amount and preserves it
24. blocks a draft without status and blocks all rows if any started draft is incomplete
25. intentionally ignores a fully blank optional Actual Income draft
26. maintenance save failure preserves entered values for retry

### B. 文案已随 V2 改版（15 例）

27. V2 shows current-month pending debt facts without exposing stale totals
28. V2 cash-flow detail and safety progress use existing model values
29. Stage 2 E/F/G. positive surplus and null coverage render truthfully
30. Stage 3 Hub has one navigation, four read-only categories, and zero writes on visit
31. C. renders model overview values from changing Home/Model fixtures
32. 15. structural deficit is described as a core income gap without mislabeling the cash floor
33. 16. balanced no surplus is not described as a deficit
34. 17. a failed cash floor gives a calm floor reminder
35. 18. NOT_APPLICABLE has no cash warning
36. Home and Safety detail preserve A structural deficit with floor met semantics
37. Home and Safety detail preserve B normal with floor failed semantics
38. Home and Safety detail preserve C structural deficit with floor failed semantics
39. Home and Safety detail preserve D normal with floor met semantics
40. Home and Safety detail preserve E no core obligations semantics
41. 19–20. Home uses primary improvement and drag dimensions

### C. matcher 未注册（1 例）

42. T-P2-01 target zero remains legal and shows coverage without a target progress bar

### D. 数值来源/交互链已变（2 例）

43. T-P2-01 keeps truthful half and capped progress for normal ratios
44. 22–23. restarting loads the persisted Home and spending state from services

## 五、恢复条件

恢复按**单条**进行，不取消整块 `describe`、不恢复整块 `describe.skip`。每条恢复时必须同时去掉标题上的 `[类别] ` 前缀和 `.skip`，并满足：

1. **先确认当前基线**：`npx vitest run tests/ui.test.tsx` 为 `36 passed | 44 skipped (80)`；全仓 `npx vitest run` 为 `496 passed | 44 skipped | 0 failed`。恢复后这两个数字应按恢复条数相应变化，全仓不得出现 failed。
2. **A 类逐条**：把旧 `data-testid` / 旧按钮、标题、选择器查询改为 V2 现存的 role 或可见文案查询（或由 V2 提供等价、稳定的可访问入口），不得仅为通过测试而回填旧 testid。
3. **B 类逐条**：先确认 V2 现行文案口径（`statusCopy` / `dimensionCopy` 等），再按现行文案改写断言；不得放宽为模糊正则来吞掉差异。
4. **C 类逐条**：注册缺失的 matcher（如引入 jest-dom 扩展）或改用 Vitest 原生断言；不得用软断言绕过。
5. **D 类逐条**：先确认其依赖的 A/B 数值来源或交互链已经恢复，再重跑并核对具体数值/唯一文本；不得用 `getAllBy*` 或放宽超时掩盖重复渲染与超时。
6. **逐条验证**：每条恢复后单独运行 `npx vitest run tests/ui.test.tsx`，确认该条由 skipped 变为 passed 且其余用例不回归；恢复条件未满足前保持 `it.skip("[类别] …")`。
7. **记录同步**：每恢复一条，同步删除 §四 对应条目并更新 §一 数量与本文基线，避免再次出现记录与代码漂移。
