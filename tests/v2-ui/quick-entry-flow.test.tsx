// @vitest-environment happy-dom
import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V2ExpenseService } from "../../src/application/v2-expense-service.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import {
  quickEntryErrorMessage,
  V2QuickEntry,
  validateQuickEntryDraft,
} from "../../src/ui/v2-quick-entry.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

let db: NodeSqliteDatabase;
let repositories: Repositories;
let expenseService: V2ExpenseService;

beforeEach(async () => {
  db = new NodeSqliteDatabase();
  repositories = new Repositories(db);
  expenseService = new V2ExpenseService(repositories);
  await migrateDatabase(db, "2026-10-20T00:00:00.000Z");
  await repositories.createProfile({ id: "profile-v2", displayName: "V2 UI" });
  await repositories.createAccount({
    id: "cash-1",
    profileId: "profile-v2",
    name: "现金",
    type: "CASH",
    currency: "CNY",
  });
  await repositories.createAccount({
    id: "credit-1",
    profileId: "profile-v2",
    name: "信用卡",
    type: "CREDIT_CARD",
    currency: "CNY",
  });
  await repositories.createExpenseCategory({
    id: "cat-food",
    profileId: "profile-v2",
    name: "餐饮",
    icon: "Utensils",
    color: "#E07A5F",
    monthlyBudget: null,
    overspendingAlert: false,
    savingsRelated: false,
    adjustable: true,
    builtin: true,
  });
  await repositories.createExpenseCategory({
    id: "cat-transport",
    profileId: "profile-v2",
    name: "交通",
    icon: "Train",
    color: "#5272D8",
    monthlyBudget: null,
    overspendingAlert: false,
    savingsRelated: false,
    adjustable: true,
    builtin: false,
  });
  await repositories.createExpenseCategory({
    id: "cat-disabled",
    profileId: "profile-v2",
    name: "停用分类",
    icon: "Ban",
    color: "#66717D",
    monthlyBudget: null,
    overspendingAlert: false,
    savingsRelated: false,
    adjustable: true,
    builtin: false,
    active: false,
  });
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

afterEach(() => {
  db.close();
});

function renderComponent(
  overrides: { expenseService?: V2ExpenseService; onRecorded?: ReturnType<typeof vi.fn> } = {},
) {
  const onRecorded = overrides.onRecorded ?? vi.fn();
  render(
    <V2QuickEntry
      expenseService={overrides.expenseService ?? expenseService}
      repositories={repositories}
      profileId="profile-v2"
      onRecorded={onRecorded}
    />,
  );
  return { onRecorded };
}

async function fillAndSubmit(
  user: ReturnType<typeof userEvent.setup>,
  amount: string,
  options: { description?: string } = {},
) {
  await waitFor(() => expect(screen.getByRole("button", { name: "记一笔" }).disabled).toBe(false));
  const amountInput = screen.getByLabelText("金额");
  await user.clear(amountInput);
  if (amount) await user.type(amountInput, amount);
  if (options.description !== undefined) {
    await user.clear(screen.getByLabelText("备注"));
    await user.type(screen.getByLabelText("备注"), options.description);
  }
  await user.click(screen.getByRole("button", { name: "记一笔" }));
}

describe("EXEC-U-01 isolated V2 quick entry flow", () => {
  it("focuses the amount input after render", async () => {
    renderComponent();
    await screen.findByRole("button", { name: "记一笔" });
    expect(document.activeElement).toBe(screen.getByLabelText("金额"));
  });

  it("loads active categories and only active CASH accounts from the repositories", async () => {
    renderComponent();
    const categoryGroup = await screen.findByRole("radiogroup", { name: "支出类别" });
    expect(within(categoryGroup).getByRole("radio", { name: /餐饮/ })).toBeTruthy();
    expect(within(categoryGroup).getByRole("radio", { name: /交通/ })).toBeTruthy();
    expect(within(categoryGroup).queryByRole("radio", { name: /停用分类/ })).toBeNull();
    expect(within(categoryGroup).getAllByRole("radio")).toHaveLength(2);
    const accountSelect = screen.getByLabelText("账户") as HTMLSelectElement;
    expect(Array.from(accountSelect.options).map((option) => option.value)).toEqual(["cash-1"]);
    expect(accountSelect.value).toBe("cash-1");
  });

  it("blocks empty amounts and writes nothing", async () => {
    const user = userEvent.setup();
    renderComponent();
    await fillAndSubmit(user, "");
    expect((await screen.findByRole("alert")).textContent).toContain("请输入金额");
    expect(await repositories.listV2Expenses("profile-v2")).toEqual([]);
  });

  it("shows exact Chinese messages for zero, negative, oversized, and malformed amounts", async () => {
    const user = userEvent.setup();
    renderComponent();
    const cases = [
      ["0", "金额不能为零"],
      ["0.00", "金额不能为零"],
      ["-1", "金额不能为负数"],
      ["1000000000000.00", "金额超出范围"],
      ["abc", "金额格式不正确（最多两位小数）"],
      ["1.234", "金额格式不正确（最多两位小数）"],
    ] as const;
    for (const [amount, message] of cases) {
      await fillAndSubmit(user, amount);
      expect((await screen.findByRole("alert")).textContent).toContain(message);
    }
    expect(await repositories.listV2Expenses("profile-v2")).toEqual([]);
  });

  it("records a valid cash debit and reads back the exact stored fields", async () => {
    const user = userEvent.setup();
    const { onRecorded } = renderComponent();
    await fillAndSubmit(user, "18.50", { description: "  合成午餐  " });
    await waitFor(() => expect(onRecorded).toHaveBeenCalledTimes(1));
    const expenses = await repositories.listV2Expenses("profile-v2");
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      amount: "18.50",
      categoryId: "cat-food",
      accountId: "cash-1",
      description: "合成午餐",
      kind: "CASH_DEBIT",
    });
  });

  it("clears amount and note, shows success, and calls onRecorded once", async () => {
    const user = userEvent.setup();
    const onRecorded = vi.fn();
    const spy = vi.spyOn(expenseService, "recordCashDebitExpense").mockResolvedValue({
      expense: {
        id: "success-id",
        profileId: "profile-v2",
        kind: "CASH_DEBIT" as const,
        amount: "35.00",
        currency: "CNY",
        occurredOn: "2026-10-20",
        categoryId: "cat-food",
        description: "测试",
        accountId: "cash-1",
      },
      reconciliation: {
        expenseId: "success-id",
        spendingRecognition: "35.00",
        cashReduction: "35.00",
        countsAsDailyExpense: true as const,
      },
    });
    renderComponent({ onRecorded });
    await fillAndSubmit(user, "35.00", { description: "测试" });
    expect((await screen.findByRole("status")).textContent).toContain("✓ 已记入本月消费");
    expect(screen.queryByRole("alert")).toBeNull();
    expect((screen.getByLabelText("金额") as HTMLInputElement).value).toBe("");
    expect((screen.getByLabelText("备注") as HTMLInputElement).value).toBe("");
    expect(onRecorded).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByRole("status")).toBeNull(), { timeout: 3000 });
  });

  it("preserves all inputs and hides success when the service rejects", async () => {
    const user = userEvent.setup();
    const failingService = new V2ExpenseService(repositories);
    const spy = vi
      .spyOn(failingService, "recordCashDebitExpense")
      .mockRejectedValue(new Error("service failure"));
    renderComponent({ expenseService: failingService });
    await fillAndSubmit(user, "42.00", { description: "失败输入" });
    expect((await screen.findByRole("alert")).textContent).toContain("保存失败，请重试");
    expect(screen.queryByRole("status")).toBeNull();
    expect((screen.getByLabelText("金额") as HTMLInputElement).value).toBe("42.00");
    expect((screen.getByLabelText("备注") as HTMLInputElement).value).toBe("失败输入");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await repositories.listV2Expenses("profile-v2")).toEqual([]);
  });

  it("renders empty states and disables submit without categories or accounts", async () => {
    await db.execute("DELETE FROM expense_categories");
    renderComponent();
    expect(await screen.findByText("暂无可用类别")).toBeTruthy();
    const submit = screen.getByRole("button", { name: "记一笔" });
    expect(submit.disabled).toBe(true);

    await db.execute("DELETE FROM expense_categories");
    await db.execute("DELETE FROM accounts");
    cleanup();
    renderComponent();
    expect(await screen.findByText("暂无可用类别")).toBeTruthy();
    expect(screen.getAllByText("暂无现金账户").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "记一笔" }).disabled).toBe(true);
  });

  it("covers validateQuickEntryDraft boundary values in the required order", () => {
    const valid = validateQuickEntryDraft({
      amount: "12.50",
      categoryId: "cat",
      accountId: "account",
      occurredOn: "2026-10-20",
    });
    expect(valid).toEqual({ ok: true, amount: "12.50" });
    const cases = [
      [
        { amount: "0", categoryId: "cat", accountId: "account", occurredOn: "2026-10-20" },
        "AMOUNT_ZERO",
      ],
      [
        { amount: "0.00", categoryId: "cat", accountId: "account", occurredOn: "2026-10-20" },
        "AMOUNT_ZERO",
      ],
      [
        { amount: "-1", categoryId: "cat", accountId: "account", occurredOn: "2026-10-20" },
        "AMOUNT_NEGATIVE",
      ],
      [
        {
          amount: "999999999999.99",
          categoryId: "cat",
          accountId: "account",
          occurredOn: "2026-10-20",
        },
        { ok: true, amount: "999999999999.99" },
      ],
      [
        {
          amount: "1000000000000.00",
          categoryId: "cat",
          accountId: "account",
          occurredOn: "2026-10-20",
        },
        "AMOUNT_TOO_LARGE",
      ],
      [
        { amount: "05", categoryId: "cat", accountId: "account", occurredOn: "2026-10-20" },
        "AMOUNT_INVALID",
      ],
      [
        { amount: ".5", categoryId: "cat", accountId: "account", occurredOn: "2026-10-20" },
        "AMOUNT_INVALID",
      ],
    ] as const;
    for (const [draft, expected] of cases) {
      expect(validateQuickEntryDraft(draft)).toEqual(
        typeof expected === "string" ? { ok: false, reason: expected } : expected,
      );
    }
    expect(quickEntryErrorMessage("AMOUNT_INVALID")).toBe("金额格式不正确（最多两位小数）");
  });

  it("refocuses the amount input when focusSignal changes", async () => {
    function FocusHarness({ signal }: { signal: number }) {
      return (
        <V2QuickEntry
          expenseService={expenseService}
          repositories={repositories}
          profileId="profile-v2"
          focusSignal={signal}
        />
      );
    }
    const { rerender } = render(<FocusHarness signal={0} />);
    const amount = screen.getByLabelText("金额");
    expect(document.activeElement).toBe(amount);
    const note = screen.getByLabelText("备注");
    await act(async () => {
      note.focus();
    });
    expect(document.activeElement).not.toBe(amount);
    await act(async () => {
      rerender(<FocusHarness signal={1} />);
    });
    await waitFor(() => expect(document.activeElement).toBe(amount));
    await act(async () => {
      rerender(<FocusHarness signal={2} />);
    });
    await waitFor(() => expect(document.activeElement).toBe(amount));
  });

  it("submits only once when the save button is clicked repeatedly while pending", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi.spyOn(expenseService, "recordCashDebitExpense").mockReturnValue(
      pending.then(() => ({
        expense: {
          id: "pending",
          profileId: "profile-v2",
          kind: "CASH_DEBIT" as const,
          amount: "20.00",
          currency: "CNY",
          occurredOn: "2026-10-20",
          categoryId: "cat-food",
          description: "",
          accountId: "cash-1",
        },
        reconciliation: {
          expenseId: "pending",
          spendingRecognition: "20.00",
          cashReduction: "20.00",
          countsAsDailyExpense: true as const,
        },
      })),
    );
    renderComponent();
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "记一笔" }).disabled).toBe(false),
    );
    const amountInput = screen.getByLabelText("金额");
    await user.type(amountInput, "20.00");
    const submit = screen.getByRole("button", { name: "记一笔" });
    await user.click(submit);
    expect(submit.disabled).toBe(true);
    await act(async () => {
      fireEventClick(submit);
      fireEventClick(submit);
    });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(submit.disabled).toBe(false));
  });

  it("clears stale success feedback while a follow-up submit is pending", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(expenseService, "recordCashDebitExpense")
      .mockResolvedValueOnce(confirmedReceipt("10.00"))
      .mockReturnValueOnce(pending.then(() => confirmedReceipt("20.00")));
    renderComponent();
    await fillAndSubmit(user, "10.00");
    expect((await screen.findByRole("status")).textContent).toContain("已记入本月消费");
    await fillAndSubmit(user, "20.00");
    expect(screen.queryByRole("status")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
    await act(async () => {
      release();
    });
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("已记入本月消费"));
  });

  it("keeps the draft and saves on retry after a failure", async () => {
    const user = userEvent.setup();
    const spy = vi
      .spyOn(expenseService, "recordCashDebitExpense")
      .mockRejectedValueOnce(new Error("synthetic"))
      .mockResolvedValueOnce(confirmedReceipt("18.50"));
    renderComponent();
    await fillAndSubmit(user, "18.50", { description: "重试" });
    expect((await screen.findByRole("alert")).textContent).toContain("保存失败，请重试");
    expect((screen.getByLabelText("金额") as HTMLInputElement).value).toBe("18.50");
    expect((screen.getByLabelText("备注") as HTMLInputElement).value).toBe("重试");
    await user.click(screen.getByRole("button", { name: "记一笔" }));
    expect((await screen.findByRole("status")).textContent).toContain("已记入本月消费");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(2);
  });
});

function confirmedReceipt(amount: string) {
  const id = `saved-${amount}`;
  return {
    expense: {
      id,
      profileId: "profile-v2",
      kind: "CASH_DEBIT" as const,
      amount,
      currency: "CNY",
      occurredOn: "2026-10-20",
      categoryId: "cat-food",
      description: "",
      accountId: "cash-1",
    },
    reconciliation: {
      expenseId: id,
      spendingRecognition: amount,
      cashReduction: amount,
      countsAsDailyExpense: true as const,
    },
  };
}

function fireEventClick(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
}
