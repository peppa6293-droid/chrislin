import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getApplicationInitializationState } from "../src/application/initialization-service.js";
import {
  ApplicationModelError,
  buildMonthlyModelInput,
  calculateMonthlyModelFromDatabase,
} from "../src/application/monthly-model-service.js";
import { ModelValidationError } from "../src/model/errors.js";
import { calculateMonthlyModel } from "../src/model/monthly-model.js";
import type { FinancialSettings } from "../src/model/types.js";
import { CURRENT_SCHEMA_VERSION, migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { variableExpense } from "./fixtures/model-input.js";
import { ownerProfileFixture } from "./fixtures/owner-profile.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

let directory: string;
let db: NodeSqliteDatabase;
let repositories: Repositories;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "finance-foundation-"));
  db = new NodeSqliteDatabase(
    new (await import("node:sqlite")).DatabaseSync(join(directory, "test.sqlite3")),
  );
  repositories = new Repositories(db);
  await migrateDatabase(db, "2026-10-02T00:00:00.000Z");
});

afterEach(() => {
  db?.close();
  rmSync(directory, { recursive: true, force: true });
});

async function initialize(
  settings: FinancialSettings = {
    safetyCoverageTargetMonths: 3,
    minimumCashCoverageMonths: 1,
    safetyRecoveryHorizonMonths: 12,
    desiredMonthlyDiscretionarySpending: "1000.00",
  },
) {
  await repositories.createProfile(
    { id: "profile-test", displayName: "Test profile" },
    "2026-10-02T00:00:00Z",
  );
  await repositories.saveSettings("profile-test", settings);
}

describe("SQLite migrations and initialization", () => {
  it("creates the current schema version", async () => {
    const rows = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table'",
    );
    expect(rows.map((row) => row.name)).toContain("profiles");
    expect(await repositories.getMeta("none")).toBeNull();
  });

  it("is idempotent across repeated initialization", async () => {
    await migrateDatabase(db);
    await migrateDatabase(db);
    const rows = await db.select<{ count: number }>(
      "SELECT COUNT(*) AS count FROM schema_migrations",
    );
    expect(rows[0]?.count).toBe(CURRENT_SCHEMA_VERSION);
  });

  it("returns INITIALIZATION_REQUIRED for an empty production-shaped database", async () => {
    expect(await buildMonthlyModelInput(db, "2026-10", "2026-10-02")).toEqual({
      status: "INITIALIZATION_REQUIRED",
    });
    expect(await calculateMonthlyModelFromDatabase(db, "2026-10", "2026-10-02")).toEqual({
      status: "INITIALIZATION_REQUIRED",
    });
    const profiles = await db.select("SELECT * FROM profiles");
    expect(profiles).toHaveLength(0);
  });

  it("returns typed application initialization state through the application service", async () => {
    expect(await getApplicationInitializationState(db)).toEqual({
      status: "INITIALIZATION_REQUIRED",
    });

    await initialize();

    expect(await getApplicationInitializationState(db)).toEqual({ status: "READY" });
  });

  it("rejects a month and as-of date that disagree", async () => {
    await expect(buildMonthlyModelInput(db, "2026-10", "2026-09-30")).rejects.toMatchObject({
      code: "INVALID_PERIOD",
    });
  });

  it("rejects an invalid calendar date at the application boundary", async () => {
    await expect(buildMonthlyModelInput(db, "2026-10", "2026-10-35")).rejects.toMatchObject({
      code: "INVALID_PERIOD",
    });
  });
});

describe("profile, settings, and essential expense repositories", () => {
  it("creates, reads, updates, and deletes a profile", async () => {
    await repositories.createProfile({ id: "p1", displayName: "One" });
    expect(await repositories.getProfile()).toEqual({ id: "p1", displayName: "One" });
    await repositories.updateProfile({ id: "p1", displayName: "Updated" });
    expect(await repositories.getProfile()).toEqual({ id: "p1", displayName: "Updated" });
    await repositories.deleteProfile("p1");
    expect(await repositories.getProfile()).toBeNull();
  });

  it("persists every user-selected financial setting without inserting examples", async () => {
    await initialize({
      safetyCoverageTargetMonths: 9,
      minimumCashCoverageMonths: 2,
      safetyRecoveryHorizonMonths: 18,
      desiredMonthlyDiscretionarySpending: "1234.56",
    });
    expect(await repositories.getSettings()).toEqual({
      safetyCoverageTargetMonths: 9,
      minimumCashCoverageMonths: 2,
      safetyRecoveryHorizonMonths: 18,
      desiredMonthlyDiscretionarySpending: "1234.56",
    });
    expect(await db.select("SELECT * FROM income_records")).toHaveLength(0);
    expect(await db.select("SELECT * FROM debts")).toHaveLength(0);
    expect(await db.select("SELECT * FROM cash_accounts")).toHaveLength(0);
    expect(await db.select("SELECT * FROM assets")).toHaveLength(0);
  });

  it("persists categorized essential expense facts and their dated history", async () => {
    await initialize();
    await repositories.saveEssentialExpense(
      { id: "home", category: "HOUSING", name: "Rent", monthlyAmount: "8000.10" },
      "profile-test",
      "2026-10-02T01:00:00Z",
    );
    expect(await repositories.listEssentialExpenses()).toEqual([
      { id: "home", category: "HOUSING", name: "Rent", monthlyAmount: "8000.10" },
    ]);
    expect(await repositories.listEssentialExpensesAt("2026-10-01")).toEqual([]);
    expect(await repositories.listEssentialExpensesAt("2026-10-02")).toHaveLength(1);
  });

  it("keeps the essential-expense master when a destructive deletion is restricted by history", async () => {
    await initialize();
    await repositories.saveEssentialExpense(
      { id: "food", category: "BASIC_FOOD", name: "Food", monthlyAmount: "500" },
      "profile-test",
    );
    await expect(repositories.deleteProfile("profile-test")).rejects.toThrow();
    expect(await repositories.listEssentialExpenses()).toHaveLength(1);
  });
});

describe("income and expense persistence", () => {
  it.each(["EXPECTED", "PENDING", "RECEIVED"] as const)(
    "persists %s income with Planning / Actual separation",
    async (status) => {
      await initialize();
      await repositories.saveIncome(
        { id: `plan-${status}`, kind: "PLANNING", status, amount: "15000", date: "2026-10-01" },
        "profile-test",
      );
      await repositories.saveIncome(
        { id: `actual-${status}`, kind: "ACTUAL", status, amount: "1234.56", date: "2026-10-02" },
        "profile-test",
        "2026-10",
      );
      const rows = await repositories.listIncome("2026-10", "2026-10-31");
      expect(rows.map((row) => row.kind)).toContain("PLANNING");
      expect(rows.find((row) => row.kind === "ACTUAL")?.status).toBe(status);
    },
  );

  it("does not leak month-scoped Actual Income into a later month", async () => {
    await initialize();
    await repositories.saveIncome(
      { id: "actual", kind: "ACTUAL", status: "RECEIVED", amount: "100", date: "2026-10-02" },
      "profile-test",
      "2026-10",
    );
    expect(await repositories.listIncome("2026-11", "2026-11-30")).toHaveLength(0);
  });

  it("persists expenses with optional categories and notes", async () => {
    await initialize();
    const record = variableExpense("12.34");
    await repositories.saveExpense({ ...record, note: "Lunch" }, "profile-test");
    expect(await repositories.listExpenses("2026-10-01", "2026-10-04")).toEqual([
      { ...record, businessDate: "2026-10-04", note: "Lunch" },
    ]);
  });

  it("uses half-open local-date intervals and includes the final stored timestamp", async () => {
    await initialize();
    const base = variableExpense("10");
    await repositories.saveExpense(
      { ...base, dateTime: "2026-10-04T23:59:59.999Z", businessDate: "2026-10-04" },
      "profile-test",
    );
    await repositories.saveExpense(
      { ...base, id: "next-day", dateTime: "2026-10-05T00:00:00.000Z", businessDate: "2026-10-05" },
      "profile-test",
    );
    expect(await repositories.variableSpending("2026-10-01", "2026-10-04")).toBe("10");
    expect(await repositories.listExpenses("2026-10-04", "2026-10-04")).toHaveLength(1);
    expect(await repositories.listExpenses("2026-10-05", "2026-10-05")).toHaveLength(1);
  });

  it("does not apply same-month planning or settings revisions before their as-of date", async () => {
    await initialize();
    await repositories.saveIncome(
      {
        id: "planning-base",
        kind: "PLANNING",
        status: "EXPECTED",
        amount: "10000",
        date: "2026-10-01",
      },
      "profile-test",
    );
    await repositories.appendPlanningIncomeRevision(
      "profile-test",
      "2026-10",
      "2026-10-20",
      "9000",
      "2026-10-20T00:00:00Z",
    );
    await repositories.appendSettingsRevision(
      "profile-test",
      "2026-10",
      "2026-10-20",
      {
        safetyCoverageTargetMonths: 3,
        minimumCashCoverageMonths: 1,
        desiredMonthlyDiscretionarySpending: "7000",
      },
      "2026-10-20T00:00:00Z",
    );
    expect(
      (await repositories.listIncome("2026-10", "2026-10-03")).find(
        (row) => row.kind === "PLANNING",
      )?.amount,
    ).toBe("10000");
    expect(
      (await repositories.getSettingsAt("2026-10", "2026-10-03"))
        ?.desiredMonthlyDiscretionarySpending,
    ).toBe("1000.00");
    expect(
      (await repositories.listIncome("2026-10", "2026-10-21")).find(
        (row) => row.kind === "PLANNING",
      )?.amount,
    ).toBe("9000");
    expect(
      (await repositories.getSettingsAt("2026-10", "2026-10-21"))
        ?.desiredMonthlyDiscretionarySpending,
    ).toBe("7000");
  });

  it("rejects amounts outside the frozen precision and range contract", async () => {
    await initialize();
    for (const amount of ["1000000000000.00", "1.001", "1e3", "NaN"]) {
      await expect(
        repositories.saveIncome(
          { id: `bad-${amount}`, kind: "PLANNING", status: "EXPECTED", amount, date: "2026-10-02" },
          "profile-test",
        ),
      ).rejects.toThrow();
    }
  });

  it("does not silently replace malformed stored amounts with zero", async () => {
    await initialize();
    await repositories.createCashAccount(
      { id: "cash", name: "Cash", includeInSafetyResources: true },
      "profile-test",
    );
    await db.execute(
      "INSERT INTO cash_balance_snapshots(id,account_id,as_of_date,balance,created_at) VALUES(?,?,?,?,?)",
      ["bad", "cash", "2026-10-02", "not-money", "now"],
    );
    await expect(repositories.cashAccountsAt("2026-10-02")).rejects.toMatchObject({
      code: "INVALID_STORED_MONEY",
    });
  });
});

describe("cash, assets, and debt snapshots", () => {
  it("selects current and previous valid cash snapshots without overwriting history", async () => {
    await initialize();
    await repositories.createCashAccount(
      { id: "cash", name: "Cash", includeInSafetyResources: true },
      "profile-test",
    );
    await repositories.saveCashSnapshot({
      id: "c1",
      accountId: "cash",
      asOfDate: "2026-09-04",
      balance: "1000.01",
    });
    await repositories.saveCashSnapshot({
      id: "c2",
      accountId: "cash",
      asOfDate: "2026-10-02",
      balance: "2000.02",
    });
    expect((await repositories.cashAccountsAt("2026-10-02"))[0]?.balance).toBe("2000.02");
    expect((await repositories.cashAccountsAt("2026-09-30"))[0]?.balance).toBe("1000.01");
    expect(await db.select("SELECT * FROM cash_balance_snapshots")).toHaveLength(2);
  });

  it("persists cash safety eligibility", async () => {
    await initialize();
    await repositories.createCashAccount(
      { id: "restricted", name: "Restricted", includeInSafetyResources: false },
      "profile-test",
    );
    await repositories.saveCashSnapshot({
      id: "cs",
      accountId: "restricted",
      asOfDate: "2026-10-02",
      balance: "300",
    });
    expect((await repositories.cashAccountsAt("2026-10-02"))[0]?.includeInSafetyResources).toBe(
      false,
    );
  });

  it("reports an active cash account without a current balance fact instead of dropping it", async () => {
    await initialize();
    await repositories.createCashAccount(
      { id: "cash", name: "Everyday", includeInSafetyResources: true },
      "profile-test",
      "2026-10-01T00:00:00Z",
    );
    await expect(repositories.cashAccountsAt("2026-10-02")).rejects.toMatchObject({
      code: "MISSING_CASH_SNAPSHOT",
    });
  });

  it("selects current and previous asset values and preserves asset classification", async () => {
    await initialize();
    await repositories.createAsset(
      { id: "fund", name: "Fund", kind: "LIQUID_INVESTMENT", includeInSafetyResources: true },
      "profile-test",
    );
    await repositories.saveAssetSnapshot({
      id: "a1",
      assetId: "fund",
      asOfDate: "2026-09-04",
      value: "10.01",
    });
    await repositories.saveAssetSnapshot({
      id: "a2",
      assetId: "fund",
      asOfDate: "2026-10-02",
      value: "10.02",
    });
    expect((await repositories.assetsAt("2026-10-02"))[0]?.currentValue).toBe("10.02");
    expect((await repositories.assetsAt("2026-09-30"))[0]?.currentValue).toBe("10.01");
    expect((await repositories.assetsAt("2026-10-02"))[0]?.includeInSafetyResources).toBe(true);
    expect(await db.select("SELECT * FROM asset_value_snapshots")).toHaveLength(2);
  });

  it("reports an active asset without a current value fact instead of dropping it", async () => {
    await initialize();
    await repositories.createAsset(
      { id: "fund", name: "Fund", kind: "LIQUID_INVESTMENT", includeInSafetyResources: true },
      "profile-test",
      "2026-10-01T00:00:00Z",
    );
    await expect(repositories.assetsAt("2026-10-02")).rejects.toMatchObject({
      code: "MISSING_ASSET_SNAPSHOT",
    });
  });

  it("selects debt balance and due only for the requested month", async () => {
    await initialize();
    await repositories.createDebt(
      { id: "loan", name: "Loan", fixedMonthlyPayment: "400" },
      "profile-test",
    );
    await repositories.saveDebtPeriodFact({
      id: "d0",
      debtId: "loan",
      periodMonth: "2026-09",
      asOfDate: "2026-09-04",
      currentBalance: "9500",
      currentMonthDue: "375",
    });
    await repositories.saveDebtPeriodFact({
      id: "d1",
      debtId: "loan",
      periodMonth: "2026-10",
      asOfDate: "2026-10-02",
      currentBalance: "9000",
      currentMonthDue: "350",
    });
    await repositories.saveDebtPeriodFact({
      id: "d2",
      debtId: "loan",
      periodMonth: "2026-11",
      asOfDate: "2026-11-02",
      currentBalance: "8600",
      currentMonthDue: "300",
    });
    expect(await repositories.debtsAt("2026-10", "2026-10-02")).toMatchObject([
      { currentMonthDue: "350", fixedMonthlyPayment: "400" },
    ]);
    expect(await repositories.debtsAt("2026-09", "2026-09-04")).toMatchObject([
      { currentMonthDue: "375", currentBalance: "9500" },
    ]);
    expect(await repositories.debtsAt("2026-11", "2026-11-02")).toMatchObject([
      { currentMonthDue: "300" },
    ]);
    await expect(repositories.debtsAt("2026-12", "2026-12-02")).rejects.toMatchObject({
      code: "MISSING_DEBT_SNAPSHOT",
    });
  });

  it("persists the fixed monthly payment independently of current-month due", async () => {
    await initialize();
    await repositories.createDebt(
      { id: "loan", name: "Loan", fixedMonthlyPayment: "400.25" },
      "profile-test",
    );
    await repositories.saveDebtPeriodFact({
      id: "d1",
      debtId: "loan",
      periodMonth: "2026-10",
      asOfDate: "2026-10-02",
      currentBalance: "10000",
      currentMonthDue: null,
    });
    expect((await repositories.debtsAt("2026-10", "2026-10-02"))[0]?.fixedMonthlyPayment).toBe(
      "400.25",
    );
    expect(
      (await repositories.debtsAt("2026-10", "2026-10-02"))[0]?.currentMonthDue,
    ).toBeUndefined();
  });

  it("preserves explicit NULL debt metadata revisions and honors the requested as-of date", async () => {
    await initialize();
    await repositories.createDebt(
      { id: "loan", name: "Loan", fixedMonthlyPayment: "400" },
      "profile-test",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.saveDebtPeriodFact({
      id: "sep-fact",
      debtId: "loan",
      periodMonth: "2026-09",
      asOfDate: "2026-09-01",
      currentBalance: "2000",
      currentMonthDue: "500",
    });

    expect(
      (await repositories.priorDebtsForMaintenance("2026-10", "2026-09-10"))[0]
        ?.fixedMonthlyPayment,
    ).toBe("400");
    await repositories.appendDebtRevision(
      "profile-test",
      {
        id: "loan",
        name: "Loan",
        currentBalance: "2000",
        currentMonthDue: "500",
        fixedMonthlyPayment: null,
      },
      "2026-09",
      "2026-09-20",
      "2026-09-20T00:00:00.000Z",
      () => "unused",
    );

    expect(
      (await repositories.priorDebtsForMaintenance("2026-10", "2026-09-10"))[0]
        ?.fixedMonthlyPayment,
    ).toBe("400");
    expect((await repositories.debtsAt("2026-09", "2026-09-10"))[0]?.fixedMonthlyPayment).toBe(
      "400",
    );
    expect(
      (await repositories.debtsAt("2026-09", "2026-09-25"))[0]?.fixedMonthlyPayment,
    ).toBeNull();
    expect(
      (await repositories.priorDebtsForMaintenance("2026-10", "2026-09-25"))[0]
        ?.fixedMonthlyPayment,
    ).toBeNull();
    expect(
      (await repositories.priorDebtsForMaintenance("2026-10", "2026-10-01"))[0]
        ?.fixedMonthlyPayment,
    ).toBeNull();
    expect(
      await db.select(
        "SELECT fixed_monthly_payment,current_balance,current_month_due FROM debt_revisions WHERE debt_id='loan'",
      ),
    ).toEqual([
      {
        fixed_monthly_payment: null,
        current_balance: "2000",
        current_month_due: "500",
      },
    ]);
  });
});

describe("database safety and persistence", () => {
  it("enforces foreign keys", async () => {
    await expect(
      repositories.createCashAccount(
        { id: "orphan", name: "Orphan", includeInSafetyResources: true },
        "missing-profile",
      ),
    ).rejects.toThrow();
  });

  it("rolls back related writes as one transaction", async () => {
    await initialize();
    await expect(
      db.transaction(async (transactionDb) => {
        const transactionRepositories = new Repositories(transactionDb);
        await transactionRepositories.createCashAccount(
          { id: "cash", name: "Cash", includeInSafetyResources: true },
          "profile-test",
        );
        await transactionRepositories.saveCashSnapshot({
          id: "snapshot",
          accountId: "missing-account",
          asOfDate: "2026-10-02",
          balance: "100",
        });
      }),
    ).rejects.toThrow();
    expect(await db.select("SELECT * FROM cash_accounts")).toHaveLength(0);
  });

  it("round-trips decimal money exactly as text", async () => {
    await initialize();
    await repositories.createCashAccount(
      { id: "cash", name: "Cash", includeInSafetyResources: true },
      "profile-test",
    );
    await repositories.saveCashSnapshot({
      id: "precise",
      accountId: "cash",
      asOfDate: "2026-10-02",
      balance: "999999999999.99",
    });
    expect((await repositories.cashAccountsAt("2026-10-02"))[0]?.balance).toBe("999999999999.99");
  });

  it("preserves facts after closing and reopening the database", async () => {
    await repositories.createProfile({ id: "persisted", displayName: "Persisted" });
    db.close();
    db = new NodeSqliteDatabase(
      new (await import("node:sqlite")).DatabaseSync(join(directory, "test.sqlite3")),
    );
    repositories = new Repositories(db);
    await migrateDatabase(db);
    expect(await repositories.getProfile()).toEqual({ id: "persisted", displayName: "Persisted" });
  });
});

describe("application service and Model Core integration", () => {
  it("assembles input from normalized facts and selected settings", async () => {
    await initialize();
    await repositories.saveEssentialExpense(
      { id: "food", category: "BASIC_FOOD", name: "Food", monthlyAmount: "2000" },
      "profile-test",
      "2026-10-01T01:00:00Z",
    );
    await repositories.saveIncome(
      { id: "salary", kind: "PLANNING", status: "EXPECTED", amount: "10000", date: "2026-10-01" },
      "profile-test",
    );
    await repositories.saveIncome(
      { id: "pay", kind: "ACTUAL", status: "PENDING", amount: "10000", date: "2026-10-02" },
      "profile-test",
      "2026-10",
    );
    await repositories.createCashAccount(
      { id: "cash", name: "Everyday", includeInSafetyResources: true },
      "profile-test",
    );
    await repositories.saveCashSnapshot({
      id: "c1",
      accountId: "cash",
      asOfDate: "2026-10-02",
      balance: "5000",
    });
    const built = await buildMonthlyModelInput(db, "2026-10", "2026-10-02");
    expect(built.status).toBe("READY");
    if (built.status === "READY") {
      expect(built.input.facts.planningIncome).toBe("10000");
      expect(built.input.facts.essentialExpenses).toBe("2000");
      expect(built.input.facts.actualIncomeRecords[0]?.status).toBe("PENDING");
      expect(built.input.facts.cashAccounts[0]?.balance).toBe("5000");
    }
  });

  it("executes the SQLite → Repository → Service → Model Core chain", async () => {
    await initialize();
    await repositories.saveEssentialExpense(
      { id: "home", category: "HOUSING", name: "Home", monthlyAmount: "2000" },
      "profile-test",
      "2026-10-01T01:00:00Z",
    );
    await repositories.saveIncome(
      { id: "plan", kind: "PLANNING", status: "EXPECTED", amount: "10000", date: "2026-10-01" },
      "profile-test",
    );
    const outcome = await calculateMonthlyModelFromDatabase(db, "2026-10", "2026-10-02");
    expect(outcome.status).toBe("READY");
    if (outcome.status === "READY") {
      expect(outcome.result.spending.baseSurplus.toString()).toBe("8000");
      expect(outcome.result.snapshot.currentMonth).toBe("2026-10");
    }
  });

  it("integrates the Owner fixture without creating production seeds", async () => {
    const input = ownerProfileFixture;
    await repositories.createProfile(input.profile);
    await repositories.saveSettings(input.profile.id, input.settings);
    await repositories.saveEssentialExpense(
      {
        id: "owner-essential-test",
        category: "OTHER_ESSENTIAL",
        name: "Fixture essential",
        monthlyAmount: String(input.facts.essentialExpenses),
      },
      input.profile.id,
      `${input.facts.asOfDate}T00:00:00Z`,
    );
    for (const account of input.facts.cashAccounts) {
      await repositories.createCashAccount(
        {
          id: account.id,
          name: account.id,
          includeInSafetyResources: account.includeInSafetyResources,
        },
        input.profile.id,
      );
      await repositories.saveCashSnapshot({
        id: `${account.id}-current`,
        accountId: account.id,
        asOfDate: input.facts.asOfDate,
        balance: String(account.balance),
      });
    }
    for (const asset of input.facts.assets) {
      await repositories.createAsset(
        {
          id: asset.id,
          name: asset.id,
          kind: asset.kind,
          includeInSafetyResources: asset.includeInSafetyResources,
        },
        input.profile.id,
      );
      await repositories.saveAssetSnapshot({
        id: `${asset.id}-current`,
        assetId: asset.id,
        asOfDate: input.facts.asOfDate,
        value: String(asset.currentValue),
      });
    }
    for (const debt of input.facts.debts) {
      await repositories.createDebt(
        {
          id: debt.id,
          name: debt.name,
          fixedMonthlyPayment:
            debt.fixedMonthlyPayment == null ? null : String(debt.fixedMonthlyPayment),
        },
        input.profile.id,
      );
      await repositories.saveDebtPeriodFact({
        id: `${debt.id}-current`,
        debtId: debt.id,
        periodMonth: input.facts.currentMonth,
        asOfDate: input.facts.asOfDate,
        currentBalance: String(debt.currentBalance),
        currentMonthDue: debt.currentMonthDue == null ? null : String(debt.currentMonthDue),
      });
    }
    for (const record of input.facts.expenses)
      await repositories.saveExpense(record, input.profile.id);
    await repositories.saveIncome(
      {
        id: "owner-planning",
        kind: "PLANNING",
        status: "EXPECTED",
        amount: String(input.facts.planningIncome),
        date: `${input.facts.currentMonth}-01`,
      },
      input.profile.id,
    );
    const outcome = await calculateMonthlyModelFromDatabase(
      db,
      input.facts.currentMonth,
      input.facts.asOfDate,
    );
    expect(outcome.status).toBe("READY");
    if (outcome.status === "READY") {
      expect(outcome.result.debt.totalDebtBalance.toString()).toBe(
        calculateMonthlyModel(input).debt.totalDebtBalance.toString(),
      );
      expect(outcome.result.snapshot.eligibleCash.toString()).toBe(
        calculateMonthlyModel(input).snapshot.eligibleCash.toString(),
      );
    }
    expect(await db.select("SELECT id FROM profiles")).toHaveLength(1);
  });

  it("converts model validation failures into an explicit application error", async () => {
    await initialize({
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "-1",
    });
    await expect(
      calculateMonthlyModelFromDatabase(db, "2026-10", "2026-10-02"),
    ).rejects.toMatchObject({ code: "MODEL_VALIDATION_FAILED" });
    try {
      await calculateMonthlyModelFromDatabase(db, "2026-10", "2026-10-02");
    } catch (error) {
      expect(error).toBeInstanceOf(ApplicationModelError);
      expect((error as ApplicationModelError).cause).toBeInstanceOf(ModelValidationError);
    }
  });
});

describe("listRecentExpenses month filtering", () => {
  it("returns recent expenses across all months when no month filter is provided", async () => {
    await initialize();
    await repositories.saveExpense(
      {
        id: "sep-1",
        amount: "10",
        dateTime: "2026-09-15T10:00:00Z",
        businessDate: "2026-09-15",
        kind: "VARIABLE",
        category: "FOOD",
      },
      "profile-test",
    );
    await repositories.saveExpense(
      {
        id: "oct-1",
        amount: "20",
        dateTime: "2026-10-01T10:00:00Z",
        businessDate: "2026-10-01",
        kind: "VARIABLE",
        category: "FOOD",
      },
      "profile-test",
    );
    const result = await repositories.listRecentExpenses(5);
    expect(result).toHaveLength(2);
    // Most recent first
    expect(result[0]?.id).toBe("oct-1");
    expect(result[1]?.id).toBe("sep-1");
  });

  it("only returns expenses within the specified month", async () => {
    await initialize();
    await repositories.saveExpense(
      {
        id: "sep-1",
        amount: "10",
        dateTime: "2026-09-28T10:00:00Z",
        businessDate: "2026-09-28",
        kind: "VARIABLE",
        category: "FOOD",
      },
      "profile-test",
    );
    await repositories.saveExpense(
      {
        id: "oct-1",
        amount: "20",
        dateTime: "2026-10-01T10:00:00Z",
        businessDate: "2026-10-01",
        kind: "VARIABLE",
        category: "TRANSPORT",
      },
      "profile-test",
    );
    await repositories.saveExpense(
      {
        id: "oct-2",
        amount: "30",
        dateTime: "2026-10-14T10:00:00Z",
        businessDate: "2026-10-14",
        kind: "VARIABLE",
        category: "FOOD",
      },
      "profile-test",
    );
    await repositories.saveExpense(
      {
        id: "nov-1",
        amount: "40",
        dateTime: "2026-11-01T10:00:00Z",
        businessDate: "2026-11-01",
        kind: "VARIABLE",
        category: "FOOD",
      },
      "profile-test",
    );

    const octResult = await repositories.listRecentExpenses(3, "2026-10");
    expect(octResult).toHaveLength(2);
    expect(octResult.map((r) => r.id)).toEqual(["oct-2", "oct-1"]);
    expect(octResult.some((r) => r.id === "sep-1")).toBe(false);
    expect(octResult.some((r) => r.id === "nov-1")).toBe(false);
  });

  it("returns empty array when no expenses exist in the specified month", async () => {
    await initialize();
    await repositories.saveExpense(
      {
        id: "sep-1",
        amount: "10",
        dateTime: "2026-09-15T10:00:00Z",
        businessDate: "2026-09-15",
        kind: "VARIABLE",
        category: "FOOD",
      },
      "profile-test",
    );
    const result = await repositories.listRecentExpenses(3, "2026-10");
    expect(result).toHaveLength(0);
  });

  it("respects the limit parameter within the filtered month", async () => {
    await initialize();
    for (let i = 1; i <= 5; i++) {
      await repositories.saveExpense(
        {
          id: `oct-${i}`,
          amount: String(i * 10),
          dateTime: `2026-10-0${i}T10:00:00Z`,
          businessDate: `2026-10-0${i}`,
          kind: "VARIABLE",
          category: "FOOD",
        },
        "profile-test",
      );
    }
    const result = await repositories.listRecentExpenses(2, "2026-10");
    expect(result).toHaveLength(2);
    // Most recent first
    expect(result[0]?.id).toBe("oct-5");
    expect(result[1]?.id).toBe("oct-4");
  });

  it("handles December-to-January year boundary correctly", async () => {
    await initialize();
    await repositories.saveExpense(
      {
        id: "dec-1",
        amount: "10",
        dateTime: "2026-12-31T10:00:00Z",
        businessDate: "2026-12-31",
        kind: "VARIABLE",
        category: "FOOD",
      },
      "profile-test",
    );
    await repositories.saveExpense(
      {
        id: "jan-1",
        amount: "20",
        dateTime: "2027-01-01T10:00:00Z",
        businessDate: "2027-01-01",
        kind: "VARIABLE",
        category: "FOOD",
      },
      "profile-test",
    );
    // Querying December must NOT leak January records (the P0 cross-year bug)
    const decResult = await repositories.listRecentExpenses(3, "2026-12");
    expect(decResult.map((item) => item.id)).toEqual(["dec-1"]);
    expect(decResult.some((item) => item.id === "jan-1")).toBe(false);

    const janResult = await repositories.listRecentExpenses(3, "2027-01");
    expect(janResult.map((item) => item.id)).toEqual(["jan-1"]);
    expect(janResult.some((item) => item.id === "dec-1")).toBe(false);
  });
});
