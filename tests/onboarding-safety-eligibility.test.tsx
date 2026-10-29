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
  await screen.findByRole("heading", { name: "你现在有哪些储备？" });
}

function entryGroup(name: string) {
  const heading = screen.getByRole("heading", { name });
  const group = heading.closest(".entry-group");
  if (!(group instanceof HTMLElement)) throw new Error(`Missing entry group: ${name}`);
  return within(group);
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
    expect(screen.getByRole("heading", { name: "你现在有哪些储备？" })).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
    expect(getRequirement).not.toHaveBeenCalled();
  });

  it.each([{ choice: "yes" }, { choice: "no" }] as const)(
    "accepts explicit asset choice $choice",
    async ({ choice }) => {
      const user = userEvent.setup();
      basicOnboarding();
      await reachStorageStep(user);
      await user.type(screen.getByLabelText("账户名称"), "Cash");
      await user.type(screen.getByLabelText("当前余额"), "100");
      await user.selectOptions(screen.getByLabelText("可用于安全储备"), "yes");
      const assetGroup = entryGroup("流动投资资产");
      await user.click(assetGroup.getByRole("button", { name: /添加/ }));
      await user.type(screen.getByLabelText("资产名称"), "Fund");
      await user.type(screen.getByLabelText("当前金额"), "50");
      await user.selectOptions(screen.getByLabelText("纳入安全储备"), choice);
      expect((screen.getByLabelText("纳入安全储备") as HTMLSelectElement).value).toBe(choice);
      await user.click(screen.getByRole("button", { name: /继续/ }));
      expect(await screen.findByRole("heading", { name: "设定适合你的安全目标" })).toBeTruthy();
    },
  );

  it("rejects an unselected asset choice", async () => {
    const user = userEvent.setup();
    const { onComplete } = basicOnboarding();
    await reachStorageStep(user);
    await user.type(screen.getByLabelText("账户名称"), "Cash");
    await user.type(screen.getByLabelText("当前余额"), "100");
    await user.selectOptions(screen.getByLabelText("可用于安全储备"), "yes");
    const assetGroup = entryGroup("流动投资资产");
    await user.click(assetGroup.getByRole("button", { name: /添加/ }));
    await user.type(screen.getByLabelText("资产名称"), "Fund");
    await user.type(screen.getByLabelText("当前金额"), "50");
    expect((screen.getByLabelText("纳入安全储备") as HTMLSelectElement).value).toBe("");
    await user.click(screen.getByRole("button", { name: /继续/ }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "你现在有哪些储备？" })).toBeTruthy();
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("passes the mixed approved candidate through React and the real Application Service in an isolated in-memory DB", async () => {
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
      await screen.findByRole("heading", { name: "你现在有哪些储备？" });

      const cashRows = [
        ["余额宝", "4805.61", "yes"],
        ["农业银行", "0", "yes"],
        ["上海银行", "0", "yes"],
        ["房租专用资金", "3800", "no"],
      ] as const;
      const cashGroup = entryGroup("现金账户");
      for (let i = 1; i < cashRows.length; i += 1)
        await user.click(cashGroup.getByRole("button", { name: /添加/ }));
      const cashNames = cashGroup.getAllByLabelText("账户名称");
      const cashBalances = cashGroup.getAllByLabelText("当前余额");
      const cashEligibility = cashGroup.getAllByLabelText("可用于安全储备");
      for (const [index, [name, balance, eligibility]] of cashRows.entries()) {
        const nameInput = cashNames[index];
        const balanceInput = cashBalances[index];
        const eligibilityInput = cashEligibility[index];
        if (!nameInput || !balanceInput || !eligibilityInput) throw new Error("Cash row missing.");
        await user.type(nameInput, name);
        await user.type(balanceInput, balance);
        await user.selectOptions(eligibilityInput, eligibility);
      }

      const assetRows = [
        ["支付宝基金", "3842", "yes"],
        ["短期理财 1", "10000", "no"],
        ["短期理财 2", "7000", "no"],
        ["短期理财 3", "3000", "no"],
      ] as const;
      const assetGroup = entryGroup("流动投资资产");
      for (let i = 0; i < assetRows.length; i += 1)
        await user.click(assetGroup.getByRole("button", { name: /添加/ }));
      const assetNames = assetGroup.getAllByLabelText("资产名称");
      const assetValues = assetGroup.getAllByLabelText("当前金额");
      const assetEligibility = assetGroup.getAllByLabelText("纳入安全储备");
      for (const [index, [name, value, eligibility]] of assetRows.entries()) {
        const nameInput = assetNames[index];
        const valueInput = assetValues[index];
        const eligibilityInput = assetEligibility[index];
        if (!nameInput || !valueInput || !eligibilityInput) throw new Error("Asset row missing.");
        await user.type(nameInput, name);
        await user.type(valueInput, value);
        await user.selectOptions(eligibilityInput, eligibility);
      }

      const debtRows = [
        ["招商分期", "46605.10", "5679.47", ""],
        ["浦发车贷", "118137.60", "3487.87", "3487.87"],
        ["花呗", "5306.76", "4362.56", ""],
        ["京东白条", "2198.70", "657.46", ""],
        ["美团月付", "331.37", "331.37", ""],
      ] as const;
      const debtGroup = entryGroup("债务");
      for (let i = 0; i < debtRows.length; i += 1)
        await user.click(debtGroup.getByRole("button", { name: /添加/ }));
      const debtNames = debtGroup.getAllByLabelText("债务名称");
      const debtBalances = debtGroup.getAllByLabelText("当前余额");
      const debtDues = debtGroup.getAllByLabelText("本月应还（选填）");
      const debtPayments = debtGroup.getAllByLabelText("固定月供（选填）");
      for (const [index, [name, balance, due, fixed]] of debtRows.entries()) {
        const nameInput = debtNames[index];
        const balanceInput = debtBalances[index];
        const dueInput = debtDues[index];
        const fixedInput = debtPayments[index];
        if (!nameInput || !balanceInput || !dueInput || !fixedInput)
          throw new Error("Debt row missing.");
        await user.type(nameInput, name);
        await user.type(balanceInput, balance);
        await user.type(dueInput, due);
        if (fixed) await user.type(fixedInput, fixed);
      }
      await user.click(screen.getByRole("button", { name: /继续/ }));
      await user.click(screen.getByRole("button", { name: "6 个月" }));
      await user.click(screen.getByRole("button", { name: "2 个月" }));
      await user.type(screen.getByLabelText(/期望每月弹性消费/), "1600");
      await user.click(screen.getByRole("button", { name: /完成设置/ }));

      await waitFor(() => expect(complete).toHaveBeenCalledTimes(1));
      await screen.findByRole("button", { name: /记一笔/ });
      const [submitted, asOfDate] = complete.mock.calls[0] ?? [];
      expect(asOfDate).toBe("2026-10-04");
      expect(submitted?.cashAccounts.map((row) => row.includeInSafetyResources)).toEqual([
        true,
        true,
        true,
        false,
      ]);
      expect(submitted?.assets.map((row) => row.includeInSafetyResources)).toEqual([
        true,
        false,
        false,
        false,
      ]);
      expect(submitted?.safetyRecoveryHorizonMonths).toBeUndefined();

      const persisted = await getFinancialMaintenanceState(db, "2026-10-04");
      expect(
        Object.fromEntries(
          persisted.cashAccounts.map((row) => [row.name, row.includeInSafetyResources]),
        ),
      ).toEqual({
        余额宝: true,
        农业银行: true,
        上海银行: true,
        房租专用资金: false,
      });
      expect(
        Object.fromEntries(persisted.assets.map((row) => [row.name, row.includeInSafetyResources])),
      ).toEqual({
        支付宝基金: true,
        "短期理财 1": false,
        "短期理财 2": false,
        "短期理财 3": false,
      });
      expect(persisted.debts.map((row) => row.name).sort()).toEqual(
        ["招商分期", "浦发车贷", "花呗", "京东白条", "美团月付"].sort(),
      );
      expect(persisted.assets.slice(1).map((row) => row.kind)).toEqual([
        "LIQUID_INVESTMENT",
        "LIQUID_INVESTMENT",
        "LIQUID_INVESTMENT",
      ]);
    } finally {
      db.close();
    }
  }, 15_000);
});
