# 段 2（P1-a + P2）六项前后对比

- **前**：`evidence/wp-ui-visual-01/p1-p4/f09-20261028/after/`（上一轮已验收的现网视觉，390/760/980）
- **后**：`evidence/wp-ui-visual-01/p1-p4/f10-20261028/shots/`（本轮产品真组件，390/760/980/1440）
- 同一套 Chrome 无头、`prefers-reduced-motion: reduce`、`--force-device-scale-factor=1`；渲染的是 `src/ui/*` 真组件 + `src/style.css` 真级联，不是手绘图。

## 1. 结构卡主体：对比条 → 双层圆环

| | |
|---|---|
| 前 | 一条横向量条（收入 100% 底 + 固定支出 + 月供 + 余量段）+ 三个圆点 + 「查看固定支出/查看债务」 |
| 后 | 外环＝固定支出÷收入、内环＝月供÷收入、中心＝收入；环下两条 44px 明细行（名称 / 金额 / 占收入 X%），仍保留两个入口按钮 |
| 证据 | 前 `f09/after/after-home-roomy-390.png`、`after-home-light-over-980.png`；后 `shots/home-roomy-390.png`、`home-light-over-980.png` |
| 代码 | `src/ui/V2StructureRings.tsx`（新）、`structure-ring.ts`（新，纯模型）、删 `V2StructureCompareBar.tsx` |

## 2. C-6：占比为 0 / 待确认时不再出现「起点圆点」

| | |
|---|---|
| 前 | 数据为 0 时 `stroke-dasharray: 0 C` 仍渲染一个圆头线帽，在 12 点方向留下一个孤点 |
| 后 | `arcProps()` 在 `capped <= 0` 时返回 `null`，**整个 arc 元素不渲染**；只剩中性轨道 + 边界圆；待确认状态下内环只画轨道 |
| 证据 | 后 `shots/home-over-large-*.png`（230% 仍画）、`shots/home-zero-burden-390.png`、`shots/home-pending-390.png`；DOM 断言 `shots/metrics.json` 中 `arcs: 0` |
| 代码 | `src/ui/V2StructureRings.tsx:14-20` |

## 3. 超收入：旧「溢出段 + 刻度」→ 封顶一圈 + 12 点标记

| | |
|---|---|
| 前 | 量条上出现 overhang 区段与 income tick，宽度按比例算，>100% 时量条被挤出容器 |
| 后 | 环永远封顶一圈（`capped = 1`），12 点方向画 4px 深红标记，行内给「已超出 ¥2,600.00」，百分比照实写 120% |
| 证据 | 前 `f09/after/after-home-over-outer-980.png`、`after-home-over-both-390.png`；后 `shots/home-over-outer-390.png`、`home-over-both-980.png`、`home-over-large-390.png` |
| DOM | `metrics.json`：`rows[].over = "已超出 ¥2,600.00"`、`hasCompareBar: false` |

## 4. 固定支出摘要：文字行 → 三个数字 + 占比环

| | |
|---|---|
| 前 | 「本月已付 ¥X / 共 ¥Y」一行 + 进度条；无「未付」 |
| 后 | `计划 / 已付 / 未付` 三项 + 96px 占比环；可见名称「所选月份已付占比」；`本月已付占比` 全仓 0 处 |
| 证据 | 前 `f09/after/after-fixed-normal-390.png`；后 `shots/fixed-normal-390.png`、`fixed-normal-980.png` |
| 代码 | `src/ui/FixedExpensesPage.tsx`（摘要块）、`V2PaidRing.tsx`（新）、`v2-fixed-page.css`（新） |

## 5. 分类小计：标题 + 虚线 → 紧凑列表 + 细进度线

| | |
|---|---|
| 前 | 「分类小计 · N 项」标题 + 未付用虚线边框 |
| 后 | 不显示标题（`分类小计` 属未签认新文案，见 P-30），块用 `aria-label="固定支出"`；6px 细线，未付为实线灰底、不加虚线；超计划填充转红并给「超计划 ¥600.00 · 已付/计划 133.3%」 |
| 证据 | 前 `f09/after/after-fixed-zero-plan-760.png`；后 `shots/fixed-normal-980.png`、`fixed-overpaid-390.png`、`fixed-zero-plan-390.png` |

## 6. 空态与文案统一

| | |
|---|---|
| 前 | 「每月要付的 · 0 项」副标题 + 三句空态 + 图标 |
| 后 | 仅「固定支出·0项」+「暂无固定支出」；无图标、无插画、无 CTA；限宽 640、`min-height: 360`、内容上移 6% |
| 文案 | 「待付」→「未付」全量（src 内 0 处 `待付`）；已付行不再出现「再记一笔」（固定支出页 0 处）；页面上不再有 `0/0`、`0%` |
| 证据 | 前 `f09/after/after-fixed-zero-plan-980.png`；后 `shots/fixed-empty-390.png`、`fixed-empty-980.png`；`COPY-GREP.txt` |

## 附：两处按实测调整（非设计改动）

1. **对比度**：产品默认 `--v2-muted #6b7f7d` 在新卡片浅底上只有 4.04:1（低于 4.5:1 正文线）。新组件内把该变量收紧为 `#5b6e6c`（实测 5.15:1），不改全局 token、不影响 F-08 已签认页面。
2. **主按钮**：`v2-btn--primary` 白字压 `#24b89a` 只有 2.5:1；固定支出页内把主按钮底色下沉到 `--v2-teal-dark`（实测 5.1:1）。
3. **环色 vs 轨道**：外环 `#7CC9BF` 压轨道 `#E9EEEC` 实测 1.63:1（内环同量级），低于 1.4.11 的 3:1。**这是签认过的品牌色**，本轮不擅自改；同一信息由「占收入 X%」文字与金额承载，已记入报告待设计师/审核员裁决。
