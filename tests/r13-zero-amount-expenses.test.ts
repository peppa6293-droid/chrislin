import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildMonthlyModelInput } from "../src/application/monthly-model-service.js";
import { calculateMonthlyModel } from "../src/model/monthly-model.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { variableExpense } from "./fixtures/model-input.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

let directory: string;
let db: NodeSqliteDatabase;
let repositories: Repositories;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "finance-zero-amount-"));
  db = new NodeSqliteDatabase(
    new (await import("node:sqlite")).DatabaseSync(join(directory, "test.sqlite3")),
  );
  repositories = new Repositories(db);
  await migrateDatabase(db, "2026-10-02T00:00:00.000Z");
  await repositories.createProfile({ id: "profile-test" }, "2026-10-02T00:00:00Z");
  await repositories.saveSettings("profile-test", {
    safetyCoverageTargetMonths: 3,
    minimumCashCoverageMonths: 1,
    safetyRecoveryHorizonMonths: 12,
    desiredMonthlyDiscretionarySpending: "1000.00",
  });
  await repositories.saveIncome(
    { id: "salary", kind: "PLANNING", status: "EXPECTED", amount: "10000", date: "2026-10-01" },
    "profile-test",
  );
  await repositories.createCashAccount(
    { id: "cash", name: "Everyday", includeInSafetyResources: true },
    "profile-test",
  );
  await repositories.saveCashSnapshot({
    id: "cash-snapshot",
    accountId: "cash",
    asOfDate: "2026-10-02",
    balance: "5000",
  });
});

afterEach(() => {
  db?.close();
  rmSync(directory, { recursive: true, force: true });
});

async function saveExpense(id: string, amount: string): Promise<void> {
  await repositories.saveExpense(
    { ...variableExpense(amount, "2026-10-02"), id },
    "profile-test",
    "2026-10-02T00:00:00Z",
  );
}

describe("zero-amount expenses at the application boundary", () => {
  it("keeps zero-amount rows in the ledger but out of the monthly model input", async () => {
    await saveExpense("zero-expense", "0.00");
    await saveExpense("positive-expense", "12.34");

    const built = await buildMonthlyModelInput(db, "2026-10", "2026-10-02");
    expect(built.status).toBe("READY");
    if (built.status !== "READY") return;

    expect(built.input.facts.expenses.map((expense) => expense.id)).toEqual(["positive-expense"]);
    expect(built.input.facts.expenses.map((expense) => expense.amount)).toEqual(["12.34"]);

    const result = calculateMonthlyModel(built.input);
    expect(result.snapshot.actualVariableSpending.toString()).toBe("12.34");

    const ledgerRows = await repositories.listExpenses("2026-10-02", "2026-10-02");
    expect(ledgerRows.map((row) => row.amount).sort()).toEqual(["0.00", "12.34"]);
  });

  it("opens the model when every expense in the month is zero", async () => {
    await saveExpense("zero-expense-a", "0.00");
    await saveExpense("zero-expense-b", "0.00");

    const built = await buildMonthlyModelInput(db, "2026-10", "2026-10-02");
    expect(built.status).toBe("READY");
    if (built.status !== "READY") return;

    expect(built.input.facts.expenses).toEqual([]);
    const result = calculateMonthlyModel(built.input);
    expect(result.snapshot.actualVariableSpending.toString()).toBe("0");
    expect(result.spending.actualVariableSpending.toString()).toBe("0");
    expect(result.spending.recommendedMonthlySpending.toString()).toBe(
      calculateMonthlyModel({
        ...built.input,
        facts: { ...built.input.facts, expenses: [] },
      }).spending.recommendedMonthlySpending.toString(),
    );
  });
});
