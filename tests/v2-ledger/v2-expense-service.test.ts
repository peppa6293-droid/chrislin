import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { V2ExpenseService } from "../../src/application/v2-expense-service.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

let db: NodeSqliteDatabase;
let repositories: Repositories;
let service: V2ExpenseService;

beforeEach(async () => {
  db = new NodeSqliteDatabase();
  repositories = new Repositories(db);
  service = new V2ExpenseService(repositories);
  await migrateDatabase(db, "2026-10-19T00:00:00.000Z");
  await repositories.createProfile({ id: "profile-v2", displayName: "V2 ledger" });
  await repositories.createAccount({
    id: "cash-1",
    profileId: "profile-v2",
    name: "现金",
    type: "CASH",
    currency: "CNY",
  });
  await repositories.createAccount({
    id: "card-1",
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
});

afterEach(() => db.close());

describe("EXEC-L-07 V2 expense application service", () => {
  it("records cash debit expenses, reconciles them, and reads back the exact fields", async () => {
    const result = await service.recordCashDebitExpense({
      id: "expense-cash",
      profileId: "profile-v2",
      amount: "35.00",
      currency: "CNY",
      occurredOn: "2026-10-19",
      categoryId: "cat-food",
      description: "现金午餐",
      accountId: "cash-1",
    });
    expect(result.expense).toEqual({
      id: "expense-cash",
      profileId: "profile-v2",
      kind: "CASH_DEBIT",
      amount: "35.00",
      currency: "CNY",
      occurredOn: "2026-10-19",
      categoryId: "cat-food",
      description: "现金午餐",
      accountId: "cash-1",
    });
    expect(result.reconciliation).toEqual({
      expenseId: "expense-cash",
      spendingRecognition: "35.00",
      cashReduction: "35.00",
      countsAsDailyExpense: true,
    });
    expect(await repositories.getV2ExpenseById("expense-cash")).toMatchObject({
      amount: "35.00",
      occurredOn: "2026-10-19",
      categoryId: "cat-food",
    });
  });

  it("records one-time and installment credit expenses with exact installment totals", async () => {
    const oneTime = await service.recordCreditExpense({
      id: "expense-one-time",
      profileId: "profile-v2",
      amount: "128.00",
      currency: "CNY",
      occurredOn: "2026-10-18",
      categoryId: "cat-food",
      description: "信用卡晚餐",
      creditCardId: "card-1",
    });
    expect(oneTime.expense).toMatchObject({
      kind: "CREDIT_ONE_TIME",
      amount: "128.00",
      creditCardId: "card-1",
    });

    const installment = await service.recordCreditExpense({
      id: "expense-installment",
      profileId: "profile-v2",
      amount: "99.99",
      currency: "CNY",
      occurredOn: "2026-10-18",
      categoryId: "cat-food",
      description: "分期消费",
      creditCardId: "card-1",
      installment: {
        totalAmount: "99.99",
        periods: 3,
        fee: "0.01",
        firstInstallmentMonth: "2026-10",
      },
    });
    expect(installment.expense.kind).toBe("CREDIT_INSTALLMENT");
    if (installment.expense.kind !== "CREDIT_INSTALLMENT") throw new Error("unexpected kind");
    expect(installment.expense.repaymentSchedule.map((item) => item.amount)).toEqual([
      "33.33",
      "33.33",
      "33.34",
    ]);
    expect(installment.expense.repaymentSchedule.reduce((total, item) => total + Number(item.amount), 0)).toBeCloseTo(100.0, 2);
    expect(await repositories.getV2ExpenseById("expense-installment")).toMatchObject({
      totalAmount: "99.99",
      installmentAmount: "33.33",
    });
  });

  it("rejects inconsistent installment schedules with an application error", async () => {
    await expect(
      service.recordCreditExpense({
        id: "expense-bad-installment",
        profileId: "profile-v2",
        amount: "100.00",
        currency: "CNY",
        occurredOn: "2026-10-18",
        categoryId: "cat-food",
        description: "分期不一致",
        creditCardId: "card-1",
        installment: {
          totalAmount: "100.00",
          periods: 0,
          fee: "0.00",
          firstInstallmentMonth: "2026-10",
        },
      }),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE_INSTALLMENT" });
    expect(await repositories.getV2ExpenseById("expense-bad-installment")).toBeNull();
  });

  it("returns credit card payment reconciliation without recognizing daily spending", async () => {
    const result = await service.recordCreditCardPayment({
      id: "payment-1",
      expenseId: "expense-one-time",
      cashAccountId: "cash-1",
      amount: "128.00",
      currency: "CNY",
      paidOn: "2026-10-19",
    });
    expect(result.reconciliation).toEqual({
      expenseId: "expense-one-time",
      paymentId: "payment-1",
      cashAccountId: "cash-1",
      cashReduction: "128.00",
      spendingRecognition: "0.00",
      countsAsDailyExpense: false,
    });
    const summary = await service.getMonthSummary("profile-v2", "2026-10");
    expect(summary.dailyExpenseTotal).toBe("0.00");
    expect(summary.billStatuses).toEqual([]);
  });

  it("summarizes daily expenses including monthly installment amounts and excludes payment records", async () => {
    await service.recordCashDebitExpense({
      id: "expense-cash",
      profileId: "profile-v2",
      amount: "35.00",
      currency: "CNY",
      occurredOn: "2026-10-19",
      categoryId: "cat-food",
      description: "现金午餐",
      accountId: "cash-1",
    });
    await service.recordCreditExpense({
      id: "expense-one-time",
      profileId: "profile-v2",
      amount: "48.00",
      currency: "CNY",
      occurredOn: "2026-10-20",
      categoryId: "cat-food",
      description: "信用卡午餐",
      creditCardId: "card-1",
    });
    await service.recordCreditExpense({
      id: "expense-installment",
      profileId: "profile-v2",
      amount: "100.00",
      currency: "CNY",
      occurredOn: "2026-10-20",
      categoryId: "cat-food",
      description: "分期消费",
      creditCardId: "card-1",
      installment: {
        totalAmount: "100.00",
        periods: 4,
        fee: "0.00",
        firstInstallmentMonth: "2026-10",
      },
    });
    await service.recordCreditCardPayment({
      id: "payment-1",
      expenseId: "expense-one-time",
      cashAccountId: "cash-1",
      amount: "48.00",
      currency: "CNY",
      paidOn: "2026-10-20",
    });
    expect(await service.getMonthSummary("profile-v2", "2026-10")).toEqual({
      dailyExpenseTotal: "108.00",
      billStatuses: [],
    });
  });

  it("returns dashboard props matching the isolated V2 dashboard contract", async () => {
    await service.recordCashDebitExpense({
      id: "expense-cash",
      profileId: "profile-v2",
      amount: "12.50",
      currency: "CNY",
      occurredOn: "2026-10-19",
      categoryId: "cat-food",
      description: "交通",
      accountId: "cash-1",
    });
    const props = await service.getDashboardProps("profile-v2", "2026-10");
    expect(props).toEqual({
      ledger: {
        income: "0.00",
        dailyExpense: "12.50",
        accountCash: "0.00",
      },
      billStatuses: [],
      savingsPlans: [],
      affordableSavings: [],
      trendSummary: null,
      trendWindow: "month",
    });
  });

  it("rejects zero, oversized, invalid date, and missing category inputs", async () => {
    const cashDraft = {
      id: "expense-invalid",
      profileId: "profile-v2",
      amount: "0.00",
      currency: "CNY",
      occurredOn: "2026-10-19",
      categoryId: "cat-food",
      description: "零金额",
      accountId: "cash-1",
    };
    await expect(service.recordCashDebitExpense(cashDraft)).rejects.toThrow(/must be positive/);

    await expect(
      service.recordCashDebitExpense({
        ...cashDraft,
        amount: "1000000000000.00",
        description: "超大金额",
      }),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE_AMOUNT" });

    await expect(
      service.recordCashDebitExpense({
        ...cashDraft,
        amount: "1.00",
        occurredOn: "2026-13-01",
        description: "非法日期",
      }),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE_DATE" });

    await expect(
      service.recordCashDebitExpense({
        ...cashDraft,
        amount: "1.00",
        categoryId: "missing-category",
        description: "缺少分类",
      }),
    ).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND" });

    expect(await repositories.listV2Expenses("profile-v2", "2026-10")).toEqual([]);
  });
});
