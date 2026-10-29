// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FinancialMaintenanceState } from "../src/application/financial-maintenance-service.js";
import type { HomeApplicationState } from "../src/application/product-service.js";
import { HomeScreen } from "../src/ui/HomeScreen.js";
import { MONTH_ROTATION_LINES, pickDailyLine } from "../src/ui/v2-month-copy.js";

const home: HomeApplicationState = {
  status: "READY",
  asOfDate: "2026-10-14",
  currentMonth: "2026-10",
  profileDisplayName: "小钱",
  actualIncomeRecordCount: 0,
  actualIncomeTotal: "13000",
  currentCash: "5000",
  currentMonthSpending: "125.50",
  currentMonthVariableExpenseCount: 2,
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

function renderHome(
  overrides: Partial<HomeApplicationState> = {},
  props: { pendingDebtFactNames?: string[]; asOfDate?: string } = {},
) {
  const onRecordExpense = vi.fn().mockResolvedValue({
    status: "CONFIRMED",
    writeSignal: "RESOLVED",
    record: {
      id: "expense-1",
      amount: "30.50",
      dateTime: "2026-10-14T12:00:00.000Z",
      businessDate: "2026-10-14",
      kind: "VARIABLE",
      category: "FOOD",
    },
    home,
  });
  render(
    <HomeScreen
      home={{ ...home, ...overrides }}
      asOfDate={props.asOfDate ?? "2026-10-14"}
      pendingDebtFactNames={props.pendingDebtFactNames}
      onRecordExpense={onRecordExpense}
      onLoadFinancialMaintenance={async () => ({
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
          desiredMonthlyDiscretionarySpending: "1600",
        },
        requiresSafetyRecoveryHorizon: false,
        asOfDate: "2026-10-14",
      })}
      onGetFinancialMaintenanceRequirement={async () => ({
        requiresSafetyRecoveryHorizon: false,
      })}
      onUpdateFinancialData={async () => {
        throw new Error("not used");
      }}
    />,
  );
  return onRecordExpense;
}

function financeState(
  overrides: Partial<Pick<FinancialMaintenanceState, "cashAccounts" | "debts">> = {},
): FinancialMaintenanceState {
  return {
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
      desiredMonthlyDiscretionarySpending: "1600",
    },
    requiresSafetyRecoveryHorizon: false,
    asOfDate: "2026-10-14",
    ...overrides,
  };
}

describe("V2 product surface", () => {
  afterEach(() => cleanup());
  it("shows the single daily task and the four progress dimensions", () => {
    renderHome();
    expect(screen.getByTestId("v2-home")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "账单：不是，他怎么还剩钱？" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "支付软件：你是不是把我卸了？" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "记一笔", exact: true })).toBeTruthy();
    expect(document.querySelectorAll(".v2-today-page .button-primary")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "你好，小钱" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "现金安全" })).toBeTruthy();
  });

  it("shows the real empty state and preserves a failed expense draft without success feedback", async () => {
    const user = userEvent.setup();
    const onRecordExpense = vi.fn().mockRejectedValue(new Error("写入失败"));
    render(
      <HomeScreen
        home={{ ...home, recentExpenses: [] }}
        asOfDate="2026-10-14"
        onRecordExpense={onRecordExpense}
        onLoadFinancialMaintenance={async () => financeState()}
        onGetFinancialMaintenanceRequirement={async () => ({
          requiresSafetyRecoveryHorizon: false,
        })}
        onUpdateFinancialData={async () => financeState()}
      />,
    );
    expect(screen.getByText("还没有最近记录")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "记一笔", exact: true }));
    const amount = screen.getByLabelText("消费金额") as HTMLInputElement;
    expect(document.activeElement).toBe(amount);
    await user.type(amount, "18.50");
    await user.click(screen.getByRole("button", { name: "保存消费" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(amount.value).toBe("18.50");
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector(".v2-recent-row.is-newly-saved")).toBeNull();
    expect(onRecordExpense).toHaveBeenCalledTimes(1);
  });

  it("keeps rendered V2 feedback static under the reduced-motion stylesheet policy", () => {
    renderHome();
    expect(screen.getByRole("button", { name: "现金安全" })).toBeTruthy();
    const styles = readFileSync(resolve(process.cwd(), "src/ui/v2-surface.css"), "utf8");
    const reducedMotion = styles.match(
      /@media \(prefers-reduced-motion: reduce\)\s*\{([\s\S]*?)\n\}/,
    )?.[1];
    expect(reducedMotion).toContain(".v2-shell *");
    expect(reducedMotion).toContain("transition: none");
    expect(reducedMotion).toContain("animation: none");
    expect(reducedMotion).toContain(".v2-recent-row.is-newly-saved");
    expect(reducedMotion).toContain(".v2-path-card.is-confirmed-cash");
    expect(reducedMotion).toContain(".v2-path-card.is-confirmed-debt");
  });

  it("keeps an incomplete debt fact actionable without showing an old payment", () => {
    render(
      <HomeScreen
        home={home}
        asOfDate="2026-11-01"
        pendingDebtFactNames={["房贷 A"]}
        onRecordExpense={async () => ({
          status: "CONFIRMED",
          writeSignal: "RESOLVED",
          record: {
            id: "expense-test",
            amount: "1",
            dateTime: "2026-11-01T00:00:00.000Z",
            businessDate: "2026-11-01",
            kind: "VARIABLE",
            category: "FOOD",
          },
          home,
        })}
        onLoadFinancialMaintenance={async () => {
          throw new Error("not used");
        }}
        onGetFinancialMaintenanceRequirement={async () => ({
          requiresSafetyRecoveryHorizon: false,
        })}
        onUpdateFinancialData={async () => {
          throw new Error("not used");
        }}
      />,
    );
    expect(
      screen.getByText(/首页暂不按上月应还金额估算|我们先不拿上个月的数字来估算/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "本月责任" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "去确认" })).toHaveLength(1);
  });

  it("records an expense through the existing application boundary and closes the sheet", async () => {
    const user = userEvent.setup();
    const onRecordExpense = renderHome();
    await user.click(screen.getByRole("button", { name: "记一笔", exact: true }));
    expect(document.activeElement).toBe(screen.getByLabelText("消费金额"));
    await user.type(screen.getByLabelText("消费金额"), "30.50");
    await user.click(screen.getByRole("button", { name: "保存消费" }));
    await waitFor(() => expect(onRecordExpense).toHaveBeenCalledTimes(1));
    expect(onRecordExpense.mock.calls[0]?.[0]).toMatchObject({ amount: "30.50" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("animates a recent expense only after the application boundary returns a confirmed readback", async () => {
    const user = userEvent.setup();
    const confirmedHome = { ...home, currentMonthSpending: "156.00" };
    const record = {
      id: "expense-confirmed",
      amount: "30.50",
      dateTime: "2026-10-14T12:00:00.000Z",
      businessDate: "2026-10-14",
      kind: "VARIABLE" as const,
      category: "FOOD" as const,
    };
    const onRecordExpense = vi.fn().mockResolvedValue({
      status: "CONFIRMED" as const,
      writeSignal: "RESOLVED" as const,
      record,
      home: confirmedHome,
    });
    render(
      <HomeScreen
        home={{
          ...home,
          currentMonthSpending: "156.00",
          recentExpenses: [
            {
              id: record.id,
              amount: record.amount,
              businessDate: record.businessDate,
              category: record.category,
            },
          ],
        }}
        asOfDate="2026-10-14"
        onRecordExpense={onRecordExpense}
        onLoadFinancialMaintenance={async () => financeState()}
        onGetFinancialMaintenanceRequirement={async () => ({
          requiresSafetyRecoveryHorizon: false,
        })}
        onUpdateFinancialData={async () => financeState()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "记一笔", exact: true }));
    await user.type(screen.getByLabelText("消费金额"), "30.50");
    await user.click(screen.getByRole("button", { name: "保存消费" }));
    expect(await screen.findByRole("status")).toBeTruthy();
    expect(onRecordExpense).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".v2-recent-row.is-newly-saved")).toBeTruthy();
    expect(document.querySelector(".v2-today-snapshot .is-expense-value-emphasis")).toBeTruthy();
  });

  it("does not animate when expense persistence is unresolved", async () => {
    const user = userEvent.setup();
    render(
      <HomeScreen
        home={home}
        asOfDate="2026-10-14"
        onRecordExpense={async () => ({
          status: "UNCONFIRMED",
          writeSignal: "RESOLVED",
          message: "保存后重新读取没有找到这笔记录。",
        })}
        onLoadFinancialMaintenance={async () => financeState()}
        onGetFinancialMaintenanceRequirement={async () => ({
          requiresSafetyRecoveryHorizon: false,
        })}
        onUpdateFinancialData={async () => financeState()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "记一笔", exact: true }));
    await user.type(screen.getByLabelText("消费金额"), "8");
    await user.click(screen.getByRole("button", { name: "保存消费" }));
    expect((await screen.findByRole("alert")).textContent).toContain("重新读取");
    expect(screen.queryByRole("status")).toBeNull();
    expect(document.querySelector(".v2-recent-row.is-newly-saved")).toBeNull();
    expect(document.querySelector(".v2-today-snapshot .is-expense-value-emphasis")).toBeNull();
  });

  it("keeps the expense sheet dismissible and handles an unavailable safety baseline", async () => {
    const user = userEvent.setup();
    renderHome({
      safetyCoverageMonths: null,
      cashCoverageMonths: null,
      cashSafetyGateStatus: "NOT_APPLICABLE",
      cashFloorMet: null,
    });
    expect(screen.getByRole("heading", { name: "支付软件：你是不是把我卸了？" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "记一笔", exact: true }));
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens the cash-flow explanation from the V2 path", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole("button", { name: "消费详情" }));
    expect(screen.getAllByRole("heading", { name: /这个月花了多少/ }).length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "返回首页" }));
    expect(screen.getByTestId("v2-home")).toBeTruthy();
  });

  it("keeps one four-destination navigation visible across destination pages", async () => {
    const user = userEvent.setup();
    renderHome();
    const navigation = screen.getByRole("navigation", { name: "主导航" });
    expect(navigation.querySelectorAll("button")).toHaveLength(4);
    expect(navigation.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
    await user.click(screen.getByRole("button", { name: "我的财务" }));
    expect(await screen.findByRole("heading", { name: "我的财务" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "主导航" })).toBe(navigation);
    expect(navigation.querySelector('[aria-label="我的财务"]')?.getAttribute("aria-current")).toBe(
      "page",
    );
    await user.click(screen.getByRole("button", { name: "今天" }));
    expect(screen.getByRole("heading", { name: "支付软件：你是不是把我卸了？" })).toBeTruthy();
  });

  it("opens a path when its content is clicked, not only its chevron", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole("button", { name: "现金安全" }));
    expect(screen.getByRole("heading", { name: "安全垫", level: 1 })).toBeTruthy();
  });

  it("shows a real spending map on Progress when expense breakdown data is available", async () => {
    const user = userEvent.setup();
    renderHome({
      spendingBreakdown: [
        { category: "FOOD", amount: "720", share: "60", count: 4 },
        { category: "TRANSPORT", amount: "360", share: "30", count: 3 },
        { category: "SHOPPING", amount: "120", share: "10", count: 1 },
      ],
    });
    await user.click(screen.getByRole("button", { name: "进展" }));
    expect(screen.getByRole("heading", { name: "这个月的花钱分布" })).toBeTruthy();
    expect(screen.getAllByText(/吃饭|餐饮/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("60%")).toBeTruthy();
    expect(screen.getByText("30%")).toBeTruthy();
  });

  it("shows model directions and explanations without creating a combined score", async () => {
    const user = userEvent.setup();
    renderHome({
      spendingStatus: "STRUCTURAL_DEFICIT",
      trendDimensions: {
        ...home.trendDimensions,
        CONSUMPTION: { direction: "IMPROVING", reason: "Same-period spending decreased." },
      },
    });
    await user.click(screen.getByRole("button", { name: "进展" }));
    expect(screen.getByText("长期看，每个月有个缺口")).toBeTruthy();
    expect(screen.getByRole("button", { name: /看清消费.*改善.*消费低于上期同期/ })).toBeTruthy();
    expect(document.querySelector(".v2-progress-ring")).toBeNull();
  });

  it("renders NO_CORE_OBLIGATION as not applicable and distinguishes balanced spending", async () => {
    const user = userEvent.setup();
    renderHome({
      safetyCoverageStatus: "NO_CORE_OBLIGATION",
      safetyCoverageMonths: null,
      cashCoverageMonths: null,
      cashSafetyGateStatus: "NOT_APPLICABLE",
      cashFloorMet: null,
      spendingStatus: "BALANCED_NO_SURPLUS",
      trendDimensions: {
        ...home.trendDimensions,
        LIQUIDITY_SAFETY: {
          direction: "NOT_APPLICABLE",
          reason: "No core obligations exist to cover.",
        },
      },
    });
    await user.click(screen.getByRole("button", { name: "进展" }));
    expect(screen.getByText("长期看，每个月刚好打平")).toBeTruthy();
    expect(screen.getAllByText("不适用").length).toBeGreaterThanOrEqual(2);
    expect(document.body.textContent).not.toMatch(/Infinity|NaN|100%/);
  });

  it("does not show pending debt balances or payments as confirmed in progress details", async () => {
    const user = userEvent.setup();
    const pendingHome = {
      ...home,
      debts: [
        {
          id: "debt-pending",
          name: "房贷",
          currentBalance: "88000",
          currentMonthDue: null,
          fixedMonthlyPayment: "1800",
          countedMonthlyPayment: "1800",
          paymentSource: "FIXED_MONTHLY_PAYMENT" as const,
        },
      ],
    };
    render(
      <HomeScreen
        home={pendingHome}
        pendingDebtFactNames={["房贷"]}
        onRecordExpense={async () => ({
          status: "UNCONFIRMED",
          writeSignal: "RESOLVED",
          message: "unused",
        })}
        onLoadFinancialMaintenance={async () => financeState()}
        onGetFinancialMaintenanceRequirement={async () => ({
          requiresSafetyRecoveryHorizon: false,
        })}
        onUpdateFinancialData={async () => financeState()}
      />,
    );
    await user.click(screen.getByRole("button", { name: "进展" }));
    expect(screen.getByRole("button", { name: /理清责任.*待确认/ })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: /理清责任.*待确认/ }));
    expect(screen.getAllByText("本月余额待确认").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("本月应还待确认").length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText("¥88,000.00")).toBeNull();
    expect(screen.queryByText("¥1,800.00")).toBeNull();
  });

  it("opens the data and privacy destination from My Finance", async () => {
    const user = userEvent.setup();
    renderHome();
    await user.click(screen.getByRole("button", { name: "我的财务" }));
    await user.click(await screen.findByRole("button", { name: "数据与隐私" }));
    expect(screen.getByRole("heading", { name: "数据与隐私" })).toBeTruthy();
    expect(screen.getByText(/保存在这台电脑上的本地数据库里/)).toBeTruthy();
    expect(screen.getByText(/不上传、不联网、没有云端账号/)).toBeTruthy();
    expect(screen.getByText(/导出成一份 JSON 文件/)).toBeTruthy();
    expect(screen.getByText(/CSV：流水表/)).toBeTruthy();
  });

  it("animates the cash safety node only after cash state is reread and matched", async () => {
    const user = userEvent.setup();
    const before = financeState({
      cashAccounts: [
        { id: "cash-1", name: "日常账户", balance: "5000", includeInSafetyResources: true },
      ],
    });
    const after = financeState({
      cashAccounts: [
        { id: "cash-1", name: "日常账户", balance: "5100", includeInSafetyResources: true },
      ],
    });
    render(
      <HomeScreen
        home={home}
        onRecordExpense={async () => {
          throw new Error("not used");
        }}
        onLoadFinancialMaintenance={async () => before}
        onGetFinancialMaintenanceRequirement={async () => ({
          requiresSafetyRecoveryHorizon: false,
        })}
        onUpdateFinancialData={async () => after}
      />,
    );
    await user.click(screen.getByRole("button", { name: "我的财务" }));
    await user.click(await screen.findByText("现金", { selector: ".finance-card-title" }));
    const row = screen.getByText("日常账户").closest(".finance-data-row");
    expect(row?.classList.contains("is-confirmed-cash-row")).toBe(false);
    await user.click(within(row as HTMLElement).getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog");
    const amount = within(dialog).getByLabelText("当前余额（元）");
    await user.clear(amount);
    await user.type(amount, "5100");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        screen
          .getByText("日常账户")
          .closest(".finance-data-row")
          ?.classList.contains("is-confirmed-cash-row"),
      ).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "今天" }));
    await waitFor(() =>
      expect(document.querySelector(".v2-today-signals .is-confirmed-cash")).toBeTruthy(),
    );
  });

  it("animates the saved debt row and responsibility node after matching readback", async () => {
    const user = userEvent.setup();
    const debt = {
      id: "debt-1",
      name: "信用卡",
      currentBalance: "800",
      currentMonthDue: "100",
      fixedMonthlyPayment: null,
      needsCurrentMonthFact: false,
    };
    const before = financeState({ debts: [debt] });
    const after = financeState({ debts: [{ ...debt, currentBalance: "750" }] });
    render(
      <HomeScreen
        home={{ ...home, totalDebt: "800" }}
        onRecordExpense={async () => {
          throw new Error("not used");
        }}
        onLoadFinancialMaintenance={async () => before}
        onGetFinancialMaintenanceRequirement={async () => ({
          requiresSafetyRecoveryHorizon: false,
        })}
        onUpdateFinancialData={async () => after}
      />,
    );
    await user.click(screen.getByRole("button", { name: "我的财务" }));
    await user.click(await screen.findByText("债务", { selector: ".finance-card-title" }));
    const row = screen.getByText("信用卡").closest(".finance-data-row");
    await user.click(within(row as HTMLElement).getByRole("button", { name: "编辑" }));
    const dialog = screen.getByRole("dialog");
    const amount = within(dialog).getByLabelText("当前余额（元）");
    await user.clear(amount);
    await user.type(amount, "750");
    await user.click(within(dialog).getByRole("button", { name: "保存" }));
    await waitFor(() =>
      expect(
        screen
          .getByText("信用卡")
          .closest(".finance-data-row")
          ?.classList.contains("is-confirmed-debt-row"),
      ).toBe(true),
    );
    await user.click(screen.getByRole("button", { name: "今天" }));
    await waitFor(() =>
      expect(document.querySelector(".v2-today-signals .is-confirmed-debt")).toBeTruthy(),
    );
  });

  it("does not display previous-month expenses in the current month recent list", async () => {
    renderHome({
      recentExpenses: [
        {
          id: "oct-current",
          amount: "25.00",
          businessDate: "2026-10-14",
          category: "FOOD",
        },
      ],
    });
    // Recent expenses are on the TODAY page (default). MoneyAmount renders as ¥25.00 with aria-label.
    expect(screen.getByRole("img", { name: /25点00 元人民币/ })).toBeTruthy();
    expect(screen.getByText("吃饭")).toBeTruthy();
    // A September expense marker must NOT appear since product-service filters by currentMonth
    expect(screen.queryByText("sep-old-expense-marker")).toBeNull();
  });
});

describe("WP-UI-COPY-01 structure and month copy", () => {
  afterEach(() => cleanup());

  const structureCard = () =>
    document.querySelector<HTMLElement>(".v2-structure-card") as HTMLElement;
  const monthCard = () => document.querySelector<HTMLElement>(".v2-month-card") as HTMLElement;

  it("S1 default fixture draws both rings and prints both shares", () => {
    renderHome();
    const card = structureCard();
    expect(within(card).getByRole("heading", { name: "账单：不是，他怎么还剩钱？" })).toBeTruthy();
    expect(card.querySelector(".v2-ring__arc.is-outer")).toBeTruthy();
    expect(card.querySelector(".v2-ring__arc.is-inner")).toBeTruthy();
    expect(card.querySelector(".v2-ring__centre-amount")?.textContent).toBe("¥13,000.00");
    const rows = [...card.querySelectorAll(".v2-ring-row")].map((row) => row.textContent);
    expect(rows[0]).toContain("固定支出");
    expect(rows[0]).toContain("占收入 27.1%");
    expect(rows[1]).toContain("必须偿还月供");
    expect(rows[1]).toContain("占收入 6.2%");
  });

  it("S2 7.7% surplus shows the tight structure band", () => {
    renderHome({
      actualIncomeTotal: "1000",
      essentialExpenses: "300",
      mandatoryDebtService: "623",
    });
    expect(
      within(structureCard()).getByRole("heading", { name: "钱包：还活着，先别开香槟。" }),
    ).toBeTruthy();
  });

  it("S3 exactly zero surplus shows the even band and is-even tone", () => {
    renderHome({
      actualIncomeTotal: "1000",
      essentialExpenses: "400",
      mandatoryDebtService: "600",
    });
    const card = structureCard();
    expect(within(card).getByRole("heading", { name: "工资：来过，爱过，没留过。" })).toBeTruthy();
    expect(card.classList.contains("is-even")).toBe(true);
  });

  it("S4 a mild deficit shows the mild band and over card tone", () => {
    renderHome({
      actualIncomeTotal: "1000",
      essentialExpenses: "500",
      mandatoryDebtService: "550",
    });
    const card = structureCard();
    expect(
      within(card).getByRole("heading", { name: "工资：你们分赃怎么不带我商量？" }),
    ).toBeTruthy();
    expect(card.classList.contains("v2-card--over")).toBe(true);
  });

  it("S5 a deep deficit shows the deep band", () => {
    renderHome({
      actualIncomeTotal: "1000",
      essentialExpenses: "800",
      mandatoryDebtService: "400",
    });
    expect(
      within(structureCard()).getByRole("heading", { name: "收入：我一个人打五个？" }),
    ).toBeTruthy();
  });

  it("S6a exactly 20% stays in the steady band", () => {
    renderHome({
      actualIncomeTotal: "1000",
      essentialExpenses: "300",
      mandatoryDebtService: "500",
    });
    expect(
      within(structureCard()).getByRole("heading", { name: "账单：不是，他怎么还剩钱？" }),
    ).toBeTruthy();
  });

  it("S6b exactly -10% is the deep band", () => {
    renderHome({
      actualIncomeTotal: "1000",
      essentialExpenses: "500",
      mandatoryDebtService: "600",
    });
    expect(
      within(structureCard()).getByRole("heading", { name: "收入：我一个人打五个？" }),
    ).toBeTruthy();
  });

  it("S7 missing actual income keeps a neutral track, no arc and never zero-fills", () => {
    renderHome({
      actualIncomeRecordCount: 0,
      actualIncomeTotal: "0",
      planningIncome: "13000",
      essentialExpenses: "3528",
      mandatoryDebtService: "800",
    });
    const card = structureCard();
    expect(
      within(card).getByRole("heading", { name: "收入：暂未出场。账单：戏份拉满。" }),
    ).toBeTruthy();
    expect(card.querySelector(".v2-ring__arc")).toBeNull();
    expect(card.querySelector(".v2-ring__track.is-outer")).toBeTruthy();
    expect(card.querySelector(".v2-ring-row__percent")).toBeNull();
    // B-02：缺失不补零——中心印「—」，可访问名称只说「收入 —」，数字位不出现 ¥0.00。
    expect(card.querySelector(".v2-ring__centre-amount")?.textContent).toBe("—");
    expect(within(card).getByRole("img", { name: "收入 —" })).toBeTruthy();
    expect(card.querySelector(".v2-card__value")?.textContent).not.toContain("¥0.00");
    // 规划收入不得回填到结构卡中心。
    expect(card.textContent).not.toContain("¥13,000.00");
  });

  it("S8 zero income and zero burden shows the all-zero band without arcs or dots", () => {
    renderHome({
      actualIncomeRecordCount: 0,
      actualIncomeTotal: "0",
      planningIncome: "0",
      essentialExpenses: "0",
      mandatoryDebtService: "0",
    });
    const card = structureCard();
    expect(
      within(card).getByRole("heading", { name: "收入：你不来？账单：那我也不来了。" }),
    ).toBeTruthy();
    expect(card.querySelector(".v2-ring__arc")).toBeNull();
    expect(card.querySelector(".v2-structure-dots")).toBeNull();
    expect(card.querySelector(".v2-ring__centre-amount")?.textContent).toBe("—");
    expect(card.querySelector(".v2-card__value")?.textContent).not.toContain("¥0.00");
  });

  it("S9 pending debt facts show confirmed amounts, mask surplus and mark debt 待确认", () => {
    renderHome({}, { pendingDebtFactNames: ["房贷"] });
    const card = structureCard();
    expect(within(card).getByRole("heading", { name: "资料不齐，花点时间补一下" })).toBeTruthy();
    expect(card.textContent).not.toContain("¥8,672.00");
    expect(within(card).getByRole("img", { name: "结构余量待确认" })).toBeTruthy();
    expect(
      within(card).getByRole("img", { name: "固定支出占收入 27.1%，必须偿还月供 待确认" }),
    ).toBeTruthy();
    expect(card.textContent).toContain("待确认");
    // 已确认的固定支出照常画外环；月供待确认，内环只有中性轨道。
    expect(card.querySelector(".v2-ring__arc.is-outer")).toBeTruthy();
    expect(card.querySelector(".v2-ring__arc.is-inner")).toBeNull();
    expect(within(card).getByRole("button", { name: "查看债务" })).toBeTruthy();
  });

  it("S10 burden over income marks the row only and caps the arc at one turn", () => {
    renderHome({
      actualIncomeTotal: "3000",
      essentialExpenses: "3528",
      mandatoryDebtService: "800",
    });
    const card = structureCard();
    expect(card.querySelectorAll(".v2-ring-row__marker")).toHaveLength(1);
    // §3.4：不在环上叠标记，超额只在明细行金额左侧表达。
    expect(card.querySelector(".v2-ring__over-mark")).toBeNull();
    expect(card.querySelectorAll("svg .v2-ring__over-mark")).toHaveLength(0);
    expect(card.textContent).toContain("已超出 ¥528.00");
    expect(card.textContent).not.toContain("已超出 ¥0.00");
    expect(card.textContent).toContain("占收入 117.6%");
    const outer = card.querySelector<SVGCircleElement>(".v2-ring__arc.is-outer");
    const dash = Number.parseFloat(outer?.getAttribute("stroke-dasharray")?.split(" ")[0] ?? "");
    expect(dash).toBeGreaterThan(653.4);
    expect(dash).toBeLessThan(653.5);
  });

  it("S10b a ratio of exactly 100% shows no over mark", () => {
    renderHome({
      actualIncomeTotal: "3000",
      essentialExpenses: "3000",
      mandatoryDebtService: "0",
    });
    const card = structureCard();
    expect(card.querySelector(".v2-ring__over-mark")).toBeNull();
    expect(card.querySelectorAll(".v2-ring-row__marker")).toHaveLength(0);
    expect(card.querySelector(".v2-ring__arc.is-outer")).toBeTruthy();
    expect(card.textContent).toContain("占收入 100%");
  });

  it("S12 the 2026-10 real-income fixture uses one source and never double counts", () => {
    renderHome({
      actualIncomeRecordCount: 1,
      actualIncomeTotal: "13791.25",
      planningIncome: "13000",
      essentialExpenses: "3528",
      mandatoryDebtService: "14518.73",
    });
    const card = structureCard();
    expect(card.querySelector(".v2-ring__centre-amount")?.textContent).toBe("¥13,791.25");
    const rows = [...card.querySelectorAll(".v2-ring-row")].map((row) => row.textContent ?? "");
    expect(rows[0]).toContain("占收入 25.6%");
    expect(rows[1]).toContain("占收入 105.3%");
    expect(card.textContent).toContain("已超出 ¥727.48");
    expect(card.querySelectorAll(".v2-ring-row__marker")).toHaveLength(1);
    expect(within(card).getByRole("heading", { name: "收入：我一个人打五个？" })).toBeTruthy();
    const value = card.querySelector(".v2-card__value")?.textContent ?? "";
    expect(value).toContain("-¥4,255.48");
    expect(value).toContain("占收入 -30.9%");
    // 反例：同一视图不得把 income_records 与 income_entries 相加（27,582.50），
    // 结构卡也不得回落到规划收入 13,000.00。
    expect(card.textContent).not.toContain("27,582.50");
    expect(card.textContent).not.toContain("13,000.00");
  });

  it("S11 the ring rows toggle selection with pointer and keyboard", async () => {
    const user = userEvent.setup();
    renderHome();
    const card = structureCard();
    const outerRow = card.querySelector<HTMLButtonElement>(".v2-ring-row[data-ring='outer']");
    if (!outerRow) throw new Error("outer row missing");
    expect(outerRow.getAttribute("aria-pressed")).toBe("false");
    await user.click(outerRow);
    expect(outerRow.getAttribute("aria-pressed")).toBe("true");
    expect(card.querySelector(".v2-ring")?.getAttribute("data-selected")).toBe("essential");
    await user.click(outerRow);
    expect(outerRow.getAttribute("aria-pressed")).toBe("false");
    await user.tab();
    outerRow.focus();
    await user.keyboard("{Enter}");
    expect(outerRow.getAttribute("aria-pressed")).toBe("true");
    await user.keyboard(" ");
    expect(outerRow.getAttribute("aria-pressed")).toBe("false");
  });

  it("M1 empty month shows the deterministic daily line and the empty state", () => {
    renderHome({ currentMonthSpending: "0", currentMonthVariableExpenseCount: 0 });
    const card = monthCard();
    const line = pickDailyLine("2026-10-14");
    expect(within(card).getByRole("heading", { name: line })).toBeTruthy();
    expect(card.querySelector(".v2-month-empty svg")?.getAttribute("width")).toBe("40");
    expect(card.querySelector(".v2-month-empty__bar")).toBeTruthy();
    expect(within(card).queryByRole("progressbar")).toBeNull();
    expect(
      within(card).getByRole("button", { name: "记第一笔" }).classList.contains("v2-btn--primary"),
    ).toBe(true);
    expect(pickDailyLine("2026-10-14")).toBe(line);
  });

  it("M2 the next day rotates to the next daily line", () => {
    const line14 = pickDailyLine("2026-10-14");
    const lines: readonly string[] = MONTH_ROTATION_LINES;
    const index = lines.indexOf(line14);
    expect(index).toBeGreaterThanOrEqual(0);
    const next = lines[(index + 1) % lines.length] ?? lines[0];
    expect(pickDailyLine("2026-10-15")).toBe(next);
    expect(next).not.toBe(line14);
    renderHome(
      {
        currentMonthSpending: "0",
        currentMonthVariableExpenseCount: 0,
        asOfDate: "2026-10-15",
      },
      { asOfDate: "2026-10-15" },
    );
    expect(within(monthCard()).getByRole("heading", { name: next })).toBeTruthy();
  });

  it("M3 records with zero spending use the fixed future-record state", () => {
    renderHome({ currentMonthSpending: "0", currentMonthVariableExpenseCount: 2 });
    const card = monthCard();
    expect(within(card).getByRole("heading", { name: "本月还没有已发生的消费。" })).toBeTruthy();
    expect(MONTH_ROTATION_LINES as readonly string[]).not.toContain("本月还没有已发生的消费。");
    expect(within(card).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
    expect(within(card).getByText("剩余 ¥1,600.00")).toBeTruthy();
  });

  it("M4 the five spend bands use their approved copy and tones", () => {
    const cases = [
      ["100", "支付软件：你是不是把我卸了？", null],
      ["700", "钱包：目前还没申请工伤。", null],
      ["1200", "预算：我感觉有人在试探我的底线。", null],
      ["1500", "预算：现在撤回付款还来得及吗？", "v2-progress--warn"],
      ["1700", "预算：我先走一步，剩下你俩聊。", "v2-progress--over"],
    ] as const;
    for (const [spending, title, tone] of cases) {
      cleanup();
      renderHome({ currentMonthSpending: spending, currentMonthVariableExpenseCount: 1 });
      const card = monthCard();
      expect(within(card).getByRole("heading", { name: title })).toBeTruthy();
      const bar = within(card).getByRole("progressbar");
      if (tone != null) expect(bar.classList.contains(tone)).toBe(true);
      if (tone === "v2-progress--over") {
        expect(bar.getAttribute("aria-valuemax")).toBe("120");
        expect(within(card).getByText("已超出 ¥100.00")).toBeTruthy();
      }
    }
  });

  it("M5 target boundaries place 1599 and 1600 in edge and 1600.01 in over", () => {
    const cases = [
      ["1599", "预算：现在撤回付款还来得及吗？", false],
      ["1600", "预算：现在撤回付款还来得及吗？", false],
      ["1600.01", "预算：我先走一步，剩下你俩聊。", true],
    ] as const;
    for (const [spending, title, over] of cases) {
      cleanup();
      renderHome({ currentMonthSpending: spending, currentMonthVariableExpenseCount: 1 });
      const card = monthCard();
      expect(within(card).getByRole("heading", { name: title })).toBeTruthy();
      expect(within(card).getByRole("progressbar").classList.contains("v2-progress--over")).toBe(
        over,
      );
    }
  });

  it("M6 no target shows the target dash without progress or setup copy", () => {
    renderHome({
      desiredMonthlyDiscretionarySpending: null,
      currentMonthSpending: "100",
      currentMonthVariableExpenseCount: 1,
    });
    const card = monthCard();
    expect(within(card).queryByRole("progressbar")).toBeNull();
    expect(within(card).getByText("目标 —")).toBeTruthy();
    expect(within(card).queryByText("尚未设置")).toBeNull();
    expect(within(card).queryByText("定个目标")).toBeNull();
    expect(within(card).getByRole("button", { name: "查看本月记录" })).toBeTruthy();
  });

  it("M7 the default fixture has no legacy danger badge or legacy monthly copy", () => {
    renderHome();
    const card = monthCard();
    expect(document.querySelector(".v2-badge--danger")).toBeNull();
    for (const text of [
      "这个月还没开始记录",
      "这个月的花销还在目标里",
      "这个月已经超过目标",
      "快到目标了",
      "先给这个月定个目标",
      "在财务管理里设置目标",
    ]) {
      expect(within(card).queryByText(text)).toBeNull();
    }
  });
});
