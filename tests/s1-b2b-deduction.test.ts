import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import {
  getFinancialMaintenanceState,
  updateFinancialDataAndRecalculate,
} from "../src/application/financial-maintenance-service.js";
import { completeOnboarding } from "../src/application/product-service.js";
import { V2ExpenseService } from "../src/application/v2-expense-service.js";
import { money } from "../src/model/money.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const opened: NodeSqliteDatabase[] = [];
const dirs: string[] = [];

function memory(): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase();
  opened.push(db);
  return db;
}

function fileDatabase(path: string): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase(new DatabaseSync(path));
  opened.push(db);
  return db;
}

function tempFile(): string {
  const directory = mkdtempSync(join(tmpdir(), "s1-b2b-deduction-"));
  dirs.push(directory);
  return join(directory, "ledger.sqlite3");
}

function close(db: NodeSqliteDatabase): void {
  const index = opened.indexOf(db);
  if (index >= 0) opened.splice(index, 1);
  db.close();
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

type Fixture = {
  db: NodeSqliteDatabase;
  profileId: string;
  cashId: string;
  debtId: string;
  service: V2ExpenseService;
};

async function fixture(path?: string): Promise<Fixture> {
  const db = path ? fileDatabase(path) : memory();
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
    "2026-09-01",
  );
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  if (!profile) throw new Error("Onboarding did not create a profile.");
  await repositories.createAccount({
    id: "v2-cash",
    profileId: profile.id,
    name: "零钱",
    type: "CASH",
    currency: "CNY",
  });
  await repositories.createExpenseCategory({
    id: "cat-food",
    profileId: profile.id,
    name: "餐饮",
    icon: "Utensils",
    color: "#FFC94A",
    monthlyBudget: null,
    overspendingAlert: false,
    savingsRelated: false,
    adjustable: true,
    builtin: true,
  });
  const state = await getFinancialMaintenanceState(db, "2026-09-10");
  const [cash] = state.cashAccounts;
  const [debt] = state.debts;
  if (!cash || !debt) throw new Error("Onboarding fixtures are missing.");
  return {
    db,
    profileId: profile.id,
    cashId: cash.id,
    debtId: debt.id,
    service: new V2ExpenseService(repositories),
  };
}

async function record(
  fx: Fixture,
  amount: string,
  paymentDate: string,
  deductionAccountId?: string,
): Promise<string> {
  const id = globalThis.crypto.randomUUID();
  await fx.service.recordCashDebitExpense({
    id,
    profileId: fx.profileId,
    amount,
    currency: "CNY",
    occurredOn: paymentDate,
    categoryId: "cat-food",
    description: "",
    accountId: "v2-cash",
    ...(deductionAccountId ? { deductionAccountId, operationDate: "2026-09-10" } : {}),
  });
  return id;
}

async function counts(db: NodeSqliteDatabase) {
  const [cashRevisions, cashSnapshots, debtRevisions, debtFacts] = await Promise.all([
    db.select<{ count: number }>("SELECT COUNT(*) AS count FROM cash_account_revisions"),
    db.select<{ count: number }>("SELECT COUNT(*) AS count FROM cash_balance_snapshots"),
    db.select<{ count: number }>("SELECT COUNT(*) AS count FROM debt_revisions"),
    db.select<{ count: number }>("SELECT COUNT(*) AS count FROM debt_period_facts"),
  ]);
  return {
    cashRevisions: cashRevisions[0]?.count,
    cashSnapshots: cashSnapshots[0]?.count,
    debtRevisions: debtRevisions[0]?.count,
    debtFacts: debtFacts[0]?.count,
  };
}

describe("S1 B2b T3 deduction behavior", () => {
  it("writes nothing when the deduction switch is off", async () => {
    const fx = await fixture();
    const before = await counts(fx.db);

    await record(fx, "50.00", "2026-09-10");

    expect(await counts(fx.db)).toEqual(before);
    expect(
      await fx.db.select(
        "SELECT COUNT(*) AS count FROM cash_account_revisions WHERE source_payment_id IS NOT NULL",
      ),
    ).toEqual([{ count: 0 }]);
  });

  it("deducts cash with one sourced revision and stacks same-day payments", async () => {
    const fx = await fixture();
    const first = await record(fx, "100.00", "2026-09-10", fx.cashId);
    expect(
      await fx.db.select(
        "SELECT as_of_date,balance FROM cash_account_revisions WHERE source_payment_id=?",
        [first],
      ),
    ).toEqual([{ as_of_date: "2026-09-10", balance: "4900" }]);
    expect(
      await fx.db.select(
        "SELECT as_of_date,balance FROM cash_balance_snapshots WHERE account_id=? AND as_of_date=?",
        [fx.cashId, "2026-09-10"],
      ),
    ).toEqual([{ as_of_date: "2026-09-10", balance: "4900" }]);

    const second = await record(fx, "50.00", "2026-09-10", fx.cashId);
    expect(
      await fx.db.select(
        "SELECT balance FROM cash_account_revisions WHERE source_payment_id IN (?,?) ORDER BY revision_id",
        [first, second],
      ),
    ).toEqual([{ balance: "4900" }, { balance: "4850" }]);
    const [account] = await new Repositories(fx.db).cashAccountsAt("2026-09-10");
    expect(account?.balance).toBe("4850");
  });

  it("keeps the historical snapshot row and adds a payment-date revision plus an operation-date adjustment", async () => {
    const fx = await fixture();
    const state = await getFinancialMaintenanceState(fx.db, "2026-09-10");
    const cash = state.cashAccounts[0];
    if (!cash) throw new Error("Cash fixture missing.");
    await updateFinancialDataAndRecalculate(
      fx.db,
      {
        cashAccounts: [
          { id: cash.id, name: cash.name, balance: "5200", includeInSafetyResources: true },
        ],
      },
      "2026-09-10",
    );
    const repositories = new Repositories(fx.db);
    const atPayment = (await repositories.cashAccountsAt("2026-09-05"))[0]?.balance;
    const atOperation = (await repositories.cashAccountsAt("2026-09-10"))[0]?.balance;
    if (atPayment === undefined || atOperation === undefined)
      throw new Error("Cash balance fixtures missing.");
    const expectedHistorical = money(atPayment).minus(25).toString();
    const expectedOperation = money(atOperation).minus(25).toString();
    const snapshotsBefore = await fx.db.select(
      "SELECT as_of_date,balance FROM cash_balance_snapshots WHERE account_id=? ORDER BY as_of_date",
      [fx.cashId],
    );

    const paymentId = await record(fx, "25.00", "2026-09-05", fx.cashId);

    expect(
      await fx.db.select(
        "SELECT as_of_date,balance FROM cash_account_revisions WHERE source_payment_id=? ORDER BY as_of_date,revision_id",
        [paymentId],
      ),
    ).toEqual([
      { as_of_date: "2026-09-05", balance: expectedHistorical },
      { as_of_date: "2026-09-10", balance: expectedOperation },
    ]);
    const snapshotsAfter = await fx.db.select(
      "SELECT as_of_date,balance FROM cash_balance_snapshots WHERE account_id=? ORDER BY as_of_date",
      [fx.cashId],
    );
    for (const row of snapshotsBefore) expect(snapshotsAfter).toContainEqual(row);
    expect(snapshotsAfter).toContainEqual({
      as_of_date: "2026-09-10",
      balance: expectedOperation,
    });
    expect((await repositories.cashAccountsAt("2026-09-05"))[0]?.balance).toBe(expectedHistorical);
    expect((await repositories.cashAccountsAt("2026-09-10"))[0]?.balance).toBe(expectedOperation);
  });

  it("charges a spending-mode debt card without touching cash", async () => {
    const fx = await fixture();
    const state = await getFinancialMaintenanceState(fx.db, "2026-09-10");
    const debt = state.debts[0];
    if (!debt) throw new Error("Debt fixture missing.");
    await updateFinancialDataAndRecalculate(
      fx.db,
      {
        debts: [
          {
            id: debt.id,
            name: debt.name,
            currentBalance: debt.currentBalance,
            currentMonthDue: debt.currentMonthDue,
            fixedMonthlyPayment: debt.fixedMonthlyPayment,
            dailySpendingMode: true,
          },
        ],
      },
      "2026-09-10",
    );
    const before = await counts(fx.db);
    const enabled = await getFinancialMaintenanceState(fx.db, "2026-09-10");
    expect(enabled.debts[0]?.dailySpendingMode).toBe(true);

    const paymentId = await record(fx, "200.00", "2026-09-10", fx.debtId);

    expect(await counts(fx.db)).toEqual({
      ...before,
      debtRevisions: (before.debtRevisions ?? 0) + 1,
    });
    expect(
      await fx.db.select(
        "SELECT balance FROM cash_balance_snapshots WHERE as_of_date='2026-09-10'",
      ),
    ).toEqual([]);
    expect(
      await fx.db.select("SELECT current_balance FROM debt_revisions WHERE source_payment_id=?", [
        paymentId,
      ]),
    ).toEqual([{ current_balance: "2200" }]);
    expect(
      await fx.db.select(
        "SELECT current_balance FROM debt_period_facts WHERE period_month='2026-09'",
      ),
    ).toEqual([{ current_balance: "2200" }]);
    expect(
      await fx.db.select(
        "SELECT COUNT(*) AS count FROM debt_revisions WHERE source_payment_id IS NULL",
      ),
    ).not.toEqual([{ count: 0 }]);
    expect((await getFinancialMaintenanceState(fx.db, "2026-09-10")).debts[0]).toMatchObject({
      currentBalance: "2200",
      dailySpendingMode: true,
    });

    const factsBefore = await fx.db.select(
      "SELECT current_balance FROM debt_period_facts WHERE period_month='2026-09'",
    );
    const futurePayment = await record(fx, "20.00", "2026-09-20", fx.debtId);
    expect(
      await fx.db.select("SELECT current_balance FROM debt_revisions WHERE source_payment_id=?", [
        futurePayment,
      ]),
    ).toEqual([{ current_balance: "2220" }]);
    expect(
      await fx.db.select(
        "SELECT current_balance FROM debt_period_facts WHERE period_month='2026-09'",
      ),
    ).toEqual(factsBefore);
  });

  it("writes only the revision and no snapshot/fact for a future-dated payment", async () => {
    const fx = await fixture();
    const before = await counts(fx.db);

    const paymentId = await record(fx, "10.00", "2026-09-20", fx.cashId);

    expect(await counts(fx.db)).toEqual({
      ...before,
      cashRevisions: (before.cashRevisions ?? 0) + 1,
    });
    expect(
      await fx.db.select(
        "SELECT as_of_date,balance FROM cash_account_revisions WHERE source_payment_id=?",
        [paymentId],
      ),
    ).toEqual([{ as_of_date: "2026-09-10", balance: "4990" }]);
    expect(
      await fx.db.select(
        "SELECT COUNT(*) AS count FROM cash_balance_snapshots WHERE as_of_date='2026-09-20'",
      ),
    ).toEqual([{ count: 0 }]);
    expect((await new Repositories(fx.db).cashAccountsAt("2026-09-20"))[0]?.balance).toBe("4990");
  });

  it("persists the debt spending-mode switch across a reopen", async () => {
    const path = tempFile();
    const first = await fixture(path);
    const debt = (await getFinancialMaintenanceState(first.db, "2026-09-10")).debts[0];
    if (!debt) throw new Error("Debt fixture missing.");
    await updateFinancialDataAndRecalculate(
      first.db,
      { debts: [{ id: debt.id, dailySpendingMode: true }] },
      "2026-09-10",
    );
    const debtId = first.debtId;
    close(first.db);

    const reopened = fileDatabase(path);
    expect((await getFinancialMaintenanceState(reopened, "2026-09-10")).debts[0]).toMatchObject({
      id: debtId,
      dailySpendingMode: true,
    });
  });
});
