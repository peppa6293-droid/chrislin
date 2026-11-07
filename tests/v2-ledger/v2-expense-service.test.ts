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
    expect(
      installment.expense.repaymentSchedule.reduce((total, item) => total + Number(item.amount), 0),
    ).toBeCloseTo(100.0, 2);
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
        recurringIncome: "0.00",
        incomeIncludesOneTime: false,
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

  it("aggregates income by month and keeps one-time income out of recurring income", async () => {
    await service.recordIncomeEntry({
      id: "income-salary",
      profileId: "profile-v2",
      periodMonth: "2026-09",
      occurredAt: "2026-09-10",
      amount: "12791.25",
      label: "工资",
      oneTime: false,
    });
    await service.recordIncomeEntry({
      id: "income-award",
      profileId: "profile-v2",
      periodMonth: "2026-09",
      occurredAt: "2026-09-20",
      amount: "1000.00",
      label: "进步奖",
      oneTime: true,
    });
    await service.recordIncomeEntry({
      id: "income-next-month",
      profileId: "profile-v2",
      periodMonth: "2026-10",
      occurredAt: "2026-10-10",
      amount: "500.00",
      label: "邻月收入",
      oneTime: false,
    });

    const september = await service.getDashboardProps("profile-v2", "2026-09");
    expect(september.ledger).toMatchObject({
      income: "13791.25",
      recurringIncome: "12791.25",
      incomeIncludesOneTime: true,
    });
    const october = await service.getDashboardProps("profile-v2", "2026-10");
    expect(october.ledger).toMatchObject({
      income: "500.00",
      recurringIncome: "500.00",
      incomeIncludesOneTime: false,
    });
  });

  it("takes each account's latest balance snapshot as of month end for account cash", async () => {
    await repositories.createCashAccount(
      { id: "cash-main", name: "主账户", includeInSafetyResources: true },
      "profile-v2",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.createCashAccount(
      { id: "cash-wallet", name: "零钱", includeInSafetyResources: true },
      "profile-v2",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.saveCashSnapshot(
      { id: "snap-main-old", accountId: "cash-main", asOfDate: "2026-09-01", balance: "1000.00" },
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.saveCashSnapshot(
      { id: "snap-main-new", accountId: "cash-main", asOfDate: "2026-09-20", balance: "1200.00" },
      "2026-09-20T00:00:00.000Z",
    );
    await repositories.saveCashSnapshot(
      { id: "snap-wallet", accountId: "cash-wallet", asOfDate: "2026-09-10", balance: "50.00" },
      "2026-09-10T00:00:00.000Z",
    );
    await repositories.saveCashSnapshot(
      {
        id: "snap-wallet-future",
        accountId: "cash-wallet",
        asOfDate: "2026-10-01",
        balance: "9999.00",
      },
      "2026-10-01T00:00:00.000Z",
    );

    const props = await service.getDashboardProps("profile-v2", "2026-09");
    expect(props.ledger.accountCash).toBe("1250.00");
  });

  it("deducts reserved cash from safety resources without clamping negatives", async () => {
    await repositories.createCashAccount(
      { id: "cash-main", name: "农业银行", includeInSafetyResources: true },
      "profile-v2",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.createCashAccount(
      { id: "cash-second", name: "上海银行", includeInSafetyResources: true },
      "profile-v2",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.createAsset(
      {
        id: "asset-securities",
        name: "证券",
        kind: "LIQUID_INVESTMENT",
        includeInSafetyResources: true,
      },
      "profile-v2",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.saveCashSnapshot(
      { id: "snap-main", accountId: "cash-main", asOfDate: "2026-09-30", balance: "5097.04" },
      "2026-09-30T00:00:00.000Z",
    );
    await repositories.saveCashSnapshot(
      { id: "snap-second", accountId: "cash-second", asOfDate: "2026-09-30", balance: "228.89" },
      "2026-09-30T00:00:00.000Z",
    );
    await repositories.saveAssetSnapshot(
      {
        id: "snap-securities",
        assetId: "asset-securities",
        asOfDate: "2026-09-30",
        value: "20000.00",
      },
      "2026-09-30T00:00:00.000Z",
    );
    await repositories.setCashAccountReservedAmount("cash-main", "profile-v2", "3800");
    await repositories.setCashAccountReservedAmount("cash-second", "profile-v2", "100.00");

    const snapshot = await service.getSafetySnapshot("profile-v2", "2026-09-30");
    expect(snapshot).toEqual({
      safetyResources: "25325.93",
      reserved: "3900.00",
      freeCash: "21425.93",
    });

    await repositories.setCashAccountReservedAmount("cash-second", "profile-v2", "0.00");
    expect(await service.getSafetySnapshot("profile-v2", "2026-09-30")).toEqual({
      safetyResources: "25325.93",
      reserved: "3800.00",
      freeCash: "21525.93",
    });
  });

  it("keeps liquid investments out of account cash and only counts eligible assets as safety resources", async () => {
    await repositories.createCashAccount(
      { id: "cash-main", name: "现金", includeInSafetyResources: true },
      "profile-v2",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.saveCashSnapshot(
      { id: "snap-main", accountId: "cash-main", asOfDate: "2026-09-30", balance: "1000.00" },
      "2026-09-30T00:00:00.000Z",
    );
    await repositories.createAsset(
      {
        id: "asset-liquid",
        name: "证券",
        kind: "LIQUID_INVESTMENT",
        includeInSafetyResources: true,
      },
      "profile-v2",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.createAsset(
      {
        id: "asset-liquid-excluded",
        name: "锁定理财",
        kind: "LIQUID_INVESTMENT",
        includeInSafetyResources: false,
      },
      "profile-v2",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.createAsset(
      {
        id: "asset-other",
        name: "自住房",
        kind: "OTHER",
        includeInSafetyResources: true,
      },
      "profile-v2",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.saveAssetSnapshot(
      { id: "snap-liquid", assetId: "asset-liquid", asOfDate: "2026-09-30", value: "20000.00" },
      "2026-09-30T00:00:00.000Z",
    );
    await repositories.saveAssetSnapshot(
      {
        id: "snap-liquid-excluded",
        assetId: "asset-liquid-excluded",
        asOfDate: "2026-09-30",
        value: "5000.00",
      },
      "2026-09-30T00:00:00.000Z",
    );
    await repositories.saveAssetSnapshot(
      { id: "snap-other", assetId: "asset-other", asOfDate: "2026-09-30", value: "3000.00" },
      "2026-09-30T00:00:00.000Z",
    );

    expect((await service.getDashboardProps("profile-v2", "2026-09")).ledger.accountCash).toBe(
      "1000.00",
    );
    expect(await service.getSafetySnapshot("profile-v2", "2026-09-30")).toEqual({
      safetyResources: "21000.00",
      reserved: "0.00",
      freeCash: "21000.00",
    });
  });

  it("sums active fixed plans effective by month end plus debt due for core obligations", async () => {
    await repositories.createFixedExpensePlan({
      id: "plan-rent",
      profileId: "profile-v2",
      name: "房租",
      monthlyAmount: "1900.00",
      effectiveFrom: "2026-01",
      note: "季付节奏",
    });
    await repositories.createFixedExpensePlan({
      id: "plan-battery",
      profileId: "profile-v2",
      name: "电池租赁",
      monthlyAmount: "728.00",
      effectiveFrom: "2026-01",
    });
    await repositories.createFixedExpensePlan({
      id: "plan-parking",
      profileId: "profile-v2",
      name: "停车",
      monthlyAmount: "300.00",
      effectiveFrom: "2026-01",
    });
    await repositories.createFixedExpensePlan({
      id: "plan-food",
      profileId: "profile-v2",
      name: "饮食规划",
      monthlyAmount: "1500.00",
      effectiveFrom: "2026-01",
    });
    await repositories.createFixedExpensePlan({
      id: "plan-insurance",
      profileId: "profile-v2",
      name: "车险+无忧年度预提",
      monthlyAmount: "648.31",
      effectiveFrom: "2026-01",
    });
    await repositories.createFixedExpensePlan({
      id: "plan-future",
      profileId: "profile-v2",
      name: "未来计划",
      monthlyAmount: "999.00",
      effectiveFrom: "2026-12",
    });
    await repositories.createDebt(
      { id: "debt-a", name: "债务 A", fixedMonthlyPayment: null },
      "profile-v2",
      "2026-01-01T00:00:00.000Z",
    );
    await repositories.saveDebtPeriodFact(
      {
        id: "debt-fact-oct",
        debtId: "debt-a",
        periodMonth: "2026-10",
        asOfDate: "2026-10-31",
        currentBalance: "20000.00",
        currentMonthDue: null,
      },
      "2026-10-31T00:00:00.000Z",
    );
    await repositories.saveDebtPeriodFact(
      {
        id: "debt-fact-nov",
        debtId: "debt-a",
        periodMonth: "2026-11",
        asOfDate: "2026-11-30",
        currentBalance: "20000.00",
        currentMonthDue: "8851.03",
      },
      "2026-11-30T00:00:00.000Z",
    );

    expect(await service.getMonthlyCoreObligations("profile-v2", "2026-11")).toBe("13927.34");
    expect(await service.getMonthlyCoreObligations("profile-v2", "2026-10")).toBe("5076.31");
  });

  it("migrates a fresh database to V11 and keeps income, reserved cash, and fixed plans writable", async () => {
    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 11 }]);
    const cashColumns = await db.select<{ name: string }>("PRAGMA table_info(cash_accounts)");
    expect(cashColumns.map((column) => column.name)).toContain("reserved_amount");
    const tables = await db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('income_entries','fixed_expense_plans') ORDER BY name",
    );
    expect(tables.map((row) => row.name)).toEqual(["fixed_expense_plans", "income_entries"]);

    await service.recordIncomeEntry({
      id: "income-fresh",
      profileId: "profile-v2",
      periodMonth: "2026-09",
      occurredAt: "2026-09-10",
      amount: "100.00",
      label: "",
      oneTime: false,
    });
    expect(await repositories.listIncomeEntries("profile-v2", "2026-09")).toHaveLength(1);

    await repositories.createCashAccount(
      { id: "cash-fresh", name: "现金", includeInSafetyResources: true },
      "profile-v2",
      "2026-09-01T00:00:00.000Z",
    );
    await repositories.saveCashSnapshot(
      { id: "snap-fresh", accountId: "cash-fresh", asOfDate: "2026-09-30", balance: "100.00" },
      "2026-09-30T00:00:00.000Z",
    );
    await repositories.setCashAccountReservedAmount("cash-fresh", "profile-v2", "12");
    expect(
      (await repositories.cashAccountsAt("2026-09-30", "profile-v2")).map(
        (account) => account.reservedAmount,
      ),
    ).toEqual(["12.00"]);
    await expect(
      repositories.setCashAccountReservedAmount("cash-fresh", "profile-v2", "-1.00"),
    ).rejects.toMatchObject({ code: "INVALID_RESERVED_AMOUNT" });

    await repositories.createFixedExpensePlan({
      id: "plan-fresh",
      profileId: "profile-v2",
      name: "计划",
      monthlyAmount: "10.00",
      effectiveFrom: "2026-09",
    });
    await repositories.updateFixedExpensePlan("profile-v2", "plan-fresh", {
      monthlyAmount: "20.00",
      note: "更新",
    });
    expect(await repositories.listFixedExpensePlans("profile-v2", "2026-09")).toMatchObject([
      { id: "plan-fresh", monthlyAmount: "20.00", note: "更新", active: true },
    ]);
    await repositories.deactivateFixedExpensePlan("profile-v2", "plan-fresh");
    expect(await repositories.listFixedExpensePlans("profile-v2", "2026-09")).toEqual([]);
  });

  it("upgrades a V7 database to V11 without losing existing rows", async () => {
    const local = new NodeSqliteDatabase();
    try {
      await migrateDatabase(local, "2026-09-01T00:00:00.000Z", 7);
      expect(await local.select("PRAGMA user_version")).toEqual([{ user_version: 7 }]);
      await local.execute("INSERT INTO profiles(id,display_name,created_at) VALUES(?,?,?)", [
        "profile-v7",
        "V7",
        "2026-09-01T00:00:00.000Z",
      ]);
      await local.execute(
        "INSERT INTO cash_accounts(id,profile_id,name,include_in_safety_resources,created_at) VALUES(?,?,?,?,?)",
        ["cash-v7", "profile-v7", "旧账户", 1, "2026-09-01T00:00:00.000Z"],
      );

      await migrateDatabase(local, "2026-09-02T00:00:00.000Z");

      expect(await local.select("PRAGMA user_version")).toEqual([{ user_version: 11 }]);
      expect(await local.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
        { version: 5 },
        { version: 6 },
        { version: 7 },
        { version: 8 },
        { version: 9 },
        { version: 10 },
        { version: 11 },
      ]);
      expect(await local.select("SELECT id,reserved_amount FROM cash_accounts")).toEqual([
        { id: "cash-v7", reserved_amount: "0.00" },
      ]);
      await local.execute(
        "INSERT INTO income_entries(id,profile_id,period_month,occurred_at,amount,label,one_time,created_at) VALUES(?,?,?,?,?,?,?,?)",
        [
          "income-v8",
          "profile-v7",
          "2026-09",
          "2026-09-10",
          "1.00",
          "",
          0,
          "2026-09-10T00:00:00.000Z",
        ],
      );
      await local.execute(
        "INSERT INTO fixed_expense_plans(id,profile_id,name,monthly_amount,effective_from,created_at) VALUES(?,?,?,?,?,?)",
        ["plan-v8", "profile-v7", "计划", "1.00", "2026-09", "2026-09-10T00:00:00.000Z"],
      );
      expect(await local.select("SELECT COUNT(*) AS count FROM income_entries")).toEqual([
        { count: 1 },
      ]);
      expect(await local.select("SELECT COUNT(*) AS count FROM fixed_expense_plans")).toEqual([
        { count: 1 },
      ]);
    } finally {
      local.close();
    }
  });

  it("upgrades a V3 database to V11", async () => {
    const local = new NodeSqliteDatabase();
    try {
      await migrateDatabase(local, "2026-09-01T00:00:00.000Z", 3);
      expect(await local.select("PRAGMA user_version")).toEqual([{ user_version: 3 }]);

      await migrateDatabase(local, "2026-09-02T00:00:00.000Z");

      expect(await local.select("PRAGMA user_version")).toEqual([{ user_version: 11 }]);
      expect(
        await local.select(
          "SELECT COUNT(*) AS count FROM schema_migrations WHERE version BETWEEN 1 AND 11",
        ),
      ).toEqual([{ count: 11 }]);
    } finally {
      local.close();
    }
  });
});
