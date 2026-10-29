# WP-UI-VISUAL-01｜参考资产定向返工执行报告（F-01～F-07）

- 执行者：小钱家执行员（AI）
- 依据：《WP-UI-VISUAL-01 最终验收与返工决定任务书 20261028》§3（Owner 已签认 `ACCEPTED / OWNER_SIGNED_20261028`）
- 范围：仅 `小钱家V3_WP-UI-VISUAL-01_设计参考资产/`；未触碰 `src/`、Financial Model、生产、鉴权文件，未生成 v3 实现稿
- 环境：macOS + Google Chrome 156.0.8078.48（headless=new，CDP over WebSocket，DPR=1，无 npm 依赖）
- 生成时间：2026-10-28

## 0. 结论摘要

| 项 | 判定 | 一句话依据 |
|---|---|---|
| F-01 | 通过（断言 + 390 截图） | 折叠摘要由实际值生成：`支付日期 · 备注（选填）` → `支付日期 2026-10-27 · 备注 地铁月卡`；改备注后 `collapsedSummaryIncludesNote=true` |
| F-02 | 通过（逐字比对） | 摘要环下有可见名称，逐字为「所选月份已付占比」，aria 名称同步 |
| F-03 | 通过（DOM 断言 + 顺序记录，范围已声明） | `aria-controls=payment-details` 目标存在且包含日期/备注输入；展开时 `hidden=false` 且可见 |
| F-04 | 通过（逐处实测表） | 环/轨道/分类条边界 3.25:1～6.06:1，品牌填充保留，焦点态 6.06:1 |
| F-05 | 通过 | 390×844 首个功能模块 y：1002.8 → **796.6**，信息未删 |
| F-06 | **部分**（等价交互 2/3，日期弹层缺真机） | 320 高视口按钮 358 → **303**（视口内）；150% 文本 520 高 607 → **503**；原生日期弹层无真机证据 |
| F-07 | 通过 | 旧 9 图移入 `renders/legacy-20261027/` 并标注旧版；逐图记录视口/内容/侧栏宽 |

**仍阻断**：§4 超额标记样式（红色斜纹）未动，等 Owner 从设计师 A/B/C 候选稿选定。
**未宣称**：产品实现就绪、独立审核通过、真机无障碍验收通过。

## 1. 基线留档（第一步）

改前副本与哈希在 `baseline-source/`，`SHA256.txt` 逐文件登记：

| 文件 | 改前 SHA256 | 改后 SHA256 |
|---|---|---|
| `app.js` | `e2151ff9…8ac90e` | `066213d1…4519a2a5` |
| `styles.css` | `4a3f051c…54ff992f` | `5f28ac3e…5235a66f4`（2026-10-28 更正，原记 `5e2c6d28…` 为中间态） |
| `index.html` | `5e10f35a…7c8aec63` | 未改（同哈希） |
| `fixed-v3-source.html` | `2297d0d0…663000ba` | 未改（同哈希） |

> **更正 C-1（2026-10-28，验收复核后）**：`styles.css` 改后终值 SHA256 为
> `5f28ac3ef550ea76ce237368c8015af64e18f0c77004123b7c6be865235a66f4`。
> 原表里的 `5e2c6d28…7ce7a691680a` 是在最后一次 `styles.css` 编辑（合并重复的 620 媒体块）**之前**取的中间态，
> 编辑后未回写哈希。文件内容未再变动，重算命令见 §8。

`before/` 的 19 张图与 `before-metrics.json` 不是旧图复用，而是用同一套 `tools/verify.mjs` 指向 `baseline-source/` 重新跑出来的，所以 before/after 的采样口径、截图尺寸、断言代码完全一致。

## 2. 方法与复现

```bash
cd "/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2/evidence/wp-ui-visual-01/reference-asset-rework-20261028"

# 改前基线（指向 baseline-source 副本）
node tools/verify.mjs \
  --root "/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2/evidence/wp-ui-visual-01/reference-asset-rework-20261028/baseline-source" \
  --out ./before --label before

# 改后
node tools/verify.mjs \
  --root "/Users/linte/Documents/ChatGPT/小钱家-新/小钱家V3_WP-UI-VISUAL-01_设计参考资产" \
  --out ./after --label after
```

19 个页面/状态/视口组合 × 每次全量断言；判定规则写在脚本里：出现横向溢出、`NaN/Infinity`、运行时异常或远程请求即计入 `failures`。两次运行均为 `failures: []`，`exceptions: []`，`remoteRequests: []`。

## 3. 逐项执行

### F-01｜付款日期/备注收起摘要不更新

- **修改对象**：`app.js`（折叠摘要生成、取消/Esc 还原）。
- **实际改动**：新增 `detailSummaryValues(sheet)` / `updateDetailSummary()`：折叠文案由「字段标签 + 实际值」拼成，不用新句子；两值皆空时逐字回落原文案 `支付日期 · 备注（选填）`；`openSheet()` 记录 `originValues`，`close` 事件 `resetSheetValues()`，取消与 Esc 不写数据；输入 `input`/`change` 时实时刷新。
- **断言（before → after）**：

| 断言 | before | after |
|---|---|---|
| 打开即收起 `f01_open_collapsed` | `支付日期 · 备注（选填）` | `支付日期 2026-10-27 · 备注 地铁月卡` |
| 改备注后收起 `f01_collapsed_summary` | `支付日期 · 备注（选填）` | `支付日期 2026-10-27 · 备注 地铁月卡·补充` |
| `f01_collapsed_includes_note` | `false` | **`true`** |
| 只填日期 `f01_date_only_summary` | `支付日期 · 备注（选填）` | `支付日期 2026-10-26` |
| 两值皆空 `f01_empty_summary` | `支付日期 · 备注（选填）` | `支付日期 · 备注（选填）`（逐字不变） |
| 重新展开原值 `f01_reopen_value` | `地铁月卡·补充` | `地铁月卡·补充`（未丢） |
| 取消不写 `f01_cancel_no_write` | `true` | `true` |
| Esc 关闭 `f01_esc_closes` | `true` | `true` |

- **截图**：`after/after-fixed-normal-payment-collapsed-390x520.png`（折叠行显示实际值）、`after/after-fixed-normal-payment-note-390x520.png`（编辑后折叠行同步）。
- **需验收确认**：摘要句式是「字段标签 + 值」的组合（`支付日期 2026-10-27 · 备注 地铁月卡`），没有引入新句子；若验收要求不同分隔符，属文案口径确认，不是新写文案。

### F-02｜摘要环缺可见名称

- **修改对象**：`app.js`（摘要环结构）、`styles.css`（名称排版）。
- **实际改动**：环外层包 `.summary-ring-block`，环下加 `<small class="summary-ring-name">所选月份已付占比</small>`；环的 `aria-label` 保持/补全为「所选月份已付占比 74.5%」。名称与环同屏、不叠加额外百分比、环数值未改。
- **断言**：`summaryName` before `null` → after `所选月份已付占比`；`aria` = `所选月份已付占比 74.5%`。
- **截图**：`after/after-fixed-normal-390x844.png`、`after-fixed-normal-1000x1100.png`、`after-fixed-normal-1440x1050.png`。
- **副作用披露**：为让 16px 的 `74.5%` 不贴住新加的 1px 状态线，摘要环直径 **≥621：76 → 84px；≤620（移动端）：70 → 84px**（改前移动端被 620 媒体块覆写为 70px，原报告「移动端同为 84」表述不准确，此处按验收要求补注）；属于 F-02/F-04 叠加后的必要微调，已由验收接受为偏差 D-1。

### F-03｜`aria-controls` 指向空节点

- **修改对象**：`app.js`（付款面板结构）、`styles.css`（`.detail-fields` 容器）。
- **实际改动**：`toggle` 的 `aria-controls` 指向真实容器 `#payment-details`，容器内是日期 + 备注两个字段；展开时移除 `hidden` 并置 `aria-expanded=true`，收起反之；`detail-fields[hidden]{display:none}` 兜底，避免类名 `display:grid` 压过隐藏。
- **断言（before → after）**：

| 断言 | before | after |
|---|---|---|
| `targetExists` | `true`（空 span） | `true`（真实容器） |
| `targetHasDate` / `targetHasNote` | `false` / `false` | **`true` / `true`** |
| 收起 `expanded` / `targetHidden` | `false` / `true` | `false` / `true` |
| 展开 `expanded` / `targetHidden` / `targetVisible` | `true` / **`true`** / **`false`**（矛盾） | `true` / `false` / `true` |

- **键盘记录**：展开后视觉顺序与 DOM 顺序一致：`金额 → 支付日期 → 备注 → 收起/展开 → 取消 → 确认付款`，与 v2 相同（未改 Tab 语义）；Esc 可关闭。
- **范围声明**：只做了 DOM/键盘层面核对，**没有**跑 VoiceOver/NVDA 全量读屏验收；CDP 合成 Tab 在 modal 内不触发遍历（`f03_tab_order` 四次都停在日期框），故以 DOM 可聚焦顺序为准，不虚报键盘实测通过。

### F-04｜必要图形对比度不足

- **修改对象**：`styles.css`（环、轨道、分类条）。
- **实际改动**：品牌色只作填充；每个必要图形加 1px 深色状态线：外环/摘要环/分类条末端 `#286D65`（必选），内环 `#B87700`（仅图形），中性轨道轮廓 `#6F827E`；分类条改为「轨道 `::after` 边框压住填充」，避免填充盖掉边线。
- **实测色值（computed style）**：`ringEdge #286d65`、`ringProgress #7cc9bf`、`innerEdge #b87700`、`innerProgress #fbd83b`、`trackEdge #286d65`（内环 `#b87700`）、`summaryEdge #286d65`、`summaryProgress #7cc9bf`、`summaryTrackEdge #6f827e`、`categoryFillBorder #286d65`。

### F-05｜390×844 首个功能模块 y≈1003

- **修改对象**：`styles.css`（仅在既有 `@media(max-width:620px)` 内调整纵向节奏）。
- **实际改动**：压缩页头/标题区/主卡内边距与间隔；主卡与双环区合并为同一张概览容器（去缝隙、拆圆角、去重复边框，属「同一结论的重复容器合并」）；未缩字号、未删节点、未扩容器宽。
- **坐标（390×844）**：

| 元素 | before | after |
|---|---:|---:|
| 主卡 `.hero` | y=183，高 414.8 | y=154，高 **357.6** |
| 双环区 `.chart-card` | y=617.8，高 365 | y=511.6，高 **273** |
| 首个功能模块 y | **1002.8** | **796.6** |
| 文档高 | 1611 | 1405 |

其他视口：760 → 1016.1 / **1007.1**（−9，同向微降，卡片合并效果只在 ≤620 生效，760 保持原圆角）；1000 → 978.1 / 978.1（未变）；1440 → 648.1 / 648.1（未变）。超载态 390：1125.8 → 913.6。
- **截图**：`before/before-home-roomy-390x844.png` → `after/after-home-roomy-390x844.png`。

### F-06｜390×520 确认付款需滚动

- **修改对象**：`styles.css` + `app.js`（面板布局）。
- **实际改动**：`dialog[open]` 改 flex 纵向；`.payment-fields` 可滚动（`min-height:0` + `overflow-y:auto`）；`.payment-actions` 常驻不压缩；≤620 时字段单列全宽、按钮 `flex:1`、面板内边距收紧。仅使用既有断点（620/879），未新增断点，880 阈值规则未动。
- **断言（实测）**：

| 场景 | before | after |
|---|---|---|
| 390×520 初始，确认付款下缘 | 495（可见） | 503（可见） |
| 390×520 展开日期/备注，确认付款 | **不可见**（面板高 496，按钮被挤出） | **可见**（下缘 503） |
| 390×320（软键盘等效），确认付款 | **不可见**（下缘 358） | **可见**（下缘 **303**），字段区可滚动 63/73，焦点仍在 INPUT |
| 390×844 + 150% 文本 | 可见（819） | 可见（827） |
| 390×520 + 150% 文本 | **不可见**（607） | **可见**（503），字段区可滚动 |
| 原生日期框 `input[type=date]` | 可见/可聚焦，宽 348 | 可见/可聚焦，宽 356 |

- **截图**：`after/after-fixed-payment-keyboard-390x320.png`、`after/after-fixed-payment-textscale-390x520.png`、`after/after-fixed-normal-payment-note-390x520.png`。三张都是**实时交互后按设备视口截的屏**（不是静态长图），与上表断言同时产生。
- **未完成子项（如实报告）**：**原生日期弹层**只能真机验证，headless Chrome 无法唤起系统日期选择器；**iOS 动态字体（Dynamic Type）** 也只是用 `-webkit-text-size-adjust:150%` 做等价放大，不等于系统字体设置。按 Owner「遇阻须停下回报、不得用静态截图充数」的要求，F-06 记为**部分完成**，等待真机补证。

### F-07｜旧 renders 混存 + 1120 vs 980

- **实际动作**：9 张旧图 `mv` 到 `renders/legacy-20261027/`（未删除），新增该目录 README 标注 **旧版 / LEGACY / 不得作为验收证据**，并逐图记录视口宽、实际内容宽、侧栏宽；`renders/README.md` 重写为「本目录不再放现行基线图 + 对照图位置 + 1120/1440 仅展示」；`handoff.md` 增补同一张宽度表与 980/586 声明。
- **结论**：任一旧图都在带 README 的隔离子目录内，文件名与说明双重标注，不会被误认作当前基线；`renders/` 根目录只剩 `README.md` 与 `legacy-20261027/`。

## 4. F-04 对比度测量表

按 sRGB 相对亮度计算（WCAG 2.x）。要求：必要图形 ≥3:1；文字对比独立验收。

| 必要图形 | 背景 | 边界 / 状态线 | 交互态（填充） | 焦点态 | 实测比 | 判定 |
|---|---|---|---|---|---|---:|
| 双环外环（固定负担） | 卡白 `#FFFFFF` | `#286D65` 16px 底线 | `#7CC9BF` 14px 进度 | — | **6.06:1** | 通过 |
| 双环内环（消费） | 卡白 `#FFFFFF` | `#B87700` 14px 底线 | `#FBD83B` 12px 进度 | — | **3.70:1**；对自身浅黄轨 `#F5F1D9` **3.25:1** | 通过（3.25 为全表最低，仍 ≥3:1） |
| 外环轨道 | 卡白 `#FFFFFF` | `#286D65` | 轨道 `#EDF2F0` | — | **6.06:1**；对轨 5.36:1 | 通过 |
| 内环轨道 | 卡白 `#FFFFFF` | `#B87700` | 轨道 `#F5F1D9`（内环实际轨道色，非 `#EDF2F0`） | — | **3.70:1**；对轨 **3.25:1** | 通过 |
| 摘要环（进度） | 卡白 `#FFFFFF` | `#286D65` 8px 底线 | `#7CC9BF` 6px 进度 | — | **6.06:1**；对浅轨 `#EDF1EF` 5.32:1 | 通过 |
| 摘要环（轨道） | 卡白 `#FFFFFF` | `#6F827E` 8px 轮廓 | 轨 `#EDF1EF` | — | **4.06:1**；对轨 **3.56:1** | 通过 |
| 分类进度条 | 卡白 `#FFFFFF` | 轨道轮廓 `#6F827E` 1px + 填充末端 `#286D65` 2px | `#7CC9BF` | — | 轮廓 **4.06:1**（对轨道灰 3.46:1）；末端 6.06:1 | 通过 |
| 顶部/页脚链接焦点环 | 卡白 `#FFFFFF` | `#286D65` 2px solid | — | `:focus-visible` 实测 `outlineStyle:solid` | **6.06:1** | 通过 |
| 品牌填充（仅作填充，不单独承担边界） | 卡白 | — | `#7CC9BF` | — | 1.92:1 | 不作边界使用（信息性） |
| 品牌填充（同上） | 卡白 | — | `#FBD83B` | — | 1.40:1 | 不作边界使用（信息性） |
| 既有警示文字（未改） | 浅珊瑚 `#FFF0ED` | — | `#C2503C` 文字 | — | 4.20:1 | 文字独立验收项，非本轮改动 |

像素复核：对 `after-fixed-normal-390x844.png` 逐行采样，分类条在 y=920/925 为 `(111,130,126)` 深色边线、y=921–924 为 `(124,201,191)` 填充，证明边框画在填充**之上**（返工中曾发现填充盖掉父级 inset 阴影，已改为伪元素边框并复测通过）。

## 5. 回归自检

- 19 个组合全部无横向溢出（`noHorizontalOverflow=true`），无 `NaN/Infinity`。
- 0 运行时异常、0 远程请求；页面仅加载本地 `styles.css` / `app.js`。
- **1000 / 1440 的首页首模块坐标与改前完全一致**（978.1 / 648.1；首页 `docHeight` 分别为 1510 / 1050，也一致）：首页几何未变。
- **更正 C-2（原表述「1000 / 1440 与改前完全一致」不成立，已补限定）**：
  - `pending` 态 1000 宽首模块 y **1402 → 1382（−20 px）**。实测定位：**顶部注释层 `.annotation-panel` 高度 248.1 → 228.1（−20.0 px）**，其文案在返工中由 `独立设计注释 · PENDING_OWNER_DECISION` 段改写为 `设计注释 · 定向返工 2026-10-28` 段；深色审核工具条 `.review-tools` 高度两侧均为 199.8（未变），`.content` 块高度两侧均为 1408.1（未变）。即 −20 px 全部来自注释层文案长度，**产品卡片区几何未变**。复核脚本：`tools/probe-banner-shift.mjs`。
  - **同一次核查中新发现（原报告漏列）**：固定支出页在 **≥761** 因 F-02 新增可见名称「所选月份已付占比」，`.fixed-summary` 增高 **+31.9 px**（760：118 → 149.9；1000/1440：124 → 155.9），其下 `.fixed-list` / `.categories` 同步下移 **31.9 px**（760：363 → 394.9；1000：382 → 413.9；1440：382 → 413.9），760 的 `docHeight` **1221 → 1256**。这是 F-02「环下必须有可见名称」的直接结果，不是产品版式回归；该高度增长是否接受请验收裁定。
  - **度量口径提醒**：1000×1100 / 1440×1050 的固定支出页 `docHeight` 恰好等于视口高（1100 / 1050），被视口下限夹住，**不能用 `docHeight` 相等推断未发生位移**；位移须看元素 y（上条已给）。
- 760 首页仅因移动端节奏微调前移 9px（1016.1 → 1007.1），卡片合并不在 760 生效，避免 620–879 出现圆角接缝。
- **未重跑** `tools/render-and-verify.mjs`：它会覆盖 `codex-revision-v2/` 的 64 张既有证据图，故保留原样；F 项断言由新工具覆盖。

## 6. 未验证 / 阻断（不虚报）

1. **F-06 原生日期弹层、iOS 动态字体、真机软键盘**：无真机证据，需 Owner/验收安排真机补测；本机只做了 320 高视口 + `-webkit-text-size-adjust` 的等价交互。
2. **读屏**：未跑 VoiceOver/NVDA，只做 DOM 语义断言。
3. **§4 超额标记样式**：红色斜纹 `#c2503c`/`#ffe3d9`、`review-slot`、`PENDING_OWNER_DECISION` 全部未动，等 Owner 选 A/B/C。
4. **产品实现**：`src/`、真实支付、真实月份切换、持久化、生产环境均未触碰；本资产仍不是实现依据。
5. 资产头部仍有 v2 遗留的禁用「导出备份」按钮，超出 F 范围，未改，已在 handoff 记录。

## 7. 改动文件与证据清单

**资产内改动**

| 文件 | 内容 |
|---|---|
| `app.js` | F-01/F-02/F-03 结构与时序；审核层文案改为「返工稿、不得作为实现依据」 |
| `styles.css` | F-04 状态线、F-05 移动端节奏、F-06 面板布局、`[hidden]` 兜底；合并重复的 620 媒体块 |
| `renders/legacy-20261027/`（新） | 9 张旧图 + README（旧版标注、逐图宽度） |
| `renders/README.md` | 重写（隔离说明 + 宽度表 + 1120/1440 声明） |
| `handoff.md` | v3：范围/状态/未决/宽度表 |
| `README.md` | v3：指向本报告与证据目录 |
| `modified-files.md` | 追加 2026-10-28 返工清单 |

**证据目录**（本目录）

| 路径 | 内容 |
|---|---|
| `baseline-source/` + `SHA256.txt` | 改前 4 文件原样副本与哈希 |
| `before/`（19 PNG + `before-metrics.json`） | 同一工具跑出的改前基线 |
| `after/`（19 PNG + 2 交互 PNG + `after-metrics.json`） | 改后截图与断言 |
| `tools/verify.mjs` | 无依赖 CDP 渲染/断言工具（`--root/--out/--label`） |
| `tools/probe-vertical-offset.mjs` | C-2 复核用探针：固定支出页 760/1000/1440 的 `.fixed-summary` 高度与下方元素 y（`--root/--label`） |
| `tools/probe-banner-shift.mjs` | C-2 复核用探针：`pending` 态 1000 宽下 `.review-tools` / `.annotation-panel` / `.content` / 首模块几何（`--root/--label`） |
| `REWORK-REPORT.md` | 本报告 |

## 8. 证据更正记录（验收复核后，2026-10-28）

**只改文档，未改资产、未改代码。** 资产文件在更正前后哈希一致，可复算。

| 编号 | 更正内容 | 原因 | 复核方式 |
|---|---|---|---|
| **C-1** | §1 `styles.css` 改后 SHA256：`5e2c6d28…7ce7a691680a` → `5f28ac3ef550ea76ce237368c8015af64e18f0c77004123b7c6be865235a66f4` | 原值取自最后一次 `styles.css` 编辑（合并重复的 620 媒体块）**之前**的中间态，编辑后未回写 | `shasum -a 256` 直接复算（命令见下） |
| **C-2** | §5「1000 / 1440 与改前完全一致」补限定：`pending`-1000 首模块 y 1402 → 1382（−20 px）；新增披露固定支出页 ≥761 因 F-02 可见名称整体下移 31.9 px、760 `docHeight` 1221 → 1256；补充「`docHeight` 被视口下限夹住」的度量口径提醒 | 原句把「首页首模块坐标」写成「版式坐标」，且未覆盖 `pending` 态与固定支出页 | `tools/probe-vertical-offset.mjs` + `tools/probe-banner-shift.mjs` 对 `baseline-source/` 与现行资产各跑一次，逐元素比对 y / height |
| **C-2 附注**（对验收归因的修正） | 验收把 −20 px 记为「审核横幅文案改写回流」；实测 **`.review-tools` 两侧均 199.8，未变**，变化全部在注释层 **`.annotation-panel` 248.1 → 228.1**，`.content` 两侧均 1408.1。归因应为「注释层文案变短」，不影响「产品卡片区几何未变」的结论 | 归因需精确到具体元素，否则后续复核会误查工具条 | `tools/probe-banner-shift.mjs` 输出（§5 已引用） |
| **C-3**（自查追加，非验收要求） | §4 内环轨道色 `#EDF2F0` → 实际 `#F5F1D9`；内环边线对自身轨道 **3.25:1**（全表最低，仍 ≥3:1）；摘要环轨道轮廓对轨 `3.46:1` → **3.56:1**（3.46 是分类条对 `#E9EEEC` 的值，误抄） | §4 把内环轨道色写成了外环轨道色；§0 写的 3.25～6.06 才是真实区间，两处自相矛盾 | 按 §3.4 的 computed style 取色重算 sRGB 相对亮度：`#B87700` vs `#F5F1D9` = 3.25、`#6F827E` vs `#EDF1EF` = 3.56 |
| **D-1 补注**（验收要求） | §3 F-02 副作用披露补注真实改前值：**≥621 为 76 → 84；≤620 为 70 → 84**（原表述「移动端同为 84」不准确，改前移动端被 620 媒体块覆写为 70px） | 验收接受环径调整时要求披露准确的前值 | `grep` 基线 `styles.css` 两条 `.summary-ring{...}` 声明（76px 基础值 + 620 媒体块 70px 覆写） |
| **D-2**（验收裁定，登记） | 固定支出页因 F-02 可见名称产生的下移（`.fixed-summary` 118→149.9 @760、124→155.9 @1000/1440，`.fixed-list`/`.categories` 同步 +31.9px）**登记为已接受偏差 D-2：不换位置、不再压高度**；披露范围按资产断点写 **≥621**（760 实测同增；≤620 实测无增长，390×844 `docHeight` 1274→1267） | 验收裁定：名称块本身即 F-02 的签认要求，消高度只能挪位或叠压，属为像素稳定做布局改造且超出 §3 允许范围 | 验收复跑 `tools/probe-vertical-offset.mjs`（before/after，760/1000/1440）确认位移等量、19 组合 0 溢出无遮挡 |

**C-1 / C-2 / C-3 三条更正均已被验收接受**（C-2 含对验收方归因的修正，以探针实测为准）；D-1 补注、D-2 一并接受。**F-01～F-07 返工于 2026-10-28 正式闭环**（6 通过 + F-06 部分通过维持，不得改写为通过）。

**更正后 F-04 结论不变**：必要图形最低 3.25:1（内环深黄边线对自身浅黄轨道），仍满足 ≥3:1；品牌浅色（1.92 / 1.40）依旧只作填充、不承担边界。

复算命令：

```bash
cd "/Users/linte/Documents/ChatGPT/小钱家-新"
shasum -a 256 \
  小钱家V3_WP-UI-VISUAL-01_设计参考资产/app.js \
  小钱家V3_WP-UI-VISUAL-01_设计参考资产/styles.css \
  小钱家V3_WP-UI-VISUAL-01_设计参考资产/index.html \
  小钱家V3_WP-UI-VISUAL-01_设计参考资产/fixed-v3-source.html

cd "个人财务模型app开发项目 2/evidence/wp-ui-visual-01/reference-asset-rework-20261028"
node tools/probe-vertical-offset.mjs --root ./baseline-source --label before
node tools/probe-vertical-offset.mjs --root "/Users/linte/Documents/ChatGPT/小钱家-新/小钱家V3_WP-UI-VISUAL-01_设计参考资产" --label after

node tools/probe-banner-shift.mjs --root ./baseline-source --label before
node tools/probe-banner-shift.mjs --root "/Users/linte/Documents/ChatGPT/小钱家-新/小钱家V3_WP-UI-VISUAL-01_设计参考资产" --label after
```

**本轮仍未闭合**：F-06 真机三项（原生日期弹层 / iOS 动态字体 / 真实软键盘）= `OPEN-F6`；读屏实测 OPEN；§4 超额标记样式等 Owner 选 A/B/C。产品代码、`src/`、Financial Model、生产与鉴权文件本轮零触碰。
