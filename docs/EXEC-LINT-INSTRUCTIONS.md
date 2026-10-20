# EXEC-LINT 执行指令（build-33：lint 清债）

**角色：** 执行者
**基线：** `2b86e1b`（build-32 已验收；全量 376 passed / 80 skipped / 0 failed）
**目标：** 将 `npm run lint`（biome check src tests）恢复为有效门槛——退出码 0、零 diagnostics；所有修复必须行为保持
**日期：** 2026-10-20
**修订：** v1

---

## 〇、债务清单（基线实测，执行前先复核一遍）

```
npm run lint   # 基线：60 errors / 63 warnings
```

| 数量 | 级别 | 规则 | 处理方式 |
|---|---|---|---|
| 39 | error | 格式化差异（formatter diff） | 机械修复（biome --write） |
| 8 | error | `assist/source/organizeImports` | 机械修复（biome --write） |
| 13 | error | `lint/a11y/useAriaPropsSupportedByRole` | **手工修复**（第四节） |
| 32 | warn | `lint/style/noDescendingSpecificity`（CSS） | 配置关闭（第五节，不重构遗留视觉 CSS） |
| 12 | warn | `lint/complexity/noImportantStyles`（CSS） | 配置关闭（第五节） |
| 10 | warn | `lint/style/noNonNullAssertion` | **手工修复**（第四节） |
| 3 | warn | `lint/complexity/useOptionalChain` | 机械修复（biome --write） |
| 6 | warn | unused variables / imports / parameters | **手工修复**（第四节） |

---

## 一、边界

- **允许改动：** `src/` 与 `tests/` 下被下列步骤触及的任何文件、`biome.json`（仅第五节所述两条规则）。
- **行为红线：** 本批次是**纯清债**，禁止任何逻辑变更、禁止改测试断言的语义、禁止改文案。唯一允许的语义层改动是第四节的 a11y 元素/角色调整（且必须保持可访问名不变）。
- 工作区未跟踪文件（`.claude/`、`pelican-bike.html`、`pelican-cycling.html`）不得提交、不得删除。
- 主仓库工作树直接开发，不建 worktree。

---

## 二、Step 1：机械修复

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
npx biome check src tests --write
```

此命令一次覆盖：格式化（39）、organizeImports（8）、useOptionalChain（3）及其它 safe fixes。

**立即验证（必须全绿才能继续）：**

```bash
env NODE_ENV=test npx vitest run --reporter=dot   # 期望 376 passed / 80 skipped / 0 failed
npm run typecheck                                  # 0 errors
```

若有测试因 --write 失败：定位到具体文件的修复，最小化回退该处（其余保留），并在回执中说明。

---

## 三、Step 2：复核剩余 diagnostics

```bash
npx biome check src tests --max-diagnostics=400
```

预期剩余：13 个 a11y error、10 个 noNonNullAssertion、6 个 unused、44 个 CSS warning。逐条列出（文件:行号）再动手。

---

## 四、Step 3：手工修复

### 4.1 a11y `useAriaPropsSupportedByRole`（13 个，error 级）

问题形态：`aria-label` 出现在不支持该属性的元素上（多为无 role 的 `<div>`）。

修复优先级（逐处选择最小改动）：
1. 元素本身应是语义元素却写成 div 的，改为语义元素（如 `<section>`）；
2. 否则为元素补一个支持 `aria-label` 的 role（如 `role="group"`、`role="region"`），class 与视觉保持不变；
3. **不得**通过删除 `aria-label` 来"消除"报错，如果该可访问名被测试或相邻文案使用。

**动手前先查依赖：** 对每处准备改的 label 文本，执行

```bash
grep -rn "<label文本>" tests/ src/
```

确认没有 `getByLabelText` / `findByLabelText` 依赖它；若有，修复后该查询必须仍能命中（修完跑全量测试验证）。

已知位置（基线实测，可能随 Step 1 行号漂移）：`src/ui/HomeScreen.tsx:498`、`src/ui/V2HomeSurface.tsx:614`、`src/ui/v2-dashboard.tsx`（7 处）、`src/ui/v2-trends.tsx`（3 处）、其余以 `npx biome check` 实测为准。

### 4.2 `noNonNullAssertion`（10 个，warn 级）

逐个将 `x!` 重构为显式判空（提前返回 / 局部变量 + 断言失败路径），行为保持不变。测试文件中的 `!` 改为先取值判空再断言（`expect(value).toBeDefined()` 后用非空局部变量）。禁止用 `as` 强转绕过。

### 4.3 unused（6 个，warn 级）

删除未使用的变量/导入/参数；若参数因接口约束必须保留，改用下划线前缀并确认 biome 接受。

---

## 五、Step 4：CSS 两条规则的裁决

`noDescendingSpecificity`（32）与 `noImportantStyles`（12）集中在 `src/style.css`、`trial-experience.css`、`pixel-world.css`、`v2-dashboard.css`、`v2-trends.css` 等**遗留视觉层**。项目没有视觉回归测试，重构选择器特异性/移除 `!important` 会造成不可验证的视觉回归风险。

**本批次裁决：在 `biome.json` 中关闭这两条规则**，不重构 CSS：

```json
"linter": {
  "enabled": true,
  "rules": {
    "recommended": true,
    "style": { "noDescendingSpecificity": "off" },
    "complexity": { "noImportantStyles": "off" }
  }
}
```

其余配置（formatter、indent、lineWidth、quoteStyle、semicolons）一律不动。此裁决的理由必须写进提交信息（见第七节）。

---

## 六、验证（逐条通过才算完成）

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"

# 6.1 lint 门槛：退出码 0，零 diagnostics
npm run lint

# 6.2 全量回归：376 passed / 80 skipped / 0 failed（数量必须与基线一致）
env NODE_ENV=test npx vitest run --reporter=dot

# 6.3 类型检查
npm run typecheck

# 6.4 构建
npm run build
```

---

## 七、提交

允许提交的文件：本批次实际改动的 `src/`、`tests/` 文件 + `biome.json`。逐一 `git add` 显式路径；不得包含未跟踪文件。

提交信息：

```
build-33: lint debt cleanup — biome format/organize, a11y role fixes, non-null refactors

CSS specificity/!important rules disabled in biome.json: legacy visual layers
lack visual regression coverage; restructuring risks unverifiable regressions.
```

---

## 八、提交回执格式

```
LINT（build-33）执行回执

1. 基线诊断：60 errors / 63 warnings（附执行前实测输出尾段）
2. 完成后诊断：N errors / M warnings（目标 0 / 0）
3. 手工修复明细：
   - a11y 13 处：逐条 文件:行号 → 采用方式（语义元素 / 补 role）
   - noNonNullAssertion 10 处：逐条 文件:行号 → 重构方式
   - unused 6 处：逐条 文件:行号
4. biome --write 回退说明（若有）
5. 全量测试：A passed, B failed, C skipped（必须 376/0/80）
6. TypeCheck：N errors；Build：success/failure
7. HEAD：commit-hash
8. git status --short 输出
```