import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { updateFinancialDataAndRecalculate } from "../src/application/financial-maintenance-service.js";
import { getApplicationInitializationState } from "../src/application/initialization-service.js";
import {
  completeOnboarding,
  getHomeApplicationState,
  recordExpenseAndRecalculate,
} from "../src/application/product-service.js";
import { V4FoundationService } from "../src/application/v4-foundation-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const paths: string[] = [];
afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { recursive: true, force: true });
});

describe("product persistence restart", () => {
  it("keeps a fresh migrated database empty until onboarding is completed", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pf-phase1-clean-start-"));
    paths.push(directory);
    const db = new NodeSqliteDatabase(new DatabaseSync(join(directory, "fresh.sqlite")));
    await migrateDatabase(db);

    expect(await getApplicationInitializationState(db)).toMatchObject({
      status: "INITIALIZATION_REQUIRED",
    });
    for (const table of [
      "profiles",
      "financial_settings",
      "planning_income_revisions",
      "essential_expense_items",
      "income_records",
      "expense_records",
      "cash_accounts",
      "cash_balance_snapshots",
      "assets",
      "asset_value_snapshots",
      "debts",
      "debt_period_facts",
    ]) {
      expect(await db.select(`SELECT * FROM ${table}`), table).toEqual([]);
    }
    expect(await db.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
    ]);
    db.close();
  });

  it("reopens an initialized local database with the expense and calculated Home intact", async () => {
    const directory = mkdtempSync(join(tmpdir(), "pf-phase3-restart-"));
    paths.push(directory);
    const file = join(directory, "restart.sqlite");
    const first = new NodeSqliteDatabase(new DatabaseSync(file));
    const date = "2026-10-03";
    await migrateDatabase(first);
    await completeOnboarding(
      first,
      {
        stableMonthlyIncome: "7000",
        essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1800" }],
        cashAccounts: [{ name: "Everyday", balance: "4200", includeInSafetyResources: true }],
        assets: [],
        debts: [],
        safetyCoverageTargetMonths: 3,
        minimumCashCoverageMonths: 1,
        desiredMonthlyDiscretionarySpending: "600",
        safetyRecoveryHorizonMonths: 12,
      },
      date,
    );
    const cashId = String(
      (await first.select<{ id: string }>("SELECT id FROM cash_accounts"))[0]?.id,
    );
    await updateFinancialDataAndRecalculate(
      first,
      {
        cashAccounts: [{ id: cashId, balance: "4500" }],
        settings: { safetyCoverageTargetMonths: 4 },
      },
      date,
    );
    await recordExpenseAndRecalculate(
      first,
      { amount: "46.5", dateTime: `${date}T12:30:00.000Z`, businessDate: date, category: "FOOD" },
      date,
    );
    first.close();

    const reopened = new NodeSqliteDatabase(new DatabaseSync(file));
    await migrateDatabase(reopened);
    const home = await getHomeApplicationState(reopened, date);
    expect(home).toMatchObject({
      status: "READY",
      currentCash: "4500",
      currentMonthSpending: "46.5",
      safetyCoverageTargetMonths: 4,
      profileDisplayName: null,
      trendState: "BASELINE_BUILDING",
    });
    expect(await reopened.select("SELECT amount FROM expense_records")).toEqual([
      { amount: "46.5" },
    ]);
    expect(
      (await new V4FoundationService(reopened).read("2026-10", date)).settingsHistory,
    ).toMatchObject([{ asOfDate: date, safetyCoverageTargetMonths: 4 }]);
    reopened.close();
  });
});
