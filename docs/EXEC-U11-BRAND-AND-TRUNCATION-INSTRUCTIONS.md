# EXEC-U11 执行指令（品牌 logo 恢复 + 点 logo 回首页 + 文字截断静态清单修复）

**角色：** 执行者
**基线：** HEAD `2bc3d1d`（build-46）；全量基线 **403 passed / 0 failed / 80 skipped**
**日期：** 2026-10-21
**批准：** 用户于 2026-10-21 直接报修三项（logo 被改 / 文字截断 / 点 logo 回首页缺失），属用户验收反馈，无需再澄清授权；截断范围澄清（clarify_id `aa7343d2-5ac5-48b3-8509-a902e605f915`）超时未答，故截断按本指令第三节**静态清单**执行，用户后续补充的实例原拟另批追加；**Owner 已于同日补充四张真机截断截图（见第三节附录 U1–U4），按承诺并入本批**；U1–U4 之外的新实例仍另批追加，不得自行扩范围。

---

## 〇、目标

1. **W1 恢复品牌 logo**：顶栏品牌位恢复 build-45 之前的原 logo 图形（绿钱包+嫩芽 svg），仅顶栏这一处；其余 13 处 lucide 图标瓷砖保留不动。
2. **W2 点 logo 回首页**：品牌位改为可点击按钮，点击回「今天」首页，复用既有 `onSelectTab` 回调，不新增路由逻辑。
3. **W3 截断修复**：按第三节静态清单逐条裁决并修复会切字的 CSS 规则；回执附逐条裁决表。

不改任何数据、行为（除 W2 新增的点击）、文案；不改原生层；不重建 smoke 候选包。

## 一、允许改动（清单之外一律不动）

| 类型 | 文件与改法 |
|---|---|
| 恢复 | `src/ui/assets/finance/brand-wallet-sprout.svg`：用 `git show 4838fb6^:src/ui/assets/finance/brand-wallet-sprout.svg` 原样恢复，**字节级一致**（回执附恢复后文件与 `git show` 输出的 sha256 比对） |
| 修改 | `src/ui/V2HomeSurface.tsx:200-208`：`.v2-brand` 外层改 `<button type="button">`，`onClick={() => onSelectTab("TODAY")}`、`aria-label="返回今天首页"`；内部 `.v2-brand-mark` 里改渲染恢复的 svg（`<img src={brandLogo} alt="" aria-hidden="true" data-brand-logo="brand-wallet-sprout" draggable="false" />`），不再用 `FinanceIllustration kind="brand"` |
| 修改 | `src/ui/FinanceIllustration.tsx`：从 `financeArt` 映射移除 `brand` 键（含 Sprout 导入若因此未用）；组件签名不变 |
| 修改 | `src/style.css`：删除 U-10 遗留死规则 `.v2-brand-mark .finance-icon-tile[data-finance-icon="brand"]`（2771-2774 行）；按第三节裁决表修改截断规则 |
| 修改 | `src/ui/v2-surface.css`：新增按钮复位样式（`button.v2-brand { background:none; border:0; padding:0; margin:0; cursor:pointer; font:inherit; color:inherit; text-align:left; }` 与 `:focus-visible` 描边 `#129b84`）；`.v2-brand-mark img` 尺寸规则（105-108、1357-1360 行）保留生效；按第三节裁决表修改截断规则（若涉及） |
| 修改 | `tests/v2-ui/icon-unification.test.tsx`：用例 2 改为断言品牌位为按钮（`closest("button")` 存在、有 aria-label）且内含 `img[data-brand-logo]`、不含 `.finance-icon-tile`；用例 3 的 approvedTones 移除 `brand`（留存 6 键）；用例 1 不动 |
| 条件修改 | `tests/ui.test.tsx`、`tests/v2-ui.test.tsx`：仅当被上述改动破坏时同步选择器，语义不删改 |

**禁止触碰：** `src/persistence/`、`src/model/`、`src/application/`、`src/runtime/`、`src-tauri/` 全部、`package.json`、`biome.json`、`vitest.config.ts`、`src/ui/` 其余组件、`src/ui/assets/finance/` 下孤儿文件（`brand-xiaoqianjia@2x.png`、`manifest.json` 未获批删除，保持原样）、工作区未跟踪文件（`.claude/`、`pelican-bike.html`、`pelican-cycling.html` 不得提交、不得删除）。

## 二、W2 交互契约

- 点击品牌按钮 ⇒ `onSelectTab("TODAY")`（`HomeScreen.tsx:314` 已传入 `navigateTab`，`navigateTab("TODAY")` 会 `setRoute("HOME")`，链路已存在，零新增状态）。
- 已在 TODAY 时点击为幂等空操作，不得报错、不得刷新数据。
- 键盘可达：Tab 可聚焦、Enter/Space 触发（原生 button 自带）；焦点环用 `:focus-visible`。

## 三、W3 截断静态清单（逐条裁决，回执附表）

`src/style.css` 中 `white-space: nowrap` 行：**696、1407、1515、1638、1897、2963、3230、3260、3450**；`overflow: hidden` 行：**230、504、887、1044、1462、2302、2317、3502**。

`src/ui/v2-surface.css` 补充裁决行：`white-space: nowrap` **495**（`.v2-task-action`）；`overflow: hidden` + `text-overflow: ellipsis` + `white-space: nowrap` 组合 **809–811**（`.v2-recent-copy strong/small`）、**1154–1156**（`.recent-expense-detail-row small`）。KEEP 白名单补充（标 KEEP 并写理由，不得改）：v2-surface.css **53/56** 与 **761/764**（`.v2-sr-only` 视觉隐藏工具类）、**117**（`.v2-brand-mark` 圆角裁切）、**737**（`.v2-path-progress` 进度条）、**1017**（`.v2-category-track` 进度条）、**895**（`.v2-progress-list` 圆角裁切，前提是内部换行后高度自适应）、**1586/1598/1603–1604**（shell/侧栏/内容滚动容器）、**1239/1344**（overlay 滚动容器）。

裁决规则：
- 金额/数字列（tabular-nums）：保留 nowrap，但补 `text-overflow: ellipsis; min-width: 0;` 并确认父级允许收缩，不得整行裁切。
- 标签/句子/备注类：改 `white-space: normal; overflow-wrap: anywhere;`，并移除配对的 `overflow: hidden`（除非该 hidden 服务于圆角裁切且内部无文字溢出）。
- 固定高度容器内含文字且可能溢出者：改 `min-height` 语义或允许高度自适应。
- **KEEP 白名单**：视觉隐藏工具类（`src/ui/v2-surface.css` 52-58 行 clip-path inset(50%) 那段）、进度条/圆形裁切等无文字溢出者——标 KEEP 并写理由，不得改。
- 侧栏导航（`.v2-primary-nav` / `SurfaceNavButton`）：仅当能证明该布局在矮窗口下裁切标签文字时才修（修法=标签紧贴图标、去掉拉伸）；否则标 KEEP 并在回执说明"非截断来源"。**不得顺手重排侧栏视觉。**

## 三、附录 — 用户补充实例 U1–U4（Owner 2026-10-21 真机截图，与第三节同裁决流程）

截图原件已入库 `docs/u11-assets/`；图中红框为 Owner 标记：

| # | 文件 | Owner 症状 | 代码锚点 | 裁决要求 |
|---|---|---|---|---|
| U1 | `docs/u11-assets/u1-progress-rows.png` | 进展页（本月看看）看清消费/稳住现金/理清责任/建立余地四行，第 1、3 行长描述右侧被硬切、不换行无省略号 | `V2HomeSurface.tsx:772-789`（ProgressPanel）；`v2-surface.css:894-934`（`.v2-progress-list` overflow:hidden、`.v2-progress-row` flex、`.v2-progress-row-copy`、`.v2-progress-row-value` 无收缩约束）；≤720px 媒体块 1533–1559 | 360/720/840/1280 四档宽度下描述与数值均不得硬切：描述为句子类→按第三节规则允许换行；`.v2-progress-row-value` 含句子片段→同样允许换行（或 KEEP nowrap 但须证明四档宽度均不溢出）；`.v2-progress-list` 的 overflow:hidden 仅当服务于圆角裁切且内部换行后高度自适应才保留 |
| U2 | `docs/u11-assets/u2-brand-text.png` | 顶栏品牌文字「小钱家」与副标题「本地账本」logo 处字体截断 | `V2HomeSurface.tsx:200-208`；`v2-surface.css:91-148` 及 ≤720px 媒体块（mark 34px / img 38px / strong 15px / span 10px 段，约 1349–1376） | 四档宽度下两行文字完整可见：不得垂直裁切（topbar min-height/padding 须容纳两行）、不得水平硬切；W2 按钮化不得引入新裁切 |
| U3 | `docs/u11-assets/u3-amount.png` | Owner 标记最近消费行金额列（crop 内 ¥88.88 字形完整，症状为该行列间挤压关系，与 U4 同排互证）：窄宽度下金额列被挤压/裁切的风险 | `v2-surface.css:800-817`（`.v2-recent-copy` flex:1 min-width:0、`.v2-recent-row > .money-amount`）；`style.css:3232-3239`（`.money-amount` nowrap） | 金额为数字类：保留 nowrap；但须证明四档宽度下金额列完整可见（`.v2-recent-copy` 应先收缩）；能证明可被挤压则 FIX（如金额侧 flex-shrink:0），否则 KEEP 并写理由 |
| U4 | `docs/u11-assets/u4-recent-rows.png` | 最近消费行备注/日期「其他 / 2026-10-…」被截（应为 2026-10-21） | `v2-surface.css:807-812`（`.v2-recent-copy strong/small` nowrap+hidden+ellipsis） | 日期为固定 10 字符串，出现省略即列宽不足：按 FIX 处理——改 `white-space: normal; overflow-wrap: anywhere;` 并允许行高自适应（`min-height` 而非 max-height）；`strong`（分类名）同规则裁决 |

U1–U4 通用要求：裁决表须覆盖第三节 style.css 17 行 + 第三节 v2-surface.css 补充行 + U1–U4 锚点，逐条给出；jsdom 无法验证布局，每条须写静态推理链（选择器→宽度传导→结论）；视觉复验留给真包证据批（须单独批准），本批回执不得声称视觉已通过。

## 四、测试要求

- 既有 3 例按第一节同步后仍全过；全量 **403 + 0 净增**（本批不新增测试文件，如你认为必须新增先 RETURN 请示）。
- `describe.skip` 区块保持 skip。

## 五、验证命令

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
git show 4838fb6^:src/ui/assets/finance/brand-wallet-sprout.svg | shasum -a 256
shasum -a 256 src/ui/assets/finance/brand-wallet-sprout.svg   # 两值须一致
env NODE_ENV=test npx vitest run tests/v2-ui/icon-unification.test.tsx tests/ui.test.tsx tests/v2-ui.test.tsx --reporter=verbose
env NODE_ENV=test npx vitest run --reporter=dot   # 403 passed / 0 failed / 80 skipped
npm run typecheck
npm run lint
npm run build
```

## 六、证据与边界

- 本批**不重建 smoke 候选包、不碰任何原生层**；真包内视觉复核（logo 复原目视、点击回首页、截断复验）另立证据批，**须用户单独批准**（门控同 L-03），不得夹带。
- 回执附：改动文件清单与 `git show --stat`、svg 哈希比对、W3 逐条裁决表（行号→KEEP/FIX→改法→理由，**须覆盖第三节 v2-surface.css 补充行与第三节附录 U1–U4 锚点，每条附静态推理链**）、专项/全量/typecheck/lint/build 结果、HEAD、`git status --short`。

## 七、提交

逐一 `git add` 显式路径，禁止 `git add -A`。
提交信息：`build-47: U-11 — restore brand logo, brand click-to-home, truncation sweep`

## 八、红线（违反即 RETURN）

1. 禁止安装新依赖、禁止网络请求。
2. 禁止启动/构建/修改 production 身份；不运行不带 `:smoke` 后缀的 tauri 构建；不改 `src-tauri/` 任何文件。
3. 禁止 schema 变更；禁止改数据层与 V1 冻结层。
4. 测试命令必须带 `env NODE_ENV=test`。
5. 禁止提交/删除未跟踪文件；禁止 `git add -A`；禁止删除孤儿资产。
6. 允许清单与 W3 裁决规则之外的一切「顺手优化」一律 RETURN 请示。

## 九、回执格式

同 `EXEC-LANDING-INSTRUCTIONS.md` 第八节，另加 svg 哈希比对与 W3 裁决表。