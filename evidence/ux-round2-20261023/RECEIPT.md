# 回执 · EXEC-UX-ROUND2（设计实现 + 翻月 + 归类词表 + 4 小缺陷）

- 任务书：`docs/EXEC-UX-ROUND2-20261023.md`（户主 2026-10-23 下发）
- 设计依据：`docs/DESIGN-UX-REVAMP-20261023.md` V1.0（415 行，审核员已过审）
- 授权 ID：`owner-approval-ux-round2-20261023-1`
- 完成时间：2026-10-23 18:45 +0800
- 交付结论：WP-A～WP-E 全部完成；技术门 457 passed / 0 failed / 80 skipped、typecheck 绿、lint 绿；一次重建装包，但因**验收中发现日历弹层被裁切（见 §3.3）**，在同一授权下追加了第二次候选指纹轮换（`-calendar-fix`），两次轮换均只动 R13B §3 允许字段。

---

## 1 交付物与文件

| 类别 | 内容 |
|---|---|
| 新建组件 | `src/ui/V2StructureCard.tsx`、`V2MonthlySpendCard.tsx`、`V2FeedbackStage.tsx`、`V2CalendarPicker.tsx`、`V2SavingsRoomPage.tsx`、`V2DetailHero.tsx`、`V2CashflowDetail.tsx`、`V2SafetyDetail.tsx`、`V2RepaymentDetail.tsx`、`V2MonthSummary.tsx`、`V2DayComplete.tsx`、`v2-import.tsx`、`use-reduced-motion.ts`、`money-format.ts` |
| 新建/整理 CSS | `v2-tokens.css`、`v2-card.css`、`v2-feedback.css`、`v2-calendar-picker.css`、`v2-detail-visual.css`、`v2-savings-room.css`、`v2-import.css` |
| 改造 | `HomeScreen.tsx`、`V2HomeSurface.tsx`、`MyFinancePages.tsx`、`LedgerPage.tsx`、`FixedExpensesPage.tsx`、`App.tsx`、`contracts.ts` |
| 服务/词表 | `src/application/ux-ledger-service.ts`、`src/persistence/export-file.ts`、`src/model/import-rules.ts`（**只加商户关键词**） |
| 脚本 | `scripts/ux-round2-rebind-candidate-binding.mjs`（R13B §1–§3 字段级轮换） |

`git status`：27 个已跟踪文件修改（约 +1,897 / −558）＋上述新增文件；HEAD 仍为 `41f9843`，本轮改动未提交（沿用前轮工作方式，未做 git 提交）。

---

## 2 红线自查

| 红线 | 结论 | 证据/做法 |
|---|---|---|
| 不改 `src/model/**` 计算规则 | 合规 | 该目录只改 `import-rules.ts`（词表 `RULES` 增补关键词），置信度机制、阈值、既有别名未动；`git diff --stat src/model` 仅此一文件 |
| 双账本 D-01 同事务镜像、V1 镜像恒 `OTHER_VARIABLE` | 合规 | 只读核对：829 条 V2 全部有同 id 的 V1 镜像；`r.amount<>e.amount` 0 条、`r.business_date<>e.occurred_on` 0 条、`r.category<>'OTHER_VARIABLE'` 0 条。库内唯一 1 条 V1 独有行 `daea72ab-1124-4fb2-bbee-d9255f1e2b3f`（¥13.10，`FOOD`，2026-10-05）为 V2 迁移前遗留，本轮未触碰 |
| 不写生产库（一律界面/服务；核对只读） | 合规 | 全部删除/归类经由应用界面；所有核对使用 `file:…?mode=ro&immutable=1` |
| 「火山 49.9」两笔不得删除 | 合规 | 仍在库：`2026-10-21 ¥49.90`、`2026-10-22 ¥49.90` |
| 不搬像素视觉 | 合规 | 无 PixelWorld / 像素庆祝 / 像素字体 / DuoGuide 皮肤引用 |
| 测试只增不减 | 合规（未增） | 457 passed / 0 failed / 80 skipped，47 files passed + 1 skipped，与基线**完全一致**；本轮没有新增测试（如实报：增量 0） |
| `__WP03_PREVIEW_BUILD__` 保持 false | 合规 | `vite.config.ts` 仍是 `__WP03_PREVIEW_BUILD__: "false"`；`scripts/test_wp03_preview_packaging.py` 断言通过 |
| schema 不变 | 合规 | `pragma user_version = 8`，无迁移脚本变更 |
| 双口径对账 | 合规 | 见 §5，当月与全量分别列出 |

---

## 3 WP-A 设计稿逐节勾验

> 口径：**做成** = 与稿一致；**偏离** = 与稿有差；**缺项** = 未做/未取证。稿中未给值的项一律未自行补值。

### §2 全局 Tokens

| 项 | 结论 | 说明 |
|---|---|---|
| §2.1 颜色变量 | 做成 | `v2-tokens.css` 逐条落地（含 `--v2-overlay: rgb(23 59 58 / 28%)`），hex 小写等值 |
| §2.1 语义色使用（teal 正常/完成、coral 超支、danger 危险、yellow+teal 庆祝） | 做成 | 首页「超出目标」徽章 coral、结构卡余量负数 coral、还款「实际还款」teal、庆祝用 yellow+teal |
| §2.2 圆角/边框/阴影 | 做成 | `--v2-radius-*`、`--v2-border-1`、`--v2-shadow-card/float` 全部由 tokens 驱动 |
| §2.3 字阶与金额 | 做成 | `--v2-text-*`、`--v2-money-*` 与稿表一致；`money-format.ts` 统一 `¥` + 千分位 + 两位小数；`font-variant-numeric: tabular-nums`、`letter-spacing: -0.02em` |
| §2.4 间距与布局（1120 / 32 / 28 / 16 / 24；<900px 降级） | 做成 | 桌面容器 1120、页边 32、卡内 24；`@media (max-width: 900px)` 有 20/20 与两栏转一栏 |
| §2.5 动效档位 | 做成 | 四个 ease 与五个 duration 变量照稿，动画引用 tokens 而非硬编码 |

### §3 通用组件状态规范

| 项 | 结论 | 说明 |
|---|---|---|
| 卡片四态（默认/hover/强调/超支） | 做成 | `v2-card` + 语义修饰类 |
| 按钮（主/次/图标/危险/禁用） | 做成 | `v2-btn--primary/secondary`、`icon-button`、`v2-icon-btn` |
| 进度条 / 徽章 / 空态 | 做成 | `v2-progress`、`v2-badge--*`、`V2EmptyState` |

### §4 首页两卡

| 项 | 结论 | 说明 |
|---|---|---|
| §4.1 布局（今天 → 结构卡 + 本月消费卡 + 今日流水） | 做成 | 截图 `launch-home.png`、`detail-cashflow.png` |
| §4.2 结构卡状态（长期缺口/持平/有余） | 做成（部分状态未取图） | 现网为「长期看，每个月有个缺口 −¥5,046.73」；其余两态代码就绪但未造数取图 |
| §4.3 本月消费卡（正常/接近/超支） | 做成（部分状态未取图） | 现网超支态（¥9,322.42 / 目标 ¥1,600.00，`超出目标` 徽章）；正常/接近态未取图 |
| §4.4 首页动效 | 做成 | 进入 360ms `--v2-ease-emphasized`；reduced-motion 下关闭 |

### §5 记账反馈三件套

| 项 | 结论 | 说明 |
|---|---|---|
| §5.1 记完一笔（金额强调 → 图标 → 文案） | 做成 | `V2FeedbackStage`；截图 `celebration-normal.png`、`celebration-reduced.png`（reduced 下无粒子，保留完成图标/进度/「记好了！」） |
| §5.2 记完一天 | 做成（**未取图，如实报缺**） | 触发口径按任务书 §2.2：当天任意一笔保存成功后每天最多一次；连续天数只读推导不写库、中断不用红色。未取图原因：需再写一笔真实流水，会污染账本，故不造数 |
| §5.3 记完一月 + 手动入口 | 做成 | 月度小结三页 `month-summary-1/2/3.png`；进度页「看本月小结」手动入口 `progress-page.png`；无数据时只显示「这个月还没有足够记录」 |
| 失败只报错不庆祝 | 做成 | `V2FeedbackStage` 仅在 `saveExpense` 保存+读回成功后触发 |

### §6 日历式日期选择器

| 项 | 结论 | 说明 |
|---|---|---|
| 只选业务日期、无时间输入 | 做成 | 值恒为 `YYYY-MM-DD` |
| 键盘 左右上下/Enter/Escape | 做成 | `V2CalendarPicker` 内 ArrowLeft/Right/Up/Down、Enter、Escape |
| 弹层可用性与样式（360×380、20 圆角、`--v2-shadow-float`） | **发现缺陷并已修** | 见 §3.3；修复后截图 `calendar-picker.png` 全月可见 |

### §7 建立余地页

| 项 | 结论 | 说明 |
|---|---|---|
| 标题「建立余地」、副标题「给未来留一点空间」 | 做成 | 截图 `savings-room.png` |
| 当前/目标/还差/进度 | 做成 | ¥25,325.93 / ¥108,280.38 / ¥82,954.45 / 23% |
| 完成态 | 做成（**未取图，如实报缺**） | 现网为进行中 23%；完成态需造数才能出现，不造数 |

### §8 三个详情页

| 项 | 结论 | 说明 |
|---|---|---|
| §8.1 现金流「本月的钱流向哪里？」 | 做成 | `detail-cashflow.png`（分类环形 + 6 行占比，含新增分类） |
| §8.2 安全垫「安全垫够不够？」 | 做成 | `detail-safety.png` |
| §8.3 债务还款「这个月要还多少？」 | 做成 | `detail-repayment.png`；**「计划计入」蓝 CalendarClock /「实际还款」teal CheckCircle2 双标签未合并**；总负债只放右上角小卡 ¥172,579.53 |

### §9 动效专项与 reduced-motion

| 项 | 结论 | 说明 |
|---|---|---|
| CSS 全局降级（`prefers-reduced-motion`） | 做成 | 全局媒体查询 + `is-reduced-motion` 类 |
| React `matchMedia` 降级 | 做成 | `use-reduced-motion.ts` |
| 静态下保留完成图标/最终进度/文案 | 做成 | `celebration-reduced.png` 对照 `celebration-normal.png` |

---

## 3.1 WP-B 流水页真实翻月

- `LedgerPage.tsx` 改为独立月份状态（默认 `asOfDate.slice(0,7)`），提供「上一月 / 下一月」+ 月份 pill；图标按钮 36×36、lucide 18px、hover `--v2-teal-soft`、pill 24px，均按稿 §3。
- 实测：进入流水页显示 `2026 年 10 月`；点「上一月」→ `2026 年 09 月` 且列表首行变为 `2026-09-01`（`ledger-2026-09.png`）；点「下一月」回到 10 月。翻月不改会话基准日，导出仍为全量。
- `__WP03_PREVIEW_BUILD__` 未动（false），不存在靠开关冒充翻月。

## 3.2 WP-C 分类、词表、全量归类

**5 个新分类**（应用层写入，schema 未变，`user_version=8`）：

| 分类 | icon | color | 库内字段核对 |
|---|---|---|---|
| 医疗 | `HeartPulse` | `#F47B68` | builtin=1 active=1 adjustable=1 overspending_alert=0 savings_related=0 |
| 居住 | `Home` | `#24B89A` | 同上 |
| 水电 | `Zap` | `#FFC94A` | 同上 |
| 保险 | `ShieldCheck` | `#4B8FE8` | 同上 |
| 教育 | `GraduationCap` | `#8C72D8` | 同上 |

启用分类共 11 个（原 6 + 新 5）。

**词表**：`src/model/import-rules.ts` 只加商户关键词——闲鱼→购物；中国移动/联通/电信/宽带→水电；医院/药房/诊所/体检→医疗；链家/自如/贝壳/物业→居住；平安/众安/太保/人保→保险；新东方/学而思/书店/培训→教育。置信度机制、阈值、既有别名未动。

**只读覆盖率模拟**（`coverage-simulation.mjs` / `.json`，模拟时 5 个新分类尚未写入，用同名占位分类估算）：合计 **93 笔 / ¥13,765.53**，分布在 2026-01～10 全部 10 个月。

**实际执行**：界面「自动归类」逐月预览 + 「就按这个改」确认，每次确认后断言总额/笔数不变。

| 口径 | 结果 |
|---|---|
| 模拟建议 | 93 笔 / ¥13,765.53 |
| 实际分布差（pre→post 快照） | **87 笔 / ¥13,418.24**（迁入侧与迁出侧各 87 笔、金额两侧平衡） |
| 差额 | 6 笔 / ¥347.29，**未逐笔归因**（如实报）。可核事实：按现行词表对现库重放 `suggestCategory`，待归类 **0 笔**，即当前状态已无「按词表应改而未改」的行 |
| 教育 | 落库 0 笔（无匹配商户），保留空分类 |

归类只改 `expenses.category_id`：V2/V1 笔数金额前后完全一致（见 §5），V1 镜像 `category` 仍恒为 `OTHER_VARIABLE`，上轮 17 笔美团→餐饮不回滚。

## 3.3 验收中发现的缺陷（本轮修复，如实报）

**日历弹层被裁切**：`.v2-expense-sheet` 为 `overflow: auto`，`V2CalendarPicker` 的弹层原为 `position: absolute`，被面板裁掉——记一笔时日历只露出 1～4 日，5 日以后点不到（证据：修复前同路径截图，弹层在面板下沿被截断）。

修复（不改设计值，只改定位方式）：弹层改 `position: fixed`，打开时按触发器 `getBoundingClientRect()` 计算位置，空间不足自动翻到上方，并在 `resize`/`scroll` 时重新锚定；宽 360、高 380、圆角 20、`--v2-shadow-float` 等稿定值原样保留。修复后 `calendar-picker.png` 整月可见、10/23 今天高亮、取消/确定可点。

因该修复需重新出包，本轮在**同一授权 ID**下做了第二次字段级轮换（见 §6），并将审计目录标记为 `ux-round2-20261023-calendar-fix`。

## 3.4 WP-D 四个小缺陷（前/后）

| # | 缺陷 | 修法 | 证据 |
|---|---|---|---|
| a | 我的财务页一屏空白 | 去掉 `.finance-page` 的 `min-height:100vh` | `after-my-finance.png`：收入/现金/资产/债务四卡首屏可见 |
| b | 固定支出条目名显示英文枚举 | 展示层走 `ESSENTIAL_LABELS`，并把库内 3 条 `name` 经编辑界面存成中文 | `after-fixed-expenses.png`：住房 / 水电通讯 / 通勤，合计 ¥3,528.00 不变 |
| c | 隐私页版式挤（每行约 6 字） | 按稿 §2.4 间距与网格重排，900px 断点两栏/一栏 | `after-privacy.png`：两栏、行宽正常 |
| d | 导入控件未样式化（英文 Choose File、原生单选） | 按稿 §3 通用组件 + tokens 自定义控件，纯视觉不改逻辑 | `after-import.png`、`after-import-file.png`：平台 pill + 虚线「选择 CSV 文件」按钮 |

---

## 5 数据锚点（当月 / 全量双口径）

只读核对（`mode=ro&immutable=1`），时点 2026-10-23 18:42 +0800。

### 5.1 双账本

| 口径 | V2 `expenses` | V1 `expense_records` | 差 |
|---|---|---|---|
| 全量 | 829 笔 / **¥101,187.16** | 830 笔 / **¥101,200.26** | 1 笔 / ¥13.10 |
| 当月 2026-10 | 109 笔 / **¥9,309.32** | 110 笔 / **¥9,322.42** | 1 笔 / ¥13.10 |

差额来源：V1 独有遗留行 `daea72ab-1124-4fb2-bbee-d9255f1e2b3f`（¥13.10，`FOOD`，2026-10-05），V2 迁移前既有，本轮未动。

镜像完整性（全量）：缺镜像 0、金额不一致 0、业务日期不一致 0、镜像 category 非 `OTHER_VARIABLE` 0。

### 5.2 分类分布

全量（829 笔 / ¥101,187.16）：

| 分类 | 笔数 | 金额 |
|---|---|---|
| 餐饮 | 268 | 14,987.11 |
| 交通 | 208 | 18,640.14 |
| 购物 | 133 | 20,002.11 |
| 其他 | 103 | 19,827.04 |
| 娱乐 | 48 | 10,677.33 |
| 水电 | 23 | 1,779.79 |
| 家居 | 18 | 5,894.42 |
| 居住 | 14 | 2,010.00 |
| 医疗 | 13 | 88.50 |
| 保险 | 1 | 7,280.72 |
| 教育 | 0 | 0.00 |

当月 2026-10（109 笔 / ¥9,309.32）：购物 19 / 3,597.17；餐饮 58 / 2,550.42；交通 17 / 1,652.67；其他 10 / 1,324.06；水电 2 / 100.00；医疗 3 / 85.00。

「其他」剩余：全量 103 笔 / ¥19,827.04；当月 10 笔 / ¥1,324.06。

### 5.3 其他锚点

| 项 | 值 |
|---|---|
| 0 金额行 | 14 笔（在流水页可见，模型输入按 `amount > 0` 排除，未改口径） |
| 火山 49.9 | 2 笔：2026-10-21 ¥49.90、2026-10-22 ¥49.90 |
| `import_batches` | 12 |
| `pragma user_version` | 8 |
| 债务（界面） | 5 笔，余额 ¥172,579.53，本月必须还款 ¥14,518.73 |
| 现金 / 安全垫 | ¥5,325.93 / ¥25,325.93 |
| 生产库 sha256 | `53a45c288200c03a6368e3e1adf26739012671433be99a260a02d5e78029aee7` |

### 5.4 本轮产生的测试数据（如实披露）

为验证「两步删除 + 12 秒撤回」链路，在界面上创建过 **4 笔 ¥1.00 测试流水**（`2026-10-23`，空摘要），随后全部经界面两步删除（删除 → 确认删除）清除，未使用 SQL。

- 创建前基线 = 当前基线：829 笔 / ¥101,187.16（当月 109 / ¥9,309.32）
- 清理后复核：829 笔 / ¥101,187.16、当月 109 / ¥9,309.32，与基线逐位一致
- 影响：删除是应用写，生产库完整性头随之推进（sha256 已变更），非数据损坏
 
---

## 6 WP-E 发布、安装与门闸热修重绑定

**构建**：`npm run tauri:build`，日志 `build-round2b.log`（EXIT:0）。
最终可执行：`sha256 d407b7bf554263a25c805cfb385b108393e626248a8aeb84f8adf88c0c09c86c`（13.08 MiB bundle）。
安装：`/Applications/Personal Finance Console.app`，按 bundle id `com.personalfinance.console` 干净退出后覆盖安装，重新拉起无残留进程；启动门闸通过（应用正常进入首页）。

**两次字段级轮换**（授权 ID 均为 `owner-approval-ux-round2-20261023-1`，§0 引用任务书，§3.4 授权段）：

| 轮次 | 时间(UTC) | 旧指纹 | 新指纹 | 审计目录 |
|---|---|---|---|---|
| #1（功能包） | 09:16:53 | `6f957ba0…43bae4` | `bb74f2aa…d8148ece` | `production-v8-hotfix-audit/ux-round2-20261023` |
| #2（日历修复） | 10:37:58 | `bb74f2aa…d8148ece` | `d407b7bf…c09c86c` | `production-v8-hotfix-audit/ux-round2-20261023-calendar-fix` |

轮换 #2 的 dry-run 差异仅限 R13B §3 允许字段：

- receipt：`candidateExecutableSha256`、`productionAppInventory[0].executable_sha256`、`hotfixReleaseRotation{6 keys}`
- ledger：`[0].candidateExecutableSha256`
- terminal：`candidateExecutableSha256`、`releaseReceiptSha256`、`consumedLedgerSha256`

**三件套哈希（轮换前 → 轮换后）**：

| 文件 | 轮换前 | 轮换后 |
|---|---|---|
| `production-v8-cutover-terminal.json` | `d4931cbd…fb9fc7` | `d714aed7c9caa3c9fc387d5e6675f02a1303326315df025ef55ef227f2716fe9` |
| `production-v8-release-receipt.json` | `8896137e…dd4676` | `9b3e440cefd8281381e1594507df47a09bd5d18d2cbfc0bf46fe805a10737e81` |
| `production-v8-consumed-authorizations.json` | `99f91685…4bcbb` | `0d7db2bb369c9459c9845cd5a2ed82a2cc9e7a9a5430732b346d6ca324d285c1` |
| `production-v8-hotfix-rotations.json` | `1f0ee79f…fc4164` | `4b2c66dfd14967a2f36f849e03cd0f06ba5a60a8f298cb70d313dc6caa646f52` |
| `production-v8-hotfix-release-authorization.json` | `4e036ff2…3782b` | `c70344a3105174261bc4b5068636fed3f81d8de594f99b2e7e06d94ff144c0ea` |

轮换日志现共 3 条（R13B 原始 + 本轮两次），完整历史保留。明细见 `rebind-apply-calendar-fix.json`、`rebind-prepare.json`、`rebind-apply.json`、`rebind-dry-run.json`。

---

## 7 技术门

| 门 | 结果 | 日志 |
|---|---|---|
| 测试 | **457 passed / 0 failed / 80 skipped**，47 files passed + 1 skipped，EXIT 0 | `verify-tests.log` |
| typecheck | `tsc --noEmit` EXIT 0 | `verify-typecheck.log` |
| lint | `biome check src tests`，157 files，EXIT 0 | `verify-lint.log` |
| 路由清查 | 首页/记录/流水/进展/我的/详情/建立余地/固定支出/隐私/维护/导入 全部可达 | 截图 + AX 遍历 |
| 金额格式 | 全站 `¥` + 千分位 + 两位小数，未回退 | 截图 |

测试数与基线**完全一致（+0）**：本轮没有新增测试，如实报。

---

## 8 证据目录

`evidence/ux-round2-20261023/`

| 文件 | 内容 |
|---|---|
| `launch-home.png` | 首页两卡（最终包，超支态） |
| `celebration-normal.png` / `celebration-reduced.png` | 记账庆祝 正常 / 减弱动效 |
| `calendar-picker.png` | 日历弹层（修复后整月可见） |
| `month-summary-1/2/3.png` | 月度小结三页 |
| `progress-page.png` | 进展页 +「看本月小结」入口 |
| `savings-room.png` | 建立余地（进行中 23%） |
| `detail-cashflow.png` / `detail-safety.png` / `detail-repayment.png` | 三个详情页 |
| `ledger-2026-10.png` / `ledger-2026-09.png` | 翻月前后 |
| `ledger-2026-0X-preview.png` / `-applied.png` | 逐月归类建议与确认后 |
| `after-my-finance.png` / `after-fixed-expenses.png` / `after-privacy.png` / `after-import.png` / `after-import-file.png` | 四缺陷修复后 |
| `quick-entry.png` | 记一笔面板 |
| `pre-classification-snapshot.json` / `post-classification-snapshot.json` | 归类前后快照 |
| `coverage-simulation.mjs` / `.json` | 只读覆盖率模拟 |
| `pre-build-db-hash.txt` | 构建前库哈希 |
| `build-round2b.log` / `build.log` | 构建日志 |
| `rebind-*.json` | 轮换准备/干跑/apply/三件套哈希 |
| `verify-tests.log` / `verify-typecheck.log` / `verify-lint.log` | 技术门日志 |

---

## 9 缺项与偏离（如实报）

1. **记完一天**：功能已实现（口径按任务书 §2.2），但**未取截图**——触发需要再写一笔真实流水，会污染账本，故不造数。
2. **首页正常/接近态、结构卡有余/持平态、建立余地完成态**：代码就绪，现网数据只落在超支态与进行中态，**未取图**，不造数。
3. **归类实际差 6 笔 / ¥347.29** 相对模拟值未逐笔归因；已核实现库按现行词表重放 0 笔待归类。
4. **庆祝截图与月度小结截图来自轮换 #1 的包**（17:48–18:34），轮换 #2 只改了日历弹层定位，未触碰这三处代码/样式；首页四缺陷截图与详情页截图在轮换 #2 的包上重取。
5. `src/model/**` 之外无计算规则改动；`import-rules.ts` 仅词表。

6. 详情页头部右侧的 `2026-10` 徽标是**全站既有写法**（`HomeScreen` 用 `home.currentMonth`、`FixedExpensesPage` 用 `asOfDate.slice(0,7)`），本轮未改；流水页因新增月份 pill，二者并排出现「2026-10 / 2026 年 10 月」重复感。属观感小瑕，未为此再重建第三个包，登记留待户主裁定是否统一。
