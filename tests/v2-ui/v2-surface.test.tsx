// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialMaintenanceState } from "../../src/application/financial-maintenance-service.js";
import type { HomeApplicationState } from "../../src/application/product-service.js";
import type { V2ExpenseService } from "../../src/application/v2-expense-service.js";
import type { V2ImportService } from "../../src/application/v2-import-service.js";
import type { Repositories } from "../../src/persistence/repositories.js";
import { V2Surface } from "../../src/ui/v2-surface.js";

const repositories = {
  listExpenseCategories: vi.fn().mockResolvedValue([]),
  listAccounts: vi.fn().mockResolvedValue([]),
  listV2Expenses: vi.fn().mockResolvedValue([]),
} as unknown as Repositories;

const importService = {} as unknown as V2ImportService;
const minimalHome: HomeApplicationState = {
  status: "READY",
  asOfDate: "2026-10-20",
  currentMonth: "2026-10",
  profileDisplayName: null,
  actualIncomeRecordCount: 0,
  currentCash: "5000",
  currentMonthSpending: "0",
  totalDebt: "2000",
  liquidAssets: "1000",
  desiredMonthlyDiscretionarySpending: "2000",
  planningIncome: "10000",
  essentialExpenses: "1500",
  mandatoryDebtService: "500",
  monthlyCoreObligations: "2000",
  baseSurplus: "8000",
  eligibleCash: "5000",
  eligibleLiquidInvestmentAssets: "1000",
  safetyResources: "6000",
  safetyTargetResources: "6000",
  safetyCoverageMonths: "3",
  safetyCoverageStatus: "NORMAL",
  safetyCoverageTargetMonths: 3,
  recommendedMonthlySpending: "2000",
  remainingSpendingCapacity: "8000",
  amountAboveRecommendation: "0",
  cashCoverageMonths: "5",
  minimumCashCoverageMonths: 1,
  safetyGap: "0",
  debts: [
    {
      id: "debt-1",
      name: "Loan",
      currentBalance: "2000",
      currentMonthDue: "500",
      fixedMonthlyPayment: "500",
      countedMonthlyPayment: "500",
      paymentSource: "CURRENT_MONTH_DUE",
    },
  ],
  spendingStatus: "NORMAL",
  cashSafetyGateStatus: "CLEAR",
  cashFloorMet: true,
  consumptionUtilization: { status: "CALCULATED", value: "0" },
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
};
const minimalMaintenance: FinancialMaintenanceState = {
  stableMonthlyIncome: "10000",
  stableIncomeRevisions: [],
  actualIncomeRecords: [],
  essentialExpenses: [],
  cashAccounts: [],
  assets: [],
  debts: [],
  settings: {
    safetyCoverageTargetMonths: 3,
    minimumCashCoverageMonths: 1,
    desiredMonthlyDiscretionarySpending: "2000",
  },
  requiresSafetyRecoveryHorizon: false,
  asOfDate: "2026-10-20",
};
const loadHomeState = vi.fn().mockResolvedValue(minimalHome);
const loadMaintenanceState = vi.fn().mockResolvedValue(minimalMaintenance);
const expenseService = {
  recordCashDebitExpense: vi.fn(),
  getMonthSummary: vi.fn().mockResolvedValue({ dailyExpenseTotal: "0.00", billStatuses: [] }),
} as unknown as V2ExpenseService;

function renderSurface() {
  return render(
    <V2Surface
      expenseService={expenseService}
      importService={importService}
      loadHomeState={loadHomeState}
      loadMaintenanceState={loadMaintenanceState}
      repositories={repositories}
      profileId="profile-v2"
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EXEC-U-02 isolated V2 navigation surface", () => {
  it("renders the four navigation tabs with today active by default", async () => {
    renderSurface();
    for (const label of ["今天", "记录", "进展", "我的"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "今天" }).className).toContain("is-active");
    expect(await screen.findByText("记下第一笔花销")).toBeTruthy();
    expect(await screen.findByText("这个月")).toBeTruthy();
    expect(screen.queryByLabelText("快速记账")).toBeNull();
    expect(screen.queryByText("导入功能即将开放")).toBeNull();
  });

  it("switches to the quick entry page when Record is selected", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "记录" }));
    expect(await screen.findByLabelText("快速记账")).toBeTruthy();
    expect(screen.getByLabelText("金额")).toBeTruthy();
    expect(screen.queryByText("这个月")).toBeNull();
  });

  it("shows the import entry on Mine", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "我的" }));
    expect(await screen.findByLabelText("选择 CSV 文件")).toBeTruthy();
    expect(screen.queryByText("导入功能即将开放")).toBeNull();
    expect(screen.queryByText("这个月")).toBeNull();
  });

  it("opens the record page from the top record button", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "记一笔" }));
    expect(await screen.findByLabelText("快速记账")).toBeTruthy();
    expect(screen.getByRole("button", { name: "记录" }).className).toContain("is-active");
    expect(screen.getByLabelText("金额")).toBeTruthy();
  });

  it("routes the today task CTA to the record page and focuses amount", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(await screen.findByRole("button", { name: "去记录" }));
    expect(await screen.findByLabelText("快速记账")).toBeTruthy();
    expect(screen.getByRole("button", { name: "记录" }).className).toContain("is-active");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("金额")));
  });

  it("shows the progress path on Progress", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "进展" }));
    expect(await screen.findByText("看清消费")).toBeTruthy();
    expect(screen.getByText("本月已花 ¥0.00")).toBeTruthy();
    await screen.findByText("稳住现金");
    expect(screen.getByText(`现金 ¥${minimalHome.currentCash}`)).toBeTruthy();
    await screen.findByText("理清责任");
    expect(screen.getByText(`总债务 ¥${minimalHome.totalDebt}`)).toBeTruthy();
    await screen.findByText("建立余地");
    expect(
      screen.getByText(
        `安全垫 ¥${minimalHome.safetyResources} / 目标 ¥${minimalHome.safetyTargetResources}`,
      ),
    ).toBeTruthy();
    expect(screen.queryByText("即将开放")).toBeNull();
  });
});
