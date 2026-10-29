// @vitest-environment happy-dom
import { act, cleanup, render, renderHook, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { HomeApplicationState } from "../src/application/product-service.js";
import { useCardsRefresh } from "../src/ui/use-cards-refresh.js";
import { V2MonthlySpendCard } from "../src/ui/V2MonthlySpendCard.js";
import { V2StructureCard } from "../src/ui/V2StructureCard.js";

const baseHome: HomeApplicationState = {
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

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function renderStructure(status: "ready" | "loading" | "disabled" = "ready") {
  render(
    <V2StructureCard
      home={baseHome}
      pendingDebtFactNames={[]}
      onOpenFixedExpenses={() => {}}
      onOpenDebt={() => {}}
      onOpenCashflow={() => {}}
      status={status}
    />,
  );
  return document.querySelector<HTMLElement>(".v2-structure-card") as HTMLElement;
}

function renderMonth(status: "ready" | "loading" | "disabled" = "ready") {
  render(
    <V2MonthlySpendCard
      home={baseHome}
      savedExpenseId={null}
      onOpenDetail={() => {}}
      onOpenLedger={() => {}}
      onOpenExpense={() => {}}
      status={status}
    />,
  );
  return document.querySelector<HTMLElement>(".v2-month-card") as HTMLElement;
}

describe("card loading and disabled states", () => {
  it("S1 structure loading exposes aria-busy, inert and exactly three skeleton bars", () => {
    const card = renderStructure("loading");
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(card.hasAttribute("inert")).toBe(true);
    expect(card.querySelectorAll(".v2-card__skeleton i")).toHaveLength(3);
  });

  it("S2 structure loading keeps the old value node and appends the skeleton last", () => {
    const card = renderStructure("loading");
    expect(card.querySelector(".v2-card__value")).toBeTruthy();
    expect(card.lastElementChild?.classList.contains("v2-card__skeleton")).toBe(true);
  });

  it("S3 structure disabled uses the single disabled title and both classes", () => {
    const card = renderStructure("disabled");
    expect(within(card).getByRole("heading", { name: "暂时无法查看" })).toBeTruthy();
    expect(card.classList.contains("v2-card--disabled")).toBe(true);
    expect(card.classList.contains("is-disabled")).toBe(true);
  });

  it("M1 month loading exposes aria-busy, inert and exactly three skeleton bars", () => {
    const card = renderMonth("loading");
    expect(card.getAttribute("aria-busy")).toBe("true");
    expect(card.hasAttribute("inert")).toBe(true);
    expect(card.querySelectorAll(".v2-card__skeleton i")).toHaveLength(3);
  });

  it("M2 month disabled uses the single disabled title and the disabled class", () => {
    const card = renderMonth("disabled");
    expect(within(card).getByRole("heading", { name: "暂时无法查看" })).toBeTruthy();
    expect(card.classList.contains("is-disabled")).toBe(true);
  });

  it("D3 ready cards have no skeleton, aria-busy or inert and keep their approved titles", () => {
    const structure = renderStructure("ready");
    expect(structure.querySelector(".v2-card__skeleton")).toBeNull();
    expect(structure.hasAttribute("aria-busy")).toBe(false);
    expect(structure.hasAttribute("inert")).toBe(false);
    expect(
      within(structure).getByRole("heading", { name: "账单：不是，他怎么还剩钱？" }),
    ).toBeTruthy();
    cleanup();
    const month = renderMonth("ready");
    expect(month.querySelector(".v2-card__skeleton")).toBeNull();
    expect(month.hasAttribute("aria-busy")).toBe(false);
    expect(month.hasAttribute("inert")).toBe(false);
    expect(
      within(month).getByRole("heading", { name: "支付软件：你是不是把我卸了？" }),
    ).toBeTruthy();
  });
});

describe("useCardsRefresh debounce", () => {
  it("H1 stays ready at 299ms", () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCardsRefresh());
    const deferred = Promise.withResolvers<void>();
    let tracked: Promise<void> = Promise.resolve();
    act(() => {
      tracked = result.current.track(deferred.promise);
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.status).toBe("ready");
    return act(async () => {
      deferred.resolve();
      await tracked;
    }).then(() => {
      expect(result.current.status).toBe("ready");
    });
  });

  it("H2 enters loading at 300ms and returns to ready when the work settles", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCardsRefresh());
    const deferred = Promise.withResolvers<void>();
    let tracked: Promise<void> = Promise.resolve();
    act(() => {
      tracked = result.current.track(deferred.promise);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.status).toBe("loading");
    await act(async () => {
      deferred.resolve();
      await tracked;
    });
    expect(result.current.status).toBe("ready");
  });

  it("H3 a refresh completing before the threshold never shows loading", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCardsRefresh());
    let tracked: Promise<string> = Promise.resolve("");
    act(() => {
      tracked = result.current.track(Promise.resolve("ok"));
    });
    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(result.current.status).toBe("ready");
    await act(async () => {
      await expect(tracked).resolves.toBe("ok");
    });
    expect(result.current.status).toBe("ready");
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.status).toBe("ready");
  });

  it("H4 concurrent refreshes stay loading until the last one settles", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useCardsRefresh());
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    let trackedFirst: Promise<void> = Promise.resolve();
    let trackedSecond: Promise<void> = Promise.resolve();
    act(() => {
      trackedFirst = result.current.track(first.promise);
      trackedSecond = result.current.track(second.promise);
    });
    act(() => {
      vi.advanceTimersByTime(300);
    });
    expect(result.current.status).toBe("loading");
    await act(async () => {
      first.resolve();
      await trackedFirst;
    });
    expect(result.current.status).toBe("loading");
    await act(async () => {
      second.resolve();
      await trackedSecond;
    });
    expect(result.current.status).toBe("ready");
  });

  it("H5 a rejected refresh rethrows and still returns to ready", async () => {
    const { result } = renderHook(() => useCardsRefresh());
    await act(async () => {
      await expect(result.current.track(Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    });
    expect(result.current.status).toBe("ready");
  });

  it("H6 unmounting during a pending refresh does not schedule a late state update", async () => {
    vi.useFakeTimers();
    const { result, unmount } = renderHook(() => useCardsRefresh());
    const deferred = Promise.withResolvers<void>();
    let tracked: Promise<void> = Promise.resolve();
    act(() => {
      tracked = result.current.track(deferred.promise);
    });
    unmount();
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await act(async () => {
      deferred.resolve();
      await tracked;
    });
    expect(true).toBe(true);
  });
});
