# EXEC-U10 执行指令（视觉统一：全站贴纸插画 → lucide 线性图标瓷砖）

**角色：** 执行者
**基线：** HEAD `a91f3ab`（build-44，落地线已 COMPLETED）；全量基线 **400 passed / 0 failed / 80 skipped**
**日期：** 2026-10-21
**批准：** 用户于 2026-10-21 经 Studio 澄清选定 **B 案**（clarify_id `83ca8b45-cbc6-43ff-a4d8-5fc185236bc2`）：全站约 14 处 `FinanceIllustration` 贴纸用法（含子页行、汇总、空态、规划页头图）一次性统一为 lucide 图标。批准范围仅限本指令列出的文件与改法。

---

## 〇、目标

把全部贴纸插画（PNG/SVG sticker）统一为 **lucide 线性图标 + 维度色底瓷砖**，与 build-36（U-09）在 `v2-dashboard` 建立的瓷砖风格一致；**不新增依赖**（`lucide-react` 已在 `package.json`）；不改任何行为、数据、文案与交互；不改原生层。

## 一、现状盘点（动手前自己复核一遍）

| 事实 | 位置 | 含义 |
|---|---|---|
| 贴纸组件 | `src/ui/FinanceIllustration.tsx`：导入 10 个贴纸资产（8 个 `@2x.png` + 2 个 svg），渲染 `<img data-finance-illustration={kind}>` | 唯一贴纸出口；改造它即可覆盖全部用法 |
| 用法 14 处 | `src/ui/V2HomeSurface.tsx:202`（brand）；`src/ui/MyFinancePages.tsx:310`（四卡 `finance-card-art`）、`:330`（plan / `secondary-plan-art`）、`:490`（income / `finance-summary-art`）、`:580`（incomeEmpty）、`:592/:651/:697/:749`（子页行 `finance-row-art`）、`:1564`（汇总 `finance-summary-art`）、`:1970`（规划头图 `planning-hero-art`） | 全部经组件调用，无直接 `<img>` 散用 |
| 尺寸钩子 CSS | `src/style.css` 的 `.finance-card-art / .secondary-plan-art / .finance-summary-art / .income-empty-art / .finance-row-art / .planning-hero-art`（含响应式段）；`src/ui/trial-experience.css` 的 `.home-page` 变体 | **类名保留作尺寸钩子**，规则从 img 改适用 span/svg |
| 瓷砖先例 | `src/ui/v2-dashboard.tsx` + `src/ui/v2-dashboard.css` 的 `v2-dashboard__icon--{coral,yellow,lavender,blue}` | 目标视觉风格；色值以 `docs/XIAOQIANJIA_PRODUCT_DESIGN_V2.md` §5.2 色板为准（teal `#129B84`、coral `#F06A58`、blue `#5272D8`、yellow `#E7AD35`、lavender `#8472C7`、muted `#66717D`） |
| 依赖 | `package.json` 已有 `lucide-react` | 禁止安装任何新依赖 |
| 既有测试 | `tests/ui.test.tsx`、`tests/v2-ui.test.tsx` 未断言贴纸 img（grep 无 `data-finance-illustration` 命中），但含 `finance-card` 相关选择器 | 仅同步被改造破坏的选择器，语义不删改 |

## 二、允许改动（清单之外一律不动）

| 类型 | 文件与改法 |
|---|---|
| 修改 | `src/ui/FinanceIllustration.tsx`：重写为图标瓷砖组件。**组件名与 props 签名（`kind`/`className`/`width`/`decorative`）保持不变**；内部改渲染 `<span class="finance-icon-tile finance-icon-tile--{tone} {className}">` 包裹 lucide svg（svg 随 `decorative` 取 `aria-hidden`）；删除全部贴纸资产导入；`financeArt` 可改为 kind→{icon, tone} 映射表或移除，但 `MyFinancePages.tsx` 对 `keyof typeof financeArt` 的类型依赖必须保持可编译 |
| 修改 | `src/ui/MyFinancePages.tsx`：仅因重写产生的类型/props 适配；交互、文案、数据一字不动 |
| 修改 | `src/ui/V2HomeSurface.tsx`：同上，仅 brand 用法适配 |
| 修改 | `src/style.css`：六个贴纸尺寸类改为瓷砖尺寸钩子（类名不变）；新增 `.finance-icon-tile` 基类与 tone 修饰类；清理失效的贴纸专用规则 |
| 修改 | `src/ui/trial-experience.css`：`.home-page` 下同名变体同步修正 |
| 条件修改 | `src/ui/v2-dashboard.css`：**仅当**把瓷砖基类与 `v2-dashboard__icon` 合并复用时需要；否则不动 |
| 条件删除 | `src/ui/assets/finance/` 下 8 个 `@2x.png` 与 2 个 svg：**门 = 重写后 `grep -rn "assets/finance/" src` 零命中**；仍有引用者保留该文件并在回执说明。逐个精确路径删除，禁止通配符 |
| 修改 | `tests/ui.test.tsx`、`tests/v2-ui.test.tsx`：仅同步被重写破坏的断言选择器，语义不删改 |
| 新增 | `tests/v2-ui/icon-unification.test.tsx`（最少 3 例，见第四节） |

**禁止触碰：** `src/persistence/`、`src/model/`、`src/application/`、`src/runtime/`、`src-tauri/` 全部、`package.json`、`biome.json`、`vitest.config.ts`、`src/ui/` 其余组件、工作区未跟踪文件（`.claude/`、`pelican-bike.html`、`pelican-cycling.html` 不得提交、不得删除）。

## 三、kind → 图标 / tone 固定映射表（照抄，不得自创）

| kind | lucide 图标 | tone |
|---|---|---|
| income | Wallet | coral |
| spending | ShoppingCart | yellow |
| incomeFlow | TrendingUp | coral |
| cash | Banknote | blue |
| assets | Landmark | lavender |
| safety | ShieldCheck | teal |
| debt | ReceiptText | yellow |
| plan | House | teal |
| incomeEmpty | Inbox | muted |
| brand | Sprout | teal |

- 若某图标名在所装 `lucide-react` 版本不存在（typecheck 报错），选最接近的**线性**图标并在回执记录「原选→改用」；禁止 filled/duotone 风格。
- 重写后全站零使用的 kind：从映射表一并移除，并在回执列明。
- tone 只允许 §5.2 色板六值；卡片原有顶部描边色不属于本批改动范围，不动。

## 四、测试要求（新文件最少 3 例）

1. **Hub 无贴纸**：渲染「我的」Hub（四卡 + 计划入口）→ 每个瓷砖为 `.finance-icon-tile` 且内含 svg；整页 `img[data-finance-illustration]` 为零。
2. **品牌位无贴纸**：渲染 `V2HomeSurface` → brand 瓷砖同上断言。
3. **映射钉住**：对映射表每个留存 kind 断言其 tone 修饰类与第三节表一致；断言取值必须**引用组件同源映射**（import 或导出常量），禁止在测试里手写第二份映射。

既有测试仅修被破坏的选择器；`describe.skip` 区块保持 skip，不借机启用或删改。

## 五、验证命令

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
grep -rn "assets/finance/" src   # 删除资产前的门：须零命中（或按第二节保留并说明）
env NODE_ENV=test npx vitest run tests/v2-ui/icon-unification.test.tsx tests/ui.test.tsx tests/v2-ui.test.tsx --reporter=verbose
env NODE_ENV=test npx vitest run --reporter=dot   # 400 + 本批净增，80 skipped 不变，0 failed
npm run typecheck
npm run lint
npm run build
```

## 六、证据与边界

- 本批**不重建 smoke 候选包、不碰任何原生层**；真包内视觉复核另立证据批，**须用户单独批准**（门控同 L-03），不得夹带。
- 回执附：改动文件清单与 `git show --stat`、grep 门输出、专项/全量/typecheck/lint/build 结果、映射表落地对照（kind→实际图标名，含任何替换说明）。

## 七、提交

逐一 `git add` 显式路径（含条件删除的资产文件），禁止 `git add -A`。
提交信息：`build-45: U-10 — replace sticker illustrations with lucide icon tiles`

## 八、红线（违反即 RETURN）

1. 禁止安装新依赖、禁止网络请求。
2. 禁止启动/构建/修改 production 身份；不运行不带 `:smoke` 后缀的 tauri 构建；不改 `src-tauri/` 任何文件。
3. 禁止 schema 变更；禁止改数据层与 V1 冻结层。
4. 测试命令必须带 `env NODE_ENV=test`。
5. 禁止提交/删除未跟踪文件；禁止 `git add -A`。
6. 映射表、tone 色板、允许文件清单之外的一切「顺手优化」一律 RETURN 请示。

## 九、回执格式

同 `EXEC-LANDING-INSTRUCTIONS.md` 第八节（专项/全量/typecheck/lint/build/关键决策/grep 门/HEAD/git status），另加第六节要求的映射对照表。
