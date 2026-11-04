// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getFinancialMaintenanceRequirement,
  getFinancialMaintenanceState,
  updateFinancialDataAndRecalculate,
} from "../src/application/financial-maintenance-service.js";
import {
  completeOnboarding,
  getExpenseRecordById,
  getHomeApplicationState,
  getOnboardingRequirement,
} from "../src/application/product-service.js";
import {
  listEssentialPaymentItems,
  listEssentialPayments,
  recordEssentialPayment,
  saveEssentialItems,
} from "../src/application/ux-ledger-service.js";
import { V4FoundationService } from "../src/application/v4-foundation-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { App } from "../src/ui/App.js";
import type { ProductApplicationServices } from "../src/ui/contracts.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const AS_OF = "2026-09-10";
const databases: NodeSqliteDatabase[] = [];

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  for (const db of databases.splice(0)) db.close();
});

async function seed(): Promise<NodeSqliteDatabase> {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(`${AS_OF}T04:00:00.000Z`));
  const db = new NodeSqliteDatabase();
  databases.push(db);
  await migrateDatabase(db, `${AS_OF}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [
        { name: "现金", balance: "5000", includeInSafetyResources: true },
        { name: "备用金", balance: "500", includeInSafetyResources: false },
      ],
      assets: [{ name: "基金", currentValue: "1000", includeInSafetyResources: true }],
      debts: [
        {
          name: "房贷",
          currentBalance: "2000",
          currentMonthDue: "500",
          fixedMonthlyPayment: "400",
        },
      ],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "2000",
    },
    "2026-09-01",
  );
  return db;
}

function makeServices(db: NodeSqliteDatabase) {
  const foundation = new V4FoundationService(db);
  return {
    bootstrap: vi.fn().mockResolvedValue({ status: "READY" }),
    getOnboardingRequirement,
    completeOnboarding: vi.fn(),
    getHomeApplicationState: vi.fn((date: string) => getHomeApplicationState(db, date)),
    getExpenseRecordById: vi.fn((id: string) => getExpenseRecordById(db, id)),
    recordExpenseAndRecalculate: vi.fn(),
    recordV2CashExpense: vi.fn(),
    getFinancialMaintenanceState: vi.fn((date: string) => getFinancialMaintenanceState(db, date)),
    getFinancialMaintenanceRequirement: vi.fn(
      (patch: Parameters<typeof getFinancialMaintenanceRequirement>[1], date: string) =>
        getFinancialMaintenanceRequirement(db, patch, date),
    ),
    updateFinancialDataAndRecalculate: vi.fn(
      (patch: Parameters<typeof updateFinancialDataAndRecalculate>[1], date: string) =>
        updateFinancialDataAndRecalculate(db, patch, date),
    ),
    listEssentialPaymentItems: vi.fn((date: string) => listEssentialPaymentItems(db, date)),
    listEssentialPayments: vi.fn((month?: string) => listEssentialPayments(db, month)),
    recordEssentialPayment: vi.fn((input: Parameters<typeof recordEssentialPayment>[1]) =>
      recordEssentialPayment(db, input),
    ),
    saveEssentialItems: vi.fn((items: Parameters<typeof saveEssentialItems>[1], date: string) =>
      saveEssentialItems(db, items, date),
    ),
    deactivateCashAccount: vi.fn((id: string, date: string) =>
      foundation.deactivateCashAccount(id, date),
    ),
    deactivateAsset: vi.fn((id: string, date: string) => foundation.deactivateAsset(id, date)),
    deactivateDebt: vi.fn((id: string, month: string, date: string) =>
      foundation.deactivateDebt(id, month, date),
    ),
  } as unknown as ProductApplicationServices;
}

type User = ReturnType<typeof userEvent.setup>;

async function mount(
  overrides: Record<string, unknown> = {},
  prepare?: (db: NodeSqliteDatabase) => Promise<void>,
): Promise<{ db: NodeSqliteDatabase; user: User }> {
  const db = await seed();
  if (prepare) await prepare(db);
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  render(<App services={{ ...makeServices(db), ...overrides } as never} />);
  await screen.findByTestId("m1-home");
  return { db, user };
}

async function openMoneyTab(user: User) {
  await user.click(screen.getByRole("button", { name: "我的财务" }));
  await screen.findByRole("button", { name: /资料维护/ });
}

describe("S1 B3 T4 maintenance entry and inline deactivation", () => {
  it("reaches the maintenance dialog from 我的财务 and deactivates a cash account there", async () => {
    const { db, user } = await mount();
    await openMoneyTab(user);

    await user.click(screen.getByRole("button", { name: /资料维护/ }));
    const dialog = await screen.findByRole("dialog", { name: "更新财务数据" });
    const cashInput = await within(dialog).findByDisplayValue("现金");
    const row = cashInput.closest(".maintenance-row");
    if (!row) throw new Error("Cash row missing.");

    await user.click(within(row).getByRole("button", { name: "停用" }));
    await user.click(within(row).getByRole("button", { name: "确认停用" }));

    await waitFor(() => expect(within(dialog).queryByDisplayValue("现金")).toBeNull());
    // 基表不动，留痕只追加 lifecycle 修订。
    expect(await db.select("SELECT active FROM cash_accounts WHERE name='现金'")).toEqual([
      { active: 1 },
    ]);
    expect(
      await db.select(
        "SELECT COUNT(*) AS count FROM cash_account_lifecycle_revisions WHERE active=0",
      ),
    ).toEqual([{ count: 1 }]);
  });

  it("drops the deactivated cash account from the deduction dropdown", async () => {
    const { user } = await mount();
    await user.click(screen.getByRole("button", { name: /记一笔/ }));
    const sheet = await screen.findByRole("dialog", { name: "记一笔消费" });
    await user.click(within(sheet).getByLabelText("从账户扣减"));
    expect(within(sheet).getByRole("option", { name: "现金" })).toBeTruthy();
    expect(within(sheet).getByRole("option", { name: "备用金" })).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "关闭" }));

    await openMoneyTab(user);
    await user.click(screen.getByRole("button", { name: /资料维护/ }));
    const dialog = await screen.findByRole("dialog", { name: "更新财务数据" });
    const cashInput = await within(dialog).findByDisplayValue("现金");
    const row = cashInput.closest(".maintenance-row");
    if (!row) throw new Error("Cash row missing.");
    await user.click(within(row).getByRole("button", { name: "停用" }));
    await user.click(within(row).getByRole("button", { name: "确认停用" }));
    await waitFor(() => expect(within(dialog).queryByDisplayValue("现金")).toBeNull());
    await user.click(within(dialog).getByRole("button", { name: "关闭" }));

    await user.click(screen.getByRole("button", { name: "今天" }));
    await user.click(screen.getByRole("button", { name: /记一笔/ }));
    const reopened = await screen.findByRole("dialog", { name: "记一笔消费" });
    await user.click(within(reopened).getByLabelText("从账户扣减"));
    await waitFor(() =>
      expect(within(reopened).queryByRole("option", { name: "现金" })).toBeNull(),
    );
    expect(within(reopened).getByRole("option", { name: "备用金" })).toBeTruthy();
  });

  it("deactivates a fixed-expense item from its list and drops it from the list", async () => {
    const { db, user } = await mount();
    await openMoneyTab(user);
    await user.click(screen.getByRole("button", { name: /^固定支出$/ }));
    const list = await screen.findByRole("region", { name: "固定支出项目" });
    const item = await screen.findByRole("button", { name: /^记一笔 / });
    const itemName = item.getAttribute("aria-label")?.replace("记一笔 ", "") ?? "";
    expect(list).toBeTruthy();

    await user.click(screen.getByRole("button", { name: `停用 ${itemName}` }));
    await user.click(screen.getByRole("button", { name: "确认停用" }));

    await waitFor(() =>
      expect(screen.queryByRole("button", { name: `记一笔 ${itemName}` })).toBeNull(),
    );
    expect(await db.select("SELECT active FROM essential_expense_items")).toEqual([{ active: 0 }]);
    expect(
      await db.select("SELECT COUNT(*) AS count FROM essential_expense_revisions WHERE active=0"),
    ).toEqual([{ count: 1 }]);
  });

  it("shows a readable error and keeps the row when deactivation fails", async () => {
    const { user } = await mount({
      deactivateCashAccount: vi.fn().mockResolvedValue({
        status: "VALIDATION_FAILED",
        code: "INVALID_CASH_LIFECYCLE",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      }),
    });
    await openMoneyTab(user);
    await user.click(screen.getByRole("button", { name: /资料维护/ }));
    const dialog = await screen.findByRole("dialog", { name: "更新财务数据" });
    const cashInput = await within(dialog).findByDisplayValue("现金");
    const row = cashInput.closest(".maintenance-row");
    if (!row) throw new Error("Cash row missing.");

    await user.click(within(row).getByRole("button", { name: "停用" }));
    await user.click(within(row).getByRole("button", { name: "确认停用" }));

    expect((await within(dialog).findByRole("alert")).textContent).toBe(
      "停用未完成，请返回列表核对结果。",
    );
    expect(within(dialog).getByDisplayValue("现金")).toBeTruthy();
  });

  it("drops a deactivated card debt from the deduction dropdown", async () => {
    const { user } = await mount({}, async (db) => {
      const [debt] = await db.select("SELECT id FROM debts");
      if (!debt) throw new Error("Debt fixture missing.");
      await updateFinancialDataAndRecalculate(
        db,
        { debts: [{ id: String(debt.id), dailySpendingMode: true }] },
        AS_OF,
      );
    });
    await user.click(screen.getByRole("button", { name: /记一笔/ }));
    const sheet = await screen.findByRole("dialog", { name: "记一笔消费" });
    await user.click(within(sheet).getByLabelText("从账户扣减"));
    expect(within(sheet).getByRole("option", { name: "房贷（记账卡）" })).toBeTruthy();
    await user.click(within(sheet).getByRole("button", { name: "关闭" }));

    await openMoneyTab(user);
    await user.click(screen.getByRole("button", { name: /资料维护/ }));
    const dialog = await screen.findByRole("dialog", { name: "更新财务数据" });
    const debtInput = await within(dialog).findByDisplayValue("房贷");
    const row = debtInput.closest(".maintenance-row");
    if (!row) throw new Error("Debt row missing.");
    await user.click(within(row).getByRole("button", { name: "停用" }));
    await user.click(within(row).getByRole("button", { name: "确认停用" }));
    await waitFor(() => expect(within(dialog).queryByDisplayValue("房贷")).toBeNull());
    await user.click(within(dialog).getByRole("button", { name: "关闭" }));

    await user.click(screen.getByRole("button", { name: "今天" }));
    await user.click(screen.getByRole("button", { name: /记一笔/ }));
    const reopened = await screen.findByRole("dialog", { name: "记一笔消费" });
    await user.click(within(reopened).getByLabelText("从账户扣减"));
    await waitFor(() =>
      expect(within(reopened).queryByRole("option", { name: "房贷（记账卡）" })).toBeNull(),
    );
    expect(within(reopened).getByRole("option", { name: "现金" })).toBeTruthy();
  });

  it("deactivates from the original values even when the form has unsaved edits", async () => {
    const { db, user } = await mount();
    await openMoneyTab(user);
    await user.click(screen.getByRole("button", { name: /资料维护/ }));
    const dialog = await screen.findByRole("dialog", { name: "更新财务数据" });
    const nameInput = await within(dialog).findByLabelText("项目名称");
    const row = nameInput.closest(".maintenance-row");
    if (!row) throw new Error("Essential row missing.");
    const amountInput = within(row).getByDisplayValue("1000");
    await user.clear(nameInput);
    await user.type(nameInput, "改名后的住房");
    await user.clear(amountInput);
    await user.type(amountInput, "999");

    await user.click(within(row).getByRole("button", { name: "停用" }));
    await user.click(within(row).getByRole("button", { name: "确认停用" }));
    await waitFor(() => expect(within(dialog).queryByDisplayValue("改名后的住房")).toBeNull());

    const [original] = await db.select("SELECT name FROM essential_expense_items");
    expect(
      await db.select(
        "SELECT name,category,monthly_amount,active FROM essential_expense_revisions WHERE active=0",
      ),
    ).toEqual([{ name: original?.name, category: "HOUSING", monthly_amount: "1000", active: 0 }]);
    expect(original?.name).not.toBe("改名后的住房");
  });
});
