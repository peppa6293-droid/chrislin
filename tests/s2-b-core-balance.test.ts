import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { completeOnboarding } from "../src/application/product-service.js";
import {
  deleteLedgerExpense,
  editLedgerExpense,
  listEssentialPayments,
  listLedgerExpenses,
  recordEssentialPayment,
  restoreLedgerExpense,
} from "../src/application/ux-ledger-service.js";
import { V2ExpenseService } from "../src/application/v2-expense-service.js";
import { V4FoundationService } from "../src/application/v4-foundation-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { localDate } from "../src/ui/date.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

// B-core balance effects: state legs, manual-set barrier (Owner 2026-11-05: 按稿不回补), soft delete.

const today = localDate(new Date());

function dayOffset(days: number): string {
  const date = new Date(`${today}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

interface Seed {
  db: NodeSqliteDatabase;
  repositories: Repositories;
  service: V2ExpenseService;
  profileId: string;
  cashA: string;
  cashB: string;
}

let seed: Seed;

async function seedDatabase(): Promise<Seed> {
  const db = new NodeSqliteDatabase();
  const repositories = new Repositories(db);
  await migrateDatabase(db, `${today}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [
        { name: "A", balance: "1000", includeInSafetyResources: true },
        { name: "B", balance: "1000", includeInSafetyResources: true },
      ],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    today,
  );
  const profile = await repositories.getProfile();
  if (!profile) throw new Error("onboarding did not create a profile");
  for (const [id, name] of [
    ["cat-food", "餐饮"],
    ["cat-transport", "交通"],
  ] as const) {
    await repositories.createExpenseCategory({
      id,
      profileId: profile.id,
      name,
      icon: "Utensils",
      color: "#E07A5F",
      monthlyBudget: null,
      overspendingAlert: false,
      savingsRelated: false,
      adjustable: true,
      builtin: true,
    });
  }
  const accounts = await repositories.cashAccountsAt(today, profile.id);
  const cashA = accounts.find((account) => account.name === "A")?.id;
  const cashB = accounts.find((account) => account.name === "B")?.id;
  if (!cashA || !cashB) throw new Error("cash accounts missing");
  // `expenses.account_id` references the legacy `accounts` table.
  for (const [id, name] of [
    [cashA, "A"],
    [cashB, "B"],
  ] as const)
    await repositories.createAccount({
      id,
      profileId: profile.id,
      name,
      type: "CASH",
      currency: "CNY",
    });
  // One old snapshot per account; no fact at `today`, so past-dated operations stay readable.
  for (const accountId of [cashA, cashB]) {
    await db.execute("DELETE FROM cash_balance_snapshots WHERE account_id=?", [accountId]);
    await repositories.saveCashSnapshot(
      { id: `${accountId}-start`, accountId, asOfDate: dayOffset(-30), balance: "1000" },
      `${today}T00:00:00.000Z`,
    );
  }
  return {
    db,
    repositories,
    service: new V2ExpenseService(repositories),
    profileId: profile.id,
    cashA,
    cashB,
  };
}

beforeEach(async () => {
  seed = await seedDatabase();
});

afterEach(() => {
  seed.db.close();
});

async function recordExpense(input: {
  id: string;
  amount?: string;
  deductionAccountId?: string;
  occurredOn?: string;
  operationDate?: string;
}): Promise<void> {
  await seed.service.recordCashDebitExpense({
    id: input.id,
    profileId: seed.profileId,
    amount: input.amount ?? "100",
    currency: "CNY",
    occurredOn: input.occurredOn ?? today,
    categoryId: "cat-food",
    description: "",
    accountId: seed.cashA,
    ...(input.deductionAccountId === undefined
      ? {}
      : {
          deductionAccountId: input.deductionAccountId,
          operationDate: input.operationDate ?? today,
        }),
  });
}

async function editExpense(
  id: string,
  changes: { amount?: string; deductionAccountId?: string | null },
): Promise<void> {
  await editLedgerExpense(seed.db, {
    id,
    amount: changes.amount ?? "100",
    businessDate: today,
    categoryId: "cat-food",
    description: "",
    asOfDate: today,
    ...(changes.deductionAccountId === undefined
      ? {}
      : { deductionAccountId: changes.deductionAccountId }),
  });
}

async function cashBalance(accountId: string, asOf = today): Promise<string | null> {
  const rows = await seed.db.select<{ balance: string }>(
    `SELECT balance FROM (
       SELECT as_of_date,0 AS revision_id,balance FROM cash_balance_snapshots WHERE account_id=? AND as_of_date<=?
       UNION ALL SELECT as_of_date,revision_id,balance FROM cash_account_revisions WHERE account_id=? AND as_of_date<=?
     ) ORDER BY as_of_date DESC,revision_id DESC LIMIT 1`,
    [accountId, asOf, accountId, asOf],
  );
  return rows[0]?.balance ?? null;
}

async function debtBalance(debtId: string, asOf = today): Promise<string | null> {
  const rows = await seed.db.select<{ current_balance: string }>(
    `SELECT current_balance FROM (
       SELECT as_of_date,0 AS revision_id,current_balance FROM debt_period_facts WHERE debt_id=? AND as_of_date<=?
       UNION ALL SELECT as_of_date,revision_id,current_balance FROM debt_revisions WHERE debt_id=? AND as_of_date<=?
     ) ORDER BY as_of_date DESC,revision_id DESC LIMIT 1`,
    [debtId, asOf, debtId, asOf],
  );
  return rows[0]?.current_balance ?? null;
}

async function revisionCount(accountId: string): Promise<number> {
  const rows = await seed.db.select<{ count: number }>(
    "SELECT COUNT(*) AS count FROM cash_account_revisions WHERE account_id=?",
    [accountId],
  );
  return Number(rows[0]?.count ?? 0);
}

async function manualSet(accountId: string, asOfDate: string, balance: string): Promise<void> {
  await seed.repositories.appendCashRevision(
    seed.profileId,
    {
      id: accountId,
      name: accountId === seed.cashA ? "A" : "B",
      includeInSafetyResources: true,
      balance,
    },
    asOfDate,
    `${asOfDate}T00:00:00.000Z`,
    () => globalThis.crypto.randomUUID(),
  );
}

async function createSpendingDebt(debtId: string, balance: string): Promise<void> {
  await seed.repositories.createDebt(
    { id: debtId, name: "Card", fixedMonthlyPayment: null, dailySpendingMode: true },
    seed.profileId,
    `${today}T00:00:00.000Z`,
  );
  await seed.repositories.saveDebtPeriodFact(
    {
      id: `${debtId}-fact`,
      debtId,
      periodMonth: today.slice(0, 7),
      asOfDate: today,
      currentBalance: balance,
      currentMonthDue: null,
    },
    `${today}T00:00:00.000Z`,
  );
}

describe("S2 B-core balance effects", () => {
  it("B1 deletes the current account after switching accounts, not the history", async () => {
    await recordExpense({ id: "e1", deductionAccountId: seed.cashA });
    expect(Number(await cashBalance(seed.cashA))).toBe(900.0);

    await editExpense("e1", { deductionAccountId: seed.cashB });
    expect(Number(await cashBalance(seed.cashA))).toBe(1000.0);
    expect(Number(await cashBalance(seed.cashB))).toBe(900.0);

    await deleteLedgerExpense(seed.db, "e1", today);
    expect(Number(await cashBalance(seed.cashA))).toBe(1000.0);
    expect(Number(await cashBalance(seed.cashB))).toBe(1000.0);
  });

  it("B2 leaves the balance alone after turning the deduction off", async () => {
    await recordExpense({ id: "e1", deductionAccountId: seed.cashA });
    await editExpense("e1", { deductionAccountId: null });
    expect(Number(await cashBalance(seed.cashA))).toBe(1000.0);
    const before = await revisionCount(seed.cashA);

    await deleteLedgerExpense(seed.db, "e1", today);
    expect(Number(await cashBalance(seed.cashA))).toBe(1000.0);
    expect(await revisionCount(seed.cashA)).toBe(before);
  });

  it("B3 returns to the start after two amount edits and a delete", async () => {
    await recordExpense({ id: "e1", amount: "100", deductionAccountId: seed.cashA });
    await editExpense("e1", { amount: "80", deductionAccountId: seed.cashA });
    expect(Number(await cashBalance(seed.cashA))).toBe(920.0);
    await editExpense("e1", { amount: "50", deductionAccountId: seed.cashA });
    expect(Number(await cashBalance(seed.cashA))).toBe(950.0);

    await deleteLedgerExpense(seed.db, "e1", today);
    expect(Number(await cashBalance(seed.cashA))).toBe(1000.0);
  });

  it("B4 goes delete → restore → delete without drift", async () => {
    await recordExpense({ id: "e1", deductionAccountId: seed.cashA });
    const deleted = await deleteLedgerExpense(seed.db, "e1", today);
    expect(Number(await cashBalance(seed.cashA))).toBe(1000.0);

    await restoreLedgerExpense(seed.db, deleted.snapshot, today);
    expect(Number(await cashBalance(seed.cashA))).toBe(900.0);

    await deleteLedgerExpense(seed.db, "e1", today);
    expect(Number(await cashBalance(seed.cashA))).toBe(1000.0);
  });

  it("B4b rejects a second delete and a restore of a live record", async () => {
    await recordExpense({ id: "e1", deductionAccountId: seed.cashA });
    await expect(restoreLedgerExpense(seed.db, { id: "e1" } as never, today)).rejects.toMatchObject(
      {
        code: "EXPENSE_NOT_DELETED",
      },
    );
    const deleted = await deleteLedgerExpense(seed.db, "e1", today);
    await expect(deleteLedgerExpense(seed.db, "e1", today)).rejects.toMatchObject({
      code: "EXPENSE_DELETED",
    });
    await expect(
      editLedgerExpense(seed.db, {
        id: "e1",
        amount: "90",
        businessDate: today,
        categoryId: "cat-food",
        description: "",
        asOfDate: today,
      }),
    ).rejects.toMatchObject({ code: "EXPENSE_DELETED" });
    expect(Number(deleted.snapshot.amount)).toBe(100);
  });

  it("B5 keeps a manually restated balance on delete and reports the barrier date", async () => {
    await recordExpense({
      id: "e1",
      deductionAccountId: seed.cashA,
      occurredOn: dayOffset(-2),
      operationDate: dayOffset(-2),
    });
    expect(Number(await cashBalance(seed.cashA))).toBe(900.0);
    await manualSet(seed.cashA, dayOffset(-1), "1500");

    const deleted = await deleteLedgerExpense(seed.db, "e1", today);
    expect(Number(await cashBalance(seed.cashA))).toBe(1500.0);
    expect(deleted.suppressed).toEqual([{ accountId: seed.cashA, suppressedOn: dayOffset(-1) }]);
  });

  it("B6 keeps a manually restated balance on edit but updates the record", async () => {
    await recordExpense({
      id: "e1",
      deductionAccountId: seed.cashA,
      occurredOn: dayOffset(-2),
      operationDate: dayOffset(-2),
    });
    await manualSet(seed.cashA, dayOffset(-1), "1500");

    const edited = await editLedgerExpense(seed.db, {
      id: "e1",
      amount: "120",
      businessDate: dayOffset(-2),
      categoryId: "cat-food",
      description: "改",
      asOfDate: today,
    });
    expect(Number(await cashBalance(seed.cashA))).toBe(1500.0);
    expect(edited.suppressed).toEqual([{ accountId: seed.cashA, suppressedOn: dayOffset(-1) }]);
    expect(
      Number(
        (await seed.db.select<{ amount: string }>("SELECT amount FROM expenses WHERE id='e1'"))[0]
          ?.amount,
      ),
    ).toBe(120);
  });

  it("B7 applies the new account even when only the old one is barred", async () => {
    await recordExpense({
      id: "e1",
      deductionAccountId: seed.cashA,
      occurredOn: dayOffset(-2),
      operationDate: dayOffset(-2),
    });
    await manualSet(seed.cashA, dayOffset(-1), "1500");

    await editLedgerExpense(seed.db, {
      id: "e1",
      amount: "100",
      businessDate: today,
      categoryId: "cat-food",
      description: "",
      asOfDate: today,
      deductionAccountId: seed.cashB,
    });
    expect(Number(await cashBalance(seed.cashA))).toBe(1500.0);
    expect(Number(await cashBalance(seed.cashB))).toBe(900.0);
  });

  it("B9 restores a deactivated cash account without reactivating it", async () => {
    await recordExpense({ id: "e1", deductionAccountId: seed.cashA });
    const foundation = new V4FoundationService(seed.db);
    expect(await foundation.deactivateCashAccount(seed.cashA, today)).toMatchObject({
      status: "SAVED",
    });
    expect(await seed.repositories.cashAccountsAt(today, seed.profileId)).toHaveLength(1);

    await deleteLedgerExpense(seed.db, "e1", today);
    expect(Number(await cashBalance(seed.cashA))).toBe(1000.0);
    expect(await seed.repositories.cashAccountsAt(today, seed.profileId)).toHaveLength(1);
  });

  it("B10 restores a deactivated debt without resurrecting it", async () => {
    await createSpendingDebt("debt-card", "3000");
    await recordExpense({ id: "e1", deductionAccountId: "debt-card" });
    expect(Number(await debtBalance("debt-card"))).toBe(3100.0);

    const foundation = new V4FoundationService(seed.db);
    expect(await foundation.deactivateDebt("debt-card", today.slice(0, 7), today)).toMatchObject({
      status: "SAVED",
    });
    expect(
      await seed.repositories.debtsAt(today.slice(0, 7), today, false, seed.profileId),
    ).toEqual([]);

    await deleteLedgerExpense(seed.db, "e1", today);
    expect(Number(await debtBalance("debt-card"))).toBe(3000.0);
    expect(
      await seed.repositories.debtsAt(today.slice(0, 7), today, false, seed.profileId),
    ).toEqual([]);
    expect(
      await seed.db.select(
        "SELECT active FROM debt_revisions WHERE debt_id='debt-card' ORDER BY revision_id DESC LIMIT 1",
      ),
    ).toEqual([{ active: 0 }]);
  });

  it("B11 rejects a business date before the earliest balance and writes nothing", async () => {
    const expensesBefore = await seed.db.select("SELECT COUNT(*) AS count FROM expenses");
    const revisionsBefore = await revisionCount(seed.cashA);

    await expect(
      recordExpense({
        id: "e1",
        deductionAccountId: seed.cashA,
        occurredOn: dayOffset(-40),
        operationDate: dayOffset(-40),
      }),
    ).rejects.toMatchObject({ code: "DEDUCTION_ACCOUNT_NOT_FOUND" });
    expect(await seed.db.select("SELECT COUNT(*) AS count FROM expenses")).toEqual(expensesBefore);
    expect(await revisionCount(seed.cashA)).toBe(revisionsBefore);
  });

  it("routes a fixed-expense payment through edit, delete, and restore on the V1 ledger only", async () => {
    const payment = await recordEssentialPayment(seed.db, {
      itemId: (await seed.repositories.listEssentialExpenses())[0]?.id as string,
      amount: "300",
      paidOn: today,
    });
    await editLedgerExpense(seed.db, {
      id: payment.payment.id,
      amount: "350",
      businessDate: today,
      categoryId: "cat-transport",
      description: "改",
      asOfDate: today,
    });
    expect(
      await seed.db.select("SELECT amount,category,note FROM expense_records WHERE id=?", [
        payment.payment.id,
      ]),
    ).toEqual([{ amount: "350", category: "HOUSING", note: "改" }]);

    const deleted = await deleteLedgerExpense(seed.db, payment.payment.id, today);
    expect(deleted.snapshot.kind).toBe("ESSENTIAL");
    expect(await listEssentialPayments(seed.db)).toEqual([]);

    await restoreLedgerExpense(seed.db, deleted.snapshot, today);
    expect((await listEssentialPayments(seed.db)).map((row) => row.id)).toEqual([
      payment.payment.id,
    ]);
  });

  it("B14 dates the reversal today and leaves future reads unchanged", async () => {
    await recordExpense({ id: "e1", deductionAccountId: seed.cashA });
    await deleteLedgerExpense(seed.db, "e1", today);
    expect(
      await seed.db.select(
        "SELECT as_of_date FROM cash_account_revisions WHERE account_id=? ORDER BY revision_id DESC LIMIT 1",
        [seed.cashA],
      ),
    ).toEqual([{ as_of_date: today }]);
    expect(Number(await cashBalance(seed.cashA, dayOffset(30)))).toBe(1000.0);
  });

  it("B16 leaves revisions untouched when the record never deducted", async () => {
    await recordExpense({ id: "e1" });
    const before = await revisionCount(seed.cashA);

    await deleteLedgerExpense(seed.db, "e1", today);
    expect(await revisionCount(seed.cashA)).toBe(before);
    expect(await seed.db.select("SELECT deleted_at FROM expenses WHERE id='e1'")).not.toEqual([
      { deleted_at: null },
    ]);
  });

  it("hides soft-deleted rows from every list and keeps them for includeDeleted readers", async () => {
    await recordExpense({ id: "e1", deductionAccountId: seed.cashA });
    await deleteLedgerExpense(seed.db, "e1", today);

    expect(await listLedgerExpenses(seed.db, today.slice(0, 7))).toEqual([]);
    expect(await seed.repositories.listV2Expenses(seed.profileId)).toEqual([]);
    expect((await seed.repositories.listV2Expenses(seed.profileId, undefined, true)).length).toBe(
      1,
    );
    expect(await seed.repositories.listRecentExpenses(5)).toEqual([]);
    expect(await seed.repositories.listExpenses(dayOffset(-30), dayOffset(30))).toEqual([]);

    await seed.repositories.saveExpense(
      {
        id: "essential-1",
        amount: "50",
        dateTime: `${today}T00:00:00.000Z`,
        businessDate: today,
        kind: "ESSENTIAL",
        category: "HOUSING",
      },
      seed.profileId,
      `${today}T00:00:00.000Z`,
    );
    await seed.db.execute("UPDATE expense_records SET deleted_at=? WHERE id='essential-1'", [
      today,
    ]);
    expect(await listEssentialPayments(seed.db)).toEqual([]);
    expect(await listEssentialPayments(seed.db, undefined, true)).toHaveLength(1);
  });
});
