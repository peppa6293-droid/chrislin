// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getFinancialMaintenanceState } from "../src/application/financial-maintenance-service.js";
import {
  completeOnboarding,
  getExpenseRecordById,
  getHomeApplicationState,
  getOnboardingRequirement,
} from "../src/application/product-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import {
  ensureV2LedgerDefaults,
  recordV2CashExpenseForDatabase,
} from "../src/runtime/tauri-bootstrap.js";
import { App } from "../src/ui/App.js";
import type { ProductApplicationServices } from "../src/ui/contracts.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

async function realApp() {
  const db = new NodeSqliteDatabase();
  await migrateDatabase(db, "2026-10-30T00:00:00.000Z");
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "4000" }],
      cashAccounts: [{ name: "现金", balance: "30000", includeInSafetyResources: true }],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: 6,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "2000",
    },
    "2026-10-30",
  );
  await ensureV2LedgerDefaults(db);
  const services = {
    bootstrap: vi.fn().mockResolvedValue({ status: "READY" }),
    getOnboardingRequirement,
    completeOnboarding: vi.fn(),
    getHomeApplicationState: (d: string) => getHomeApplicationState(db, d),
    getExpenseRecordById: (id: string) => getExpenseRecordById(db, id),
    recordExpenseAndRecalculate: vi.fn(),
    recordV2CashExpense: (s: Parameters<typeof recordV2CashExpenseForDatabase>[1], d: string) =>
      recordV2CashExpenseForDatabase(db, s, d),
    getFinancialMaintenanceState: (d: string) => getFinancialMaintenanceState(db, d),
    getFinancialMaintenanceRequirement: vi.fn(),
    updateFinancialDataAndRecalculate: vi.fn(),
  } as unknown as ProductApplicationServices;
  return { db, services };
}

describe("M1 expense sheet wired to the real service and an in-memory database", () => {
  it.each([
    ["吃饭", "餐饮"],
    ["出行", "交通"],
    ["买东西", "购物"],
    ["娱乐", "娱乐"],
    ["日用", "家居"],
    ["其他", "其他"],
  ])(
    "choosing %s stores the category %s",
    async (label, stored) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-30T04:00:00.000Z"));
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      const { db, services } = await realApp();
      try {
        render(<App services={services} />);
        await user.click(await screen.findByRole("button", { name: /记一笔/ }));
        await user.type(screen.getByLabelText(/消费金额/), "12.30");
        await user.click(screen.getByRole("button", { name: label }));
        await user.click(screen.getByRole("button", { name: "保存消费" }));
        await waitFor(async () =>
          expect(await db.select("SELECT id FROM expenses")).toHaveLength(1),
        );
        const rows = await db.select<{ name: string; amount: string }>(
          "SELECT c.name, e.amount FROM expenses e JOIN expense_categories c ON c.id=e.category_id",
        );
        expect(rows).toEqual([{ name: stored, amount: "12.30" }]);
      } finally {
        db.close();
      }
    },
    20_000,
  );

  it("no category chosen stores 其他", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-30T04:00:00.000Z"));
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const { db, services } = await realApp();
    try {
      render(<App services={services} />);
      await user.click(await screen.findByRole("button", { name: /记一笔/ }));
      await user.type(screen.getByLabelText(/消费金额/), "8.8");
      await user.click(screen.getByRole("button", { name: "保存消费" }));
      await waitFor(async () => expect(await db.select("SELECT id FROM expenses")).toHaveLength(1));
      const rows = await db.select<{ name: string }>(
        "SELECT c.name FROM expenses e JOIN expense_categories c ON c.id=e.category_id",
      );
      expect(rows).toEqual([{ name: "其他" }]);
    } finally {
      db.close();
    }
  }, 20_000);
});
