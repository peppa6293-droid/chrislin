import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateMonthlyModelFromDatabase } from "../../src/application/monthly-model-service.js";
import { completeOnboarding } from "../../src/application/product-service.js";
import { V2ExpenseService } from "../../src/application/v2-expense-service.js";
import { money } from "../../src/model/money.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import { localDate } from "../../src/ui/date.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

interface SeededDatabase {
  db: NodeSqliteDatabase;
  repositories: Repositories;
  service: V2ExpenseService;
  profileId: string;
  asOfDate: string;
  currentMonth: string;
}

let seeded: SeededDatabase;

async function seedDatabase(connection = new DatabaseSync(":memory:")): Promise<SeededDatabase> {
  const asOfDate = localDate(new Date());
  const db = new NodeSqliteDatabase(connection);
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
      debts: [],
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
  await repositories.createAccount({
    id: "card-1",
    profileId: profile.id,
    name: "信用卡",
    type: "CREDIT_CARD",
    currency: "CNY",
  });
  await repositories.createExpenseCategory({
    id: "cat-food",
    profileId: profile.id,
    name: "餐饮",
    icon: "Utensils",
    color: "#E07A5F",
    monthlyBudget: null,
    overspendingAlert: false,
    savingsRelated: false,
    adjustable: true,
    builtin: true,
  });
  return {
    db,
    repositories,
    service,
    profileId: profile.id,
    asOfDate,
    currentMonth: asOfDate.slice(0, 7),
  };
}

function cashDraft(seed: SeededDatabase, id: string, amount = "35.00") {
  return {
    id,
    profileId: seed.profileId,
    amount,
    currency: "CNY",
    occurredOn: seed.asOfDate,
    categoryId: "cat-food",
    description: "现金午餐",
    accountId: "cash-1",
  };
}

beforeEach(async () => {
  seeded = await seedDatabase();
});

afterEach(() => seeded.db.close());

describe("EXEC-D-01 V2 cash expense dual-write into the V1 ledger", () => {
  it("mirrors a quick cash expense with the same id and the fixed V1 mapping", async () => {
    const result = await seeded.service.recordCashDebitExpense(cashDraft(seeded, "expense-cash"));

    expect(result.expense).toMatchObject({
      id: "expense-cash",
      kind: "CASH_DEBIT",
      amount: "35.00",
    });
    expect(await seeded.repositories.expenseById("expense-cash")).toEqual({
      id: "expense-cash",
      amount: "35.00",
      dateTime: `${seeded.asOfDate}T00:00:00.000Z`,
      businessDate: seeded.asOfDate,
      kind: "VARIABLE",
      category: "OTHER_VARIABLE",
      note: "现金午餐",
    });
    expect(
      await seeded.db.select(
        "SELECT id,profile_id,amount,occurred_at,kind,category,note,business_date FROM expense_records WHERE id=?",
        ["expense-cash"],
      ),
    ).toEqual([
      {
        id: "expense-cash",
        profile_id: seeded.profileId,
        amount: "35.00",
        occurred_at: `${seeded.asOfDate}T00:00:00.000Z`,
        kind: "VARIABLE",
        category: "OTHER_VARIABLE",
        note: "现金午餐",
        business_date: seeded.asOfDate,
      },
    ]);
  });

  it("feeds the V1 monthly model so variable spending grows by the recorded amount", async () => {
    const before = await calculateMonthlyModelFromDatabase(
      seeded.db,
      seeded.currentMonth,
      seeded.asOfDate,
    );
    if (before.status !== "READY") throw new Error("expected a ready monthly model baseline");

    await seeded.service.recordCashDebitExpense(cashDraft(seeded, "expense-model", "42.50"));

    const after = await calculateMonthlyModelFromDatabase(
      seeded.db,
      seeded.currentMonth,
      seeded.asOfDate,
    );
    if (after.status !== "READY") throw new Error("expected a ready monthly model after recording");
    const expected = money(before.result.spending.actualVariableSpending).plus("42.50");
    expect(money(after.result.spending.actualVariableSpending).eq(expected)).toBe(true);
  });

  it("rolls back both ledgers when the mirror insert fails", async () => {
    class MirrorInsertFailureDatabase extends NodeSqliteDatabase {
      constructor(private readonly base: NodeSqliteDatabase) {
        super(base.connection);
      }
      override async execute(sql: string, bindValues: unknown[] = []) {
        if (sql.trim().startsWith("INSERT INTO expense_records")) {
          throw new Error("forced mirror insert failure");
        }
        return this.base.execute(sql, bindValues);
      }
    }
    const wrapped = new MirrorInsertFailureDatabase(seeded.db);
    const failingService = new V2ExpenseService(new Repositories(wrapped));

    await expect(
      failingService.recordCashDebitExpense(cashDraft(seeded, "expense-atomic")),
    ).rejects.toThrow("forced mirror insert failure");
    expect(await seeded.repositories.getV2ExpenseById("expense-atomic")).toBeNull();
    expect(await seeded.repositories.expenseById("expense-atomic")).toBeNull();
  });

  it("keeps the mirrored ledger row after closing and reopening the database file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "ledger-sync-"));
    const databasePath = join(directory, "ledger.sqlite");
    const fileSeeded = await seedDatabase(new DatabaseSync(databasePath));
    try {
      await fileSeeded.service.recordCashDebitExpense(cashDraft(fileSeeded, "expense-persist"));
      fileSeeded.db.close();

      const reopened = new NodeSqliteDatabase(new DatabaseSync(databasePath));
      try {
        await migrateDatabase(reopened, `${fileSeeded.asOfDate}T00:00:00.000Z`);
        expect(await new Repositories(reopened).expenseById("expense-persist")).toMatchObject({
          id: "expense-persist",
          amount: "35.00",
          businessDate: fileSeeded.asOfDate,
          kind: "VARIABLE",
          category: "OTHER_VARIABLE",
        });
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("does not mirror credit card expenses into the V1 ledger", async () => {
    const result = await seeded.service.recordCreditExpense({
      id: "expense-credit",
      profileId: seeded.profileId,
      amount: "128.00",
      currency: "CNY",
      occurredOn: seeded.asOfDate,
      categoryId: "cat-food",
      description: "信用卡晚餐",
      creditCardId: "card-1",
    });

    expect(result.expense.kind).toBe("CREDIT_ONE_TIME");
    expect(await seeded.repositories.expenseById("expense-credit")).toBeNull();
    expect(
      await seeded.db.select("SELECT COUNT(*) AS count FROM expense_records WHERE profile_id=?", [
        seeded.profileId,
      ]),
    ).toEqual([{ count: 0 }]);
  });
});
