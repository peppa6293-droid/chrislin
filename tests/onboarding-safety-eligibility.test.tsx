// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFinancialMaintenanceState } from "../src/application/financial-maintenance-service.js";
import {
  completeOnboarding,
  getHomeApplicationState,
  getOnboardingRequirement,
  type OnboardingSubmission,
} from "../src/application/product-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { App } from "../src/ui/App.js";
import type { ProductApplicationServices } from "../src/ui/contracts.js";
import { Onboarding } from "../src/ui/Onboarding.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function basicOnboarding() {
  const onComplete = vi.fn().mockResolvedValue(undefined);
  const getRequirement = vi.fn().mockReturnValue({ requiresSafetyRecoveryHorizon: false });
  render(<Onboarding onComplete={onComplete} getRequirement={getRequirement} />);
  return { onComplete, getRequirement };
}

async function reachStorageStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText("每月稳定收入（元）"), "1");
  await user.click(screen.getByRole("button", { name: /继续/ }));
  await user.click(screen.getByRole("button", { name: /继续/ }));
  await screen.findByRole("heading", { name: "你现在有多少现金？" });
}

describe("onboarding safety-resource tri-state", () => {
  it.each([{ choice: "yes" }, { choice: "no" }] as const)(
    "accepts explicit cash choice $choice",
    async ({ choice }) => {
      const user = userEvent.setup();
      basicOnboarding();
      await reachStorageStep(user);
      await user.type(screen.getByLabelText("账户名称"), "Cash");
      await user.type(screen.getByLabelText("当前余额"), "100");
      await user.selectOptions(screen.getByLabelText("可用于安全储备"), choice);
      expect((screen.getByLabelText("可用于安全储备") as HTMLSelectElement).value).toBe(choice);
      await user.click(screen.getByRole("button", { name: /继续/ }));
      expect(await screen.findByRole("heading", { name: "设定适合你的安全目标" })).toBeTruthy();
    },
  );

  it("rejects an unselected cash choice instead of converting it to false", async () => {
    const user = userEvent.setup();
    const { onComplete, getRequirement } = basicOnboarding();
    await reachStorageStep(user);
    await user.type(screen.getByLabelText("账户名称"), "Cash");
    await user.type(screen.getByLabelText("当前余额"), "100");
    expect((screen.getByLabelText("可用于安全储备") as HTMLSelectElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: /继续/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "你现在有多少现金？" })).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(getRequirement).not.toHaveBeenCalled();
  });

  it.each(["-1", "abc", "100.123", "1,000", ""])(
    "UI blocks invalid income %j before any service call",
    async (income) => {
      const user = userEvent.setup();
      const { onComplete, getRequirement } = basicOnboarding();
      if (income) await user.type(screen.getByLabelText("每月稳定收入（元）"), income);
      await user.click(screen.getByRole("button", { name: /继续/ }));
      expect(await screen.findByRole("alert")).toBeTruthy();
      expect(screen.getByLabelText("每月稳定收入（元）")).toBeTruthy();
      expect(onComplete).not.toHaveBeenCalled();
      expect(getRequirement).not.toHaveBeenCalled();
    },
  );

  it("M1: four groups only, no asset or debt entry; real service persists and reads back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-04T04:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const db = new NodeSqliteDatabase();
    await migrateDatabase(db, "2026-10-04T00:00:00.000Z");
    const complete = vi.fn((submission: OnboardingSubmission, date: string) =>
      completeOnboarding(db, submission, date),
    );
    const appServices: ProductApplicationServices = {
      bootstrap: vi.fn().mockResolvedValue({ status: "INITIALIZATION_REQUIRED" }),
      getOnboardingRequirement,
      completeOnboarding: complete,
      getHomeApplicationState: (date) => getHomeApplicationState(db, date),
      recordExpenseAndRecalculate: vi.fn(),
      getFinancialMaintenanceState: (date) => getFinancialMaintenanceState(db, date),
      getFinancialMaintenanceRequirement: vi.fn(),
      updateFinancialDataAndRecalculate: vi.fn(),
    };
    try {
      render(<App services={appServices} />);
      await screen.findByLabelText("每月稳定收入（元）");
      await user.type(screen.getByLabelText("每月稳定收入（元）"), "13000");
      await user.click(screen.getByRole("button", { name: /继续/ }));
      await user.type(screen.getByLabelText(/住房/), "1900");
      await user.type(screen.getByLabelText(/交通通勤/), "1028");
      await user.type(screen.getByLabelText(/水电与通讯/), "600");
      await user.click(screen.getByRole("button", { name: /继续/ }));
      await screen.findByRole("heading", { name: "你现在有多少现金？" });
      expect(screen.queryByText("流动投资资产")).toBeNull();
      expect(screen.queryByRole("heading", { name: "债务" })).toBeNull();
      expect(screen.queryByLabelText("债务名称")).toBeNull();

      await user.type(screen.getByLabelText("账户名称"), "现金");
      await user.type(screen.getByLabelText("当前余额"), "20000");
      await user.selectOptions(screen.getByLabelText("可用于安全储备"), "yes");
      await user.click(screen.getByRole("button", { name: /继续/ }));
      const targetGroup = screen.getByRole("group", { name: "安全覆盖目标（月）" });
      const floorGroup = screen.getByRole("group", { name: "最低现金覆盖（月）" });
      await user.click(within(targetGroup).getByRole("button", { name: "3 个月" }));
      await user.click(within(floorGroup).getByRole("button", { name: "2 个月" }));
      await user.type(screen.getByLabelText(/期望每月弹性消费/), "1600");
      await user.click(screen.getByRole("button", { name: /完成设置/ }));

      await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
      await screen.findByRole("button", { name: /记一笔/ });
      const [submitted, asOfDate] = complete.mock.calls[0] ?? [];
      expect(asOfDate).toBe("2026-10-04");
      expect(submitted?.assets).toEqual([]);
      expect(submitted?.debts).toEqual([]);
      expect(submitted?.cashAccounts).toEqual([
        { name: "现金", balance: "20000", includeInSafetyResources: true },
      ]);

      expect(await db.select("SELECT amount FROM income_records")).toEqual([{ amount: "13000" }]);
      expect(await db.select("SELECT count(*) AS n FROM assets")).toEqual([{ n: 0 }]);
      expect(await db.select("SELECT count(*) AS n FROM debts")).toEqual([{ n: 0 }]);
      expect(await db.select("SELECT balance FROM cash_balance_snapshots")).toEqual([
        { balance: "20000" },
      ]);
      const home = await getHomeApplicationState(db, "2026-10-04");
      expect(home).toMatchObject({
        currentCash: "20000",
        totalDebt: "0",
        liquidAssets: "0",
        planningIncome: "13000",
        essentialExpenses: "3528",
        desiredMonthlyDiscretionarySpending: "1600",
        safetyCoverageTargetMonths: 3,
        minimumCashCoverageMonths: 2,
      });
    } finally {
      db.close();
    }
  }, 15_000);
});
