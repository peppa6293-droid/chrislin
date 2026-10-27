import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { calculateMonthlyModelFromDatabase } from "../../src/application/monthly-model-service.js";
import { completeOnboarding } from "../../src/application/product-service.js";
import { money } from "../../src/model/money.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import {
  ensureV2LedgerDefaults,
  recordV2CashExpenseForDatabase,
} from "../../src/runtime/tauri-bootstrap.js";
import { localDate } from "../../src/ui/date.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

interface SeededDatabase {
  db: NodeSqliteDatabase;
  repositories: Repositories;
  asOfDate: string;
  currentMonth: string;
}

async function seedDatabase(connection = new DatabaseSync(":memory:")): Promise<SeededDatabase> {
  const asOfDate = localDate(new Date());
  const db = new NodeSqliteDatabase(connection);
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
  return {
    db,
    repositories: new Repositories(db),
    asOfDate,
    currentMonth: asOfDate.slice(0, 7),
  };
}

function quickEntrySubmission(seed: SeededDatabase, id: string, amount = "42.50") {
  return {
    id,
    amount,
    dateTime: `${seed.asOfDate}T09:30:00.000Z`,
    businessDate: seed.asOfDate,
    category: "FOOD" as const,
    note: "现金午餐",
  };
}

describe("EXEC-LANDING L-01 composition-root services", () => {
  it("seeds one cash account and the built-in categories, idempotently", async () => {
    const seed = await seedDatabase();
    try {
      const first = await ensureV2LedgerDefaults(seed.db);

      const accounts = await seed.db.select(
        "SELECT name,type,currency,active FROM accounts ORDER BY id",
      );
      expect(accounts).toEqual([{ name: "现金", type: "CASH", currency: "CNY", active: 1 }]);
      expect(first.cashAccountId).toBeTruthy();

      const categories = await seed.db.select(
        "SELECT id,name,icon,color,monthly_budget,overspending_alert,savings_related,adjustable,builtin,active FROM expense_categories ORDER BY id",
      );
      expect(categories).toHaveLength(11);
      expect(new Set(categories.map((category) => category.name))).toEqual(
        new Set([
          "餐饮",
          "交通",
          "购物",
          "娱乐",
          "家居",
          "其他",
          "医疗",
          "居住",
          "水电",
          "保险",
          "教育",
        ]),
      );
      for (const category of categories) {
        expect(category).toMatchObject({
          monthly_budget: null,
          overspending_alert: 0,
          savings_related: 0,
          adjustable: 1,
          builtin: 1,
          active: 1,
        });
      }
      expect(Object.keys(first.categoryIds).sort()).toEqual(
        ["ENTERTAINMENT", "FOOD", "HOUSEHOLD", "OTHER_VARIABLE", "SHOPPING", "TRANSPORT"].sort(),
      );
      expect(new Set(Object.values(first.categoryIds)).size).toBe(6);

      const second = await ensureV2LedgerDefaults(seed.db);
      expect(second).toEqual(first);
      expect(await seed.db.select("SELECT COUNT(*) AS count FROM accounts")).toEqual([
        { count: 1 },
      ]);
      expect(await seed.db.select("SELECT COUNT(*) AS count FROM expense_categories")).toEqual([
        { count: 11 },
      ]);
    } finally {
      seed.db.close();
    }
  });

  it("moves monthly variable spending by the recorded amount, derived from the baseline object", async () => {
    const seed = await seedDatabase();
    try {
      await ensureV2LedgerDefaults(seed.db);
      const before = await calculateMonthlyModelFromDatabase(
        seed.db,
        seed.currentMonth,
        seed.asOfDate,
      );
      if (before.status !== "READY") throw new Error("expected a ready monthly model baseline");

      const submission = quickEntrySubmission(seed, "landing-model-expense");
      await recordV2CashExpenseForDatabase(seed.db, submission, seed.asOfDate);

      const after = await calculateMonthlyModelFromDatabase(
        seed.db,
        seed.currentMonth,
        seed.asOfDate,
      );
      if (after.status !== "READY") throw new Error("expected a ready monthly model after save");

      const expected = money(before.result.spending.actualVariableSpending).plus(submission.amount);
      expect(money(after.result.spending.actualVariableSpending).eq(expected)).toBe(true);
      expect(
        money(after.result.spending.actualVariableSpending)
          .minus(before.result.spending.actualVariableSpending)
          .eq(money(submission.amount)),
      ).toBe(true);
    } finally {
      seed.db.close();
    }
  });

  it("writes the same id into both ledgers with the fixed V1 mirror mapping", async () => {
    const seed = await seedDatabase();
    try {
      const defaults = await ensureV2LedgerDefaults(seed.db);
      const submission = quickEntrySubmission(seed, "landing-dual-row", "35.00");
      const result = await recordV2CashExpenseForDatabase(seed.db, submission, seed.asOfDate);
      expect(result.expenseId).toBe("landing-dual-row");

      expect(await seed.repositories.getV2ExpenseById("landing-dual-row")).toMatchObject({
        id: "landing-dual-row",
        kind: "CASH_DEBIT",
        amount: "35.00",
        occurredOn: seed.asOfDate,
        categoryId: defaults.categoryIds.FOOD,
        accountId: defaults.cashAccountId,
      });
      expect(await seed.repositories.expenseById("landing-dual-row")).toEqual({
        id: "landing-dual-row",
        amount: "35.00",
        dateTime: `${seed.asOfDate}T00:00:00.000Z`,
        businessDate: seed.asOfDate,
        kind: "VARIABLE",
        category: "OTHER_VARIABLE",
        note: "现金午餐",
      });
      expect(
        await seed.db.select("SELECT kind,category,business_date FROM expense_records WHERE id=?", [
          "landing-dual-row",
        ]),
      ).toEqual([{ kind: "VARIABLE", category: "OTHER_VARIABLE", business_date: seed.asOfDate }]);
    } finally {
      seed.db.close();
    }
  });

  it("keeps the seeded defaults and both ledger rows after closing and reopening the file", async () => {
    const directory = mkdtempSync(join(tmpdir(), "landing-services-"));
    const databasePath = join(directory, "landing.sqlite");
    const fileSeed = await seedDatabase(new DatabaseSync(databasePath));
    try {
      const defaults = await ensureV2LedgerDefaults(fileSeed.db);
      await recordV2CashExpenseForDatabase(
        fileSeed.db,
        quickEntrySubmission(fileSeed, "landing-persist", "28.00"),
        fileSeed.asOfDate,
      );
      fileSeed.db.close();

      const reopened = new NodeSqliteDatabase(new DatabaseSync(databasePath));
      try {
        await migrateDatabase(reopened, `${fileSeed.asOfDate}T00:00:00.000Z`);
        const reopenedDefaults = await ensureV2LedgerDefaults(reopened);
        expect(reopenedDefaults).toEqual(defaults);
        expect(await reopened.select("SELECT COUNT(*) AS count FROM accounts")).toEqual([
          { count: 1 },
        ]);
        expect(await reopened.select("SELECT COUNT(*) AS count FROM expense_categories")).toEqual([
          { count: 11 },
        ]);

        const repositories = new Repositories(reopened);
        expect(await repositories.getV2ExpenseById("landing-persist")).toMatchObject({
          id: "landing-persist",
          kind: "CASH_DEBIT",
          amount: "28.00",
          occurredOn: fileSeed.asOfDate,
        });
        expect(await repositories.expenseById("landing-persist")).toMatchObject({
          id: "landing-persist",
          amount: "28.00",
          businessDate: fileSeed.asOfDate,
        });
      } finally {
        reopened.close();
      }
    } finally {
      try {
        fileSeed.db.close();
      } catch {
        // already closed before reopening
      }
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
