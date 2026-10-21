# EXEC-U12 执行指令（build-48：Owner 截断实例 U1–U4 修复 + build-47 裁决表补交）

**角色：** 执行者
**基线：** HEAD `b4f0525`（plan 附录提交）/ 代码基线 `ea798c0`（build-47 已验收代码门）；全量基线 **403 passed / 0 failed / 80 skipped**
**日期：** 2026-10-21
**批准：** Owner 于 2026-10-21 补充四张真机截断截图（U1–U4，原件入库 `docs/u11-assets/`），属用户验收反馈，与 U-11 同源授权，无需再澄清；U1–U4 之外的新实例仍另批追加，不得自行扩范围。

---

## 〇、目标

1. **U1–U4 修复**：按第二节逐条把 Owner 截图中的截断/挤压修掉（构造性修法：让文字可换行、让数字列不被挤压），回执附逐条裁决与静态推理链。
2. **补交裁决表**：build-47 的 W3 裁决表未送达审核员。本批回执须补交**完整**裁决表：build-47 静态清单中所有标 KEEP 的行（style.css 八处 `overflow: hidden`：230、504、887、1044、1462、2302、2317、3502；以及 nowrap 第九行 `.money-amount` 基规则，约 3232–3240 行）+ 本批 U1–U4 全部锚点行，逐条 KEEP/FIX + 改法 + 理由。
3. 不改任何数据、行为、文案；不改原生层；不重建 smoke 候选包。

## 一、允许改动（清单之外一律不动）

| 类型 | 文件与改法 |
|---|---|
| 修改 | `src/ui/v2-surface.css`：仅第二节列出的规则；新增规则必须挂在既有选择器上，不得新建类名 |
| 条件修改 | `src/style.css`：**仅当** `.money-amount` 基规则（约 3232–3240 行）缺 `text-overflow: ellipsis` 时补上（nowrap 保留）；若已有则标 KEEP 附理由，不得改 |
| 条件修改 | `tests/v2-ui.test.tsx`、`tests/v2-ui/*.test.tsx`：仅当被 CSS/标记改动破坏时同步选择器，语义不删改 |

**禁止触碰：** 一切 `.tsx` 组件源码（U1–U4 一律用 CSS 解决；若你认定某条必须改标记才能修，先 RETURN 请示）、`src/persistence/`、`src/model/`、`src/application/`、`src/runtime/`、`src-tauri/` 全部、`package.json`、`biome.json`、`vitest.config.ts`、`src/ui/assets/finance/` 下孤儿文件、工作区未跟踪文件。

## 二、U1–U4 目标状态与裁决要求

通用：jsdom 无布局能力，每条须写静态推理链（选择器→盒模型/宽度传导→结论）；视觉复验留给真包证据批（须 Owner 单独批准），回执不得声称视觉已通过。四档推理宽度：360 / 720 / 840 / 1280。

| # | 症状（Owner 截图） | 锚点 | 目标状态 |
|---|---|---|---|
| U1 | 进展页四行（看清消费/稳住现金/理清责任/建立余地）描述单行右切 | `v2-surface.css` `.v2-progress-row`(898)、`.v2-progress-row-copy`(925)、`.v2-progress-row-value`(931)、`.v2-progress-row small`(145)、`.v2-progress-list`(894 overflow:hidden)、≤720 媒体块 1533–1559 | 描述与数值在四档宽度均不得单行硬切：给 `.v2-progress-row small` 与 `.v2-progress-row-value` 显式 `white-space: normal; overflow-wrap: anywhere;`（value 保留 `font-variant-numeric: tabular-nums`）；`.v2-progress-list` 的 `overflow: hidden` 仅当服务于圆角裁切且行高自适应时 KEEP，否则移除 |
| U2 | 顶栏「小钱家 / 本地账本」副标题疑似垂直裁切 | `v2-surface.css` `.v2-topbar`(60)、`.v2-brand`(91)、`.v2-brand > div`(127)、`.v2-brand strong`(133)、`.v2-brand span`(138)、≤720 媒体块对应段 | 先举证：列出所有可能对品牌两行文字施加 height/max-height/overflow/line-height 压缩的规则；若确无裁切来源则标 KEEP 并写「非截断来源」推理链（副标题为 muted 浅色，勿与裁切混淆）；若找到裁切来源则 FIX（高度自适应、不得垂直 clip） |
| U3 | 最近消费金额列窄宽度下被挤压风险 | `v2-surface.css` `.v2-recent-copy`(800 flex:1 min-width:0)、`.v2-recent-row > .money-amount`(814) | 金额永不挤压：给 `.v2-recent-row > .money-amount` 加 `flex-shrink: 0;`（nowrap 保留，来自 `.money-amount` 基规则）；备注列先收缩（已具备 min-width:0） |
| U4 | 最近消费备注/日期「2026-10-…」被切（应为 2026-10-21） | `v2-surface.css` `.v2-recent-copy strong/small`(807–812 nowrap+hidden+ellipsis)、`.v2-recent-row`(779 min-height:62) | 日期为固定 10 字符，出现省略即列宽不足：改 `white-space: normal; overflow-wrap: anywhere;`，移除该对的 `overflow: hidden` 与 `text-overflow: ellipsis`；行高自适应（`min-height` 保留、不得改 max-height/height）；`strong`（分类名）同规则 |

KEEP 白名单（标 KEEP 写理由，不得改）：`.v2-sr-only`(48–58)、`.v2-brand-mark`(112 圆角裁切)、`.v2-path-progress`(735)、`.v2-category-track`(1015)、shell/侧栏/内容滚动容器(1586/1598/1603–1604)、overlay 滚动容器(1239/1344)、`.v2-task-action`(489–496 nowrap，按钮文字短且居中，四档宽度推理不溢出才 KEEP)。

## 三、测试要求

- 不新增测试文件；全量 **403 + 0 净增**；`describe.skip` 区块保持 skip。
- 如你认为必须新增测试先 RETURN 请示。

## 四、验证命令

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
env NODE_ENV=test npx vitest run --reporter=dot   # 403 passed / 0 failed / 80 skipped
npm run typecheck
npm run lint
npm run build
```

## 五、证据与边界

- 本批**不重建 smoke 候选包、不碰任何原生层**；真包内视觉复验（U1–U4 + logo 复原 + 点击回首页）另立证据批，**须 Owner 单独批准**（门控同 L-03），不得夹带。
- 回执附：改动文件清单与 `git show --stat`、**完整裁决表**（第〇节第 2 条范围，行号→KEEP/FIX→改法→理由→四档宽度推理链）、专项/全量/typecheck/lint/build 结果、HEAD、`git status --short`。

## 六、提交

逐一 `git add` 显式路径，禁止 `git add -A`。
提交信息：`build-48: U-12 — truncation fixes for owner instances U1-U4`

## 七、红线（违反即 RETURN）

1. 禁止安装新依赖、禁止网络请求。
2. 禁止启动/构建/修改 production 身份；不运行不带 `:smoke` 后缀的 tauri 构建；不改 `src-tauri/` 任何文件。
3. 禁止 schema 变更；禁止改数据层与 V1 冻结层。
4. 测试命令必须带 `env NODE_ENV=test`。
5. 禁止提交/删除未跟踪文件；禁止 `git add -A`；禁止删除孤儿资产。
6. 允许清单与第二节裁决规则之外的一切「顺手优化」一律 RETURN 请示。

## 八、回执格式

同 `EXEC-LANDING-INSTRUCTIONS.md` 第八节，另加第〇节第 2 条完整裁决表。
