# F-09 执行报告｜双环对齐 B-01（2026-10-28）

范围依据：`docs/WP-UI-VISUAL-01-P1-P4-EXECUTION-TASKBOOK-20261028.md` §15（审核员 F-08 复核、C-4 / C-5、§7 第四态裁定「选项 1，授权 F-09，不收替代证据」、§15.3 六条）。
执行对象：`/Users/linte/Documents/ChatGPT/小钱家-新/小钱家V3_WP-UI-VISUAL-01_设计参考资产`。
本报告只陈述可独立复核的事实；未做的项在 §6、§7 单列，**不得**据此认为 P1–P4 已实现或视觉总验收已通过。

结论一句话：§15.3 六条已逐条落地并通过自检（36 次渲染 / 675 条断言 / 0 失败 / 0 异常 / 0 远程请求），C-4、C-5 已修；**200% 字体压力未修、OPEN-F6 与读屏未做、F-06 仍为部分通过、产品代码仍未授权**，总结论维持 `PASS_WITH_CONDITIONS`。请审核员复核后再放行段 2。

---

## 1. 改前基线（未覆盖任何既有证据）

`baseline/` 为改动前原样副本，SHA256 见 `baseline/SHA256.txt`：

| 文件 | 改前 SHA256 | 与 F-08 after 的关系 |
|---|---|---|
| `app.js` | `cdf8a40efb0521b9d7aea3793b76183ca3e171aef4ca8bdc87c38ad5e5f116b0` | 与 F-08 交付完全一致（同字节） |
| `styles.css` | `04fcef76bbc10697b468c6f3564579883963a3d629f11c3638c1209e2ff0f873` | 与 F-08 交付完全一致（同字节） |
| `index.html` | `5e10f35a0bf309745ee919f8580dde7c2271971a640f03ff4ce4a3837c8aec63` | 未改 |
| `fixed-v3-source.html` | `2297d0d0f2564170c66b8b1b64f146474a64f49ac4ffb4fc359270c9663000ba` | 未改 |

因此 F-08 的 `after/` 截图集合就是 F-09 的改前视觉证据（同一字节的 app.js / styles.css 生成），F-09 未重跑、未改写、未覆盖 `f08-20261028/` 任何文件。

改前静态事实（对 `baseline/` 计数，可 `grep -o | wc -l` 复算）：

| 关键字串 | baseline/app.js | baseline/styles.css | 改后资产 |
|---|---:|---:|---:|
| `.overflow-summary` | 1（主卡 ⓘ 块） | 6 | **0 / 0** |
| `.category-extra` | 1（红色斜纹条） | 1 | **0 / 0** |
| `固定负担` | 6（旧环口径与 aria） | — | 1（仅注释层 B-01 定义句） |
| `消费` | 5（旧内环、aria、注释） | — | 2（模块标题「消费」+ 注释层说明「消费进度不再入环」） |
| `d.fixed+d.debt`（外环=固定负担合计） | 5 | — | **0** |
| `over-split` | 0 | — | 2（夹具 + 工具栏标签） |
| `必须偿还月供` | 1 | — | 6（明细行、零收入行、aria） |

---

## 2. §15.3 六条逐条交付

### 条目 1｜双环对齐 B-01，消费移出圆环

- `app.js:124-146` `ringChart()`：外环 `outer = d.fixed / d.income`、内环 `inner = d.debt / d.income`、中心 `收入` + `shortMoney(d.income)`。旧式 `(d.fixed + d.debt) / d.income` 与 `d.spend / d.budget` 已全部移除（`d.fixed+d.debt` 5→0）。
- 环 aria 逐字为「固定支出 X%，[已超出 ¥…，]必须偿还月供 Y%[，已超出 ¥…]」，超额金额只跟在**该环自己**后面；明细行与 aria 均不再出现「消费」。
- 零收入态不再合并口径：仍不画比例、不显示百分比，但改为两行分别列「固定支出 ¥…」「必须偿还月供 ¥…」。
- 断言：`aria-label` 27/27 逐字匹配、`ring-has-no-spend-word` 27/27、`center-is-income` 27/27（含零收入 `¥0`、待确认 `待确认`）。

### 条目 2｜明细行「名称＋金额＋占收入 X%」，A 标记锚定金额左侧 8px

- `app.js:119-122` `ringDetailRow(swatch, label, amount, ratio, overAmount)`：行结构改为「名称 / 金额 / 占收入 X%」，标记放在**金额文本节点之前**（不再是百分比之前），`「已超出 ¥…」` 仍在下一行、`#1B292A`、12.5px、右对齐。
- `styles.css` 新增 `.legend-name` / `.legend-value` / `.legend-amount`（22px、tabular-nums）/ `.legend-share`；行允许换行、不截断。
- 实测（`after-report.json` → `rows[].marker`）：390 / 760 / 980 三宽下标记 **3.0 × 14.0 px、`rgb(194, 80, 60)`、`border-radius:2px`、`aria-hidden="true"`、与金额文本间隙 8.00 px**（`marker-left-of-amount-8px` 容差 ±1.5px，实测全部 8.00）。
- C-5 闭环证据：断言 `marker-left-of-amount-8px` 27/27；`row-name-amount-share` 27/27（名称、金额、占收入三段逐字匹配）。

### 条目 3｜删除主卡 `.overflow-summary`（C-4）

- 删除 `homePage()` 中 `over` 变量与 `ⓘ 已超出` 整块；`styles.css` 同步删除基础规则与 ≤620 规则（6 处引用归零）。
- 整体超载现在只表现为**主卡负结构余量 + 负比例**：如 `overload` = `−¥3,000.00` / `占收入 -23.1%`，`over-split` = `−¥1,300.00` / `占收入 -10%`；页面任意宽度都不再出现该块。
- 断言：`no-overflow-summary-block` 27/27；`surplus-value`、`ratio-value` 27/27。

### 条目 4｜70%+40% 夹具 + 四态 × 390/760/980 截图

新增夹具 `over-split`：`income 13000 / fixed 9100 / debt 5200`，即外环 70%、内环 40%、两环均 ≤100%、无标记；主卡 `−¥1,300.00` / `占收入 -10%`（整体 110%）。旧夹具按新口径重设，避免「固定负担合计」时代的数值继续冒充：

| 态 | 收入 | 固定支出 | 必须偿还月供 | 外环 | 内环 | 标记 | 主卡 |
|---|---:|---:|---:|---:|---:|---:|---|
| `over-outer` | 13,000 | 15,600 | 2,600 | 120% | 20% | 1 | −¥5,200.00 / −40% |
| `over-both` | 13,000 | 15,600 | 15,600 | 120% | 120% | 2 | −¥18,200.00 / −140% |
| `over-large` | 10,000 | 23,000 | 1,000 | 230% | 10% | 1 | −¥14,000.00 / −140% |
| `over-split` | 13,000 | 9,100 | 5,200 | 70% | 40% | **0** | −¥1,300.00 / −10% |

- 第四态实测 aria：`固定支出 70%，必须偿还月供 40%`；两行 `占收入 70%` / `占收入 40%`；无 `.overage-note`；负余量与负比例均在主卡。**§7 第四态在本资产口径下已可表达并通过**，F-08 §5 的历史限制只作历史记录保留，不回写。
- 230% 仍是**一圈封顶**（`single-lap-arcs` 27/27，`stroke-dasharray` 首段 ≤ 周长 + 0.6），完整 230% 与 `已超出 ¥13,000.00` 在对应行同组可见。
- 截图：`after/after-home-{over-outer,over-both,over-large,over-split}-{390,760,980}.png` 共 12 张；另含 `overload`（90.8%+32.3% 仅整体超载）、`roomy`、`light-over`、`zero-burden`、`pending` 作对照。

### 条目 5｜删除固定支出页 `.category-extra` 红色斜纹

- 删除 `fixedCategories()` 中斜纹条节点与 `styles.css` 的 `repeating-linear-gradient` 规则（1→0 / 1→0）。
- 超计划不再有任何新视觉（无红条、无徽标、无感叹号）：`通勤 已付 ¥1,125.00 / 计划 ¥900.00` 只保留满格实心条与 B-03 已签认文字「超计划 ¥225.00 · 已付/计划 125%」。`zero-plan` 走 B-03「计划 ¥0 不显示比例」分支，不产生 `Infinity%`。
- 一并清除审核层两处已过期的 `PENDING_OWNER_DECISION`（B-03 已于 2026-10-28 签认），改为已签认措辞；只动审核层文字，未新增产品视觉。逐字 B-03 的整页版式仍属 P2。
- 断言：`no-hatching-on-fixed-page` 9/9（normal / overpaid / zero-plan × 三宽）、`b03-overpaid-wording` 3/3、`b03-zero-plan-wording` 3/3。

### 条目 6｜F-01～F-08 不回归；200% 不修

回归探针（同一隔离 Chrome，实测值）：

| 探针 | 结果 | 判定 |
|---|---|---|
| F-01 折叠摘要由实际日期/备注生成 | `支付日期 2026-10-27 · 备注 地铁月卡` | 通过 |
| F-03 `aria-controls` 指向真实容器 | `payment-details` 存在；展开 `hidden=false`/`aria-expanded=true`，收起 `hidden=true` | 通过 |
| F-05 390 首模块 y | **796.6**（与 F-05 签认值一致；双环区卡片 273，主卡 357.6） | 通过 |
| F-06 320 高视口提交按钮 | 按钮 bottom **303** < 320 | 通过 |
| F-02 摘要环可见名称 | `所选月份已付占比`（固定支出 normal × 三宽） | 通过 |
| 固定支出「记一笔」 | 存在且可开面板 | 通过 |

- 为守住 F-05 的 796.6，≤620 只压缩**空间**、未缩字：`chart-card` 纵向内边距 10/14 → 8/8、`.ring-detail` gap 8→6 / margin-top 6→4、`.legend-amount` `line-height:1`；22px 金额字号未降。实测双环区卡片 273px、首模块 796.6，与 F-05 记录逐像素一致。
- 200% 字体压力**未修**：未缩字、未移位、未隐藏金额，中心收入侵入圆环的问题原样存在（P1/P4 阻断项，见 §6）。

---

## 3. 断言与运行记录

- 工具：`tools/verify-f09.mjs`（沿用 F-08 的 CDP 隔离 Chrome 方案：临时 `--user-data-dir`、`Page.captureScreenshot`、无网络）。断言表为独立手写的 B-01 期望值，不读 `app.js` 常量。
- 运行：`node verify-f09.mjs --root <资产目录> --out ../after --label after`
- 结果（`after/after-report.json`）：**36 次渲染 / 675 条断言 / 29 类检查 / 0 失败 / 运行时异常 0 / HTTP(S) 请求 0**。
  - 首页 9 态 × 3 宽 = 27 次；固定支出页 normal、overpaid、zero-plan × 3 宽 = 9 次。
  - 每态含：无旧斜纹/`<pattern>`、无 `.overflow-summary`、无 `.category-extra`、标记数量/尺寸/颜色/圆角/装饰性/左侧 8px、逐行「名称+金额+占收入」、`已超出` 文案与不截断、aria 逐字、环内无「消费」、中心=收入、负余量与负比例、弧长单圈、无警示图标、无横向溢出、干净视图无审核控件。
- 对比度（脚本内复算，非引用旧表）：标记 `#C2503C` 对白 4.66:1、对页面底 `#F4F6F6` 4.30:1；金额 `#1B292A` 对白 15.03:1；`占收入` 次级文字 4.97:1；外环状态线 `#286D65` 对白 6.06:1。标记为纯装饰（`aria-hidden`），语义由文字与 aria 承担。
- 截图：`after/` 36 张，`after-report.json` 逐张记录 `state / width / height / checks`；`after/SHA256.txt` 为改后交付文件哈希。

改后哈希：

| 文件 | 改后 SHA256 |
|---|---|
| `app.js` | `af9340b39dac65c5798e29770d37000ff4435f1f061df3eb595cb2a43c6fcbd3` |
| `styles.css` | `dea4775e6b5e33e5e805d74d4a629d79c97b82cb0f2e67ee5c70a759a8be4037` |
| `index.html` | `5e10f35a0bf309745ee919f8580dde7c2271971a640f03ff4ce4a3837c8aec63`（未改） |
| `fixed-v3-source.html` | `2297d0d0f2564170c66b8b1b64f146474a64f49ac4ffb4fc359270c9663000ba`（未改） |
| `README.md` | `86d9bb7505995032c586b819b9df02321854cd93f6d2039f88d512df7dd5ea9c` |
| `handoff.md` | `ac753a4f04d365d6a6d38b0eb47558cd824033baec5fbc428e087d53f75a82f3` |
| `modified-files.md` | `47ee39306ceb2b3a67f9f0d7cfcce47f391c2b9c0c939d4a1c962b3b0a75624b` |
| `renders/README.md` | `f17ef5305e3c3e18ca8cda2f324036f0de58eaee39934da9d8e5a25f300d2a0b` |

---

## 4. 目检（非替代断言）

逐张看过并在报告中只描述可见内容：

- `after-home-over-split-{390,760,980}.png`：两环分别为 70% / 40%，无红色标记、无「已超出」行；主卡 `−¥1,300.00` / `占收入 -10%`。
- `after-home-over-outer-390.png`：`▏¥15,600.00`（标记紧贴金额左侧，8px）、`占收入 120%`、下一行右对齐 `已超出 ¥2,600.00`；外环整圈、内环 20%。
- `after-home-over-both-390.png`：两行各有一个标记、各有一行超额文字；两环都是整圈。
- `after-home-over-large-390.png`：230% 仍只有一圈，`已超出 ¥13,000.00` 可见，无感叹号/三角/红横幅。
- `after-home-overload-390.png`：两环都未超 100%、无标记，整体超载只由主卡 `−¥3,000.00` / `-23.1%` 表达——旧 ⓘ 块确已消失。
- `after-home-zero-burden-390.png`：无弧、无百分比，两行金额分列。
- `after-fixed-overpaid-390/760/980.png`、`after-fixed-zero-plan-390/760/980.png`：无红色斜纹，只剩 B-03 已签认文字。
- 已知截图习惯：完整长图会带固定底部导航，category 候选两态改用 1900 高视口截图以免导航压住文字；这是出图设置，不是布局改动。

---

## 5. 与审核裁定的对应

| 裁定 | 处置 |
|---|---|
| C-4（主卡 ⓘ 块仍在，报告措辞不成立） | 已删节点 + 删样式，`no-overflow-summary-block` 27/27；F-08 报告未改写，作为历史记录保留 |
| C-5（标记锚在百分比而非金额） | 行结构改「名称+金额+占收入」，标记锚定金额、间隙实测 8.00px，27/27 |
| §7 第四态「选项 1」 | 环口径切 B-01、补 `over-split` 夹具、三宽出图并通过；未使用替代证据 |
| §15.3 六条 | 逐条完成，见 §2 |
| 只改 `app.js`、`styles.css`、`renders/`、README/handoff 记录 | 实际改动 = `app.js`、`styles.css`、`README.md`、`handoff.md`、`modified-files.md`、`renders/README.md`；`index.html`、`fixed-v3-source.html`、`screenshots.html`、`verification/`、`tools/render-and-verify.mjs`、`CANDIDATE/`、`renders/legacy-20261027/` 未动 |
| 不新增可见文案，只用冻结术语 | 环内只出现「固定支出」「必须偿还月供」「已超出」「收入」四个已冻结词，以及条目 2 字面要求的「占收入 X%」（主卡既有 `.ratio` 本来就在用「占收入 -40%」，非新造词）；无新句子。B-03 分支正文沿用已签认结构，「B-03 已签认」是审核层前缀，不是产品文案 |

---

## 6. 未做 / 原样保留（不得解读为通过）

1. **200% 字体压力未修**：中心收入侵入圆环仍存在；未缩字、未移位、未隐藏金额。仍为 P1/P4 阻断项。
2. **零长度 dash 的起点圆点**：`ringStroke()` 用 `stroke-linecap:round`，比例为零或未知（零收入、待确认）时主弧长度 0 仍在起点渲染一个圆点。该行为在 F-01～F-08 期间已存在，F-09 未改，登记为 P1 实现须处理项（B-02「零收入不画弧」「待确认不加起点色点」）。
3. **首页事实行仍写「月供」**：§15.3 条目 1 只覆盖圆环明细与环 aria，未授权改首页事实行；若要统一为 B-01 术语「必须偿还月供」，需在 P2 明确。
4. **B-03 整页版式仍属 P2**：本资产只删了斜纹、清了过期标签、按已签认口径改了两条分类文字；整页汇总联动、逐字版式未在本段实现。
5. **OPEN-F6 未闭合**：原生日期选择器、iOS 动态字体、真机软键盘，以及读屏（VoiceOver）验证均未做；F-06 仍为「部分通过」，不得改写为通过。
6. **产品实现未授权**：`src/`、`tests/`、生产库、真实支付、授权文件零触碰；`git status --porcelain -- src tests` 为空，无 git 提交。本资产不是实现依据。
7. **Q-1 / Q-2 仍待 chris**：P1-b 与 P4「上月」继续阻断，F-09 不涉及。

---

## 7. 复现

```sh
cd "/Users/linte/Documents/ChatGPT/小钱家-新/个人财务模型app开发项目 2/evidence/wp-ui-visual-01/p1-p4/f09-20261028/tools"
node verify-f09.mjs \
  --root "/Users/linte/Documents/ChatGPT/小钱家-新/小钱家V3_WP-UI-VISUAL-01_设计参考资产" \
  --out ../after --label after
```

脚本每次新建临时 Chrome profile，只打开本地 `file://` 页面；结束打印 `total / passed / failures / regression / exceptions / remoteRequests / contrast`，并写 `after/after-report.json`。
