// @vitest-environment happy-dom
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  type FinancialMaintenanceState,
  getFinancialMaintenanceState,
  updateFinancialDataAndRecalculate,
} from "../src/application/financial-maintenance-service.js";
import { buildMonthlyModelInput } from "../src/application/monthly-model-service.js";
import { completeOnboarding } from "../src/application/product-service.js";
import { money } from "../src/model/money.js";
import { calculateMonthlyModel } from "../src/model/monthly-model.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { FinancialMaintenanceDialog } from "../src/ui/FinancialMaintenanceDialog.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const openDatabases: NodeSqliteDatabase[] = [];
const tempDirs: string[] = [];

function memoryDatabase(): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase();
  openDatabases.push(db);
  return db;
}

function fileDatabase(path: string): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase(new DatabaseSync(path));
  openDatabases.push(db);
  return db;
}

function closeDatabase(db: NodeSqliteDatabase): void {
  const index = openDatabases.indexOf(db);
  if (index >= 0) openDatabases.splice(index, 1);
  db.close();
}

function tempPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "m2-s1-b2-"));
  tempDirs.push(directory);
  return join(directory, "ledger.sqlite3");
}

afterEach(() => {
  cleanup();
  for (const db of openDatabases.splice(0)) db.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

async function onboard(
  db: NodeSqliteDatabase,
  asOfDate = "2026-09-01",
  includeDebt = true,
): Promise<void> {
  await migrateDatabase(db);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
      assets: [{ name: "Fund", currentValue: "1000", includeInSafetyResources: true }],
      debts: includeDebt
        ? [
            {
              name: "Loan",
              currentBalance: "2000",
              currentMonthDue: "500",
              fixedMonthlyPayment: "400",
            },
          ]
        : [],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "2000",
    },
    asOfDate,
  );
}

function only<T>(items: T[]): T {
  const item = items[0];
  if (!item || items.length !== 1) throw new Error("Expected exactly one fixture row.");
  return item;
}

async function readyInput(db: NodeSqliteDatabase, month: string, asOfDate: string) {
  const built = await buildMonthlyModelInput(db, month, asOfDate);
  if (built.status !== "READY") throw new Error("Monthly model input is not ready.");
  return built.input;
}

const historyOf = (state: FinancialMaintenanceState, category: string) =>
  (state.history ?? []).filter((entry) => entry.category === category);

describe("S1 B2 maintenance behavior", () => {
  it("maintains all six groups, reads them back, and keeps them after reopening", async () => {
    const path = tempPath();
    let db = fileDatabase(path);
    await onboard(db);
    const before = await getFinancialMaintenanceState(db, "2026-09-05");
    const essential = only(before.essentialExpenses);
    const cash = only(before.cashAccounts);
    const asset = only(before.assets);
    const debt = only(before.debts);

    const saved = await updateFinancialDataAndRecalculate(
      db,
      {
        stableMonthlyIncome: "11000",
        essentialExpenses: [{ id: essential.id, monthlyAmount: "1200" }],
        cashAccounts: [{ id: cash.id, balance: "5100" }],
        assets: [{ id: asset.id, currentValue: "1100" }],
        debts: [{ id: debt.id, currentBalance: "1900" }],
        settings: { desiredMonthlyDiscretionarySpending: "2100" },
      },
      "2026-09-05",
    );
    expect(saved.state.stableMonthlyIncome).toBe("11000");
    expect(only(saved.state.essentialExpenses).monthlyAmount).toBe("1200");
    expect(only(saved.state.cashAccounts).balance).toBe("5100");
    expect(only(saved.state.assets).currentValue).toBe("1100");
    expect(only(saved.state.debts)).toMatchObject({
      currentBalance: "1900",
      currentMonthDue: "500",
      fixedMonthlyPayment: "400",
    });
    expect(saved.state.settings.desiredMonthlyDiscretionarySpending).toBe("2100");
    expect((saved.state.history ?? []).map((entry) => entry.category).sort()).toEqual([
      "ASSET",
      "CASH",
      "DEBT",
      "ESSENTIAL",
      "INCOME",
      "SETTINGS",
    ]);

    closeDatabase(db);
    db = fileDatabase(path);
    const reopened = await getFinancialMaintenanceState(db, "2026-09-05");
    expect(reopened.stableMonthlyIncome).toBe("11000");
    expect(only(reopened.essentialExpenses).monthlyAmount).toBe("1200");
    expect(only(reopened.cashAccounts).balance).toBe("5100");
    expect(only(reopened.assets).currentValue).toBe("1100");
    expect(only(reopened.debts).currentBalance).toBe("1900");
    expect(reopened.settings.desiredMonthlyDiscretionarySpending).toBe("2100");
    expect(reopened.history).toHaveLength(6);
  });

  it("applies a fixed-expense change from the current month and leaves the prior month snapshot alone", async () => {
    const db = memoryDatabase();
    await onboard(db, "2026-09-01", false);
    const septemberBefore = calculateMonthlyModel(await readyInput(db, "2026-09", "2026-09-30"));
    const octoberBefore = calculateMonthlyModel(await readyInput(db, "2026-10", "2026-10-03"));
    const essential = only(
      (await getFinancialMaintenanceState(db, "2026-10-03")).essentialExpenses,
    );

    await updateFinancialDataAndRecalculate(
      db,
      { essentialExpenses: [{ id: essential.id, monthlyAmount: "1200" }] },
      "2026-10-03",
    );

    const octoberInput = await readyInput(db, "2026-10", "2026-10-03");
    expect(octoberInput.facts.essentialExpenses).toBe("1200");
    const octoberAfter = calculateMonthlyModel(octoberInput);
    expect(octoberAfter.snapshot.monthlyCoreObligations.toString()).toBe(
      money(octoberBefore.snapshot.monthlyCoreObligations).minus("1000").plus("1200").toString(),
    );

    const septemberAfter = calculateMonthlyModel(await readyInput(db, "2026-09", "2026-09-30"));
    expect(septemberAfter.snapshot.recommendedMonthlySpending.toString()).toBe(
      septemberBefore.snapshot.recommendedMonthlySpending.toString(),
    );
    expect(septemberAfter.snapshot.monthlyCoreObligations.toString()).toBe(
      septemberBefore.snapshot.monthlyCoreObligations.toString(),
    );
  });

  it("builds a revision trail with baseline first values and only changed fields", async () => {
    const db = memoryDatabase();
    await onboard(db);
    const cash = only((await getFinancialMaintenanceState(db, "2026-09-03")).cashAccounts);

    await updateFinancialDataAndRecalculate(
      db,
      { cashAccounts: [{ id: cash.id, balance: "5100" }] },
      "2026-09-03",
    );
    await updateFinancialDataAndRecalculate(
      db,
      { cashAccounts: [{ id: cash.id, balance: "5200" }] },
      "2026-09-04",
    );
    await updateFinancialDataAndRecalculate(
      db,
      { cashAccounts: [{ id: cash.id, balance: "5200", name: "Checking" }] },
      "2026-09-05",
    );

    const cashHistory = historyOf(await getFinancialMaintenanceState(db, "2026-09-05"), "CASH");
    expect(cashHistory).toHaveLength(3);
    expect(cashHistory.map((entry) => entry.createdAt)).toEqual([
      "2026-09-05T00:00:00.000Z",
      "2026-09-04T00:00:00.000Z",
      "2026-09-03T00:00:00.000Z",
    ]);
    expect(cashHistory[2]).toMatchObject({
      objectName: "Checking",
      isFirst: true,
      asOfDate: "2026-09-03",
      changes: [{ field: "balance", before: "5000", after: "5100" }],
    });
    expect(cashHistory[1]).toMatchObject({
      isFirst: false,
      changes: [{ field: "balance", before: "5100", after: "5200" }],
    });
    expect(cashHistory[0]?.changes).toEqual([]);
  });

  it("records baseline values for the first income, essential, asset, debt and settings revisions", async () => {
    const db = memoryDatabase();
    await onboard(db);
    const state = await getFinancialMaintenanceState(db, "2026-09-05");
    const essential = only(state.essentialExpenses);
    const asset = only(state.assets);
    const debt = only(state.debts);

    await updateFinancialDataAndRecalculate(
      db,
      {
        stableMonthlyIncome: "11000",
        essentialExpenses: [{ id: essential.id, monthlyAmount: "1200" }],
        assets: [{ id: asset.id, currentValue: "1100" }],
        debts: [{ id: debt.id, currentBalance: "1900" }],
        settings: { desiredMonthlyDiscretionarySpending: "2100" },
      },
      "2026-09-05",
    );
    const after = await getFinancialMaintenanceState(db, "2026-09-05");
    expect(historyOf(after, "INCOME")[0]?.changes).toEqual([
      { field: "stableMonthlyIncome", before: "10000", after: "11000" },
    ]);
    expect(historyOf(after, "ESSENTIAL")[0]?.changes).toEqual([
      { field: "monthlyAmount", before: "1000", after: "1200" },
    ]);
    expect(historyOf(after, "ASSET")[0]?.changes).toEqual([
      { field: "currentValue", before: "1000", after: "1100" },
    ]);
    expect(historyOf(after, "DEBT")[0]?.changes).toEqual([
      { field: "currentBalance", before: "2000", after: "1900" },
    ]);
    expect(historyOf(after, "SETTINGS")[0]?.changes).toEqual([
      { field: "desiredMonthlyDiscretionarySpending", before: "2000", after: "2100" },
    ]);
    expect((after.history ?? []).every((entry) => entry.isFirst)).toBe(true);
  });

  it("keeps the three debt fields mapped to their own meanings", async () => {
    const db = memoryDatabase();
    await onboard(db);
    const debt = only((await getFinancialMaintenanceState(db, "2026-09-05")).debts);

    const saved = await updateFinancialDataAndRecalculate(
      db,
      {
        debts: [
          {
            id: debt.id,
            currentBalance: "1900",
            currentMonthDue: "450",
            fixedMonthlyPayment: "420",
          },
        ],
      },
      "2026-09-05",
    );

    expect(only(saved.state.debts)).toMatchObject({
      currentBalance: "1900",
      currentMonthDue: "450",
      fixedMonthlyPayment: "420",
    });
    expect(saved.home.totalDebt).toBe("1900");
    expect(historyOf(saved.state, "DEBT")[0]?.changes).toEqual([
      { field: "currentBalance", before: "2000", after: "1900" },
      { field: "currentMonthDue", before: "500", after: "450" },
      { field: "fixedMonthlyPayment", before: "400", after: "420" },
    ]);
  });

  it("shows the read-only change history grouped by maintenance category", () => {
    const initial: FinancialMaintenanceState = {
      stableMonthlyIncome: "11000",
      stableIncomeRevisions: [],
      actualIncomeRecords: [],
      essentialExpenses: [
        { id: "essential-1", category: "HOUSING", name: "住房", monthlyAmount: "1200" },
      ],
      cashAccounts: [
        { id: "cash-1", name: "Checking", balance: "5200", includeInSafetyResources: true },
      ],
      assets: [],
      debts: [],
      settings: {
        safetyCoverageTargetMonths: 1,
        minimumCashCoverageMonths: 1,
        desiredMonthlyDiscretionarySpending: "2100",
      },
      requiresSafetyRecoveryHorizon: false,
      asOfDate: "2026-10-05",
      history: [
        {
          category: "CASH",
          objectId: "cash-1",
          objectName: "Checking",
          revisionId: 3,
          createdAt: "2026-10-05T00:00:00.000Z",
          asOfDate: "2026-10-05",
          isFirst: false,
          changes: [],
        },
        {
          category: "CASH",
          objectId: "cash-1",
          objectName: "Checking",
          revisionId: 2,
          createdAt: "2026-10-04T00:00:00.000Z",
          asOfDate: "2026-10-04",
          isFirst: false,
          changes: [{ field: "balance", before: "5100", after: "5200" }],
        },
        {
          category: "CASH",
          objectId: "cash-1",
          objectName: "Checking",
          revisionId: 1,
          createdAt: "2026-10-03T00:00:00.000Z",
          asOfDate: "2026-10-03",
          isFirst: true,
          changes: [{ field: "balance", before: "5000", after: "5100" }],
        },
        {
          category: "INCOME",
          objectId: "profile-1",
          objectName: "稳定月收入",
          revisionId: 4,
          createdAt: "2026-10-03T00:00:00.000Z",
          asOfDate: "2026-10-03",
          isFirst: true,
          changes: [{ field: "stableMonthlyIncome", before: "10000", after: "11000" }],
        },
        {
          category: "DEBT",
          objectId: "debt-1",
          objectName: "Loan",
          revisionId: 5,
          createdAt: "2026-10-03T00:00:00.000Z",
          asOfDate: "2026-10-03",
          isFirst: true,
          changes: [{ field: "currentBalance", before: null, after: "1900" }],
        },
      ],
    };

    render(
      <FinancialMaintenanceDialog
        initial={initial}
        loading={false}
        error=""
        onClose={() => undefined}
        onLoad={async () => undefined}
        onSave={async () => undefined}
        getRequirement={async () => ({ requiresSafetyRecoveryHorizon: false })}
      />,
    );

    expect(screen.getByRole("heading", { name: "变更历史" })).toBeTruthy();
    const historySection = screen.getByRole("heading", { name: "变更历史" }).closest("section");
    if (!historySection) throw new Error("History section is missing.");
    const cashGroup = within(historySection).getByRole("heading", {
      name: "现金账户",
    }).parentElement;
    if (!cashGroup) throw new Error("Cash history group is missing.");
    const cashItems = within(cashGroup).getAllByRole("listitem");
    expect(cashItems).toHaveLength(3);
    expect(cashItems[0]?.textContent).toContain("2026-10-05 00:00");
    expect(cashItems[0]?.textContent).toContain("无字段变化");
    expect(cashItems[1]?.textContent).toContain("当前余额：5100 → 5200");
    expect(cashItems[2]?.textContent).toContain("当前余额：5000 → 5100");

    expect(screen.getByText("稳定月收入：10000 → 11000")).toBeTruthy();
    expect(screen.getByText("当前余额：无先前记录 → 1900")).toBeTruthy();
    expect(screen.queryByText(/固定月还款/)).toBeNull();
  });
});
