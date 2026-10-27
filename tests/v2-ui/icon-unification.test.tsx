// @vitest-environment happy-dom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialMaintenanceState } from "../../src/application/financial-maintenance-service.js";
import type { HomeApplicationState } from "../../src/application/product-service.js";
import { FinanceIllustration, financeArt } from "../../src/ui/FinanceIllustration.js";
import { MyFinancePages } from "../../src/ui/MyFinancePages.js";
import { V2HomeSurface } from "../../src/ui/V2HomeSurface.js";

const home: HomeApplicationState = {
  status: "READY",
  asOfDate: "2026-10-21",
  currentMonth: "2026-10",
  profileDisplayName: "小钱",
  actualIncomeRecordCount: 0,
  currentCash: "5000",
  currentMonthSpending: "125.50",
  currentMonthVariableExpenseCount: 1,
  totalDebt: "800",
  liquidAssets: "1500",
  desiredMonthlyDiscretionarySpending: "1600",
  planningIncome: "13000",
  essentialExpenses: "3528",
  mandatoryDebtService: "800",
  monthlyCoreObligations: "4328",
  baseSurplus: "8672",
  eligibleCash: "5000",
  eligibleLiquidInvestmentAssets: "1500",
  safetyResources: "6500",
  safetyTargetResources: "25968",
  safetyCoverageMonths: "1.50",
  safetyCoverageStatus: "NORMAL",
  safetyCoverageTargetMonths: 6,
  recommendedMonthlySpending: "1000",
  remainingSpendingCapacity: "874.50",
  amountAboveRecommendation: "0",
  cashCoverageMonths: "1.15",
  minimumCashCoverageMonths: 2,
  safetyGap: "19468",
  debts: [],
  spendingStatus: "NORMAL",
  cashSafetyGateStatus: "CLEAR",
  cashFloorMet: true,
  consumptionUtilization: { status: "CALCULATED", value: "0.12" },
  trendState: "BASELINE_BUILDING",
  trendDimensions: {
    LIQUIDITY_SAFETY: { direction: "NO_BASELINE", reason: "missing" },
    DEBT: { direction: "NO_BASELINE", reason: "missing" },
    CONSUMPTION: { direction: "NO_BASELINE", reason: "missing" },
    WEALTH: { direction: "NO_BASELINE", reason: "missing" },
  },
  primaryImprovement: null,
  primaryDrag: null,
  priorityAction: { action_code: "NO_ACTION", reason: "No clear issue." },
  recentExpenses: [],
};

const maintenance: FinancialMaintenanceState = {
  stableMonthlyIncome: "13000",
  stableIncomeRevisions: [],
  actualIncomeRecords: [],
  essentialExpenses: [],
  cashAccounts: [],
  assets: [],
  debts: [],
  settings: {
    safetyCoverageTargetMonths: 6,
    minimumCashCoverageMonths: 2,
    safetyRecoveryHorizonMonths: 12,
    desiredMonthlyDiscretionarySpending: "1600",
  },
  requiresSafetyRecoveryHorizon: false,
  asOfDate: "2026-10-21",
};

afterEach(cleanup);

describe("U-10 icon tiles", () => {
  it("renders the finance hub with icon tiles and no sticker images", () => {
    render(
      <MyFinancePages
        route="MY_FINANCE"
        home={home}
        data={maintenance}
        loading={false}
        error=""
        asOfDate="2026-10-21"
        onRoute={() => {}}
        onBack={() => {}}
        onHome={() => {}}
        onRetry={() => {}}
        onOpenLegacyMaintenance={() => {}}
        getRequirement={async () => ({ requiresSafetyRecoveryHorizon: false })}
        onSavePlanning={async () => maintenance}
        isSessionDateCurrent={() => true}
      />,
    );

    const hub = document.querySelector(".finance-hub-grid");
    expect(hub).toBeTruthy();
    const tiles = [...(hub?.querySelectorAll(".finance-icon-tile") ?? [])];
    expect(tiles).toHaveLength(4);
    for (const tile of tiles) {
      expect(tile.querySelector("svg")).toBeTruthy();
    }
    const planTile = document.querySelector(".secondary-plan-art");
    expect(planTile?.classList.contains("finance-icon-tile")).toBe(true);
    expect(planTile?.querySelector("svg")).toBeTruthy();
    expect(document.querySelectorAll("img[data-finance-illustration]")).toHaveLength(0);
  });

  it("renders the brand mark as a clickable button with the restored logo", () => {
    render(
      <V2HomeSurface
        home={home}
        asOfDate="2026-10-21"
        selectedTab="TODAY"
        onSelectTab={vi.fn()}
        onRecordExpense={vi.fn().mockResolvedValue({ status: "UNCONFIRMED" })}
        onOpenDetail={vi.fn()}
        onOpenFinance={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    const brand = document.querySelector(".v2-brand");
    const brandButton = brand?.closest("button");
    expect(brandButton).toBeTruthy();
    expect(brandButton?.getAttribute("aria-label")).toBe("返回今天首页");
    expect(brandButton?.querySelector(".v2-brand-mark img[data-brand-logo]")).toBeTruthy();
    expect(brandButton?.querySelector(".v2-brand-mark .finance-icon-tile")).toBeNull();
    expect(document.querySelectorAll("img[data-finance-illustration]")).toHaveLength(0);
  });

  it("pins every retained kind to the approved tone through the shared mapping", () => {
    const approvedTones: Record<keyof typeof financeArt, string> = {
      income: "coral",
      cash: "blue",
      assets: "lavender",
      debt: "yellow",
      plan: "teal",
      incomeEmpty: "muted",
    };

    expect(Object.keys(financeArt).sort()).toEqual(Object.keys(approvedTones).sort());
    for (const kind of Object.keys(approvedTones) as Array<keyof typeof financeArt>) {
      const tone = approvedTones[kind];
      expect(financeArt[kind].tone).toBe(tone);
      const { container, unmount } = render(<FinanceIllustration kind={kind} />);
      const tile = container.querySelector(".finance-icon-tile");
      expect(tile?.classList.contains(`finance-icon-tile--${tone}`)).toBe(true);
      expect(tile?.querySelector("svg")).toBeTruthy();
      unmount();
    }
  });
});
