import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { completeOnboarding } from "../../src/application/product-service.js";
import {
  deleteLedgerExpense,
  editLedgerExpense,
  listDebtPaymentLog,
  listEssentialPayments,
  readAuditLog,
  readLedgerReconciliation,
  recategorizeLedgerExpenses,
  recordDebtRepayment,
  recordEssentialPayment,
  restoreLedgerExpense,
} from "../../src/application/ux-ledger-service.js";
import { V2ExpenseService } from "../../src/application/v2-expense-service.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import { localDate } from "../../src/ui/date.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

interface Seed {
  db: NodeSqliteDatabase;
  repositories: Repositories;
  service: V2ExpenseService;
  profileId: string;
  asOfDate: string;
  debtId: string;
}

let seed: Seed;

async function seedDatabase(): Promise<Seed> {
  const asOfDate = localDate(new Date());
  const db = new NodeSqliteDatabase();
  const repositories = new Repositories(db);
  const service = new V2ExpenseService(repositories);
  await migrateDatabase(db, `${asOfDate}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
      assets: [],
      debts: [
        {
          name: "房贷",
          currentBalance: "100000",
          currentMonthDue: "1000",
          fixedMonthlyPayment: "1000",
        },
      ],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    asOfDate,
  );
  const profile = await repositories.getProfile();
  if (!profile) throw new Error("onboarding did not create a profile");
  await repositories.createAccount({
    id: "cash-1",
    profileId: profile.id,
    name: "现金",
    type: "CASH",
    currency: "CNY",
  });
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
  const debts = await repositories.debtsAt(asOfDate.slice(0, 7), asOfDate, false, profile.id);
  const debt = debts[0];
  if (!debt) throw new Error("onboarding did not create a debt");
  return { db, repositories, service, profileId: profile.id, asOfDate, debtId: debt.id };
}

async function recordExpense(id: string, amount = "35.00") {
  await seed.service.recordCashDebitExpense({
    id,
    profileId: seed.profileId,
    amount,
    currency: "CNY",
    occurredOn: seed.asOfDate,
    categoryId: "cat-food",
    description: "现金午餐",
    accountId: "cash-1",
  });
}

async function v1Row(id: string) {
  return (
    await seed.db.select(
      "SELECT amount,category,kind,business_date,note FROM expense_records WHERE id=?",
      [id],
    )
  )[0];
}

beforeEach(async () => {
  seed = await seedDatabase();
});

afterEach(() => seed.db.close());

describe("UX ledger mutations keep V2/V1 in step", () => {
  it("edits the mirrored amount and date while keeping the V1 category pinned", async () => {
    await recordExpense("expense-edit");
    const result = await editLedgerExpense(seed.db, {
      id: "expense-edit",
      amount: "50.00",
      businessDate: seed.asOfDate,
      categoryId: "cat-transport",
      description: "改过备注",
      asOfDate: seed.asOfDate,
    });
    expect(result.reconciliation).toMatchObject({
      v2Amount: "50.00",
      balanced: true,
    });
    expect(Number(result.reconciliation.v1Amount)).toBe(50);
    expect(await v1Row("expense-edit")).toMatchObject({
      amount: "50",
      category: "OTHER_VARIABLE",
      kind: "VARIABLE",
      note: "改过备注",
    });
    const audit = await readAuditLog(seed.db);
    expect(audit.at(-1)).toMatchObject({ action: "EDIT_EXPENSE", expenseId: "expense-edit" });
  });

  it("deletes both ledgers, keeps an audit snapshot, and restores them together", async () => {
    await recordExpense("expense-delete");
    const deleted = await deleteLedgerExpense(seed.db, "expense-delete", seed.asOfDate);
    expect(deleted.snapshot.mirror?.amount).toBe("35.00");
    expect(await v1Row("expense-delete")).toBeUndefined();
    expect(await readLedgerReconciliation(seed.db, "expense-delete")).toMatchObject({
      v2Amount: null,
      v1Amount: null,
      balanced: true,
    });
    expect((await readAuditLog(seed.db)).at(-1)).toMatchObject({
      action: "DELETE_EXPENSE",
      expenseId: "expense-delete",
    });

    const restored = await restoreLedgerExpense(seed.db, deleted.snapshot, seed.asOfDate);
    expect(restored.reconciliation).toMatchObject({
      v2Amount: "35.00",
      v1Amount: "35.00",
      balanced: true,
    });
    expect(await v1Row("expense-delete")).toMatchObject({ amount: "35.00", kind: "VARIABLE" });
  });

  it("recategorizes display categories without touching totals, counts, or the V1 mirror", async () => {
    await recordExpense("expense-a", "35.00");
    await recordExpense("expense-b", "12.50");
    const result = await recategorizeLedgerExpenses(
      seed.db,
      [{ expenseId: "expense-a", categoryId: "cat-transport" }],
      seed.asOfDate,
    );
    expect(result.updated).toBe(1);
    expect(Number(result.totalBefore)).toBeCloseTo(Number(result.totalAfter), 2);
    expect(Number(result.totalBefore)).toBeCloseTo(47.5, 2);
    expect(result.countBefore).toBe(result.countAfter);
    const v2 = await seed.db.select("SELECT category_id FROM expenses WHERE id=?", ["expense-a"]);
    expect(v2[0]?.category_id).toBe("cat-transport");
    expect((await v1Row("expense-a"))?.category).toBe("OTHER_VARIABLE");
    expect((await readAuditLog(seed.db)).at(-1)).toMatchObject({ action: "RECATEGORIZE" });
  });

  it("records a repayment by moving both debt ledgers and appending the payment log", async () => {
    const before = await seed.db.select(
      "SELECT current_balance FROM debt_period_facts WHERE debt_id=? ORDER BY as_of_date DESC LIMIT 1",
      [seed.debtId],
    );
    expect(Number(before[0]?.current_balance)).toBe(100000);

    const result = await recordDebtRepayment(seed.db, {
      debtId: seed.debtId,
      amount: "1000",
      paidOn: seed.asOfDate,
      note: "本月房贷",
      asOfDate: seed.asOfDate,
    });
    expect(result.reconciliation).toMatchObject({ balanced: true });
    expect(Number(result.reconciliation.revisionBalance)).toBe(99000);
    expect(Number(result.reconciliation.factBalance)).toBe(99000);
    expect(result.payment).toMatchObject({
      debtId: seed.debtId,
      amount: "1000",
      balanceAfter: "99000",
    });
    expect(await listDebtPaymentLog(seed.db)).toHaveLength(1);

    await expect(
      recordDebtRepayment(seed.db, {
        debtId: seed.debtId,
        amount: "999999",
        paidOn: seed.asOfDate,
        asOfDate: seed.asOfDate,
      }),
    ).rejects.toMatchObject({ code: "REPAYMENT_EXCEEDS_BALANCE" });
  });

  it("records an essential payment only in the fixed-expense ledger", async () => {
    const items = await seed.repositories.listEssentialExpensesAt(seed.asOfDate);
    const item = items[0];
    if (!item) throw new Error("onboarding did not create an essential item");

    const result = await recordEssentialPayment(seed.db, {
      itemId: item.id,
      amount: "1000",
      paidOn: seed.asOfDate,
    });
    expect(Number(result.monthTotal)).toBe(1000);
    expect(await listEssentialPayments(seed.db)).toHaveLength(1);
    const v2Count = await seed.db.select("SELECT COUNT(*) AS count FROM expenses");
    expect(Number(v2Count[0]?.count)).toBe(0);
    const variableCount = await seed.db.select(
      "SELECT COUNT(*) AS count FROM expense_records WHERE kind='VARIABLE'",
    );
    expect(Number(variableCount[0]?.count)).toBe(0);
    const essential = await seed.db.select(
      "SELECT amount,category,kind FROM expense_records WHERE kind='ESSENTIAL'",
    );
    expect(essential).toHaveLength(1);
    expect(essential[0]).toMatchObject({ kind: "ESSENTIAL", category: "HOUSING" });
  });
});
