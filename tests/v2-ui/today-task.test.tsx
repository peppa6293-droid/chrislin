// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type FinancialMaintenanceState,
  getFinancialMaintenanceState,
} from "../../src/application/financial-maintenance-service.js";
import {
  completeOnboarding,
  getHomeApplicationState,
  type HomeApplicationState,
  type OnboardingSubmission,
} from "../../src/application/product-service.js";
import {
  hasPositiveSafetyGap,
  selectTodayTask,
  TASK_COPY,
  type TaskContext,
} from "../../src/model/v2-task-selector.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import type { Repositories } from "../../src/persistence/repositories.js";
import { localDate } from "../../src/ui/date.js";
import { V2TodayTask } from "../../src/ui/v2-today-task.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

type MonthExpense = { id: string; occurredOn: string };

const openDatabases: NodeSqliteDatabase[] = [];

function onboarding(overrides: Partial<OnboardingSubmission> = {}): OnboardingSubmission {
  return {
    displayName: "今日任务用户",
    stableMonthlyIncome: "10000",
    essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
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

function repositoriesWithExpenses(expenses: MonthExpense[] = []): Repositories {
  return {
    listV2Expenses: vi.fn().mockResolvedValue(expenses),
  } as unknown as Repositories;
}

function previousMonthDate(day = 15): string {
  const date = new Date();
  date.setMonth(date.getMonth() - 1, day);
  return localDate(date);
}

function contextFrom(
  home: HomeApplicationState,
  maintenance: FinancialMaintenanceState,
  monthExpenseCount: number,
): TaskContext {
  return {
    hasStructuralDeficit: home.spendingStatus === "STRUCTURAL_DEFICIT",
    belowCashFloor: home.cashSafetyGateStatus === "ACTIVE",
    consumptionIsPrimaryDrag: home.primaryDrag === "CONSUMPTION",
    hasMissingDebtFact: maintenance.debts.some((debt) => debt.needsCurrentMonthFact),
    hasSafetyGap: hasPositiveSafetyGap(home.safetyGap),
    monthExpenseCount,
  };
}

async function setupRealDatabase(
  submissionOverrides: Partial<OnboardingSubmission> = {},
  onboardAsOfDate?: string,
) {
  const db = new NodeSqliteDatabase();
  openDatabases.push(db);
  await migrateDatabase(db);
  const asOfDate = localDate(new Date());
  await completeOnboarding(db, onboarding(submissionOverrides), onboardAsOfDate ?? asOfDate);
  return { asOfDate, db };
}

async function setupRealState(
  submissionOverrides: Partial<OnboardingSubmission> = {},
  onboardAsOfDate?: string,
) {
  const { asOfDate, db } = await setupRealDatabase(submissionOverrides, onboardAsOfDate);
  const home = await getHomeApplicationState(db, asOfDate);
  const maintenance = await getFinancialMaintenanceState(db, asOfDate);
  const loadHomeState = async (date: string) => await getHomeApplicationState(db, date);
  const loadMaintenanceState = async (date: string) => await getFinancialMaintenanceState(db, date);
  return { asOfDate, db, home, loadHomeState, loadMaintenanceState, maintenance };
}

// A missing current-month debt fact makes getHomeApplicationState itself throw
// MISSING_DEBT_SNAPSHOT. The maintenance service still exposes the pending fact,
// so pair a real healthy Home baseline with this real maintenance state.
async function setupPendingDebtMaintenance() {
  const { asOfDate, db } = await setupRealDatabase({}, previousMonthDate());
  const maintenance = await getFinancialMaintenanceState(db, asOfDate);
  const loadMaintenanceState = async (date: string) => await getFinancialMaintenanceState(db, date);
  return { maintenance, loadMaintenanceState };
}

function renderTask({
  repositories,
  loadHomeState,
  loadMaintenanceState,
  onGoRecord = vi.fn(),
}: {
  repositories: Repositories;
  loadHomeState: (asOfDate: string) => Promise<HomeApplicationState>;
  loadMaintenanceState: (asOfDate: string) => Promise<FinancialMaintenanceState>;
  onGoRecord?: () => void;
}) {
  return render(
    <V2TodayTask
      loadHomeState={loadHomeState}
      loadMaintenanceState={loadMaintenanceState}
      repositories={repositories}
      profileId="profile-v2"
      onGoRecord={onGoRecord}
    />,
  );
}

function assertNoDangerOrScore(container: HTMLElement) {
  expect(container.innerHTML).not.toContain("danger");
  expect(container.textContent).not.toMatch(/\d+\s*\/\s*100/);
  expect(container.textContent).not.toMatch(/\d+\s*分(?!钟)/);
}

function expectCopy(taskId: ReturnType<typeof selectTodayTask>) {
  expect(screen.getByText(TASK_COPY[taskId].title)).toBeTruthy();
  expect(screen.getByText(TASK_COPY[taskId].reason)).toBeTruthy();
  expect(screen.getByText(TASK_COPY[taskId].duration)).toBeTruthy();
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 20, 12, 0, 0));
});

afterEach(() => {
  cleanup();
  for (const db of openDatabases.splice(0)) db.close();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("EXEC-U-08 today task real V1 signals", () => {
  it("maps a healthy real home state to DEFAULT_RECORD", async () => {
    const { home, loadHomeState, loadMaintenanceState, maintenance } = await setupRealState();
    const context = contextFrom(home, maintenance, 0);
    const expected = selectTodayTask(context);
    expect(expected).toBe("DEFAULT_RECORD");
    expect(context).toEqual({
      hasStructuralDeficit: false,
      belowCashFloor: false,
      consumptionIsPrimaryDrag: false,
      hasMissingDebtFact: false,
      hasSafetyGap: false,
      monthExpenseCount: 0,
    });

    const { container } = renderTask({
      repositories: repositoriesWithExpenses(),
      loadHomeState,
      loadMaintenanceState,
    });
    await screen.findByText(TASK_COPY[expected].title);
    expectCopy(expected);
    const action = screen.getByRole("button", { name: TASK_COPY[expected].action });
    expect(action.disabled).toBe(false);
    assertNoDangerOrScore(container);
    expect(container.querySelectorAll("section.v2-today-task")).toHaveLength(1);
  });

  it("maps a same-month expense to RECORD_EXPENSE and keeps the completed state", async () => {
    const { home, loadHomeState, loadMaintenanceState, maintenance } = await setupRealState();
    const expenses: MonthExpense[] = [
      { id: "e1", occurredOn: "2026-10-20" },
      { id: "e2", occurredOn: "2026-10-20" },
    ];
    const expected = selectTodayTask(contextFrom(home, maintenance, expenses.length));
    expect(expected).toBe("RECORD_EXPENSE");

    const { container } = renderTask({
      repositories: repositoriesWithExpenses(expenses),
      loadHomeState,
      loadMaintenanceState,
    });
    await screen.findByText(TASK_COPY[expected].title);
    expectCopy(expected);
    const action = screen.getByRole("button", { name: "已完成" });
    expect(action.disabled).toBe(true);
    expect(screen.getByText("今天已记 2 笔")).toBeTruthy();
    assertNoDangerOrScore(container);
  });

  it("maps a pending current-month debt fact to CONFIRM_DEBT", async () => {
    const healthy = await setupRealState();
    const pending = await setupPendingDebtMaintenance();
    expect(pending.maintenance.debts.some((debt) => debt.needsCurrentMonthFact)).toBe(true);
    const context = contextFrom(healthy.home, pending.maintenance, 0);
    expect(context.hasStructuralDeficit).toBe(false);
    expect(context.belowCashFloor).toBe(false);
    expect(context.consumptionIsPrimaryDrag).toBe(false);
    expect(context.hasSafetyGap).toBe(false);
    const expected = selectTodayTask(context);
    expect(expected).toBe("CONFIRM_DEBT");

    renderTask({
      repositories: repositoriesWithExpenses(),
      loadHomeState: healthy.loadHomeState,
      loadMaintenanceState: pending.loadMaintenanceState,
    });
    await screen.findByText(TASK_COPY[expected].title);
    expectCopy(expected);
  });

  it("maps an active cash safety gate to SECURE_CASH", async () => {
    const { home, loadHomeState, loadMaintenanceState, maintenance } = await setupRealState({
      cashAccounts: [{ name: "现金账户", balance: "500", includeInSafetyResources: true }],
      assets: [],
      safetyRecoveryHorizonMonths: 12,
    });
    expect(home.cashSafetyGateStatus).toBe("ACTIVE");
    expect(home.spendingStatus).not.toBe("STRUCTURAL_DEFICIT");
    const expected = selectTodayTask(contextFrom(home, maintenance, 0));
    expect(expected).toBe("SECURE_CASH");

    renderTask({
      repositories: repositoriesWithExpenses(),
      loadHomeState,
      loadMaintenanceState,
    });
    await screen.findByText(TASK_COPY[expected].title);
    expectCopy(expected);
  });

  it("maps a structural deficit to CLARIFY_GAP even when other signals are present", async () => {
    const { home, loadHomeState, loadMaintenanceState, maintenance } = await setupRealState({
      stableMonthlyIncome: "1000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "2000" }],
      debts: [],
      safetyCoverageTargetMonths: 3,
    });
    expect(home.spendingStatus).toBe("STRUCTURAL_DEFICIT");
    expect(home.cashSafetyGateStatus).toBe("ACTIVE");
    const expected = selectTodayTask(contextFrom(home, maintenance, 0));
    expect(expected).toBe("CLARIFY_GAP");

    renderTask({
      repositories: repositoriesWithExpenses(),
      loadHomeState,
      loadMaintenanceState,
    });
    await screen.findByText(TASK_COPY[expected].title);
    expectCopy(expected);
  });

  it("maps a positive safety gap with no higher-priority signal to CHECK_SAFETY", async () => {
    const { home, loadHomeState, loadMaintenanceState, maintenance } = await setupRealState({
      cashAccounts: [{ name: "现金账户", balance: "1500", includeInSafetyResources: true }],
      assets: [],
      debts: [],
      safetyRecoveryHorizonMonths: 12,
    });
    const context = contextFrom(home, maintenance, 0);
    expect(home.cashSafetyGateStatus).toBe("CLEAR");
    expect(context.hasStructuralDeficit).toBe(false);
    expect(context.consumptionIsPrimaryDrag).toBe(false);
    expect(context.hasMissingDebtFact).toBe(false);
    expect(context.hasSafetyGap).toBe(true);
    const expected = selectTodayTask(context);
    expect(expected).toBe("CHECK_SAFETY");

    renderTask({
      repositories: repositoriesWithExpenses(),
      loadHomeState,
      loadMaintenanceState,
    });
    await screen.findByText(TASK_COPY[expected].title);
    expectCopy(expected);
  });

  it("maps CONSUMPTION as the primary drag ahead of a pending debt fact", async () => {
    const healthy = await setupRealState();
    const pending = await setupPendingDebtMaintenance();
    expect(pending.maintenance.debts.some((debt) => debt.needsCurrentMonthFact)).toBe(true);
    const consumptionHome: HomeApplicationState = {
      ...healthy.home,
      primaryDrag: "CONSUMPTION",
    };
    const expected = selectTodayTask(contextFrom(consumptionHome, pending.maintenance, 0));
    expect(expected).toBe("DEFAULT_RECORD");

    const loadConsumptionHome = async () => consumptionHome;
    renderTask({
      repositories: repositoriesWithExpenses(),
      loadHomeState: loadConsumptionHome,
      loadMaintenanceState: pending.loadMaintenanceState,
    });
    await screen.findByText(TASK_COPY[expected].title);
    expectCopy(expected);
    expect(screen.queryByText(TASK_COPY.CONFIRM_DEBT.title)).toBeNull();
  });

  it("routes the pending CTA to the record page once", async () => {
    const user = userEvent.setup();
    const { home, loadHomeState, loadMaintenanceState, maintenance } = await setupRealState();
    const expected = selectTodayTask(contextFrom(home, maintenance, 0));
    const onGoRecord = vi.fn();
    renderTask({
      repositories: repositoriesWithExpenses(),
      loadHomeState,
      loadMaintenanceState,
      onGoRecord,
    });
    await user.click(await screen.findByRole("button", { name: TASK_COPY[expected].action }));
    expect(onGoRecord).toHaveBeenCalledTimes(1);
  });

  it("does not route the completed CTA", async () => {
    const user = userEvent.setup();
    const { home, loadHomeState, loadMaintenanceState, maintenance } = await setupRealState();
    const expenses: MonthExpense[] = [{ id: "e1", occurredOn: "2026-10-20" }];
    const expected = selectTodayTask(contextFrom(home, maintenance, expenses.length));
    expect(expected).toBe("RECORD_EXPENSE");
    const onGoRecord = vi.fn();
    renderTask({
      repositories: repositoriesWithExpenses(expenses),
      loadHomeState,
      loadMaintenanceState,
      onGoRecord,
    });
    await user.click(await screen.findByRole("button", { name: "已完成" }));
    expect(onGoRecord).toHaveBeenCalledTimes(0);
  });

  it("renders nothing while any of the three loads is pending", async () => {
    const { loadHomeState, loadMaintenanceState } = await setupRealState();
    const repositories = {
      listV2Expenses: vi.fn().mockReturnValue(new Promise(() => {})),
    } as unknown as Repositories;
    const { container } = renderTask({ repositories, loadHomeState, loadMaintenanceState });
    expect(container.children).toHaveLength(0);
    expect(screen.queryByText("加载中…")).toBeNull();
  });

  it("renders nothing after a home-state load failure", async () => {
    const { loadMaintenanceState } = await setupRealState();
    const loadHomeState = vi.fn().mockRejectedValue(new Error("home failed"));
    const { container } = renderTask({
      repositories: repositoriesWithExpenses(),
      loadHomeState,
      loadMaintenanceState,
    });
    await waitFor(() => expect(loadHomeState).toHaveBeenCalledTimes(1));
    expect(container.children).toHaveLength(0);
  });

  it("renders nothing after a maintenance-state load failure", async () => {
    const { loadHomeState } = await setupRealState();
    const loadMaintenanceState = vi.fn().mockRejectedValue(new Error("maintenance failed"));
    const { container } = renderTask({
      repositories: repositoriesWithExpenses(),
      loadHomeState,
      loadMaintenanceState,
    });
    await waitFor(() => expect(loadMaintenanceState).toHaveBeenCalledTimes(1));
    expect(container.children).toHaveLength(0);
  });
});

describe("hasPositiveSafetyGap", () => {
  it("only treats positive gaps as gaps", () => {
    expect(hasPositiveSafetyGap("0")).toBe(false);
    expect(hasPositiveSafetyGap("0.00")).toBe(false);
    expect(hasPositiveSafetyGap("-1")).toBe(false);
    expect(hasPositiveSafetyGap("0.0000000001")).toBe(true);
    expect(hasPositiveSafetyGap("1500")).toBe(true);
  });
});
