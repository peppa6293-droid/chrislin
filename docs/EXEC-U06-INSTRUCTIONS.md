# EXEC-U-06 执行指令（build-32）

**角色：** 执行者
**基线：** `db09005`（main；测试基建修复完成，全量 370 passed / 80 skipped / 0 failed）
**目标：** 将已就绪的 CSV 导入链路（`parseImportFile` → 去重 → 确认 → `V2ImportService.writeConfirmedImport`）接入 V2Surface「我的」页，替换当前「导入功能即将开放」占位
**日期：** 2026-10-20
**修订：** v1

---

## 〇、为什么是这个范围（必读）

原 `.ekko-tmp/xiaoqianjia-v2-u06-instructions-v1.md`（快捷记账真实写入）**已作废，不要执行**，原因：

1. 它基于旧 worktree（`.ekko-tmp/xqj-u01-build21-isolated`，基线 `df85920`）与不存在的 `src/application/v2-home-service.ts`、`createMemoryDatabase` 等 API；
2. 它的目标（快捷记账 UI → 真实 SQLite 写入 → 回读）在 build-28/29 的 U-01/U-02 落地时**已经实现**：`src/ui/v2-quick-entry.tsx:174` 直接调用 `V2ExpenseService.recordCashDebitExpense`（真实写入 + 服务内回读校验），`tests/v2-ui/quick-entry-flow.test.tsx` 用真实 `NodeSqliteDatabase` + 迁移覆盖了端到端链路。

`docs/EXEC-I04-IMPORT-WRITE-INSTRUCTIONS.md` 同样已完成（build-26/27，提交 `d82276c`/`427078f`），**不要重复执行**。

当前真实缺口：V2Surface 四个目的地中「我的」页仍是占位文案（`src/ui/v2-surface.tsx` 中 `{tab === "mine" ? <p>导入功能即将开放</p> : null}`），而导入的服务层、模型纯函数、仓储、测试夹具全部就绪且被测试覆盖。本批次把这层 UI 补上，完成产品设计定义的「快速记账 + 账单导入」日常循环。

---

## 一、背景与边界

**已就绪（只读引用，全部有测试覆盖，禁止修改）：**

| 层 | 文件 | 提供能力 |
|---|---|---|
| 模型纯函数 | `src/model/v2-import.ts` | `parseImportFile(content, provider, importBatchId)`、`dedupeImportCandidates(candidates, existingKeys)`、`applyCandidateEdits(candidate, edits)`、`confirmImportBatch(candidates)` |
| 应用服务 | `src/application/v2-import-service.ts` | `new V2ImportService(repositories)`；`writeConfirmedImport(input) → ImportBatchResult`（含计数器与 auditEvents，内部事务写入 + 回读校验） |
| 仓储 | `src/persistence/repositories.ts` | `listImportedDedupeKeys(profileId)`、`listExpenseCategories(profileId)`、`listAccounts(profileId)`、`listV2Expenses(profileId, month?)` |
| 测试夹具 | `tests/fixtures/v2-import/sample-alipay-export.csv`、`sample-wechat-export.csv` | 合成官方导出格式 |
| 参照测试 | `tests/v2-ledger/import-write.test.ts`、`tests/v2-ledger/import-parse.test.ts` | 数据库搭建、候选构造、计数断言的权威范本 |

**本批次允许改动的文件（共 5 个，除此之外一律不动）：**

| 类型 | 文件 |
|---|---|
| 新增 | `src/ui/v2-import.tsx` |
| 新增 | `src/ui/v2-import.css` |
| 新增 | `tests/v2-ui/import-flow.test.tsx` |
| 修改 | `src/ui/v2-surface.tsx`（mine 页接入导入组件 + 新增 `importService` prop） |
| 修改 | `tests/v2-ui/v2-surface.test.tsx`（同步 mine 页断言） |

**禁止触碰：**
- `src/model/` 全部文件（尤其 `v2-import.ts`——只读引用，连"顺手优化"都不行）
- `src/application/`、`src/persistence/` 全部文件
- `src/ui/V2HomeSurface.tsx`、`v2-quick-entry.tsx`、`v2-today.tsx`、`v2-today-task.tsx`、`v2-progress.tsx`、`v2-dashboard.tsx`、`v2-trends.tsx` 及其 css
- `package.json`、`vitest.config.ts`、`vite.config.ts`、`src-tauri/` 全部
- 工作区未跟踪文件（`.claude/`、`pelican-bike.html`、`pelican-cycling.html`）——不得提交、不得删除

**工作位置：** 主仓库工作区（与 build-28~31 相同，直接在 main 工作树开发），完成后提交到 main。不要创建 worktree，不要进入 `.ekko-tmp/`。

---

## 二、关键数据契约（照抄，不要发明新字段）

`parseImportFile` 返回 `ImportedExpenseCandidate[]`，其中 `category: null`、`accountId: null`——**解析产物不带分类和账户**，必须由 UI 在确认前补齐，否则 `writeConfirmedImport` 会判为 error 行。

`writeConfirmedImport` 的输入输出：

```ts
await importService.writeConfirmedImport({
  importBatchId,          // string，用 globalThis.crypto.randomUUID() 生成
  profileId,              // 从 props 传入
  provider,               // "ALIPAY_CSV" | "WECHAT_CSV"
  sourceFileContent,      // 原始 CSV 文本（用于计算 sha256 去重指纹）
  candidates,             // 已赋 category/accountId 且 reviewStatus 为 CONFIRMED 的候选
});
// → ImportBatchResult { batchId, provider, sourceFileSha256,
//     totalRows, validRows, writtenRows, skippedRows, errorRows, auditEvents }
```

服务层已有行为（不需要也不允许在 UI 重复实现）：
- `direction !== "EXPENSE"`（收入/未知）→ 计入 `skippedRows`
- `dedupeKey` 已存在 → 计入 `skippedRows`
- category/account 不在 active 集合、日期非法、金额非法 → 计入 `errorRows`
- 整批事务写入，任一行失败整体回滚；写入后逐行回读校验

候选状态机：`PENDING`（解析成功）/ `ERROR`（解析期校验失败）→ 经 `applyCandidateEdits` 变 `EDITED` → 经 `confirmImportBatch` 变 `CONFIRMED`；去重命中由 `dedupeImportCandidates` 置 `SKIPPED`。

---

## 三、`src/ui/v2-import.tsx` 实现要求

### 3.1 Props（与兄弟组件一致的风格）

```tsx
import type { V2ImportService } from "../application/v2-import-service.js";
import type { Repositories } from "../persistence/repositories.js";
import "./v2-import.css";

export function V2Import({
  importService,
  repositories,
  profileId,
}: {
  importService: V2ImportService;
  repositories: Repositories;
  profileId: string;
}) { ... }
```

### 3.2 交互流程（三段式，无路由）

**阶段一：选择与解析**
- 平台选择：两个 radio——「支付宝账单」（`ALIPAY_CSV`）、「微信账单」（`WECHAT_CSV`），默认支付宝。
- 文件选择：`<input type="file" accept=".csv">`，带可见标签「选择 CSV 文件」。选中后用 `file.text()` 读取（若 happy-dom 下不稳定，可加可选注入 `readFileText?: (file: File) => Promise<string>` prop，默认 `file.text()`，测试可不注入直接走真实路径，先试真实路径）。
- 读取后立即：
  1. `const batchId = globalThis.crypto.randomUUID();`
  2. `parseImportFile(content, provider, batchId)`
  3. `dedupeImportCandidates(candidates, new Set(await repositories.listImportedDedupeKeys(profileId)))`
- 同时加载 `repositories.listExpenseCategories(profileId)` 与 `repositories.listAccounts(profileId)`。

**阶段二：预览与补齐**
- 汇总行（`role="status"`）：「共 N 条｜可导入 X｜重复跳过 Y｜异常 Z」，数字全部来自解析/去重结果，不得手算。
- 两个下拉（都只列 active 项）：
  - 「默认分类」：`listExpenseCategories` 中 `active === true` 的项；
  - 「默认账户」：`listAccounts` 中 active 的现金账户——**过滤条件与 `src/ui/v2-quick-entry.tsx` 加载账户列表时完全一致**（照抄该文件的判断，不要自创 `kind`/`type` 字段）。
- 候选列表：每行显示 `businessDate`、`amount`、`merchant ?? note ?? "—"`、状态徽标（可导入 / 已重复 / 异常）。本批次**不做**逐行编辑与逐行跳过；默认分类/账户统一应用到所有 `PENDING` 候选。
- 两个下拉都有默认选中（各自第一个 active 项）。若 active 分类或 active 现金账户为空：显示中文提示「请先在记录页准备好分类和现金账户」，禁用确认按钮。
- 若解析结果为 0 条候选：显示「没有识别到可导入的记录」，不进入阶段二表格。

**阶段三：确认与结果**
- 「确认导入」按钮：
  1. 对所有 `PENDING` 候选执行 `applyCandidateEdits(candidate, { category: 默认分类id, accountId: 默认账户id })`；`SKIPPED`/`ERROR` 原样保留；
  2. `confirmImportBatch(合并后的全部候选)`；
  3. `await importService.writeConfirmedImport({ importBatchId: batchId, profileId, provider, sourceFileContent: content, candidates: 全部候选（含 SKIPPED/ERROR，服务层自行计数） })`。
- 成功：展示结果面板（`role="status"`）——「已写入 W 条，跳过 S 条，失败 E 条」，数字取自返回的 `writtenRows`/`skippedRows`/`errorRows`；附「再导入一份」按钮回到阶段一（重置全部状态，生成新 batchId）。
- 失败（抛错）：保留阶段二状态，显示 `role="alert"` 的中文错误信息（`error instanceof Error ? error.message : String(error)`），不清空候选。
- 确认过程中按钮 `disabled` 并显示「导入中…」，防止重复提交。

### 3.3 视觉与可访问性

- 风格对齐 `v2-quick-entry.css` / `v2-today.css`：macOS 克制排版、`tabular-nums` 金额、浅灰底圆角卡片；不引入新字体、不引入动画库。
- 语义：阶段标题用 `h2`/`h3` 层级（不高于页面已有层级）；文件输入、两个下拉都要有 `<label>` 关联；结果/错误用 `role="status"`/`role="alert"`。
- 金额展示用字符串原样格式化（两位小数），不做浮点运算。

---

## 四、`src/ui/v2-surface.tsx` 接线

1. `V2Surface` props 增加 `importService: V2ImportService`（`import type`，与 `expenseService` 写法一致）。
2. 将 `{tab === "mine" ? <p>导入功能即将开放</p> : null}` 替换为：

```tsx
{tab === "mine" ? (
  <V2Import importService={importService} repositories={repositories} profileId={profileId} />
) : null}
```

3. 除上述改动外 `v2-surface.tsx` 不做其他调整（导航、记一笔按钮、focusSignal 逻辑保持原样）。

---

## 五、测试要求

### 5.1 `tests/v2-ui/import-flow.test.tsx`（新增）

- 文件头 `// @vitest-environment happy-dom`。
- 数据库搭建**照抄** `tests/v2-ledger/import-write.test.ts` 的 `beforeEach` 模式：`new NodeSqliteDatabase()` → `new Repositories(db)` → `migrateDatabase(db, "…Z")` → `createProfile` → 建 `CASH` 账户与 `CREDIT_CARD` 账户、至少一个分类（字段以该文件为准，不要猜）；`afterEach` 里 `db.close()` + `cleanup()`。
- 文件上传用 `@testing-library/user-event` 的 `userEvent.upload(input, file)`，`file` 用 `new File([csvText], "alipay.csv", { type: "text/csv" })` 构造，`csvText` 从 `tests/fixtures/v2-import/sample-alipay-export.csv` 读取（测试里用 `readFileSync`，参照 `import-write.test.ts`）。
- 期望计数**以 `tests/v2-ledger/import-parse.test.ts` 对该夹具的实际断言为准**——先读该文件确定夹具行数和解析结果，再写死期望值；禁止运行后才回填断言。

必测用例（最少 6 个）：
1. 上传支付宝夹具后出现预览：汇总行计数与 `parseImportFile` + `dedupeImportCandidates` 的实际输出一致，候选列表渲染日期/金额/状态。
2. 确认导入后：`repositories.listV2Expenses(profileId)` 能查到与夹具一致的行（金额、日期、分类、账户、`kind === "CASH_DEBIT"`），结果面板数字与 `ImportBatchResult` 一致。
3. 同一文件第二次导入：全部命中去重，`writtenRows === 0`，结果面板显示跳过数等于首次写入数。
4. 无 active 分类（或无 active 现金账户）时：显示中文引导文案，确认按钮禁用。
5. 写入失败路径：`vi.spyOn(importService, "writeConfirmedImport").mockRejectedValue(new Error("forced failure"))`，界面保留候选并出现 `role="alert"` 错误，不出现成功面板。
6. 空内容文件（`new File([""], "empty.csv")`）：显示「没有识别到可导入的记录」，不崩溃。

### 5.2 `tests/v2-ui/v2-surface.test.tsx`（修改）

- mock 对象增加 `importService`（`{} as unknown as V2ImportService` 或最小 mock，以能渲染为准）。
- 「shows the import placeholder on Mine」用例改为验证导入入口出现（如文件选择输入存在、`导入功能即将开放` 消失）。其余 6 个用例行为不得变化。

---

## 六、验证命令（全部在项目根目录执行，逐条通过才算完成）

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"

# 6.1 专项
env NODE_ENV=test npx vitest run tests/v2-ui/import-flow.test.tsx tests/v2-ui/v2-surface.test.tsx --reporter=verbose

# 6.2 全量回归（期望 0 failed；基线 370 passed + 本批新增，80 skipped 不变）
env NODE_ENV=test npx vitest run --reporter=dot

# 6.3 类型检查
npm run typecheck

# 6.4 lint
npm run lint

# 6.5 构建
npm run build
```

---

## 七、红线（违反即 RETURN）

1. 禁止修改第一节「禁止触碰」清单中的任何文件。
2. 禁止改动 `src/model/v2-import.ts` 的任何纯函数签名或行为。
3. 禁止在 UI 里重复实现去重/校验/回读逻辑（那些是服务层职责）。
4. 禁止发起任何网络请求；禁止安装新依赖。
5. 测试命令必须带 `env NODE_ENV=test`。
6. 不得提交 `.claude/`、`pelican-bike.html`、`pelican-cycling.html` 及任何未跟踪文件。

---

## 八、提交

通过全部验证后，仅提交下列文件（以实际新增/修改为准，逐一 `git add` 显式路径）：

```
src/ui/v2-import.tsx
src/ui/v2-import.css
tests/v2-ui/import-flow.test.tsx
src/ui/v2-surface.tsx
tests/v2-ui/v2-surface.test.tsx
```

提交信息：

```
build-32: U-06 CSV import flow wired into V2Surface mine page
```

---

## 九、提交回执格式

```
U-06（build-32）执行回执

1. 专项测试结果：import-flow X passed / v2-surface Y passed, Z failed
2. 全量测试结果：A passed, B failed, C skipped
3. TypeCheck：N errors
4. Lint：N problems
5. Build：success/failure
6. HEAD：commit-hash
7. git status --short 输出（粘贴完整输出，确认无未提交的批次内文件）
8. 夹具期望计数来源说明（引用 import-parse.test.ts 的哪条断言）
```