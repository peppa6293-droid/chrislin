# F-08 参考资产返工报告｜超额标记 A 落地（2026-10-28）

**状态：`READY_FOR_REVIEW`（段 1 交付，待审核员 / 验收员复核）。**
本报告不构成视觉验收通过，也不构成产品实现依据。总结论仍为 `PASS_WITH_CONDITIONS`；F-06 部分通过、`OPEN-F6` 三项与读屏实测均未因此改变。

## 1. 授权依据与范围

- 依据：`docs/WP-UI-VISUAL-01-P1-P4-EXECUTION-TASKBOOK-20261028.md` §13「O-4 F-08 已授权（参考资产，范围见 §7）；先于 P1 实现执行并经验收员复核」、§14.3「放行段 1（F-08 参考资产）」。
- 允许：`app.js`、`styles.css`、`renders/` 相关超额态图；移除红色斜纹超额弧，按 A 在明细行旁加固定短标记 + 完整数值。
- 禁止并已遵守：不改 `src/` 与 `tests/`、不改 F-01～F-07 已验收内容、不新增可见文案（只复用资产内既有词）、不混入 `CANDIDATE/` 内容、不新增产品页面或入口。
- 生产库 / 真实支付 / 跨月生产操作：零触碰。

## 2. 修改前基线（先留基线再改）

`baseline/` 为改前原样副本，`baseline/SHA256.txt`：

| 文件 | SHA256 |
|---|---|
| `app.js` | `066213d145d718b3f26f6eb5382046d524dd91cd13a1cf5d8fcb31d74519a2a5` |
| `styles.css` | `5f28ac3ef550ea76ce237368c8015af64e18f0c77004123b7c6be865235a66f4` |
| `fixed-v3-source.html` | `2297d0d0f2564170c66b8b1b64f146474a64f49ac4ffb4fc359270c9663000ba` |
| `index.html` | `5e10f35a0bf309745ee919f8580dde7c2271971a640f03ff4ce4a3837c8aec63` |

`styles.css` 改前值与本项目 C-1 更正后的终值一致（`5f28ac3e…`），未被本轮覆盖。

## 3. 改后哈希

| 文件 | SHA256 |
|---|---|
| `app.js` | `cdf8a40efb0521b9d7aea3793b76183ca3e171aef4ca8bdc87c38ad5e5f116b0` |
| `styles.css` | `04fcef76bbc10697b468c6f3564579883963a3d629f11c3638c1209e2ff0f873` |
| `README.md` | `292adcff1c8942191a2c7da0b5772f55edeb5a8d3c433c09ef7304168771859c` |
| `handoff.md` | `11efe9e969d5e03fa72387eb2fc72a3b171c541135088703637f180896753691` |
| `modified-files.md` | `64226a0778720c51167dc8be00db2d215de3e469b90a277cc50dba16846c16ff` |
| `renders/README.md` | `d23a8b3712ee0073534f611c79862db82bdaf1d314c0bb33c8de6ff52cf92f38` |

未改：`fixed-v3-source.html`、`index.html`、`screenshots.html`、`verification/*`、`tools/render-and-verify.mjs`、`tools/protect-source.mjs`、`renders/legacy-20261027/*`、`CANDIDATE/*`、`archive/*`。

## 4. 实现内容（逐条对应 A 文字规格）

| A 规格 | 本资产落地 |
|---|---|
| 3×14 CSS px、圆角 2px、固定大小 | `.overage-mark{width:3px;height:14px;border-radius:2px}`；实测 120% 与 230% 两态同尺寸（断言 `marker-size-3x14`） |
| 位于对应明细金额左边、间隔 8px | 标记为 `.legend-row b` 内联首元素，`margin-right:8px`；断言标记右缘 ≤ 百分比文字左缘 |
| 只有该环 >100% 才出现 | `ringDetailRow()` 以该环自身比例判断；`over-outer` 外环 120% 有、内环 81.8% 无 |
| 不随 120%→230% 加长 / 不叠圈 | 主弧 `min(1,ratio)`，230% 仍只画一圈、标记仍一根 3×14 |
| 两环都超额时两行分别出现 | `over-both`（外 120% / 内 120%）→ 2 个标记、2 条超额行 |
| 「已超出 ¥…」在对应明细下一行深色呈现，不做红色小字 | `.overage-note` 12.5px、`#1B292A`（白底 15.03:1），允许换行、右对齐 |
| 无感叹号、三角、徽章、红底条 | `.chart-card` 内仅保留环 SVG；断言 `no-warning-icon-in-chart` |
| 不把整体超载金额挂到单环 | 删除环下 `.chart-warning`「已超出」横幅；整体超载只由主卡负结构余量 + 负比例表达 |
| 与圆环关联靠名称 / 点击强调，不在环上叠标记 | 标记只出现在「固定负担」「消费」两行；环面不加任何标记 |
| 高对比、图形不承担唯一信息 | `#C2503C`/白 **4.66:1**、`#C2503C`/页面底 `#F4F6F6` **4.30:1**；百分比与金额均为深色文字，颜色不是唯一线索 |

可访问名称同步：`.double-ring` 的 `aria-label` 由「固定负担 X，消费 Y，已超出 Z（合计）」改为**按环各自附超额金额**，例如 `固定负担 120%，已超出 ¥2,600.00，消费 81.8%`；整体超载金额不再出现在环的可访问名称里。

文字方面**没有新增句子**：`固定负担` / `消费` / `已超出` / `¥…` 均为资产内既有词（被删除的环下横幅原文即「已超出 ¥X」），标记本身 `aria-hidden="true"`、不承载读数。

新增的 `over-outer` / `over-both` / `over-large` 三个夹具态**只出现在 `?view=review` 审核工具栏**，属外部审核工具，不是产品新增状态或入口；数值为隔离合成夹具。

## 5. 四态覆盖矩阵（任务书 §7 验收项）

| §7 要求 | 结果 | 证据 |
|---|---|---|
| 单环超额 | ✅ 外环 120%，仅该行有标记 + `已超出 ¥2,600.00` | `after/after-home-over-outer-{390,760,980}.png` |
| 双环超额 | ✅ 两环各 120%，两行各一标记 + `¥2,600.00` / `¥220.00` | `after/after-home-over-both-*.png` |
| >200% | ✅ 230%，主弧一圈，文字 `230%` + `已超出 ¥13,000.00` | `after/after-home-over-large-*.png` |
| 70%+40% 仅整体超载、两环都不加标记 | ⚠️ **本资产现有环口径无法表达** | 见下 |

**为什么第 4 态不可表达（不擅自改环口径）**：本资产外环定义是「固定负担 = 固定支出 + 月供」，`outer=(fixed+debt)/income`；70%+40% 在该环上就是 110%，必然触发外环标记。要literal复现「两环各未超额、只有整体超载」，必须先按 B-01 把双环改成「外环=固定支出÷收入、内环=必须偿还月供÷收入」。这属于换环口径，不在 §7「允许」列表内，因此**未做**，也未用近似态冒充。

两条可选处置（请裁决，我不自行选择）：
1. **授权 F-09**：把参考资产双环切到 B-01 映射（外环固定支出、内环月供），再补该态截图；F-08 的标记机制无需改动。
2. **接受替代证据**：`over-outer` 已证明「整体为负、未超额的那一环不加标记、整体金额不挂环」；`zero-burden` / `roomy` 证明无超额时 0 标记。但严格说这不等于 §7 第四态原图。

## 6. 断言结果（before / after）

- 工具：`tools/verify-f08.mjs`（隔离 Chrome 临时 profile；无网络请求、无 JS 异常）。每次运行 7 个首页态 × 390/760/980 + 固定支出页 3 宽。
- **after：24/24 通过，0 失败，`exceptions=0`，`remoteRequests=0`。**
  - `no-legacy-stripes-or-pattern`（无 `excess-arc` / `excess-stripes` / `pattern` / `chart-warning`）
  - `marker-count`、`marker-size-3x14`、`marker-color-c2503c`、`marker-radius-2`、`marker-decorative`
  - `marker-left-of-amount`、`notes-text`、`notes-not-clipped`、`amount-not-clipped`
  - `single-lap-arcs`（`stroke-dasharray` 首段 ≤ 周长）、`aria-label`、`no-warning-icon-in-chart`
  - `no-horizontal-overflow`（`documentElement.scrollWidth ≤ 视口宽+1`，且无元素右缘越界）
  - 固定支出页：`summary-ring-name-kept`（所选月份已付占比）、`pay-button-kept`、无溢出 —— F-01～F-07 未被回归破坏。
- **before：9 次运行 3 通过 / 18 失败，失败项即本轮要消除的旧画法**（斜纹 / `pattern` / 环下横幅 / 无标记 / 旧 aria），因此 before 报告保留原样作为对照，不改写成通过。
- 复核入口：`after/after-report.json`、`before/before-report.json`。

## 7. 对比度（脚本内实测计算）

| 前景 | 背景 | 用途 | 比值 |
|---|---|---|---|
| `#C2503C` | `#FFFFFF`（卡片底） | 标记本体 | **4.66:1** |
| `#C2503C` | `#F4F6F6`（页面底） | 标记最差背景 | **4.30:1** |
| `#1B292A` | `#FFFFFF` | 「已超出 ¥…」文字 | **15.03:1** |
| `#286D65` | `#FFFFFF` | 环必要边界（F-04 保留） | **6.06:1** |

标记只作图形、不作唯一信息载体；`#C2503C` 未用于 12.5px 正文。真实背景 / 焦点态 / 选中态的产品侧实测仍按 P1 要求在实现阶段做，本报告不代替。

## 8. 证据清单

```
p1-p4/f08-20261028/
├── baseline/            改前 app.js / styles.css / 两个 html + SHA256.txt
├── before/              9 张 before 图 + before-report.json
├── after/               21 张首页态 ×3 宽 + 3 张固定支出页 + 1 张审核视图 + after-report.json + SHA256.txt
├── tools/verify-f08.mjs 本轮独立断言工具（不改资产、不写产品目录）
└── F08-REPORT.md        本文件
```

复现（只读资产、只写证据目录）：

```bash
cd evidence/wp-ui-visual-01/p1-p4/f08-20261028/tools
node verify-f08.mjs --root "/Users/linte/Documents/ChatGPT/小钱家-新/小钱家V3_WP-UI-VISUAL-01_设计参考资产" \
  --out ../after --label after
```

before 复现：用 `baseline/` 的 4 个文件组成临时根目录，`--label before --states overload,roomy`。

## 9. 未决 / 未做（不得当作已通过）

1. **§7 第四态（70%+40% 仅整体超载）**未出图，原因见 §5，需授权或替代裁决。
2. **200% 文字放大时中心收入侵入圆环**：F-08 未触碰中心文字，问题原样存在；未缩字、未移位、未隐藏金额。仍按任务书列为 P1/P4 阻断项。
3. **OPEN-F6**（原生日期弹层 / iOS 动态字体 / 真实软键盘）与**读屏实测**：不在 F-08 范围，未做，仍 OPEN。
4. 参考资产双环仍是旧口径（外环=固定负担合计、内环=旧「消费进度」），`README`/`handoff`/工具栏注记均保留该声明；F-08 只落标记形态。
5. `tools/render-and-verify.mjs` 是 v2 期工具，内含旧「overflow arc」断言；本轮**未运行、未修改**（运行会覆盖 `codex-revision-v2/` 旧证据）。F-08 断言以 `tools/verify-f08.mjs` 为准。
6. 未提交 git；未改 `src/`、Financial Model、生产库、授权文件（`git status -- src tests` 为空）。
