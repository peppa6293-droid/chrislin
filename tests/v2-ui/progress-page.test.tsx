// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  completeOnboarding,
  getHomeApplicationState,
  type HomeApplicationState,
  type OnboardingSubmission,
} from "../../src/application/product-service.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { localDate } from "../../src/ui/date.js";
import { V2Progress } from "../../src/ui/v2-progress.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

function onboarding(overrides: Partial<OnboardingSubmission> = {}): OnboardingSubmission {
  return {
    displayName: "进展页用户",
    stableMonthlyIncome: "10000",
    essentialExpenses: [
      { category: "HOUSING", monthlyAmount: "1000" },
      { category: "BASIC_FOOD", monthlyAmount: "500" },
    ],
    cashAccounts: [{ name: "现金账户", balance: "5000", includeInSafetyResources: true }],
    assets: [{ name: "流动资产", currentValue: "1000", includeInSafetyResources: true }],
    debts: [
      {
        name: "信用卡",
        currentBalance: "2000",
        currentMonthDue: "500",
        fixedMonthlyPayment: "500",
      },
    ],
    safetyCoverageTargetMonths: 3,
    minimumCashCoverageMonths: 1,
    desiredMonthlyDiscretionarySpending: "2000",
    ...overrides,
  };
}

async function setupProgress(submissionOverrides: Partial<OnboardingSubmission> = {}) {
  const db = new NodeSqliteDatabase();
  await migrateDatabase(db);
  const asOfDate = localDate(new Date());
  const submission = onboarding(submissionOverrides);
  await completeOnboarding(db, submission, asOfDate);
  const home = await getHomeApplicationState(db, asOfDate);
  const expenseService = {
    getMonthSummary: vi.fn().mockResolvedValue({ dailyExpenseTotal: "0.00", billStatuses: [] }),
  };
  const loadHomeState = vi.fn(async () => await getHomeApplicationState(db, asOfDate));
  render(
    <V2Progress expenseService={expenseService} loadHomeState={loadHomeState} profileId="any" />,
  );
  return { db, home };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
});

describe("EXEC-U-07 progress nodes 2-4 with V1 model data", () => {
  it("renders all four node titles without placeholders", async () => {
    const { home } = await setupProgress();
    await screen.findByText(`现金 ¥${home.currentCash}`);
    for (const title of ["看清消费", "稳住现金", "理清责任", "建立余地"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
    expect(screen.queryByText("即将开放")).toBeNull();
  });

  it("renders cash safety data from the database baseline", async () => {
    const { home } = await setupProgress();
    expect(await screen.findByText(`现金 ¥${home.currentCash}`)).toBeTruthy();
    if (home.cashCoverageMonths === null) {
      expect(screen.getByText("覆盖月数待计算")).toBeTruthy();
    } else {
      expect(
        screen.getByText(
          `可覆盖 ${home.cashCoverageMonths} 个月（最低要求 ${home.minimumCashCoverageMonths} 个月）`,
        ),
      ).toBeTruthy();
    }
    const cashStatus = {
      ACTIVE: "现金低于安全线",
      CLEAR: "现金高于安全线",
      NOT_APPLICABLE: "安全线暂不适用",
    }[home.cashSafetyGateStatus];
    expect(screen.getByText(cashStatus)).toBeTruthy();
  });

  it("renders debt data from the database baseline", async () => {
    const { home } = await setupProgress();
    expect(await screen.findByText(`总债务 ¥${home.totalDebt}`)).toBeTruthy();
    expect(screen.getByText(`本月还款义务 ¥${home.mandatoryDebtService}`)).toBeTruthy();
    expect(screen.getByText(`${home.debts.length} 笔债务`)).toBeTruthy();
  });

  it("renders safety data and status from the database baseline", async () => {
    const { home } = await setupProgress();
    expect(
      await screen.findByText(
        `安全垫 ¥${home.safetyResources} / 目标 ¥${home.safetyTargetResources}`,
      ),
    ).toBeTruthy();
    const coverageCopy =
      home.safetyCoverageMonths === null
        ? "覆盖月数待计算"
        : `可覆盖 ${home.safetyCoverageMonths} 个月`;
    if (home.safetyCoverageMonths === null) {
      expect(screen.getByText(coverageCopy)).toBeTruthy();
    } else {
      expect(screen.getByText(coverageCopy)).toBeTruthy();
    }
    const safetyStatus = {
      NORMAL: "安全垫正常",
      NO_CORE_OBLIGATION: "暂无需要覆盖的核心支出",
    }[home.safetyCoverageStatus];
    expect(screen.getByText(safetyStatus)).toBeTruthy();
    expect(screen.queryByText("/100")).toBeNull();
    expect(screen.queryByText("分")).toBeNull();
  });

  it("shows the error state when home loading fails", async () => {
    const db = new NodeSqliteDatabase();
    await migrateDatabase(db);
    const asOfDate = localDate(new Date());
    const submission = onboarding();
    await completeOnboarding(db, submission, asOfDate);
    const expenseService = {
      getMonthSummary: vi.fn().mockResolvedValue({ dailyExpenseTotal: "0.00", billStatuses: [] }),
    };
    const failingLoadHomeState = vi.fn(async () => {
      throw new Error("load failed");
    });
    render(
      <V2Progress
        expenseService={expenseService}
        loadHomeState={failingLoadHomeState}
        profileId="any"
      />,
    );
    expect(await screen.findByText("数据加载失败，请重试。")).toBeTruthy();
  });

  it("shows the loading state while home data is pending", async () => {
    const db = new NodeSqliteDatabase();
    await migrateDatabase(db);
    const asOfDate = localDate(new Date());
    const submission = onboarding();
    await completeOnboarding(db, submission, asOfDate);
    const expenseService = {
      getMonthSummary: vi.fn().mockResolvedValue({ dailyExpenseTotal: "0.00", billStatuses: [] }),
    };
    let resolveHome: (value: HomeApplicationState) => void = () => {};
    const pendingLoadHomeState = vi.fn(
      () =>
        new Promise<HomeApplicationState>((resolve) => {
          resolveHome = resolve;
        }),
    );
    render(
      <V2Progress
        expenseService={expenseService}
        loadHomeState={pendingLoadHomeState}
        profileId="any"
      />,
    );
    expect(screen.getByText("加载中…")).toBeTruthy();
    resolveHome(await getHomeApplicationState(db, asOfDate));
    expect(await screen.findByText("稳住现金")).toBeTruthy();
  });

  it("supports the non-null cash coverage branch through the real service chain", async () => {
    const { home } = await setupProgress();
    expect(await screen.findByText(`现金 ¥${home.currentCash}`)).toBeTruthy();
    expect(home.cashCoverageMonths).not.toBeNull();
    expect(
      screen.getByText(
        `可覆盖 ${home.cashCoverageMonths} 个月（最低要求 ${home.minimumCashCoverageMonths} 个月）`,
      ),
    ).toBeTruthy();
  });
});
