# build-22 提交执行指令

**角色：** 执行者
**基线：** `df85920`（build-21: freeze V2 candidate manifest）
**目标：** 修复 3 项 LOW 问题后，将当前工作树提交为 `build-22`
**日期：** 2026-10-19

---

## 一、提交前修复（3 项，全部完成后方可 stage）

### FIX-1：修正 `tests/v4-acceptance-sandbox.test.ts` 缩进

第 35 行 `{ version: 5 },` 当前缩进为 6 空格，应与同级 `{ version: 4 },` 对齐（8 空格）。

修复后该断言块应为：

```ts
      expect(await db.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
        { version: 5 },
      ]);
```

### FIX-2：将 `.eco-tmp/` 加入 `.gitignore`

在 `.gitignore` 末尾已有的 `.ekko-tmp/` 之后追加一行：

```
.eco-tmp/
```

### FIX-3：删除项目根目录无关文件

删除以下 3 个与本项目无关的动画演示文件：

```
pelican-bicycle.html
pelican-riding-bicycle.html
pelican_bike_animation.html
```

使用 `rm`（它们从未被 git 跟踪，无需 `git rm`）。

---

## 二、提交范围

### 修改文件（6）

- `src/persistence/migrations.ts`
- `src/persistence/repositories.ts`
- `tests/future-schema-guard.test.ts`
- `tests/product-restart.test.ts`
- `tests/v4-acceptance-sandbox.test.ts`
- `tests/v4-foundation.test.ts`

### 新增文件（全部 `git add`）

- `docs/CATEGORY_NAME_REVIEW_CHECKLIST.md`
- `docs/V2-CASHFLOW-PLANNING.md`
- `docs/V2-DASHBOARD-ISOLATION.md`
- `docs/V2-QUICK-ENTRY-MOCK.md`
- `docs/V2-SAVINGS-GOAL-ISOLATION.md`
- `docs/V2-TRENDS-ISOLATION.md`
- `docs/WP-IMPORT-ARCHITECTURE.md`
- `docs/WP-IMPORT-FEASIBILITY-REPORT.md`
- `docs/BUILD-22-COMMIT-INSTRUCTIONS.md`（本文件）
- `src/model/v2-cashflow.ts`
- `src/model/v2-expense.ts`
- `src/model/v2-quick-entry.ts`
- `src/model/v2-reconciliation.ts`
- `src/model/v2-savings-goal.ts`
- `src/model/v2-trends.ts`
- `src/model/v2-types.ts`
- `src/ui/v2-dashboard.css`
- `src/ui/v2-dashboard.tsx`
- `src/ui/v2-trends.css`
- `src/ui/v2-trends.tsx`
- `tests/fixtures/v2-import/`（整个目录）
- `tests/v2-ledger/`（整个目录）
- `tests/v2-ui/`（整个目录）

### 修改文件（追加）

- `.gitignore`（FIX-2）

### 禁止进入提交

- `.ekko-tmp/`（已在 .gitignore）
- `.eco-tmp/`（FIX-2 后进入 .gitignore）
- `pelican*.html`（FIX-3 删除）
- 任何 Production App/DB 路径

---

## 三、提交前验证（必须全部通过）

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"
npx tsc --noEmit
npm run build:web
NODE_ENV=test npx vitest run
```

要求：
- `tsc --noEmit`：零错误
- `build:web`：成功
- 全量测试：0 failed（允许 2 个 skipped describe，与当前一致）

任一失败：停止提交，报告失败输出，不修复不属于本次范围的测试。

---

## 四、提交与验证

```bash
git add -A   # 确认 .eco-tmp/ 和 pelican 文件已被忽略/删除后不会出现
git status --short   # 人工核对无意外文件
git commit -m "build-22: V2 isolation layer, Schema V5 accounts/categories, CSV import fixtures"
```

提交后验证：

```bash
git show --stat HEAD | head -60
git log --oneline -2
git status --short   # 必须只剩 .ekko-tmp/ 相关或为空
```

---

## 五、回执要求

执行者提交后报告：

1. 最终 commit hash（完整 40 位）
2. `git show --stat HEAD` 的文件计数（预期：31 个文件，8M + 23A）
3. 三项验证的通过证据（测试总数/通过数）
4. 任何偏离本指令的操作及原因

**禁止：** 不修改本指令范围外的文件；不触碰 Production；不 push；不合并；不删除 `.ekko-tmp/`。

</content>