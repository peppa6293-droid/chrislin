// @vitest-environment happy-dom
// U-14-A route-level acceptance: the V2 dashboard becomes reachable from the
// production "我的财务" route. The fixture flows through the real
// V2ExpenseService against an in-memory database, then the composition-root
// getV2DashboardProps boundary is injected via the module mock below — the UI
// under test never sees a database or repository handle.
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { HomeApplicationState } from "../../src/application/product-service.js";
import { V2ExpenseService } from "../../src/application/v2-expense-service.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import type { TauriProductServices } from "../../src/runtime/tauri-bootstrap.js";
import { HomeScreen } from "../../src/ui/HomeScreen.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

// HomeScreen captures getTauriProductServices() at module scope, before the
// test body can assign the fixture. The proxy defers every property access to
// render time, when globalThis holds the per-test services object.
vi.mock("../../src/runtime/tauri-bootstrap.js", () => ({
  getTauriProductServices: () =>
    new Proxy(
      {},
      {
        get(_target, property) {
          const services = (globalThis as { __U14_SERVICES__?: TauriProductServices })
            .__U14_SERVICES__;
          if (!services) throw new Error("U-14 services fixture is not initialized yet.");
          const value = Reflect.get(services as object, property);
          return typeof value === "function" ? value.bind(services) : value;
        },
      },
    ),
}));

let dashboardServices: TauriProductServices;
let db: NodeSqliteDatabase;

const home: HomeApplicationState = {
  status: "READY",
  asOfDate: "2026-09-21",
  currentMonth: "2026-09",
  profileDisplayName: "小钱",
  actualIncomeRecordCount: 0,
  currentCash: "5325.93",
  currentMonthSpending: "0",
  totalDebt: "0",
  liquidAssets: "20000",
  desiredMonthlyDiscretionarySpending: "1600",
  planningIncome: "12791.25",
  essentialExpenses: "3528",
  mandatoryDebtService: "0",
  monthlyCoreObligations: "3528",
  baseSurplus: "9263.25",
  eligibleCash: "5325.93",
  eligibleLiquidInvestmentAssets: "20000",
  safetyResources: "25325.93",
  safetyTargetResources: "25968",
  safetyCoverageMonths: "0.98",
  safetyCoverageStatus: "NORMAL",
  safetyCoverageTargetMonths: 6,
  recommendedMonthlySpending: "1000",
  remainingSpendingCapacity: "874.50",
  amountAboveRecommendation: "0",
  cashCoverageMonths: "1.15",
  minimumCashCoverageMonths: 2,
  safetyGap: "642.07",
  debts: [],
  spendingStatus: "NORMAL",
  cashSafetyGateStatus: "CLEAR",
  cashFloorMet: true,
  consumptionUtilization: { status: "CALCULATED", value: "0.12" },
  trendState: "BASELINE_BUILDING",
  trendDimensions: {
    LIQUIDITY_SAFETY: {
      direction: "NO_BASELINE",
      reason: "Prior cash or core-obligation baseline is missing.",
    },
    DEBT: { direction: "NO_BASELINE", reason: "Prior valid debt balance is missing." },
    CONSUMPTION: {
      direction: "NO_BASELINE",
      reason: "Prior same-period variable spending is missing.",
    },
    WEALTH: {
      direction: "NO_BASELINE",
      reason: "Prior liquid-investable-asset snapshot is missing.",
    },
  },
  primaryImprovement: null,
  primaryDrag: null,
  priorityAction: { action_code: "NO_ACTION", reason: "No clear issue." },
  recentExpenses: [],
};

function maintenanceState() {
  return {
    stableMonthlyIncome: "12791.25",
    stableIncomeRevisions: [],
    actualIncomeRecords: [],
    essentialExpenses: [],
    cashAccounts: [],
    assets: [],
    debts: [],
    settings: {
      safetyCoverageTargetMonths: 6,
      minimumCashCoverageMonths: 2,
      desiredMonthlyDiscretionarySpending: "1600",
    },
    requiresSafetyRecoveryHorizon: false,
    asOfDate: "2026-09-21",
  };
}

async function seedOwnerLedgerFixture() {
  const repositories = new Repositories(db);
  const service = new V2ExpenseService(repositories);
  await repositories.createProfile({ id: "profile-owner", displayName: "户主" });
  await repositories.createCashAccount(
    { id: "cash-main", name: "农业银行", includeInSafetyResources: true },
    "profile-owner",
    "2026-08-01T00:00:00.000Z",
  );
  await repositories.saveCashSnapshot(
    { id: "snap-main", accountId: "cash-main", asOfDate: "2026-09-30", balance: "5325.93" },
    "2026-09-30T00:00:00.000Z",
  );
  await service.recordIncomeEntry({
    id: "income-salary",
    profileId: "profile-owner",
    periodMonth: "2026-09",
    occurredAt: "2026-09-10",
    amount: "12791.25",
    label: "工资",
    oneTime: false,
  });
  await service.recordIncomeEntry({
    id: "income-award",
    profileId: "profile-owner",
    periodMonth: "2026-09",
    occurredAt: "2026-09-20",
    amount: "1000.00",
    label: "进步奖",
    oneTime: true,
  });
}

beforeEach(async () => {
  db = new NodeSqliteDatabase();
  await migrateDatabase(db, "2026-09-21T00:00:00.000Z");
  await seedOwnerLedgerFixture();
  const repositories = new Repositories(db);
  const service = new V2ExpenseService(repositories);
  dashboardServices = {
    bootstrap: vi.fn(),
    getOnboardingRequirement: vi.fn(),
    completeOnboarding: vi.fn(),
    getHomeApplicationState: vi.fn(),
    getExpenseRecordById: vi.fn(),
    recordExpenseAndRecalculate: vi.fn(),
    recordV2CashExpense: vi.fn(),
    getV2ImportOptions: vi.fn(),
    writeV2Import: vi.fn(),
    getV2DashboardProps: vi.fn((month: string) =>
      service.getDashboardProps("profile-owner", month),
    ),
    getFinancialMaintenanceState: vi.fn().mockResolvedValue(maintenanceState()),
    getFinancialMaintenanceRequirement: vi.fn().mockResolvedValue({
      requiresSafetyRecoveryHorizon: false,
    }),
    updateFinancialDataAndRecalculate: vi.fn().mockResolvedValue({
      state: maintenanceState(),
      home,
    }),
    saveCurrentMonthDebtFact: vi.fn(),
    savePlanningMonthDecision: vi.fn(),
    reviseActualIncome: vi.fn(),
    getV4FinancialReadState: vi.fn(),
    deactivateCashAccount: vi.fn(),
    deactivateAsset: vi.fn(),
    deactivateDebt: vi.fn(),
  } as unknown as TauriProductServices;
  (globalThis as { __U14_SERVICES__?: TauriProductServices }).__U14_SERVICES__ = dashboardServices;
});

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  db.close();
});

describe("U-14 dashboard route wiring", () => {
  it("renders the production route entry and reaches the dashboard ledger through 我的财务", async () => {
    const user = userEvent.setup();
    render(
      <HomeScreen
        home={home}
        asOfDate="2026-09-21"
        onRecordExpense={vi.fn()}
        onLoadFinancialMaintenance={async () => maintenanceState()}
        onGetFinancialMaintenanceRequirement={async () => ({
          requiresSafetyRecoveryHorizon: false,
        })}
        onUpdateFinancialData={async () => maintenanceState()}
      />,
    );

    // Route entry: navigate from the production home surface into 我的财务.
    await user.click(screen.getByRole("button", { name: "我的财务" }));
    const entry = await screen.findByText("收支账本");
    expect(entry).toBeTruthy();

    // Expanding the fixed entry renders the dashboard with real service data.
    await user.click(entry);
    await waitFor(() =>
      expect(document.querySelector('[data-testid="v2-dashboard"]')).toBeTruthy(),
    );
    const dashboard = within(document.querySelector('[data-testid="v2-dashboard"]') as HTMLElement);
    expect(dashboard.getByText("13791.25")).toBeTruthy();
    expect(dashboard.getByText("经常性收入 12791.25")).toBeTruthy();
    expect(dashboard.getByText("5325.93")).toBeTruthy();
    expect(dashboard.getByTestId("income-one-time-badge").textContent).toBe("含一次性收入");
  });

  it("defaults the ledger month to the session month derived from asOfDate", async () => {
    const user = userEvent.setup();
    render(
      <HomeScreen
        home={home}
        asOfDate="2026-09-21"
        onRecordExpense={vi.fn()}
        onLoadFinancialMaintenance={async () => maintenanceState()}
        onGetFinancialMaintenanceRequirement={async () => ({
          requiresSafetyRecoveryHorizon: false,
        })}
        onUpdateFinancialData={async () => maintenanceState()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "我的财务" }));
    await user.click(await screen.findByText("收支账本"));
    await waitFor(() =>
      expect(vi.mocked(dashboardServices.getV2DashboardProps).mock.calls[0]?.[0]).toBe("2026-09"),
    );
    await waitFor(() => expect(screen.getByTestId("v2-dashboard")).toBeTruthy());
  });

  it("keeps the one-time income badge absent when only recurring income is recorded", async () => {
    const user = userEvent.setup();
    // Swap the fixture to a recurring-only income month for the same profile.
    // The cash snapshot stays: getDashboardProps requires a valid balance at
    // month-end and this test only varies the income composition.
    const repositories = new Repositories(db);
    const service = new V2ExpenseService(repositories);
    await db.execute("DELETE FROM income_entries");
    await service.recordIncomeEntry({
      id: "income-only",
      profileId: "profile-owner",
      periodMonth: "2026-09",
      occurredAt: "2026-09-11",
      amount: "100.00",
      label: "工资",
      oneTime: false,
    });
    vi.mocked(dashboardServices.getV2DashboardProps).mockImplementation((month: string) =>
      service.getDashboardProps("profile-owner", month),
    );

    render(
      <HomeScreen
        home={home}
        asOfDate="2026-09-21"
        onRecordExpense={vi.fn()}
        onLoadFinancialMaintenance={async () => maintenanceState()}
        onGetFinancialMaintenanceRequirement={async () => ({
          requiresSafetyRecoveryHorizon: false,
        })}
        onUpdateFinancialData={async () => maintenanceState()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "我的财务" }));
    await user.click(await screen.findByText("收支账本"));
    await waitFor(() => expect(screen.getByTestId("v2-dashboard")).toBeTruthy());
    expect(screen.queryByTestId("income-one-time-badge")).toBeNull();
    expect(screen.getByText("100.00")).toBeTruthy();
  });
});
