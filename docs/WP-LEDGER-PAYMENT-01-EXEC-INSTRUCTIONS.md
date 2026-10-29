# WP-LEDGER-PAYMENT-01 执行说明（v1.0）

> 作者：任务书作者 / 复核方。执行方照做即可，不要自行扩大范围。
> 本包只做两件事：**修一个已复现的显示错位** + **把 Rust 侧未提交的两个文件补进提交**。

---

## 0. 一句话

已提交的前端调用 `save_export_file`，但 HEAD 的 Rust 里没有这条命令；同时固定支出「支付记录」把同类别的两笔支付都显示成同一个条目名。本包补齐 Rust 入库并修掉错位，出一个可用的提交。

---

## 1. 问题证据（复核方已实测，不必重查）

### 1.1 导出备份在新 checkout 上必失败

- `src/persistence/export-file.ts` 调用 `invoke("save_export_file")`，该文件已在 `2bd9904` 入库。
- `git show HEAD:src-tauri/src/lib.rs | grep -c save_export_file` → **0**。
- 工作区 `src-tauri/src/lib.rs` 有该命令（第 1838 行定义，2335/2351 两处注册），但未提交：`117 insertions / 12 deletions`。
- 结论：本机（工作区）能用，**新 clone / 重装 / 别人拿 HEAD 构建，点「导出备份」必报 command not found**。测试覆盖不到，因为 vitest 不跑 Tauri 运行时。

### 1.2 支付记录张冠李戴

`src/application/ux-ledger-service.ts` 的 `listEssentialPayments` 从 `expense_records` 读行，但该表没有 `item_id` 列；函数用 **类别**反查条目名，并把 `itemId` 写死为空：

```ts
itemId: "",
itemName: items.find((item) => item.category === text(row, "category"))?.name ?? "固定支出",
```

实测（临时测试已删除，结论保留）：HOUSING 下同时有「房租 3000」「物业费 200」，各记一笔支付后，两笔都显示 **物业费**，`itemId` 均为 `""`。页面 `src/ui/FixedExpensesPage.tsx:349` 直接渲染 `payment.itemName`，用户看到的就是错名字。

根因：条目身份只存在于 `app_metadata` 的 `ux.essential-payments.v1`（`recordEssentialPayment` 写入的 payment 记录含 `id`/`itemId`/`itemName`），读取时没用上。

---

## 2. 范围与红线

**只允许改这 4 个路径：**

| 路径 | 动作 |
|---|---|
| `src/application/ux-ledger-service.ts` | 改 1 个函数 + 加 1 个私有 helper |
| `tests/v2-ledger/essential-payment-identity.test.ts` | 新建 |
| `src-tauri/src/lib.rs` | 不改代码，只提交已有改动 |
| `src-tauri/src/startup_exclusion.rs` | 不改代码，只提交已有改动 |

**不许动：** `src/model/**`、`src/persistence/repositories.ts`、`src/persistence/migrations.ts`（schema 冻结）、`src/ui/**`、`src/runtime/**`、`package.json`、`docs/**`、任何既有测试、`Cargo.toml`、`Cargo.lock`。

**不许做：** 新建表/加列、改 `recordEssentialPayment` 的写入格式、改 UI 组件、`git add -A`、`git add .`、`git commit -a`。

---

## 3. 改动一：支付记录按 id 取回条目身份

文件：`src/application/ux-ledger-service.ts`

### 3.1 在 `readAuditLog` 之后插入 helper

锚点：`export async function readAuditLog(...)` 函数结束（`return []; }` 之后），`export async function listLedgerExpenses` 之前。

```ts
async function readMetadataEntries(
  db: SqlDatabase,
  key: string,
): Promise<Record<string, unknown>[]> {
  const raw = await new Repositories(db).getMeta(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}
```

### 3.2 整段替换 `listEssentialPayments`

把当前实现（从 `export async function listEssentialPayments(` 到对应的 `}`）整段替换为：

```ts
export async function listEssentialPayments(
  db: SqlDatabase,
  month?: string,
): Promise<EssentialPaymentRecord[]> {
  const rows = await db.select(
    `SELECT id,amount,occurred_at,category,note,created_at FROM expense_records
     WHERE kind='ESSENTIAL'${month ? " AND business_date LIKE ?" : ""} ORDER BY business_date DESC,created_at DESC`,
    month === undefined ? [] : [`${month}%`],
  );
  if (rows.length === 0) return [];
  const items = await new Repositories(db).listEssentialExpenses();
  const logged = new Map(
    (await readMetadataEntries(db, ESSENTIAL_PAYMENT_KEY)).map((entry) => [
      String(entry.id),
      entry,
    ]),
  );
  return rows.map((row) => {
    const category = text(row, "category") as ExpenseCategory;
    const record = logged.get(text(row, "id"));
    const loggedName = record && typeof record.itemName === "string" ? record.itemName : "";
    return {
      id: text(row, "id"),
      itemId: record && typeof record.itemId === "string" ? record.itemId : "",
      itemName: loggedName || items.find((item) => item.category === category)?.name || "固定支出",
      category,
      amount: text(row, "amount"),
      paidOn: text(row, "occurred_at").slice(0, 10),
      note: nullableText(row, "note"),
      recordedAt: text(row, "created_at"),
    };
  });
}
```

**要点：**

- 金额/日期/备注仍以 `expense_records` 为准（账本是真源）；元数据只提供 `itemId`/`itemName`。
- 条目在付款后改名，历史支付保留当时的名字（快照语义），这是有意的。
- 元数据缺失（超过 300 条上限被裁剪、或旧数据）时退回按类别取名字，**不得抛错**。
- 不要改 `recordEssentialPayment`：它写的 entry 已经含 `id`/`itemId`/`itemName`。

---

## 4. 改动二：新增测试

新建 `tests/v2-ledger/essential-payment-identity.test.ts`，全文如下：

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { completeOnboarding } from "../../src/application/product-service.js";
import {
  listEssentialPaymentItems,
  listEssentialPayments,
  recordEssentialPayment,
  saveEssentialItems,
} from "../../src/application/ux-ledger-service.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import { localDate } from "../../src/ui/date.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

let db: NodeSqliteDatabase;
let repositories: Repositories;
let asOfDate: string;

beforeEach(async () => {
  asOfDate = localDate(new Date());
  db = new NodeSqliteDatabase();
  repositories = new Repositories(db);
  await migrateDatabase(db, `${asOfDate}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    asOfDate,
  );
});

afterEach(() => db.close());

async function payByAmount(
  items: Array<{ id: string; name: string; monthlyAmount: string }>,
  name: string,
  amount: string,
): Promise<void> {
  const item = items.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`missing essential item: ${name}`);
  await recordEssentialPayment(db, {
    itemId: item.id,
    amount,
    paidOn: asOfDate,
  });
}

describe("fixed-expense payments keep their own item identity", () => {
  it("two items in the same category are listed under their own names", async () => {
    await saveEssentialItems(
      db,
      [
        { name: "房租", category: "HOUSING", monthlyAmount: "3000" },
        { name: "物业费", category: "HOUSING", monthlyAmount: "200" },
      ],
      asOfDate,
    );
    const items = await listEssentialPaymentItems(db, asOfDate);
    await payByAmount(items, "房租", "3000");
    await payByAmount(items, "物业费", "200");

    const payments = await listEssentialPayments(db, asOfDate.slice(0, 7));
    const byAmount = new Map(payments.map((payment) => [payment.amount, payment]));
    const rent = items.find((item) => item.name === "房租");
    const management = items.find((item) => item.name === "物业费");
    if (!rent || !management) throw new Error("seed items missing");

    expect(byAmount.get("3000")?.itemName).toBe("房租");
    expect(byAmount.get("3000")?.itemId).toBe(rent.id);
    expect(byAmount.get("200")?.itemName).toBe("物业费");
    expect(byAmount.get("200")?.itemId).toBe(management.id);
    expect(new Set(payments.map((payment) => payment.itemName)).size).toBe(2);
  });

  it("falls back without throwing when the payment log was trimmed", async () => {
    // BASIC_FOOD 没有 onboarding 预置条目，类别反查结果唯一，断言不依赖排序。
    await saveEssentialItems(
      db,
      [{ name: "菜钱", category: "BASIC_FOOD", monthlyAmount: "800" }],
      asOfDate,
    );
    const items = await listEssentialPaymentItems(db, asOfDate);
    await payByAmount(items, "菜钱", "800");
    await repositories.setMeta("ux.essential-payments.v1", "[]");

    const payments = await listEssentialPayments(db, asOfDate.slice(0, 7));
    expect(payments).toHaveLength(1);
    expect(payments[0]?.itemId).toBe("");
    expect(payments[0]?.itemName).toBe("菜钱");
    expect(payments[0]?.amount).toBe("800");
  });
});
```

说明：

- 第二个用例用 `BASIC_FOOD`（onboarding 不预置该类别），退回结果是唯一的「菜钱」，断言不依赖列表排序。
- 断言失败先报数字与失败原因，不要改断言凑绿。

---

## 5. 改动三：Rust 两个文件入库（不改代码）

这两个文件的改动**已经存在于工作区**，本包只负责验证并提交：

- `src-tauri/src/lib.rs`：新增 `save_export_file` 命令（定义在 1838 行附近，注册在 2335、2351 两处）+ 数据目录隔离校验。
- `src-tauri/src/startup_exclusion.rs`：数据目录身份校验（拒绝符号链接 / 非本人所有 / 被重定向的路径）。

两者必须**同一个提交**：`lib.rs` 的新代码引用了 `startup_exclusion` 新增的函数，拆开会导致 HEAD 编译不过。

提交前必须做一次冷启动：

```bash
cd src-tauri && cargo check --offline   # 期望：Finished，无 error
```

然后在应用里启动一次，确认能进首页；若启动即报 `*_IDENTITY_INVALID` / `*_REDIRECTED` / `*_UNAVAILABLE`，**停下来报告**，不要自行放宽校验。

复核方已实测（工作区当前代码 + 干净目标目录）：`cargo check --offline` **exit 0，27s 完成**，仅一条既存 warning（`src/wp02_preview_isolation.rs:2` 未使用的 `PathBuf`，不属于本包文件，不必处理）。

> 备注：本机 `cargo check` 若报 `failed to read plugin permissions ... autogenerated/commands/app_hide.toml`，是 `target/` 缓存不完整，改用干净目标目录验证：
> `CARGO_TARGET_DIR=/tmp/rust-check cargo check --offline`。

---

## 6. 验证（全部通过才算完）

```bash
cd "个人财务模型app开发项目 2"

npx tsc --noEmit                      # 期望 exit 0，无输出
npx biome check src tests             # 期望 165 files checked, no fixes applied
npx vitest run tests/v2-ledger/essential-payment-identity.test.ts   # 期望 2 passed
npx vitest run                        # 期望 51 files / 528 passed | 44 skipped | 0 failed
```

提交后（在新树里核对，不看工作区）：

```bash
git show HEAD:src-tauri/src/lib.rs | grep -c save_export_file     # 期望 3（1 处定义 + 2 处注册）
git show HEAD:src/application/ux-ledger-service.ts | grep -c "readMetadataEntries"  # 期望 2
```

手工冒烟（Tauri 应用内）：

1. 流水页点「导出备份」→ `~/Downloads` 出现当天日期的 `.json` 与 `.csv`，页面提示两个路径。
2. 固定支出页记两笔同类别支付（如房租 3000、物业费 200）→ 支付记录里两行名字不同且正确。
3. 冷启动一次，确认首页正常。

---

## 7. 提交

先确认工作区只有预期改动（其余未提交项保持原样，不要顺手带走）：

```bash
git status --porcelain | wc -l        # 记录基线数字 B
git add src-tauri/src/lib.rs \
        src-tauri/src/startup_exclusion.rs \
        src/application/ux-ledger-service.ts \
        tests/v2-ledger/essential-payment-identity.test.ts
git diff --cached --name-only         # 期望正好 4 行
```

提交信息：

```
fix(ledger): 固定支出支付记录保留条目身份 + 补齐 save_export_file 原生命令

- listEssentialPayments 按支付 id 从 ux.essential-payments.v1 取回 itemId/itemName，
  不再按类别反查；同类别多条目不再张冠李戴，元数据缺失时降级不抛错
- 新增 essential-payment-identity 测试：两笔同类别支付名字必须不同；日志被裁剪时降级
- src-tauri：入库 save_export_file 命令与数据目录身份校验。此前前端已提交、后端未提交，
  新 checkout 上「导出备份」必定失败
```

提交后：`git status --porcelain | wc -l` 应等于 `B - 4`（`src-tauri` 两文件 + `src` 一文件 + 新测试各减一）。

---

## 8. 完成标准（DoD）

- [ ] `listEssentialPayments` 不再出现 `itemId: ""` 字面量，改从元数据取值
- [ ] 同类别两笔支付的 `itemName` 不同且各自正确
- [ ] 元数据被裁剪/缺失时返回降级名字，不抛错
- [ ] 新测试 2/2 通过；全量 528 passed / 44 skipped / 0 failed
- [ ] `tsc` 0 错，`biome check src tests` 干净
- [ ] HEAD 的 `src-tauri/src/lib.rs` 含 2 处 `save_export_file`
- [ ] 应用内导出备份可用（两个文件落到 Downloads）
- [ ] 应用冷启动正常
- [ ] 提交只含 4 个文件，未带走 `package.json`、`docs/**`、其他未提交项

---

## 9. 失败处理

- **`cargo check` 报错**：先看是不是 `target/` 缓存问题（见 §5 备注）；仍失败就停，把报错原文贴回来，不要改 Rust 逻辑。
- **启动报身份校验错误**：停，报告，连同 `~/Library/Application Support` 下的实际权限/符号链接情况一起贴回来。
- **测试断言与预期不符**：报实际值，不要改断言或改实现凑绿。
- **`git diff --cached` 多于 4 行**：`git reset`（只撤销暂存，不动工作区）后重来。
- **需要回滚**：`git reset --soft HEAD~1` 撤销提交；Rust 两文件本身已在工作区，不会丢。

---

## 10. 不在本包范围（已知、记录在案）

1. 新建账本时固定支出条目直接拿英文枚举当名字（界面出现 `HOUSING`），`src/application/product-service.ts` 既有行为，HEAD~1 就存在，本包不修。
2. `disabled` 卡片头部的「为什么 →」「消费详情 →」仍是死按钮（只 `pointer-events:none`）。
3. `ux.essential-payments.v1` 上限 300 条（约 5 年按月支付），超出后老支付记录降级为按类别取名。
4. `recategorizeLedgerExpenses` 的总额校验在事务提交之后才比对，失败不会回滚（当前不可能触发，属防御性死代码）。

---

## 11. 执行记录与勘误（v1.1，复核方填写）

**执行提交：`e21f1e5`**，4 文件 / +305 −31，`git status` 54 → 50，`src` 与 `tests` 零残留。

复核结论：**PASS**。独立复验数据：

- `git show --name-only e21f1e5` 正好 4 个文件；`src-tauri` 两文件与 HEAD 逐字节一致（SHA256 相同，确认只入库未改逻辑）。
- 隔离构建（`git archive HEAD` → /tmp，不碰工作区）：`tsc` exit 0、`biome` 165 files clean、`vitest` 51 files / **528 passed | 44 skipped | 0 failed**。
- `grep -c readMetadataEntries` = 2，`grep -c "itemId: \"\""` = 0；HEAD 的 Rust 中 `save_export_file` = 3。
- 变异验证（在 /tmp 副本上做，改动未进仓库）：把身份回退成旧逻辑 → 测试 1 失败（`expected 'HOUSING' to be '房租'`）；只把 `itemId` 置空 → 测试 1 失败（`expected '' to be '<uuid>'`）；把返回列表改成抛错 → 两个用例都失败。还原后 2/2 通过，`sha256` 与仓库文件一致。

**本任务书自身两处错误（由执行方发现并正确处理，记录在案）：**

1. §4 测试里的 `note: null` 与 `recordEssentialPayment` 的 `note?: string` 不符，会触发 `TS2322`；执行方改为省略该字段，断言未变。
2. §6 的期望值写成 `save_export_file` = 2，实际应为 3（1 处定义 + 2 处注册）。执行方按实际证据报告，未改代码迎合数字。

**唯一未闭环的 DoD 项：** GUI 手工冒烟（点「导出备份」确认 Downloads 双文件、固定支出页手记两笔同类别支付）。自动层已覆盖命令注册与条目身份，最终确认留给 Owner。
