import { describe, expect, it } from "vitest";
import {
  ApplicationModelError,
  buildMonthlyModelInput,
} from "../src/application/monthly-model-service.js";
import { completeOnboarding, getHomeApplicationState } from "../src/application/product-service.js";
import {
  listEssentialPaymentItems,
  listEssentialPayments,
  recordEssentialPayment,
  saveEssentialItems,
} from "../src/application/ux-ledger-service.js";
import { ModelValidationError } from "../src/model/errors.js";
import { money } from "../src/model/money.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import {
  ensureV2LedgerDefaults,
  recordV2CashExpenseForDatabase,
} from "../src/runtime/tauri-bootstrap.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const AS_OF = "2026-11-01";

/** Every business table the fixed-expense paths may touch, for before/after equality. */
const BUSINESS_TABLES = [
  "profiles",
  "financial_settings",
  "settings_revisions",
  "income_records",
  "actual_income_revisions",
  "planning_income_revisions",
  "planning_income_month_revisions",
  "essential_expense_items",
  "essential_expense_revisions",
  "essential_expense_snapshots",
  "cash_accounts",
  "cash_account_revisions",
  "cash_account_lifecycle_revisions",
  "cash_balance_snapshots",
  "assets",
  "asset_revisions",
  "asset_value_snapshots",
  "debts",
  "debt_revisions",
  "debt_period_facts",
  "expense_categories",
  "expense_records",
  "expenses",
  "accounts",
  "income_entries",
  "fixed_expense_plans",
  "import_batches",
  "app_metadata",
] as const;

async function tableContents(db: NodeSqliteDatabase): Promise<Record<string, unknown[]>> {
  const contents: Record<string, unknown[]> = {};
  for (const table of BUSINESS_TABLES) {
    contents[table] = await db.select(`SELECT * FROM ${table} ORDER BY rowid`);
  }
  return contents;
}

async function seed(
  options: { income?: string; safetyMonths?: number; withVariableExpense?: boolean } = {},
) {
  const db = new NodeSqliteDatabase();
  await migrateDatabase(db, `${AS_OF}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: options.income ?? "2000",
      essentialExpenses: [
        { category: "HOUSING", monthlyAmount: "1000" },
        { category: "UTILITIES_COMMUNICATIONS", monthlyAmount: "200" },
      ],
      cashAccounts: [{ name: "现金", balance: "5000", includeInSafetyResources: true }],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: options.safetyMonths ?? 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    AS_OF,
  );
  await ensureV2LedgerDefaults(db);
  if (options.withVariableExpense) {
    await recordV2CashExpenseForDatabase(
      db,
      {
        amount: "50",
        dateTime: `${AS_OF}T00:00:00.000Z`,
        businessDate: AS_OF,
        category: "FOOD",
        note: "午饭",
      },
      AS_OF,
    );
  }
  return db;
}

describe("V15/V17/V19 新增固定支出的服务事实与模型变化", () => {
  it("V19 新增 300：12 组预期逐项成立，且源事实只多一条项目与一条修订", async () => {
    const db = await seed({ withVariableExpense: true });
    try {
      const before = await getHomeApplicationState(db, AS_OF);
      const beforeTables = await tableContents(db);
      const draftId = globalThis.crypto.randomUUID();

      await saveEssentialItems(
        db,
        [{ id: draftId, name: "合成保险", category: "INSURANCE", monthlyAmount: "300.00" }],
        AS_OF,
      );

      const after = await getHomeApplicationState(db, AS_OF);
      // 1 计划收入 / 2 必要支出 / 3 债务 / 4 基础盈余 / 5 核心义务
      expect(after.planningIncome).toBe("2000");
      expect(before.essentialExpenses).toBe("1200");
      expect(after.essentialExpenses).toBe("1500");
      expect(after.totalDebt).toBe("0");
      expect(after.mandatoryDebtService).toBe("0");
      expect(before.baseSurplus).toBe("800");
      expect(after.baseSurplus).toBe("500");
      expect(after.monthlyCoreObligations).toBe("1500");
      // 6 现金 / 安全资源
      expect(after.currentCash).toBe("5000");
      expect(after.safetyResources).toBe("5000");
      // 7 安全目标 / 安全缺口
      expect(before.safetyTargetResources).toBe("1200");
      expect(after.safetyTargetResources).toBe("1500");
      expect(after.safetyGap).toBe("0");
      // 8 覆盖月数：按现有 Decimal 精度对照除法
      expect(money(before.safetyCoverageMonths ?? "0").eq(money("5000").div(money("1200")))).toBe(
        true,
      );
      expect(money(after.safetyCoverageMonths ?? "0").eq(money("5000").div(money("1500")))).toBe(
        true,
      );
      expect(money(after.cashCoverageMonths ?? "0").eq(money("5000").div(money("1500")))).toBe(
        true,
      );
      // 9 用户期望 / 实际弹性消费
      expect(after.desiredMonthlyDiscretionarySpending).toBe("1000");
      expect(after.currentMonthSpending).toBe("50");
      // 10 建议 / 11 剩余与超出 / 12 状态与现金底线
      expect(before.recommendedMonthlySpending).toBe("800");
      expect(after.recommendedMonthlySpending).toBe("500");
      expect(before.remainingSpendingCapacity).toBe("750");
      expect(after.remainingSpendingCapacity).toBe("450");
      expect(after.amountAboveRecommendation).toBe("0");
      expect(after.spendingStatus).toBe("NORMAL");
      expect(after.cashFloorMet).toBe(true);

      // V17：只有静态项目与修订增加；快照与全部非固定支出表逐行不变。
      const afterTables = await tableContents(db);
      for (const table of BUSINESS_TABLES) {
        if (table === "essential_expense_items" || table === "essential_expense_revisions") {
          continue;
        }
        expect(afterTables[table], table).toEqual(beforeTables[table]);
      }
      expect((beforeTables.essential_expense_items ?? []).length).toBe(2);
      expect((afterTables.essential_expense_items ?? []).length).toBe(3);
      expect((beforeTables.essential_expense_revisions ?? []).length).toBe(0);
      expect((afterTables.essential_expense_revisions ?? []).length).toBe(1);
      expect((afterTables.essential_expense_snapshots ?? []).length).toBe(2);
    } finally {
      db.close();
    }
  });

  it("V19 第二夹具 新增 1000：必要支出 1200→2200、盈余 800→-200、建议 800→0、超出 0→50", async () => {
    const db = await seed({ withVariableExpense: true });
    try {
      const before = await getHomeApplicationState(db, AS_OF);
      await saveEssentialItems(
        db,
        [{ name: "整租差价", category: "INSURANCE", monthlyAmount: "1000" }],
        AS_OF,
      );
      const after = await getHomeApplicationState(db, AS_OF);
      expect(before.essentialExpenses).toBe("1200");
      expect(after.essentialExpenses).toBe("2200");
      expect(before.baseSurplus).toBe("800");
      expect(after.baseSurplus).toBe("-200");
      expect(before.spendingStatus).toBe("NORMAL");
      expect(after.spendingStatus).toBe("STRUCTURAL_DEFICIT");
      expect(before.recommendedMonthlySpending).toBe("800");
      expect(after.recommendedMonthlySpending).toBe("0");
      expect(before.remainingSpendingCapacity).toBe("750");
      expect(after.remainingSpendingCapacity).toBe("0");
      expect(before.amountAboveRecommendation).toBe("0");
      expect(after.amountAboveRecommendation).toBe("50");
      expect(after.desiredMonthlyDiscretionarySpending).toBe("1000");
      expect(after.currentMonthSpending).toBe("50");
    } finally {
      db.close();
    }
  });

  it("V15/V22 新增只写 1 主表 + 1 修订且同日可读，前一日不可见；首次设置 2 类 = 2 项目 2 快照", async () => {
    const db = await seed();
    try {
      const seededItems = await listEssentialPaymentItems(db, AS_OF);
      expect(seededItems).toHaveLength(2);
      expect(seededItems.map((item) => item.category).sort()).toEqual([
        "HOUSING",
        "UTILITIES_COMMUNICATIONS",
      ]);
      expect((await db.select("SELECT id FROM essential_expense_snapshots")).length).toBe(2);

      const draftId = globalThis.crypto.randomUUID();
      await saveEssentialItems(
        db,
        [{ id: draftId, name: " 合成保险 ", category: "INSURANCE", monthlyAmount: "300.00" }],
        AS_OF,
      );
      const today = await listEssentialPaymentItems(db, AS_OF);
      const found = today.filter((item) => item.id === draftId);
      expect(found).toHaveLength(1);
      expect(found[0]?.name).toBe(" 合成保险 ");
      expect(found[0]?.category).toBe("INSURANCE");
      expect(money(found[0]?.monthlyAmount ?? "0").eq(money("300"))).toBe(true);
      const before = await listEssentialPaymentItems(db, "2026-10-31");
      expect(before.filter((item) => item.id === draftId)).toHaveLength(0);

      const master = await db.select<{ active: number }>(
        "SELECT active FROM essential_expense_items WHERE id=?",
        [draftId],
      );
      expect(master).toEqual([{ active: 1 }]);
      const revision = await db.select<{
        as_of_date: string;
        active: number;
        name: string;
        category: string;
      }>(
        "SELECT as_of_date,active,name,category FROM essential_expense_revisions WHERE item_id=?",
        [draftId],
      );
      expect(revision).toEqual([
        { as_of_date: AS_OF, active: 1, name: " 合成保险 ", category: "INSURANCE" },
      ]);
      expect((await db.select("SELECT id FROM essential_expense_snapshots")).length).toBe(2);
    } finally {
      db.close();
    }
  });
});

describe("V04/V05 支付：账本隔离、模型不变与输入校验", () => {
  it("V04 一笔 300.20 只进固定支出账，模型与弹性消费完全不变", async () => {
    const db = await seed({ withVariableExpense: true });
    try {
      const before = await getHomeApplicationState(db, AS_OF);
      const beforeTables = await tableContents(db);
      const item = (await listEssentialPaymentItems(db, AS_OF)).find(
        (candidate) => candidate.category === "HOUSING",
      );
      if (!item) throw new Error("缺少住房项目");
      const result = await recordEssentialPayment(db, {
        itemId: item.id,
        amount: "300.20",
        paidOn: AS_OF,
        note: "合成验收",
      });

      const after = await getHomeApplicationState(db, AS_OF);
      expect(after.essentialExpenses).toBe(before.essentialExpenses);
      expect(after.baseSurplus).toBe(before.baseSurplus);
      expect(after.recommendedMonthlySpending).toBe(before.recommendedMonthlySpending);
      expect(after.remainingSpendingCapacity).toBe(before.remainingSpendingCapacity);
      expect(after.amountAboveRecommendation).toBe(before.amountAboveRecommendation);
      expect(after.currentCash).toBe(before.currentCash);
      expect(after.currentMonthSpending).toBe("50");

      const afterTables = await tableContents(db);
      for (const table of BUSINESS_TABLES) {
        if (table === "expense_records" || table === "app_metadata") continue;
        expect(afterTables[table], table).toEqual(beforeTables[table]);
      }
      const rows = (afterTables.expense_records ?? []) as Array<Record<string, unknown>>;
      expect(rows.length).toBe((beforeTables.expense_records ?? []).length + 1);
      const essential = rows.filter((row) => row.kind === "ESSENTIAL");
      expect(essential).toHaveLength(1);
      expect(Number(essential[0]?.amount)).toBe(300.2);
      expect(essential[0]?.business_date).toBe(AS_OF);
      const variable = rows.filter((row) => row.kind === "VARIABLE");
      expect(variable).toHaveLength(1);
      const meta = JSON.parse(
        String(
          (
            await db.select<{ value: string }>(
              "SELECT value FROM app_metadata WHERE key='ux.essential-payments.v1'",
            )
          )[0]?.value ?? "[]",
        ),
      ) as Array<{ id: string }>;
      expect(meta).toHaveLength(1);
      expect(meta[0]?.id).toBe(result.payment.id);
      expect(result.monthTotal).toBe("300.2");
    } finally {
      db.close();
    }
  });

  it("V05 合法 3 例写入、非法 10 例与非法日期 2 例各 0 行", async () => {
    const db = await seed({ withVariableExpense: true });
    try {
      const item = (await listEssentialPaymentItems(db, AS_OF))[0];
      if (!item) throw new Error("缺少固定支出项目");
      const valid = ["1", "1.20", "999999999999.99"];
      for (const amount of valid) {
        await recordEssentialPayment(db, { itemId: item.id, amount, paidOn: AS_OF });
      }
      expect(
        (await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'")).length,
      ).toBe(3);
      const invalid = ["", "0", "-1", "1.001", "1e2", "+1", "01", "1,000", "NaN", "1000000000000"];
      for (const amount of invalid) {
        await expect(
          recordEssentialPayment(db, { itemId: item.id, amount, paidOn: AS_OF }),
        ).rejects.toBeTruthy();
      }
      await expect(
        recordEssentialPayment(db, { itemId: "missing-item", amount: "1", paidOn: AS_OF }),
      ).rejects.toBeTruthy();
      for (const paidOn of ["2026-02-30", "2026-13-01"]) {
        await expect(
          recordEssentialPayment(db, { itemId: item.id, amount: "1", paidOn }),
        ).rejects.toBeTruthy();
      }
      expect(
        (await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'")).length,
      ).toBe(3);
      expect(await listEssentialPayments(db, "2026-11")).toHaveLength(3);
    } finally {
      db.close();
    }
  });
});

describe("REWORK-02 真实服务：V20 提交后 home 失败与 R1-a 计划 2200", () => {
  /** V20：收入3000、计划1200、现金5000、安全目标3个月、未提供恢复期限。 */
  async function seedV20() {
    const db = new NodeSqliteDatabase();
    await migrateDatabase(db, `${AS_OF}T00:00:00.000Z`);
    await completeOnboarding(
      db,
      {
        stableMonthlyIncome: "3000",
        essentialExpenses: [
          { category: "HOUSING", monthlyAmount: "1000" },
          { category: "UTILITIES_COMMUNICATIONS", monthlyAmount: "200" },
        ],
        cashAccounts: [{ name: "现金", balance: "5000", includeInSafetyResources: true }],
        assets: [],
        debts: [],
        safetyCoverageTargetMonths: 3,
        minimumCashCoverageMonths: 1,
        desiredMonthlyDiscretionarySpending: "1000",
      },
      AS_OF,
    );
    await ensureV2LedgerDefaults(db);
    await recordV2CashExpenseForDatabase(
      db,
      { amount: "50", dateTime: `${AS_OF}T00:00:00.000Z`, businessDate: AS_OF, category: "FOOD" },
      AS_OF,
    );
    return db;
  }

  it("V20 事务已提交后 home 抛 ModelValidationError；计划按业务日清单求和恰 2200", async () => {
    const db = await seedV20();
    try {
      const before = await getHomeApplicationState(db, AS_OF);
      expect(before.essentialExpenses).toBe("1200");
      expect(before.baseSurplus).toBe("1800");
      expect(before.safetyTargetResources).toBe("3600");
      expect(before.safetyGap).toBe("0");

      const snapshotsBefore = await db.select(
        "SELECT item_id,as_of_date FROM essential_expense_snapshots ORDER BY item_id",
      );
      const draftId = globalThis.crypto.randomUUID();

      let raised: unknown;
      try {
        await saveEssentialItems(
          db,
          [{ id: draftId, name: "整租差价", category: "INSURANCE", monthlyAmount: "1000" }],
          AS_OF,
        );
      } catch (error) {
        raised = error;
      }

      // 真实异常必须出现；不许用 mock 抛错代替，根因必须是模型校验而非读写故障。
      expect(raised).toBeInstanceOf(ApplicationModelError);
      expect((raised as ApplicationModelError).code).toBe("MODEL_VALIDATION_FAILED");
      const cause = (raised as ApplicationModelError).cause;
      expect(cause).toBeInstanceOf(ModelValidationError);
      const issues = (cause as ModelValidationError).issues.map((issue) => issue.field);
      expect(issues).toContain("settings.safetyRecoveryHorizonMonths");

      // 事务已提交：项目 2→3，修订 0→1，快照不变。
      expect(await db.select("SELECT id FROM essential_expense_items")).toHaveLength(3);
      expect(
        await db.select("SELECT revision_id FROM essential_expense_revisions WHERE item_id=?", [
          draftId,
        ]),
      ).toHaveLength(1);
      expect(await db.select("SELECT revision_id FROM essential_expense_revisions")).toHaveLength(
        1,
      );
      expect(
        await db.select(
          "SELECT item_id,as_of_date FROM essential_expense_snapshots ORDER BY item_id",
        ),
      ).toEqual(snapshotsBefore);

      // 计划 2200 只能由业务日清单按 money 求和得到，不拿失败的 home 当返回证据。
      const items = await listEssentialPaymentItems(db, AS_OF);
      const planned = items
        .reduce((total, item) => total.plus(money(item.monthlyAmount)), money("0"))
        .toString();
      expect(planned).toBe("2200");
      expect(planned).not.toBe("3200");
      expect(items).toHaveLength(3);
      expect(items.filter((item) => item.id === draftId)).toHaveLength(1);
      expect(items.find((item) => item.id === draftId)?.name).toBe("整租差价");
      expect(items.find((item) => item.id === draftId)?.category).toBe("INSURANCE");
      expect(money(items.find((item) => item.id === draftId)?.monthlyAmount ?? "0").eq(1000)).toBe(
        true,
      );

      // 独立算式：3000-2200=800；3*2200=6600；6600-5000=1600。
      expect(money("3000").minus(money("2200")).toString()).toBe("800");
      expect(money("3").times(money("2200")).toString()).toBe("6600");
      expect(money("6600").minus(money("5000")).toString()).toBe("1600");

      // 不再写也不补参数：重复读取仍是 3 条、1 条修订。
      const again = await listEssentialPaymentItems(db, AS_OF);
      expect(again).toHaveLength(3);
      expect(await db.select("SELECT revision_id FROM essential_expense_revisions")).toHaveLength(
        1,
      );
      expect(await db.select("SELECT id FROM expense_records WHERE kind='ESSENTIAL'")).toHaveLength(
        0,
      );
    } finally {
      db.close();
    }
  }, 30_000);
});

/* ------------------------------------------------------------------ *
 * EVIDENCE-CLOSURE-01 补证：以下为按 24 条对应表新增的子场景。
 * 产品实现未改动；当前产品正确，故新增覆盖直接为绿，如实标「补覆盖」。
 * ------------------------------------------------------------------ */

/** PLAN §3：undefined 在 JSON 边界会消失，故以标记保留字段存在性。 */
function markUndefined(value: unknown): unknown {
  if (value === undefined) return { $undefined: true };
  if (Array.isArray(value)) return value.map(markUndefined);
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      Object.defineProperty(output, key, {
        value: markUndefined(inner),
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }
    return output;
  }
  return value;
}

/** 带固定前缀的单行 JSON，供 target/contract-raw.log 以 caseId 精确定位。 */
function emitEvidence(caseId: string, payload: Record<string, unknown>) {
  console.log(`M2_EVIDENCE ${JSON.stringify(markUndefined({ caseId, ...payload }))}`);
}

/** P 夹具：原支付统一夹具。收入 10000、住房 1000 + 水电 200、现金 5000、债务 0、弹性 1 笔 50。 */
async function seedP() {
  return seed({ income: "10000", withVariableExpense: true });
}

/** A 夹具：原新增统一夹具。收入 2000、计划 1200、现金 5000、安全目标 1 个月、期望 1000、弹性 50。 */
async function seedA() {
  return seed({ withVariableExpense: true });
}

async function sqliteSequence(
  db: NodeSqliteDatabase,
): Promise<Array<{ name: string; seq: number }>> {
  const rows = await db.select<{ name: string; seq: number }>(
    "SELECT name,seq FROM sqlite_sequence ORDER BY name",
  );
  return rows.map((row) => ({ name: String(row.name), seq: Number(row.seq) }));
}

/** 真实 sqlite_master 业务表集合（排除 sqlite 内部表）。 */
async function masterBusinessTables(db: NodeSqliteDatabase): Promise<string[]> {
  const rows = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.map((row) => row.name);
}

/** 对照集合差集：返回 A 有 B 无 与 B 有 A 无。 */
function setDiff(a: string[], b: string[]): { onlyInA: string[]; onlyInB: string[] } {
  const setA = new Set(a);
  const setB = new Set(b);
  return {
    onlyInA: a.filter((name) => !setB.has(name)),
    onlyInB: b.filter((name) => !setA.has(name)),
  };
}

async function rowsOf(db: NodeSqliteDatabase, sql: string, binds: unknown[] = []) {
  return (await db.select(sql, binds)) as Array<Record<string, unknown>>;
}

describe("E04 支付：P 夹具完整账表与模型前后（收入 10000）", () => {
  it("E04-A 同日支付 300.20 前后：完整 home 与全部业务表逐项对照", async () => {
    const db = await seedP();
    try {
      const item = (await listEssentialPaymentItems(db, AS_OF)).find(
        (candidate) => candidate.category === "HOUSING",
      );
      if (!item) throw new Error("缺少住房项目");
      const beforeInput = await buildMonthlyModelInput(db, "2026-11", AS_OF);
      const beforeHome = await getHomeApplicationState(db, AS_OF);
      const beforeTables = await tableContents(db);
      const beforeSeq = await sqliteSequence(db);

      const result = await recordEssentialPayment(db, {
        itemId: item.id,
        amount: "300.20",
        paidOn: AS_OF,
        note: "合成验收",
      });

      const afterInput = await buildMonthlyModelInput(db, "2026-11", AS_OF);
      const afterHome = await getHomeApplicationState(db, AS_OF);
      const afterTables = await tableContents(db);
      const afterSeq = await sqliteSequence(db);

      // 收入必须真是 P 夹具的 10000，不是 A 的 2000。
      expect(beforeHome.planningIncome).toBe("10000");
      expect(beforeHome.essentialExpenses).toBe("1200");
      expect(beforeHome.currentMonthSpending).toBe("50");
      expect(beforeHome.totalDebt).toBe("0");

      // 非目标表逐行不变（含 VARIABLE 行与现金、债务、快照、设置）。
      for (const table of BUSINESS_TABLES) {
        if (table === "expense_records" || table === "app_metadata") continue;
        expect(afterTables[table], table).toEqual(beforeTables[table]);
      }

      const beforeLedger = (beforeTables.expense_records ?? []) as Array<Record<string, unknown>>;
      const afterLedger = (afterTables.expense_records ?? []) as Array<Record<string, unknown>>;
      const beforeVariable = beforeLedger.filter((row) => row.kind === "VARIABLE");
      const afterVariable = afterLedger.filter((row) => row.kind === "VARIABLE");
      const beforeEssential = beforeLedger.filter((row) => row.kind === "ESSENTIAL");
      const afterEssential = afterLedger.filter((row) => row.kind === "ESSENTIAL");

      // E04-B：VARIABLE 子集逐行一致，总额仍 50。
      expect(afterVariable).toEqual(beforeVariable);
      expect(afterVariable).toHaveLength(1);
      expect(beforeVariable).toHaveLength(1);
      const variableTotal = afterVariable
        .reduce((total, row) => total.plus(money(String(row.amount))), money("0"))
        .toString();
      expect(variableTotal).toBe("50");
      // ESSENTIAL 恰 +1 且金额 300.20。
      expect(beforeEssential).toHaveLength(0);
      expect(afterEssential).toHaveLength(1);
      expect(money(String(afterEssential[0]?.amount)).eq(money("300.20"))).toBe(true);
      expect(afterEssential[0]?.business_date).toBe(AS_OF);

      // 元数据增加同 id 的 1 条。
      const meta = JSON.parse(
        String(
          (
            await db.select<{ value: string }>(
              "SELECT value FROM app_metadata WHERE key='ux.essential-payments.v1'",
            )
          )[0]?.value ?? "[]",
        ),
      ) as Array<{ id: string }>;
      expect(meta).toHaveLength(1);
      expect(meta[0]?.id).toBe(result.payment.id);

      // 计划与模型逐字段不变。
      expect(afterHome.essentialExpenses).toBe("1200");
      expect(afterHome.baseSurplus).toBe(beforeHome.baseSurplus);
      expect(afterHome.recommendedMonthlySpending).toBe(beforeHome.recommendedMonthlySpending);
      expect(afterHome.remainingSpendingCapacity).toBe(beforeHome.remainingSpendingCapacity);
      expect(afterHome.amountAboveRecommendation).toBe(beforeHome.amountAboveRecommendation);
      expect(afterHome.safetyTargetResources).toBe(beforeHome.safetyTargetResources);
      expect(afterHome.safetyGap).toBe(beforeHome.safetyGap);
      expect(afterHome.currentCash).toBe(beforeHome.currentCash);
      expect(afterHome.currentMonthSpending).toBe("50");
      // 模型输入的 facts.expenses 由 listExpenses 取全部 expense_records（不按 kind 过滤），
      // 故支付后该数组会多出本条 ESSENTIAL 行；模型只对 VARIABLE 求和，输出不变。
      // 这里逐项证明：除 facts.expenses 外输入完全一致，且 expenses 恰多 1 条 ESSENTIAL。
      const withoutExpenses = (built: unknown) => {
        const parsed = JSON.parse(JSON.stringify(built)) as {
          input?: { facts?: Record<string, unknown> };
        };
        if (parsed.input?.facts) delete parsed.input.facts.expenses;
        return parsed;
      };
      expect(withoutExpenses(afterInput)).toEqual(withoutExpenses(beforeInput));
      const inputExpenses = (built: unknown) =>
        (
          (built as { input?: { facts?: { expenses?: Array<Record<string, unknown>> } } }).input
            ?.facts?.expenses ?? []
        ).map((row) => String(row.kind));
      expect(inputExpenses(beforeInput).sort()).toEqual(["VARIABLE"]);
      expect(inputExpenses(afterInput).sort()).toEqual(["ESSENTIAL", "VARIABLE"]);
      // 支付只进固定支出账，不写 sqlite_sequence 之外的任何自增。
      expect(afterSeq).toEqual(beforeSeq);

      // EC04：真实 sqlite_master 业务表集合与 tableContents 对照集合。
      // 迁移元数据表 schema_migrations 不承载业务行，属显式排除项，逐表说明依据，不静默遗漏。
      const masterAfter = await masterBusinessTables(db);
      const comparedTables = Object.keys(afterTables);
      const MIGRATION_METADATA_TABLES = ["schema_migrations"];
      const NON_BUSINESS_TABLES = new Set(MIGRATION_METADATA_TABLES);
      const coverageRaw = setDiff(masterAfter, comparedTables);
      const coverage = {
        onlyInA: coverageRaw.onlyInA.filter((name) => !NON_BUSINESS_TABLES.has(name)),
        onlyInB: coverageRaw.onlyInB,
        excluded: coverageRaw.onlyInA
          .filter((name) => NON_BUSINESS_TABLES.has(name))
          .map((name) => ({
            table: name,
            reason: "迁移版本元数据表，仅记录已应用迁移文件名，不承载任何业务事实行",
          })),
      };
      expect(coverage.onlyInA).toEqual([]);
      expect(coverage.onlyInB).toEqual([]);
      expect(coverage.excluded.map((row) => row.table)).toEqual(["schema_migrations"]);

      emitEvidence("E04-A", {
        masterBusinessTables: masterAfter,
        comparedTables,
        setDiff: coverage,
        beforeTables,
        afterTables,
        allowedChanges: [
          {
            table: "expense_records",
            change: "新增 1 条 kind=ESSENTIAL 300.20 行",
            reason: "本次支付事实",
          },
          {
            table: "app_metadata",
            change: "ux.essential-payments.v1 增加同 id 1 条",
            reason: "支付身份索引",
          },
        ],
        V: "V04",
        fixtureId: "P",
        phase: "payment-300.20",
        callArgs: { itemId: item.id, amount: "300.20", paidOn: AS_OF, note: "合成验收" },
        receipt: result.payment,
        monthTotal: result.monthTotal,
        modelInputBefore: beforeInput,
        modelInputAfter: afterInput,
        homeBefore: beforeHome,
        homeAfter: afterHome,
        essentialRowsBefore: beforeEssential,
        essentialRowsAfter: afterEssential,
        variableRowsBefore: beforeVariable,
        variableRowsAfter: afterVariable,
        variableTotalAfter: variableTotal,
        metadataAfter: meta,
        sqliteSequenceBefore: beforeSeq,
        sqliteSequenceAfter: afterSeq,
        assertions:
          "非目标表逐行相等、VARIABLE 逐行相等且总额50、ESSENTIAL+1为300.20、计划1200与模型字段不变",
      });
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("E05 支付输入校验：逐例独立内存库", () => {
  it("E05 合法 3 例各 1 行；非法 10 例、缺失 id 1 例、非法日期 2 例各 0 行", async () => {
    const cases: Array<{
      id: string;
      amount: string;
      paidOn?: string;
      missing?: boolean;
      expectRows: number;
    }> = [
      { id: "E05-VALID-1", amount: "1", expectRows: 1 },
      { id: "E05-VALID-1.20", amount: "1.20", expectRows: 1 },
      { id: "E05-VALID-999999999999.99", amount: "999999999999.99", expectRows: 1 },
      { id: "E05-INVALID-empty", amount: "", expectRows: 0 },
      { id: "E05-INVALID-0", amount: "0", expectRows: 0 },
      { id: "E05-INVALID--1", amount: "-1", expectRows: 0 },
      { id: "E05-INVALID-1.001", amount: "1.001", expectRows: 0 },
      { id: "E05-INVALID-1e2", amount: "1e2", expectRows: 0 },
      { id: "E05-INVALID-+1", amount: "+1", expectRows: 0 },
      { id: "E05-INVALID-01", amount: "01", expectRows: 0 },
      { id: "E05-INVALID-1000", amount: "1,000", expectRows: 0 },
      { id: "E05-INVALID-NaN", amount: "NaN", expectRows: 0 },
      { id: "E05-INVALID-1000000000000", amount: "1000000000000", expectRows: 0 },
      { id: "E05-NOITEM-missing-id", amount: "1", missing: true, expectRows: 0 },
      { id: "E05-DATE-2026-02-30", amount: "1", paidOn: "2026-02-30", expectRows: 0 },
      { id: "E05-DATE-2026-13-01", amount: "1", paidOn: "2026-13-01", expectRows: 0 },
    ];
    for (const testCase of cases) {
      // 每例独立内存库：不共享前例已写行的尾数。
      const db = await seedP();
      try {
        const items = await listEssentialPaymentItems(db, AS_OF);
        const item = items[0];
        if (!item) throw new Error("缺少项目");
        const targetId = testCase.missing ? "missing-item" : item.id;
        const beforeCount = (await db.select("SELECT id FROM expense_records")).length;
        expect(beforeCount, testCase.id).toBe(1);
        let raised: unknown = null;
        try {
          await recordEssentialPayment(db, {
            itemId: targetId,
            amount: testCase.amount,
            paidOn: testCase.paidOn ?? AS_OF,
          });
        } catch (error) {
          raised = error;
        }
        const rows = await rowsOf(
          db,
          "SELECT id,kind,amount,business_date FROM expense_records ORDER BY id",
        );
        expect(rows.length, testCase.id).toBe(1 + testCase.expectRows);
        const essentialRows = await rowsOf(
          db,
          "SELECT id,kind,amount,business_date FROM expense_records WHERE kind='ESSENTIAL'",
        );
        expect(essentialRows.length, testCase.id).toBe(testCase.expectRows);
        emitEvidence("E05", {
          V: "V05",
          fixtureId: "P",
          phase: testCase.id,
          callArgs: { itemId: targetId, amount: testCase.amount, paidOn: testCase.paidOn ?? AS_OF },
          raisedError:
            raised === null
              ? null
              : { name: (raised as Error).name, message: (raised as Error).message },
          beforeRowCount: beforeCount,
          afterAllRows: rows,
          afterEssentialRows: essentialRows,
          assertion: testCase.expectRows === 1 ? "恰 1 行 ESSENTIAL" : "0 行 ESSENTIAL",
        });
      } finally {
        db.close();
      }
    }
  }, 180_000);

  it("E05-NOITEM 无项目夹具：清单为空时 0 写入", async () => {
    const db = new NodeSqliteDatabase();
    try {
      await migrateDatabase(db, `${AS_OF}T00:00:00.000Z`);
      await completeOnboarding(
        db,
        {
          stableMonthlyIncome: "10000",
          essentialExpenses: [],
          cashAccounts: [{ name: "现金", balance: "5000", includeInSafetyResources: true }],
          assets: [],
          debts: [],
          safetyCoverageTargetMonths: 1,
          minimumCashCoverageMonths: 1,
          desiredMonthlyDiscretionarySpending: "1000",
        },
        AS_OF,
      );
      await ensureV2LedgerDefaults(db);
      const items = await listEssentialPaymentItems(db, AS_OF);
      let raised: unknown = null;
      try {
        await recordEssentialPayment(db, { itemId: "any", amount: "1", paidOn: AS_OF });
      } catch (error) {
        raised = error;
      }
      const rows = await rowsOf(db, "SELECT id FROM expense_records WHERE kind='ESSENTIAL'");
      expect(items).toHaveLength(0);
      expect(rows).toHaveLength(0);
      emitEvidence("E05-NOITEM-empty", {
        V: "V05",
        fixtureId: "P-empty",
        phase: "no-items",
        itemsAfterOnboarding: items,
        raisedError:
          raised === null
            ? null
            : { name: (raised as Error).name, message: (raised as Error).message },
        afterEssentialRows: rows,
        assertion: "0 项目、0 写入",
      });
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("E16 新增后立即支付与生效前拒付", () => {
  it("E16-A 新 id 支付 60.50：八字段一致、计划仍 1500、模型字段逐项", async () => {
    const db = await seedA();
    try {
      const beforeAddInput = await buildMonthlyModelInput(db, "2026-11", AS_OF);
      const beforeAddHome = await getHomeApplicationState(db, AS_OF);
      const draftId = globalThis.crypto.randomUUID();
      await saveEssentialItems(
        db,
        [{ id: draftId, name: "合成保险", category: "INSURANCE", monthlyAmount: "300.00" }],
        AS_OF,
      );
      const afterAddInput = await buildMonthlyModelInput(db, "2026-11", AS_OF);
      const afterAddHome = await getHomeApplicationState(db, AS_OF);
      expect(beforeAddHome.essentialExpenses).toBe("1200");
      expect(afterAddHome.essentialExpenses).toBe("1500");

      const result = await recordEssentialPayment(db, {
        itemId: draftId,
        amount: "60.50",
        paidOn: AS_OF,
        note: "新增即付",
      });
      const afterPayInput = await buildMonthlyModelInput(db, "2026-11", AS_OF);
      const afterPayHome = await getHomeApplicationState(db, AS_OF);

      const rows = await listEssentialPayments(db, "2026-11");
      const matched = rows.filter((row) => row.id === result.payment.id);
      expect(matched).toHaveLength(1);
      const row = matched[0];
      if (!row) throw new Error("缺少读回记录");
      expect(row.id).toBe(result.payment.id);
      expect(row.itemId).toBe(draftId);
      expect(row.itemName).toBe("合成保险");
      expect(row.category).toBe("INSURANCE");
      expect(money(row.amount).eq(money("60.50"))).toBe(true);
      expect(row.paidOn).toBe(AS_OF);
      expect(row.note).toBe("新增即付");
      expect(typeof row.recordedAt).toBe("string");

      expect(afterPayHome.essentialExpenses).toBe("1500");
      expect(afterPayHome.baseSurplus).toBe(afterAddHome.baseSurplus);
      expect(afterPayHome.recommendedMonthlySpending).toBe(afterAddHome.recommendedMonthlySpending);
      expect(afterPayHome.remainingSpendingCapacity).toBe(afterAddHome.remainingSpendingCapacity);
      expect(afterPayHome.amountAboveRecommendation).toBe(afterAddHome.amountAboveRecommendation);
      expect(afterPayHome.safetyTargetResources).toBe(afterAddHome.safetyTargetResources);
      expect(afterPayHome.safetyGap).toBe(afterAddHome.safetyGap);
      expect(afterPayHome.currentMonthSpending).toBe(afterAddHome.currentMonthSpending);
      expect(result.monthTotal).toBe("60.5");

      emitEvidence("E16-A", {
        V: "V16",
        fixtureId: "A",
        phase: "add-then-pay",
        patch: { id: draftId, name: "合成保险", category: "INSURANCE", monthlyAmount: "300.00" },
        callArgs: { itemId: draftId, amount: "60.50", paidOn: AS_OF, note: "新增即付" },
        receipt: result.payment,
        readback: row,
        monthTotal: result.monthTotal,
        modelInputBeforeAdd: beforeAddInput,
        modelInputAfterAdd: afterAddInput,
        modelInputAfterPay: afterPayInput,
        homeBeforeAdd: beforeAddHome,
        homeAfterAdd: afterAddHome,
        homeAfterPay: afterPayHome,
        assertions: "八字段一致、计划1500不变、模型输出逐项与新增完成时相同",
      });
    } finally {
      db.close();
    }
  }, 30_000);

  it("E16-B 已新增后补记生效日之前（2026-10-31）的真实支付：允许写入，字段与月汇总独立正确", async () => {
    const db = await seedA();
    try {
      const draftId = globalThis.crypto.randomUUID();
      await saveEssentialItems(
        db,
        [{ id: draftId, name: "合成保险", category: "INSURANCE", monthlyAmount: "300.00" }],
        AS_OF,
      );

      const backfilled = await recordEssentialPayment(db, {
        itemId: draftId,
        amount: "60.50",
        paidOn: "2026-10-31",
      });
      const octRows = await listEssentialPayments(db, "2026-10");
      const octMatched = octRows.filter((row) => row.id === backfilled.payment.id);
      expect(octMatched).toHaveLength(1);
      const octRow = octMatched[0];
      if (!octRow) throw new Error("缺少读回记录");
      expect(octRow.itemId).toBe(draftId);
      expect(octRow.itemName).toBe("合成保险");
      expect(octRow.category).toBe("INSURANCE");
      expect(money(octRow.amount).eq(money("60.50"))).toBe(true);
      expect(octRow.paidOn).toBe("2026-10-31");
      expect(backfilled.monthTotal).toBe("60.5");

      // 正证：11-01 当天支付同一项目仍成功，两次独立计入各自月份，互不污染。
      const onEffectiveDate = await recordEssentialPayment(db, {
        itemId: draftId,
        amount: "60.50",
        paidOn: AS_OF,
      });
      expect(onEffectiveDate.payment.itemId).toBe(draftId);
      const novRows = await listEssentialPayments(db, "2026-11");
      expect(novRows.filter((row) => row.id === onEffectiveDate.payment.id)).toHaveLength(1);
      expect(onEffectiveDate.monthTotal).toBe("60.5");

      emitEvidence("E16-B", {
        V: "V16",
        fixtureId: "A",
        phase: "pay-before-effective",
        callArgs: { itemId: draftId, amount: "60.50", paidOn: "2026-10-31" },
        backfillReceipt: backfilled.payment,
        backfillReadback: octRow,
        backfillMonthTotal: backfilled.monthTotal,
        controlOnEffectiveDate: onEffectiveDate.payment,
        controlMonthTotal: onEffectiveDate.monthTotal,
        assertion:
          "10-31 补记成功、读回字段一致、10月汇总60.5；11-01 同 id 再付一次同样成功，11月汇总独立为60.5",
      });
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("E16-C 已停用项目仍拒绝支付", () => {
  it("停用后的项目补记 10-31 支付：ESSENTIAL_ITEM_NOT_FOUND、0 写入", async () => {
    const db = await seedA();
    try {
      const item = (await listEssentialPaymentItems(db, AS_OF))[0];
      if (!item) throw new Error("缺少项目");
      await saveEssentialItems(db, [{ ...item, active: false }], AS_OF);
      const before = await rowsOf(db, "SELECT id FROM expense_records WHERE kind='ESSENTIAL'");
      let raised: unknown = null;
      try {
        await recordEssentialPayment(db, {
          itemId: item.id,
          amount: "60.50",
          paidOn: "2026-10-31",
        });
      } catch (error) {
        raised = error;
      }
      expect((raised as Error | null)?.message).toBe("Item does not exist.");
      const after = await rowsOf(db, "SELECT id FROM expense_records WHERE kind='ESSENTIAL'");
      expect(after.length).toBe(before.length);
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("E17 新增账表隔离与旧行逐行保护", () => {
  it("E17-A 旧项目逐行不变、新项目与修订各 +1、非目标表逐行不变、sqlite_sequence 单列前后", async () => {
    const db = await seedA();
    try {
      const beforeItems = await rowsOf(
        db,
        "SELECT id,name,category,active,created_at,updated_at FROM essential_expense_items ORDER BY id",
      );
      const beforeRevisions = await rowsOf(
        db,
        "SELECT revision_id,item_id,as_of_date,name,category,monthly_amount,active,created_at FROM essential_expense_revisions ORDER BY revision_id",
      );
      const beforeTables = await tableContents(db);
      const beforeSeq = await sqliteSequence(db);
      const draftId = globalThis.crypto.randomUUID();

      await saveEssentialItems(
        db,
        [{ id: draftId, name: "合成保险", category: "INSURANCE", monthlyAmount: "300.00" }],
        AS_OF,
      );

      const afterItems = await rowsOf(
        db,
        "SELECT id,name,category,active,created_at,updated_at FROM essential_expense_items ORDER BY id",
      );
      const afterRevisions = await rowsOf(
        db,
        "SELECT revision_id,item_id,as_of_date,name,category,monthly_amount,active,created_at FROM essential_expense_revisions ORDER BY revision_id",
      );
      const afterTables = await tableContents(db);
      const afterSeq = await sqliteSequence(db);

      // 旧行逐行不变（按新 id 过滤后比较，防空比较冒充实证）。
      const oldItemsBefore = beforeItems.filter((row) => row.id !== draftId);
      const oldItemsAfter = afterItems.filter((row) => row.id !== draftId);
      expect(oldItemsAfter).toEqual(oldItemsBefore);
      expect(oldItemsBefore).toHaveLength(2);
      expect(afterItems).toHaveLength(3);
      expect(afterItems.filter((row) => row.id === draftId)).toHaveLength(1);
      expect(afterRevisions).toHaveLength(1);
      expect(beforeRevisions).toHaveLength(0);

      // 非目标业务表逐行不变。
      for (const table of BUSINESS_TABLES) {
        if (table === "essential_expense_items" || table === "essential_expense_revisions")
          continue;
        expect(afterTables[table], table).toEqual(beforeTables[table]);
      }
      // 快照不因新增而变。
      expect((afterTables.essential_expense_snapshots ?? []).length).toBe(2);
      // sqlite_sequence 单列：修订自增推进，属内部计数，不掩盖其他表变化。
      const seqDiff = afterSeq
        .filter(
          (row) =>
            JSON.stringify(beforeSeq.find((b) => b.name === row.name)) !== JSON.stringify(row),
        )
        .map((row) => ({
          name: row.name,
          before: beforeSeq.find((b) => b.name === row.name) ?? null,
          after: row,
        }));

      emitEvidence("E17-A", {
        V: "V17",
        fixtureId: "A",
        phase: "add-300",
        patch: { id: draftId, name: "合成保险", category: "INSURANCE", monthlyAmount: "300.00" },
        oldItemsBefore,
        oldItemsAfter,
        newItemsAfter: afterItems.filter((row) => row.id === draftId),
        revisionsBefore: beforeRevisions,
        revisionsAfter: afterRevisions,
        snapshotsAfter: afterTables.essential_expense_snapshots,
        sqliteSequenceBefore: beforeSeq,
        sqliteSequenceAfter: afterSeq,
        sqliteSequenceChanged: seqDiff,
        nonTargetTablesEqual: true,
        beforeTables,
        afterTables,
        masterBusinessTables: await masterBusinessTables(db),
        comparedTables: Object.keys(afterTables),
        setDiff: setDiff(await masterBusinessTables(db), Object.keys(afterTables)),
        allowedChanges: [
          { table: "essential_expense_items", change: "新增 1 条新 id", reason: "本次新增" },
          {
            table: "essential_expense_revisions",
            change: "新增 1 条该 id 修订",
            reason: "本次新增",
          },
        ],
        assertion: "旧项目逐行不变、新项目+1、修订+1、快照不变、非目标表逐行相等",
      });
    } finally {
      db.close();
    }
  }, 30_000);

  it("E17-B 已有旧修订后再新增：旧 items/revisions 逐行不变", async () => {
    const db = await seedA();
    try {
      const firstId = globalThis.crypto.randomUUID();
      await saveEssentialItems(
        db,
        [{ id: firstId, name: "既有保险", category: "INSURANCE", monthlyAmount: "300.00" }],
        AS_OF,
      );
      const beforeItems = await rowsOf(
        db,
        "SELECT id,name,category,active,created_at,updated_at FROM essential_expense_items ORDER BY id",
      );
      const beforeRevisions = await rowsOf(
        db,
        "SELECT revision_id,item_id,as_of_date,name,category,monthly_amount,active,created_at FROM essential_expense_revisions ORDER BY revision_id",
      );
      expect(beforeRevisions).toHaveLength(1);

      const secondId = globalThis.crypto.randomUUID();
      await saveEssentialItems(
        db,
        [{ id: secondId, name: "第二保险", category: "INSURANCE", monthlyAmount: "100.00" }],
        AS_OF,
      );
      const afterItems = await rowsOf(
        db,
        "SELECT id,name,category,active,created_at,updated_at FROM essential_expense_items ORDER BY id",
      );
      const afterRevisions = await rowsOf(
        db,
        "SELECT revision_id,item_id,as_of_date,name,category,monthly_amount,active,created_at FROM essential_expense_revisions ORDER BY revision_id",
      );
      expect(afterRevisions).toHaveLength(2);
      expect(afterRevisions.filter((row) => row.item_id === firstId)).toEqual(
        beforeRevisions.filter((row) => row.item_id === firstId),
      );
      expect(afterItems.filter((row) => row.id === firstId)).toEqual(
        beforeItems.filter((row) => row.id === firstId),
      );

      emitEvidence("E17-B", {
        V: "V17",
        fixtureId: "A-with-old-revision",
        phase: "second-add",
        firstId,
        secondId,
        revisionsBefore: beforeRevisions,
        revisionsAfter: afterRevisions,
        oldRevisionUnchanged: true,
        assertion: "旧修订非空变体下，旧 items 与 revisions 逐行不变，新修订仅 +1",
      });
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("E19 新增模型实数变化：两夹具完整输入与独立规格算式", () => {
  it("E19-MAIN 新增 300：真实 input/home 前后 + 12 组逐项 + 独立算式", async () => {
    const db = await seedA();
    try {
      const before = await getHomeApplicationState(db, AS_OF);
      const beforeInput = await buildMonthlyModelInput(db, "2026-11", AS_OF);
      const draftId = globalThis.crypto.randomUUID();
      await saveEssentialItems(
        db,
        [{ id: draftId, name: "合成保险", category: "INSURANCE", monthlyAmount: "300.00" }],
        AS_OF,
      );
      const after = await getHomeApplicationState(db, AS_OF);
      const afterInput = await buildMonthlyModelInput(db, "2026-11", AS_OF);

      // 独立规格算式：不调用模型函数，只用 money 按规格重算。
      const specBase = (income: string, essential: string, debtService: string) =>
        money(income).minus(money(essential)).minus(money(debtService)).toString();
      const specTarget = (months: string, core: string) =>
        money(months).times(money(core)).toString();
      const specGap = (target: string, resources: string) => {
        const gap = money(target).minus(money(resources));
        return gap.gt(0) ? gap.toString() : "0";
      };

      const expected = {
        baseSurplusBefore: specBase("2000", "1200", "0"),
        baseSurplusAfter: specBase("2000", "1500", "0"),
        safetyTargetBefore: specTarget("1", "1200"),
        safetyTargetAfter: specTarget("1", "1500"),
        safetyGapBefore: specGap("1200", "5000"),
        safetyGapAfter: specGap("1500", "5000"),
      };
      expect(expected.baseSurplusBefore).toBe("800");
      expect(expected.baseSurplusAfter).toBe("500");
      expect(expected.safetyTargetBefore).toBe("1200");
      expect(expected.safetyTargetAfter).toBe("1500");
      expect(expected.safetyGapBefore).toBe("0");
      expect(expected.safetyGapAfter).toBe("0");
      // 实际 home 与独立算式逐项相等。
      expect(before.baseSurplus).toBe(expected.baseSurplusBefore);
      expect(after.baseSurplus).toBe(expected.baseSurplusAfter);
      expect(before.safetyTargetResources).toBe(expected.safetyTargetBefore);
      expect(after.safetyTargetResources).toBe(expected.safetyTargetAfter);
      expect(after.safetyGap).toBe(expected.safetyGapAfter);

      const groups = {
        "1计划收入": { before: before.planningIncome, after: after.planningIncome },
        "2必要支出": { before: before.essentialExpenses, after: after.essentialExpenses },
        "3债务": { before: before.totalDebt, after: after.totalDebt },
        "4基础盈余": { before: before.baseSurplus, after: after.baseSurplus },
        "5核心义务": { before: before.monthlyCoreObligations, after: after.monthlyCoreObligations },
        "6现金安全资源": { before: before.safetyResources, after: after.safetyResources },
        "7安全目标与缺口": {
          before: [before.safetyTargetResources, before.safetyGap],
          after: [after.safetyTargetResources, after.safetyGap],
        },
        "8覆盖月数": {
          before: [before.safetyCoverageMonths, before.cashCoverageMonths],
          after: [after.safetyCoverageMonths, after.cashCoverageMonths],
        },
        "9期望与实际消费": {
          before: [before.desiredMonthlyDiscretionarySpending, before.currentMonthSpending],
          after: [after.desiredMonthlyDiscretionarySpending, after.currentMonthSpending],
        },
        "10建议": {
          before: before.recommendedMonthlySpending,
          after: after.recommendedMonthlySpending,
        },
        "11剩余与超出": {
          before: [before.remainingSpendingCapacity, before.amountAboveRecommendation],
          after: [after.remainingSpendingCapacity, after.amountAboveRecommendation],
        },
        "12状态与现金底线": {
          before: [before.spendingStatus, before.cashFloorMet],
          after: [after.spendingStatus, after.cashFloorMet],
        },
      };
      expect(Object.keys(groups)).toHaveLength(12);

      emitEvidence("E19-MAIN", {
        V: "V19",
        fixtureId: "A",
        phase: "add-300",
        patch: { id: draftId, name: "合成保险", category: "INSURANCE", monthlyAmount: "300.00" },
        modelInputBefore: beforeInput,
        modelInputAfter: afterInput,
        homeBefore: before,
        homeAfter: after,
        expectedCalculation: expected,
        actualGroups: groups,
        assertion:
          "12 组逐项记录；baseSurplus 与安全目标/缺口由独立 money 算式复算并与实际 home 相等",
      });
    } finally {
      db.close();
    }
  }, 30_000);

  it("E19-SECOND 新增 1000：必要 1200→2200、盈余 800→-200、STRUCTURAL_DEFICIT、建议 800→0、剩余 750→0、超出 0→50", async () => {
    const db = await seedA();
    try {
      const before = await getHomeApplicationState(db, AS_OF);
      const beforeInput = await buildMonthlyModelInput(db, "2026-11", AS_OF);
      await saveEssentialItems(
        db,
        [{ name: "整租差价", category: "INSURANCE", monthlyAmount: "1000.00" }],
        AS_OF,
      );
      const after = await getHomeApplicationState(db, AS_OF);
      const afterInput = await buildMonthlyModelInput(db, "2026-11", AS_OF);

      expect(after.essentialExpenses).toBe("2200");
      expect(after.baseSurplus).toBe("-200");
      expect(after.spendingStatus).toBe("STRUCTURAL_DEFICIT");
      expect(after.recommendedMonthlySpending).toBe("0");
      expect(after.remainingSpendingCapacity).toBe("0");
      expect(after.amountAboveRecommendation).toBe("50");
      // 期望与实际消费不变。
      expect(after.desiredMonthlyDiscretionarySpending).toBe("1000");
      expect(after.currentMonthSpending).toBe("50");

      // 独立算式：2000-2200-0 = -200；1*2200 = 2200；缺口 max(2200-5000,0)=0。
      expect(money("2000").minus(money("2200")).toString()).toBe("-200");
      expect(money("1").times(money("2200")).toString()).toBe("2200");

      emitEvidence("E19-SECOND", {
        V: "V19",
        fixtureId: "A-second",
        phase: "add-1000",
        modelInputBefore: beforeInput,
        modelInputAfter: afterInput,
        homeBefore: before,
        homeAfter: after,
        expectedCalculation: {
          baseSurplus: money("2000").minus(money("2200")).toString(),
          safetyTarget: money("1").times(money("2200")).toString(),
          safetyGap: "0",
        },
        assertion: "2200/-200/STRUCTURAL_DEFICIT/0/0/50，期望1000与实际50不变",
      });
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("E20 新增失败与事务回滚", () => {
  it("E20-PRE 写前拒绝：主表与修订各 0 新增", async () => {
    const db = await seedA();
    try {
      const beforeItems = await rowsOf(db, "SELECT id FROM essential_expense_items ORDER BY id");
      const beforeRevisions = await rowsOf(
        db,
        "SELECT revision_id FROM essential_expense_revisions ORDER BY revision_id",
      );
      const originalExecute = db.execute.bind(db);
      let hits = 0;
      db.execute = async (sql: string, bindValues: unknown[] = []) => {
        if (/INSERT INTO essential_expense_items/i.test(sql)) {
          hits += 1;
          throw new Error("INJECTED_PRE_WRITE_FAILURE");
        }
        return originalExecute(sql, bindValues);
      };
      let raised: unknown = null;
      try {
        await saveEssentialItems(
          db,
          [
            {
              id: globalThis.crypto.randomUUID(),
              name: "失败保险",
              category: "INSURANCE",
              monthlyAmount: "100.00",
            },
          ],
          AS_OF,
        );
      } catch (error) {
        raised = error;
      } finally {
        db.execute = originalExecute;
      }
      const afterItems = await rowsOf(db, "SELECT id FROM essential_expense_items ORDER BY id");
      const afterRevisions = await rowsOf(
        db,
        "SELECT revision_id FROM essential_expense_revisions ORDER BY revision_id",
      );
      expect(hits).toBe(1);
      expect((raised as Error).message).toBe("INJECTED_PRE_WRITE_FAILURE");
      expect(afterItems).toEqual(beforeItems);
      expect(afterRevisions).toEqual(beforeRevisions);
      expect(afterItems).toHaveLength(2);
      expect(afterRevisions).toHaveLength(0);

      emitEvidence("E20-PRE", {
        V: "V20",
        fixtureId: "A",
        phase: "pre-write-reject",
        injectedAt: "INSERT INTO essential_expense_items",
        faultHits: hits,
        raisedError: { name: (raised as Error).name, message: (raised as Error).message },
        itemsBefore: beforeItems,
        itemsAfter: afterItems,
        revisionsBefore: beforeRevisions,
        revisionsAfter: afterRevisions,
        assertion: "写前抛错后主表与修订各 0 新增",
      });
    } finally {
      db.close();
    }
  }, 30_000);

  it("E20-TX 事务内修订插入失败：主表已有本次新 id，真实 ROLLBACK 后主表与修订各 0 新增", async () => {
    const db = await seedA();
    try {
      const beforeItems = await rowsOf(db, "SELECT id FROM essential_expense_items ORDER BY id");
      const beforeRevisions = await rowsOf(
        db,
        "SELECT revision_id FROM essential_expense_revisions ORDER BY revision_id",
      );
      const draftId = globalThis.crypto.randomUUID();
      const originalExecute = db.execute.bind(db);
      let hits = 0;
      let masterAtFault: Array<Record<string, unknown>> = [];
      db.execute = async (sql: string, bindValues: unknown[] = []) => {
        if (/INSERT INTO essential_expense_revisions/i.test(sql)) {
          hits += 1;
          // 事务内主表应已含本次新 id，证明故障发生在插入之后。
          masterAtFault = await rowsOf(
            db,
            "SELECT id,name FROM essential_expense_items WHERE id=?",
            [draftId],
          );
          throw new Error("INJECTED_TX_REVISION_FAILURE");
        }
        return originalExecute(sql, bindValues);
      };
      let raised: unknown = null;
      try {
        await saveEssentialItems(
          db,
          [{ id: draftId, name: "回滚保险", category: "INSURANCE", monthlyAmount: "100.00" }],
          AS_OF,
        );
      } catch (error) {
        raised = error;
      } finally {
        db.execute = originalExecute;
      }
      const afterItems = await rowsOf(db, "SELECT id FROM essential_expense_items ORDER BY id");
      const afterRevisions = await rowsOf(
        db,
        "SELECT revision_id FROM essential_expense_revisions ORDER BY revision_id",
      );
      const leaked = await rowsOf(db, "SELECT id FROM essential_expense_items WHERE id=?", [
        draftId,
      ]);

      expect(hits).toBe(1);
      expect((raised as Error).message).toBe("INJECTED_TX_REVISION_FAILURE");
      // 故障时主表确已有本次新 id。
      expect(masterAtFault).toHaveLength(1);
      expect(masterAtFault[0]?.id).toBe(draftId);
      // 真实 ROLLBACK 之后主表与修订均无新增，草稿 id 未泄漏。
      expect(afterItems).toEqual(beforeItems);
      expect(afterRevisions).toEqual(beforeRevisions);
      expect(leaked).toHaveLength(0);

      emitEvidence("E20-TX", {
        V: "V20",
        fixtureId: "A",
        phase: "tx-revision-insert-failure",
        injectedAt: "INSERT INTO essential_expense_revisions",
        faultHits: hits,
        masterRowsAtFault: masterAtFault,
        raisedError: { name: (raised as Error).name, message: (raised as Error).message },
        itemsBefore: beforeItems,
        itemsAfter: afterItems,
        revisionsBefore: beforeRevisions,
        revisionsAfter: afterRevisions,
        draftLeakedAfterRollback: leaked,
        assertion: "事务内命中修订插入后真实回滚，主表与修订各 0 新增，草稿 id 未泄漏",
      });
    } finally {
      db.close();
    }
  }, 30_000);
});

describe("E22 初始数据与独立增量", () => {
  it("E22-EMPTY 首次设置为空：0 项目 0 快照，当日计划 0", async () => {
    const db = new NodeSqliteDatabase();
    try {
      await migrateDatabase(db, `${AS_OF}T00:00:00.000Z`);
      await completeOnboarding(
        db,
        {
          stableMonthlyIncome: "2000",
          essentialExpenses: [],
          cashAccounts: [{ name: "现金", balance: "5000", includeInSafetyResources: true }],
          assets: [],
          debts: [],
          safetyCoverageTargetMonths: 1,
          minimumCashCoverageMonths: 1,
          desiredMonthlyDiscretionarySpending: "1000",
        },
        AS_OF,
      );
      await ensureV2LedgerDefaults(db);
      const items = await listEssentialPaymentItems(db, AS_OF);
      const snapshots = await rowsOf(db, "SELECT item_id FROM essential_expense_snapshots");
      const home = await getHomeApplicationState(db, AS_OF);
      expect(items).toHaveLength(0);
      expect(snapshots).toHaveLength(0);
      expect(home.essentialExpenses).toBe("0");

      emitEvidence("E22-EMPTY", {
        V: "V22",
        fixtureId: "A-empty",
        phase: "first-time-empty",
        items,
        snapshots,
        homeEssentialExpenses: home.essentialExpenses,
        assertion: "0 项目 0 快照，当日计划 0",
      });
    } finally {
      db.close();
    }
  }, 30_000);

  it("E22-TWO 首次设置 2 类：2 项目 2 快照，计划 1200；独立增量 300 后为 1500 而非 2700", async () => {
    const db = await seedA();
    try {
      const items = await listEssentialPaymentItems(db, AS_OF);
      const snapshots = await rowsOf(
        db,
        "SELECT item_id FROM essential_expense_snapshots ORDER BY item_id",
      );
      const before = await getHomeApplicationState(db, AS_OF);
      expect(items).toHaveLength(2);
      expect(snapshots).toHaveLength(2);
      expect(before.essentialExpenses).toBe("1200");

      // 明确独立增量：新增 300 属于原 1200 之外的增量，结果为 1500，不是 2700，也不覆盖旧 1200。
      await saveEssentialItems(
        db,
        [{ name: "独立增量保险", category: "INSURANCE", monthlyAmount: "300.00" }],
        AS_OF,
      );
      const after = await getHomeApplicationState(db, AS_OF);
      expect(after.essentialExpenses).toBe("1500");
      expect(after.essentialExpenses).not.toBe("2700");
      expect(money("1200").plus(money("300")).toString()).toBe("1500");

      emitEvidence("E22-TWO", {
        V: "V22",
        fixtureId: "A",
        phase: "first-time-two-then-increment",
        itemsAfterOnboarding: items,
        snapshotsAfterOnboarding: snapshots,
        homeBefore: before.essentialExpenses,
        homeAfter: after.essentialExpenses,
        independentIncrement: "1200 + 300 = 1500，非 2700",
        assertion: "2 项目 2 快照计划 1200；独立增量 300 后 1500",
      });
    } finally {
      db.close();
    }
  }, 30_000);
});
