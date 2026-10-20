# EXEC-U-09 执行指令（build-36：财务概览卡片图标体系）

**角色：** 执行者
**基线：** build-35 验收后的 HEAD `6c2cafa`；全量 384 passed / 80 skipped / 0 failed；`npm run lint` 为有效门槛
**目标：** `V2Dashboard` 的 6 张概览卡片（收入 / 日常支出 / 账户现金 / 资产 / 债务 / 资产更新）从纯文字升级为「图标 + 文字」，按产品设计 §色彩规范用维度配色；**纯视觉层改动，禁止触碰任何数据逻辑、文案数值、props 形状**
**日期：** 2026-10-20
**修订：** v2（修正第三节测试要求以匹配该测试文件的真实风格；明确维度色值来源与图标名兜底；修正板块计数）

---

## 一、背景与边界

**现状：** `src/ui/v2-dashboard.tsx` 两处 `v2-dashboard__grid` 内的 6 张 `v2-dashboard__card`（收入、日常支出、账户现金、资产、债务、资产更新）只有 `v2-dashboard__label` + 金额/占位文字，无图标。产品设计（`docs/XIAOQIANJIA_PRODUCT_DESIGN_V2.md` §色彩）要求：

> Teal 负责主行动，coral / blue / yellow / lavender 只用于维度区分。任何状态都必须同时有文字或图标，不能只靠颜色。

**图标库：** `lucide-react`（`package.json` 已有依赖，`V2HomeSurface.tsx` 已在用），**禁止安装新依赖**。

**本批次允许改动的文件（共 3 个，除此之外一律不动）：**

| 类型 | 文件 |
|---|---|
| 修改 | `src/ui/v2-dashboard.tsx`（仅 6 张卡片内部加图标元素，不动任何数据渲染逻辑） |
| 修改 | `src/ui/v2-dashboard.css`（仅新增图标相关样式） |
| 修改 | `tests/v2-ui/dashboard.test.tsx`（新增图标断言，现有断言不得删改语义） |

**禁止触碰：**
- `src/model/`、`src/application/`、`src/persistence/` 全部文件
- `src/ui/` 除 `v2-dashboard.tsx` 外的一切文件（含 `v2-surface.tsx`、`v2-today*.tsx`、`v2-progress.tsx`、`v2-trends.tsx`）
- 6 张卡片的 `aria-label`（「收入」「日常支出」「账户现金」「资产」「债务」「资产更新」）必须原样保留——测试与可访问名都依赖它
- `DashboardLedgerSummary` / `V2DashboardProps` 接口形状、`formatAmount`、信用卡/储蓄/趋势各板块
- `package.json`、`biome.json`、`vitest.config.ts`、`vite.config.ts`、`src-tauri/` 全部
- 工作区未跟踪文件（`.claude/`、`pelican-bike.html`、`pelican-cycling.html`）不得提交、不得删除

---

## 二、设计契约

### 2.1 图标与维度配色映射

维度配色按产品设计规范（coral=现金与流动性、blue=债务与责任、yellow=消费、lavender=财富与储备）。6 张卡片的归属：

| 卡片 | 维度 | 建议 lucide 图标 | 配色 |
|---|---|---|---|
| 收入 | 现金与流动性 | `Wallet` | coral |
| 日常支出 | 消费 | `ShoppingCart` | yellow |
| 账户现金 | 现金与流动性 | `Banknote` | coral |
| 资产 | 财富与储备 | `Landmark` | lavender |
| 债务 | 债务与责任 | `ReceiptText` | blue |
| 资产更新 | 财富与储备 | `RefreshCw` | lavender |

图标名可微调（执行者若认为有更贴切的同库图标，允许替换，但须在回执中列出最终选型表及理由；维度与配色的对应关系不得变）。图标导出名由 `npm run typecheck` 编译期兜底校验——若建议图标在当前安装的 `lucide-react`（`package.json` 为 `^1.57.0`）中不存在，选同义图标替代并在回执说明。**具体色值**：先 `grep -rn "coral\|lavender" src/` 确认现有 CSS 是否已定义维度色变量，有则复用；没有则使用产品设计文档 §色彩给出的基准色值：coral `#F06A58`、blue `#5272D8`、yellow `#E7AD35`、lavender `#8472C7`（`docs/XIAOQIANJIA_PRODUCT_DESIGN_V2.md:173-176`）。禁止自创新色号。

### 2.2 实现形状

每张卡片改为（以「收入」为例）：

```tsx
<section className="v2-dashboard__card" aria-label="收入">
  <span className="v2-dashboard__icon v2-dashboard__icon--coral" aria-hidden="true">
    <Wallet size={18} />
  </span>
  <p className="v2-dashboard__label">收入</p>
  <p className="v2-dashboard__amount">{formatAmount(ledger.income)}</p>
</section>
```

要点：
1. 图标容器 `aria-hidden="true"`（装饰性，文字标签已提供可访问名）；不得给图标加 `aria-label`。
2. 卡片 `aria-label`、`v2-dashboard__label` 文案、`v2-dashboard__amount` / `v2-dashboard__placeholder` 内容与顺序一律不变。
3. 图标颜色只由 CSS 修饰符类（`--coral` / `--blue` / `--yellow` / `--lavender`）控制，禁止内联 `style` / `color` prop。
4. 其余三个板块（信用卡待还、储蓄目标、收支趋势）一行不动；页面标题与整体容器也不动。

### 2.3 CSS 要求

- 新增样式只加在文件末尾或卡片样式块附近，禁止重排/重写既有选择器（build-33 刚清完 CSS 债务，`noDescendingSpecificity` 虽已关闭，仍须避免新的 `!important`）。
- 图标容器与标签的间距、对齐保持卡片视觉平衡；`tabular-nums` 若现有金额已使用则保持不变。
- 禁止媒体查询大改、禁止动布局网格列数。

---

## 三、测试要求

`tests/v2-ui/dashboard.test.tsx`（**动手前先通读该文件**：现有用例是 `renderToStaticMarkup(React.createElement(V2Dashboard, makeProps()))` 的静态 HTML 字符串断言风格——没有 happy-dom 环境、没有 `screen`/testing-library 查询，新增断言必须沿用同一风格）：

- **现有用例全部保留，断言语义不得变化**（对「收入」「日常支出」「账户现金」「资产」「债务」「资产更新」等文案的现有 `toContain` 断言必须仍通过）。
- 新增最少 2 个用例（一律 `renderToStaticMarkup` + `expect(html)` 风格）：
  1. 图标与维度类齐全：默认 `makeProps()` 下，断言 `v2-dashboard__icon--coral` 出现 2 次（收入、账户现金）、`v2-dashboard__icon--yellow` 1 次（日常支出）、`v2-dashboard__icon--lavender` 2 次（资产、资产更新）、`v2-dashboard__icon--blue` 1 次（债务）；并断言 `html` 中 `<svg` 恰出现 6 次（默认 props 下趋势/账单/储蓄均为空，6 张卡片的图标应是唯一 svg 来源——动手前先实测确认，若还有其它 svg 来源，改为按容器 class 计数并在回执说明）。
  2. 图标容器为装饰性：断言 `v2-dashboard__icon` 共出现 6 次、`aria-hidden="true"` 至少出现 6 次（lucide 的 `<svg>` 可能自带该属性，故用「至少」）；禁止给图标或容器新增任何 `aria-label`。
- 禁止引入 `@testing-library/*` 查询、禁止改成 `// @vitest-environment happy-dom`、禁止快照测试。

---

## 四、验证命令（逐条通过才算完成）

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"

# 4.1 专项
env NODE_ENV=test npx vitest run tests/v2-ui/dashboard.test.tsx --reporter=verbose

# 4.2 全量回归（384 + 本批净增，80 skipped 不变，0 failed）
env NODE_ENV=test npx vitest run --reporter=dot

# 4.3 类型检查
npm run typecheck

# 4.4 lint（必须整体通过，退出码 0）
npm run lint

# 4.5 构建
npm run build
```

---

## 五、红线（违反即 RETURN）

1. 禁止修改第一节「禁止触碰」清单中的任何文件。
2. 禁止改动任何数据逻辑：`formatAmount`、props 形状、条件渲染分支、金额字符串。
3. 禁止改动 6 张卡片的 `aria-label` 与可见文案。
4. 禁止安装新依赖；图标一律来自已装的 `lucide-react`。
5. 禁止内联颜色样式；配色只走 CSS 修饰符类。
6. 测试命令必须带 `env NODE_ENV=test`；禁止网络请求。
7. 不得提交未跟踪文件。

---

## 六、提交

仅提交下列文件（逐一 `git add` 显式路径）：

```
src/ui/v2-dashboard.tsx
src/ui/v2-dashboard.css
tests/v2-ui/dashboard.test.tsx
```

提交信息：

```
build-36: U-09 dashboard overview cards get lucide icons with dimension colors
```

---

## 七、提交回执格式

```
U-09（build-36）执行回执

1. 专项测试结果：dashboard X passed, Y failed
2. 全量测试结果：A passed, B failed, C skipped
3. TypeCheck：N errors；Lint：N problems；Build：success/failure
4. 最终图标选型表（6 张卡片 → 图标名 → 维度 → 色值来源）
5. 若替换了建议图标或自定了色值：逐条理由
6. HEAD：commit-hash
7. git status --short 输出
```