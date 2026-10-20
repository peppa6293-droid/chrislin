# EXEC-D-01 执行指令（build-37：V2 现金支出双写接通 V1 账本）

**角色：** 执行者
**基线：** build-36 验收后的 HEAD `e9d25e1`；全量 386 passed / 80 skipped / 0 failed；`npm run lint` 为有效门槛
**目标：** V2 快速记账与导入写入的 `CASH_DEBIT` 支出，在同一事务内镜像写入 V1 账本 `expense_records`，使 V1 财务模型（`getHomeApplicationState` / 月度模型）实时反映 V2 记账；**不**改 schema、**不**改 V1 模型读取路径、**不**接入 Production 入口
**日期：** 2026-10-20
**修订：** v1（方案 A「双写」已由用户拍板，本指令即该方案的精确执行契约）

---

## 〇、为什么是这个范围（必读）

现状：`V2ExpenseService.recordCashDebitExpense` 写 `expenses` 表（schema V6），`V2ImportService.writeConfirmedImport` 经 `repositories.writeImportBatchAtomically` 写同一张表；而 `buildMonthlyModelInput`（`src/application/monthly-model-service.ts:47,67`）读的是 `expense_records`（经 `listExpenses` / `variableSpending`）。两套账本之间没有任何链路，导致"记账成功但任务推荐与财务结果不变"。

已评估并被否决的替代方案：**不要**改 `buildMonthlyModelInput` 让它读 `expenses` 表（动冻结模型层，回归面过大）；**不要**只改界面汇总冒充同步。唯一授权路径就是本指令的双写。

---

## 一、背景与边界

**双写的两个入口（必须全部覆盖，缺一不可）：**

| 入口 | 文件 | 现状写入 |
|---|---|---|
| 快速记账 | `src/application/v2-expense-service.ts` `recordCashDebitExpense`（:118） | `repositories.createV2Expense` + 回读 |
| 账单导入 | `src/application/v2-import-service.ts` `writeConfirmedImport`（:200） | `repositories.writeImportBatchAtomically`（内部 `db.transaction`，`src/persistence/repositories.ts:1732`） |

**镜像目标表 `expense_records` 的形状（`src/persistence/migrations.ts:68` + V4 迁移追加的 `business_date`，:216）：**

```
id TEXT PRIMARY KEY
profile_id TEXT NOT NULL
amount TEXT NOT NULL
occurred_at TEXT NOT NULL
kind TEXT NOT NULL CHECK (kind IN ('ESSENTIAL','VARIABLE'))
category TEXT CHECK (...12 个枚举或 NULL...)
note TEXT
created_at TEXT NOT NULL
business_date TEXT
```

V1 读取侧（不得修改，只供你理解口径）：`listExpenses(from, through)` 按 `business_date` 过滤（`repositories.ts:894`）；`variableSpending` 只累加 `kind='VARIABLE'`（`repositories.ts:1935`）；`listExpenses` 读回时 `category` 为 NULL 会被当作 `'OTHER_VARIABLE'`。

**本批次允许改动的文件（共 4 个，除此之外一律不动）：**

| 类型 | 文件 |
|---|---|
| 修改 | `src/persistence/repositories.ts`（仅新增一个双写仓储方法 + 在 `writeImportBatchAtomically` 既有事务内追加镜像插入） |
| 修改 | `src/application/v2-expense-service.ts`（仅 `recordCashDebitExpense` 改走双写方法；映射构造放这里） |
| 新增 | `tests/v2-ledger/ledger-sync.test.ts` |
| 修改 | `tests/v2-ledger/import-write.test.ts`（新增镜像断言用例，现有用例不删改语义） |

**禁止触碰：**
- `src/persistence/migrations.ts`（无 schema 变更，`expense_records` 现有列足够）
- `src/model/` 全部文件（含 `types.ts`、`monthly-model.ts`、`v2-task-selector.ts`）
- `src/application/monthly-model-service.ts`、`product-service.ts`、`financial-maintenance-service.ts`（V1 读取路径一字不动）
- `src/ui/` 全部；禁止接入 `App.tsx` / `main.tsx`
- `src/application/v2-expense-service.ts` 的信用卡三个方法（`recordCreditExpense`、`recordCreditCardPayment` 等）——**只有 `CASH_DEBIT` 需要镜像**
- `package.json`、`biome.json`、`vitest.config.ts`、`src-tauri/` 全部
- 工作区未跟踪文件（`.claude/`、`pelican-bike.html`、`pelican-cycling.html`）不得提交、不得删除

---

## 二、映射契约（照抄，不得自创字段对应）

每条镜像的 `expense_records` 行按下表构造，V1 行与 V2 行 **1:1 且共用同一个 id**（两边主键空间独立，共用 id 建立稳定关联，为未来编辑/删除同步留路）：

| expense_records 字段 | 取值 |
|---|---|
| `id` | V2 expense.id（同一 UUID） |
| `profile_id` | expense.profileId |
| `amount` | expense.amount（服务层已规范化为两位小数，原样使用） |
| `occurred_at` | expense.occurredOn（`YYYY-MM-DD` 原样；动手前看一眼 `product-service.ts:551` 现有 `saveExpense` 调用方的格式，若那是完整 ISO 时间戳则沿用其风格补 `T00:00:00.000Z`，并在回执说明你选的是哪种——两种都不影响查询，因为读取侧只按 `business_date` 过滤） |
| `kind` | `'VARIABLE'`（固定值。V1 的 `ESSENTIAL` 来自 essential_expense_items 配置，与记录流水无关；`variableSpending` 只统计 VARIABLE，这正是我们想要的口径） |
| `category` | `'OTHER_VARIABLE'`（固定值。V2 分类是自由创建的名称/图标，与 V1 的 12 值枚举无对应关系；不得猜测映射） |
| `note` | expense.description（空串则写 `null`） |
| `created_at` | `new Date().toISOString()` |
| `business_date` | expense.occurredOn（与 V2 侧 `occurredOn` 同值，保证跨月补记落进正确月份） |

---

## 三、实现要求

### 3.1 `src/persistence/repositories.ts`

1. **新增** `createV2ExpenseWithLegacyMirror(expense: <createV2Expense 的现有入参类型>, legacy: { amount: string; occurredAt: string; businessDate: string; note: string | null; createdAt: string })`：
   - 内部用 `this.db.transaction(async (transactionDb) => { ... })`（参照 `writeImportBatchAtomically` :1732 的既有用法）在**同一事务**内完成：① 现有 `createV2Expense` 的插入语句；② `INSERT INTO expense_records(id,profile_id,amount,occurred_at,kind,category,note,created_at,business_date) VALUES(?,?,?,?,?,?,?,?,?)`，`kind`/`category` 写字面量 `'VARIABLE'`/`'OTHER_VARIABLE'`。
   - 任一失败整体回滚，由事务语义保证，不要手写补偿。
   - **保留**现有 `createV2Expense` 与 `saveExpense` 不动（信用卡路径与既有调用方仍用前者；不要改 `saveExpense` 的 upsert 语义）。
2. **修改** `writeImportBatchAtomically`：在其既有事务内，对每条写入的 expense 追加同样的 `expense_records` 插入（字段按第二节映射，从 expense 对象直接派生）。批量导入的行数计数器、去重、回读逻辑一律不动。

### 3.2 `src/application/v2-expense-service.ts`

`recordCashDebitExpense` 内把 `await this.repositories.createV2Expense(expense)` 替换为构造映射对象后调用 `createV2ExpenseWithLegacyMirror`（映射构造放服务层，仓储只收现成值）。回读校验段保留，并**追加**一条镜像回读：`await this.repositories.expenseById(expense.id)` 必须非空且 `amount`、`businessDate` 与 V2 expense 一致，不一致抛 `ApplicationDataError("EXPENSE_READBACK_FAILED", ...)`（沿用现有错误码风格）。

`recordCreditExpense`、`recordCreditCardPayment`、`getMonthSummary`、`getDashboardProps` 不动。

### 3.3 失败语义

- 镜像插入失败（如外键、格式问题）→ 整个 `recordCashDebitExpense` 抛错，V2 行也不得残留（事务回滚保证）。
- 导入批次中镜像插入失败 → 整批回滚（`writeImportBatchAtomically` 既有原子性），抛错路径与现状一致。

---

## 四、测试要求

### 4.1 `tests/v2-ledger/ledger-sync.test.ts`（新增）

数据库搭建照抄 `tests/v2-ledger/import-write.test.ts` 的 `beforeEach` 模式（`NodeSqliteDatabase` → `migrateDatabase` → profile/账户/分类）；`completeOnboarding` 提交体形状先读 `tests/ui.test.tsx` 确定，不要猜。必测用例（最少 5 个）：

1. **端到端单笔**：`V2ExpenseService.recordCashDebitExpense` 记一笔当月支出 → `repositories.expenseById(同 id)` 返回镜像行，`amount`/`businessDate`/`kind==='VARIABLE'` 与映射一致。
2. **模型联动（防糊弄核心断言）**：记账前调用 `calculateMonthlyModelFromDatabase(db, month, asOfDate)` 取基准结果；记账后再调用，断言结果中与变动支出相关的字段已按基准对象推导变化（先独立算出期望值再断言，**禁止手写期望数字**；`asOfDate = localDate(new Date())` 动态计算，防跨月 flaky）。
3. **原子性**：使镜像插入失败（`vi.spyOn` 数据库层对 `expense_records` 的插入抛错，或构造必然违反约束的输入），断言 `recordCashDebitExpense` 抛错且 `getV2ExpenseById` 与 `expenseById` **双双**查不到该行。
4. **持久性（退出重开）**：写入后 `db.close()`，用同一文件路径重新打开数据库并 `migrateDatabase`（幂等），断言 `expenseById` 仍能查到镜像行。
5. **信用卡不镜像**：`recordCreditExpense`（一次性）记一笔后，`expenseById` 返回 `null`（确认双写范围只限 CASH_DEBIT）。

### 4.2 `tests/v2-ledger/import-write.test.ts`（扩展）

- 新增用例：夹具导入成功后，`expense_records` 中镜像行数 === `writtenRows`，抽样一行的 `amount`/`business_date` 与导入候选一致。
- 新增用例：同一文件二次导入全部去重后，镜像行数不增长。
- 现有用例断言不得删改语义。

---

## 五、验证命令（全部在项目根目录执行，逐条通过才算完成）

```bash
cd "/Users/linte/Documents/ChatGPT/个人财务模型app开发项目 2"

# 5.1 专项
env NODE_ENV=test npx vitest run tests/v2-ledger/ledger-sync.test.ts tests/v2-ledger/import-write.test.ts --reporter=verbose

# 5.2 全量回归（386 + 本批净增，80 skipped 不变，0 failed）
env NODE_ENV=test npx vitest run --reporter=dot

# 5.3 类型检查
npm run typecheck

# 5.4 lint
npm run lint

# 5.5 构建
npm run build
```

---

## 六、红线（违反即 RETURN）

1. 禁止修改第一节「禁止触碰」清单中的任何文件。
2. 禁止任何 schema 变更（`migrations.ts` 不动，不加列、不加表）。
3. 镜像范围只有 `CASH_DEBIT`；信用卡与还款路径不得产生 `expense_records` 行。
4. 映射必须逐字段照抄第二节：`kind='VARIABLE'`、`category='OTHER_VARIABLE'`、共用 id；禁止发明分类映射。
5. 双写必须同事务；禁止"先写 V2 再补 V1"的非事务顺序。
6. 测试命令必须带 `env NODE_ENV=test`；禁止网络请求；禁止安装新依赖。
7. 不得提交未跟踪文件。

---

## 七、提交

仅提交下列文件（逐一 `git add` 显式路径，禁止 `git add -A`）：

```
src/persistence/repositories.ts
src/application/v2-expense-service.ts
tests/v2-ledger/ledger-sync.test.ts
tests/v2-ledger/import-write.test.ts
```

提交信息：

```
build-37: D-01 dual-write V2 cash expenses into V1 ledger (ledger sync)
```

---

## 八、提交回执格式

```
D-01（build-37）执行回执

1. 专项测试结果：ledger-sync X passed / import-write Y passed, Z failed
2. 全量测试结果：A passed, B failed, C skipped（基线 386/0/80）
3. TypeCheck：N errors；Lint：N problems；Build：success/failure
4. occurred_at 格式选择（裸日期或 ISO 时间戳）及参照的既有调用方
5. 模型联动断言说明：基准对象哪个字段、推导出的期望值是什么
6. HEAD：commit-hash
7. git status --short 输出
```