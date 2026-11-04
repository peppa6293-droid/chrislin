import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { saveCurrentMonthDebtFact } from "../src/application/debt-fact-service.js";
import { getFinancialMaintenanceState } from "../src/application/financial-maintenance-service.js";
import { buildMonthlyModelInput } from "../src/application/monthly-model-service.js";
import { completeOnboarding } from "../src/application/product-service.js";
import {
  listEssentialPaymentItems,
  listEssentialPayments,
  recordEssentialPayment,
  saveEssentialItems,
} from "../src/application/ux-ledger-service.js";
import { V4FoundationService } from "../src/application/v4-foundation-service.js";
import { money } from "../src/model/money.js";
import type { ExpenseCategory } from "../src/model/types.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const databases: NodeSqliteDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function onboard(db: NodeSqliteDatabase, asOfDate = "2026-09-01"): Promise<void> {
  databases.push(db);
  await migrateDatabase(db);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
      assets: [{ name: "Fund", currentValue: "1000", includeInSafetyResources: true }],
      debts: [
        {
          name: "Loan",
          currentBalance: "2000",
          currentMonthDue: "500",
          fixedMonthlyPayment: "400",
        },
      ],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "2000",
    },
    asOfDate,
  );
}

async function dump(db: NodeSqliteDatabase, sql: string): Promise<unknown[]> {
  return db.select(sql);
}

async function essentialItem(db: NodeSqliteDatabase, asOfDate = "2026-09-02") {
  const [item] = await listEssentialPaymentItems(db, asOfDate);
  if (!item) throw new Error("Essential fixture missing.");
  return item;
}

async function deactivateEssential(
  db: NodeSqliteDatabase,
  item: Awaited<ReturnType<typeof essentialItem>>,
  asOfDate = "2026-09-10",
): Promise<void> {
  await saveEssentialItems(
    db,
    [
      {
        id: item.id,
        name: item.name,
        category: item.category as ExpenseCategory,
        monthlyAmount: item.monthlyAmount,
        active: false,
      },
    ],
    asOfDate,
  );
}

describe("S1 B3 T1 essential-expense deactivation", () => {
  it("keeps the base row and history, drops the item from now on, and rejects new or backdated payments", async () => {
    const db = new NodeSqliteDatabase();
    await onboard(db);
    const item = await essentialItem(db);
    const first = await recordEssentialPayment(db, {
      itemId: item.id,
      amount: "100.00",
      paidOn: "2026-09-05",
      note: "首笔",
    });
    const second = await recordEssentialPayment(db, {
      itemId: item.id,
      amount: "20.50",
      paidOn: "2026-09-08",
    });
    const historyBefore = await buildMonthlyModelInput(db, "2026-09", "2026-09-05");
    const maintenanceBefore = await getFinancialMaintenanceState(db, "2026-09-05");

    await deactivateEssential(db, item);

    expect(
      await dump(db, `SELECT active FROM essential_expense_items WHERE id='${item.id}'`),
    ).toEqual([{ active: 0 }]);
    expect(
      await dump(
        db,
        `SELECT as_of_date,active FROM essential_expense_revisions WHERE item_id='${item.id}' AND active=0`,
      ),
    ).toEqual([{ as_of_date: "2026-09-10", active: 0 }]);
    // 留痕只追加一行 active=0，没有多余的 active=1 修订复活。
    expect(
      await dump(
        db,
        `SELECT COUNT(*) AS count FROM essential_expense_revisions WHERE item_id='${item.id}' AND active=1`,
      ),
    ).toEqual([{ count: 0 }]);

    // 历史支付逐行保留、冻结值不变、按月可查。
    const payments = await listEssentialPayments(db, "2026-09");
    expect(
      payments.map(({ id, itemId, itemName, amount, paidOn, note }) => ({
        id,
        itemId,
        itemName,
        amount,
        paidOn,
        note,
      })),
    ).toEqual([
      {
        id: second.payment.id,
        itemId: item.id,
        itemName: item.name,
        amount: "20.5",
        paidOn: "2026-09-08",
        note: null,
      },
      {
        id: first.payment.id,
        itemId: item.id,
        itemName: item.name,
        amount: "100",
        paidOn: "2026-09-05",
        note: "首笔",
      },
    ]);

    // 当月起剔除：维护状态与历史月 as-of 模型。
    expect((await getFinancialMaintenanceState(db, "2026-09-10")).essentialExpenses).toEqual([]);
    const historyAfter = await buildMonthlyModelInput(db, "2026-09", "2026-09-05");
    expect(historyAfter).toEqual(historyBefore);
    const maintenanceAfter = await getFinancialMaintenanceState(db, "2026-09-05");
    expect(maintenanceAfter.essentialExpenses).toEqual(maintenanceBefore.essentialExpenses);

    // 不可新记：新日期与回填历史日期都被拒，错误码沿用现状。
    const newPayment = {
      itemId: item.id,
      amount: "10.00",
      paidOn: "2026-09-12",
    };
    await expect(recordEssentialPayment(db, newPayment)).rejects.toMatchObject({
      code: "ESSENTIAL_ITEM_NOT_FOUND",
    });
    await expect(
      recordEssentialPayment(db, { ...newPayment, paidOn: "2026-09-02" }),
    ).rejects.toMatchObject({ code: "ESSENTIAL_ITEM_NOT_FOUND" });
    expect(await listEssentialPayments(db)).toHaveLength(2);
    expect(await listEssentialPaymentItems(db, "2026-09-12")).toEqual([]);
    expect((await listEssentialPaymentItems(db, "2026-09-02")).map((row) => row.id)).toEqual([
      item.id,
    ]);
  });
});

describe("S1 B3 T2 soft delete for cash, asset and debt", () => {
  it("adds an inactive revision, leaves base and flow tables untouched, and keeps history as-of", async () => {
    const db = new NodeSqliteDatabase();
    await onboard(db);
    const state = await getFinancialMaintenanceState(db, "2026-09-05");
    const [cash] = state.cashAccounts;
    const [asset] = state.assets;
    const [debt] = state.debts;
    if (!cash || !asset || !debt) throw new Error("Onboarding fixtures missing.");
    // 夹具必须真有流水，否则「既有流水保留」的 dump 断言会 0→0 空转。
    const item = await essentialItem(db);
    await recordEssentialPayment(db, { itemId: item.id, amount: "30.00", paidOn: "2026-09-06" });
    const unchanged = [
      "cash_accounts",
      "cash_balance_snapshots",
      "asset_value_snapshots",
      "assets",
      "debts",
      "debt_period_facts",
      "expense_records",
    ];
    const before: Record<string, unknown[]> = {};
    for (const table of unchanged) before[table] = await dump(db, `SELECT * FROM ${table}`);
    expect((before.expense_records ?? []).length).toBeGreaterThan(0);
    expect((before.asset_value_snapshots ?? []).length).toBeGreaterThan(0);

    const foundation = new V4FoundationService(db);
    expect(await foundation.deactivateCashAccount(cash.id, "2026-09-10")).toMatchObject({
      status: "SAVED",
    });
    expect(await foundation.deactivateAsset(asset.id, "2026-09-10")).toMatchObject({
      status: "SAVED",
    });
    expect(await foundation.deactivateDebt(debt.id, "2026-09", "2026-09-10")).toMatchObject({
      status: "SAVED",
    });

    for (const table of unchanged)
      expect(await dump(db, `SELECT * FROM ${table}`)).toEqual(before[table]);
    expect(
      await dump(
        db,
        `SELECT as_of_date,active FROM cash_account_lifecycle_revisions WHERE account_id='${cash.id}'`,
      ),
    ).toEqual([{ as_of_date: "2026-09-10", active: 0 }]);
    expect(
      await dump(
        db,
        `SELECT as_of_date,active FROM asset_revisions WHERE asset_id='${asset.id}' AND active=0`,
      ),
    ).toEqual([{ as_of_date: "2026-09-10", active: 0 }]);
    expect(
      await dump(
        db,
        `SELECT as_of_date,active FROM debt_revisions WHERE debt_id='${debt.id}' AND active=0`,
      ),
    ).toEqual([{ as_of_date: "2026-09-10", active: 0 }]);

    const current = await getFinancialMaintenanceState(db, "2026-09-10");
    expect(current.cashAccounts).toEqual([]);
    expect(current.assets).toEqual([]);
    expect(current.debts).toEqual([]);
    const historical = await getFinancialMaintenanceState(db, "2026-09-05");
    expect(historical.cashAccounts.map((row) => row.id)).toEqual([cash.id]);
    expect(historical.assets.map((row) => row.id)).toEqual([asset.id]);
    expect(historical.debts.map((row) => row.id)).toEqual([debt.id]);

    // 幂等：重复停用同一现金账户返回 NO_CHANGE。
    expect(await foundation.deactivateCashAccount(cash.id, "2026-09-10")).toMatchObject({
      status: "NO_CHANGE",
    });
  });

  it("requires the current-month fact before a debt can be deactivated", async () => {
    const db = new NodeSqliteDatabase();
    await onboard(db);
    const [debt] = (await getFinancialMaintenanceState(db, "2026-09-05")).debts;
    if (!debt) throw new Error("Debt fixture missing.");

    const result = await new V4FoundationService(db).deactivateDebt(
      debt.id,
      "2026-12",
      "2026-12-10",
    );
    expect(result).toMatchObject({
      status: "VALIDATION_FAILED",
      code: "DEBT_FACT_REQUIRED_BEFORE_DEACTIVATION",
    });
  });

  it("stops treating a soft-deleted debt as active for new facts", async () => {
    const db = new NodeSqliteDatabase();
    await onboard(db);
    const [debt] = (await getFinancialMaintenanceState(db, "2026-09-05")).debts;
    if (!debt) throw new Error("Debt fixture missing.");

    await new V4FoundationService(db).deactivateDebt(debt.id, "2026-09", "2026-09-10");

    const result = await saveCurrentMonthDebtFact(
      db,
      { debtId: debt.id, currentBalance: "1900", currentMonthDue: "500" },
      "2026-09-11",
    );
    expect(result).toMatchObject({ status: "CONFLICT_OR_UNKNOWN_ID", code: "UNKNOWN_DEBT_ID" });
  });
});

describe("S1 B3 T3 month boundary and reopen", () => {
  it("removes deactivated rows from the current month while the historical month stays identical", async () => {
    const db = new NodeSqliteDatabase();
    await onboard(db);
    const before = await buildMonthlyModelInput(db, "2026-09", "2026-09-05");
    const currentBefore = await buildMonthlyModelInput(db, "2026-09", "2026-09-10");
    const item = await essentialItem(db);
    const foundation = new V4FoundationService(db);
    const state = await getFinancialMaintenanceState(db, "2026-09-05");
    const cash = state.cashAccounts[0];
    if (!cash) throw new Error("Cash fixture missing.");

    await deactivateEssential(db, item);
    await foundation.deactivateCashAccount(cash.id, "2026-09-10");

    expect(await buildMonthlyModelInput(db, "2026-09", "2026-09-05")).toEqual(before);
    const after = await buildMonthlyModelInput(db, "2026-09", "2026-09-10");
    if (after.status !== "READY" || currentBefore.status !== "READY")
      throw new Error("Synthetic model input is not ready.");
    expect(money(after.input.facts.essentialExpenses).eq(0)).toBe(true);
    expect(after.input.facts.cashAccounts).toEqual([]);
    expect(money(currentBefore.input.facts.essentialExpenses).eq(1000)).toBe(true);
    expect(currentBefore.input.facts.cashAccounts).toHaveLength(1);
  });

  it("keeps the same boundary after the file database is reopened", async () => {
    const directory = mkdtempSync(join(tmpdir(), "s1-b3-deactivate-"));
    const path = join(directory, "ledger.sqlite3");
    try {
      const first = new NodeSqliteDatabase(new DatabaseSync(path));
      await onboard(first);
      const item = await essentialItem(first);
      await deactivateEssential(first, item);
      const stateBefore = await getFinancialMaintenanceState(first, "2026-09-05");
      first.close();
      databases.splice(databases.indexOf(first), 1);

      const reopened = new NodeSqliteDatabase(new DatabaseSync(path));
      try {
        const stateAfter = await getFinancialMaintenanceState(reopened, "2026-09-05");
        expect(stateAfter.essentialExpenses).toEqual(stateBefore.essentialExpenses);
        expect(
          (await getFinancialMaintenanceState(reopened, "2026-09-12")).essentialExpenses,
        ).toEqual([]);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
