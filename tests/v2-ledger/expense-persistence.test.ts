import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

let db: NodeSqliteDatabase;
let repositories: Repositories;

beforeEach(async () => {
  db = new NodeSqliteDatabase();
  repositories = new Repositories(db);
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

describe("EXEC-P-01 V2 expense persistence", () => {
  it("migrates a fresh database to V8 and records all three expense kinds", async () => {
    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 8 }]);
    expect(await db.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
    ]);

    await repositories.createV2Expense({
      kind: "CASH_DEBIT",
      id: "expense-cash",
      profileId: "profile-v2",
      amount: "35.00",
      currency: "CNY",
      occurredOn: "2026-10-19",
      categoryId: "cat-food",
      description: "现金午餐",
      accountId: "cash-1",
    });
    await repositories.createV2Expense({
      kind: "CREDIT_ONE_TIME",
      id: "expense-one-time",
      profileId: "profile-v2",
      amount: "128.00",
      currency: "CNY",
      occurredOn: "2026-10-18",
      categoryId: "cat-food",
      description: "信用卡晚餐",
      creditCardId: "card-1",
    });
    await repositories.createV2Expense({
      kind: "CREDIT_INSTALLMENT",
      id: "expense-installment",
      profileId: "profile-v2",
      amount: "1200.00",
      currency: "CNY",
      occurredOn: "2026-10-17",
      categoryId: "cat-food",
      description: "分期消费",
      creditCardId: "card-1",
      totalAmount: "1200.00",
      periods: 3,
      fee: "0.00",
      firstInstallmentMonth: "2026-10",
      installmentAmount: "400.00",
    });

    expect(await repositories.getV2ExpenseById("expense-cash")).toEqual({
      kind: "CASH_DEBIT",
      id: "expense-cash",
      profileId: "profile-v2",
      amount: "35.00",
      currency: "CNY",
      occurredOn: "2026-10-19",
      categoryId: "cat-food",
      description: "现金午餐",
      accountId: "cash-1",
    });
    expect(await repositories.getV2ExpenseById("expense-one-time")).toMatchObject({
      kind: "CREDIT_ONE_TIME",
      amount: "128.00",
      creditCardId: "card-1",
    });
    expect(await repositories.getV2ExpenseById("expense-installment")).toMatchObject({
      kind: "CREDIT_INSTALLMENT",
      totalAmount: "1200.00",
      periods: 3,
      fee: "0.00",
      installmentAmount: "400.00",
    });
    expect(await repositories.listV2Expenses("profile-v2")).toHaveLength(3);
  });

  it("migrates an existing V5 database incrementally to V8", async () => {
    await db.connection.exec("DELETE FROM expense_categories");
    await db.connection.exec("DELETE FROM accounts");
    await db.connection.exec("DELETE FROM schema_migrations WHERE version IN (6,7,8)");
    await db.connection.exec("DROP INDEX expenses_dedupe_unique");
    await db.connection.exec("ALTER TABLE expenses DROP COLUMN dedupe_key");
    await db.connection.exec("ALTER TABLE cash_accounts DROP COLUMN reserved_amount");
    await db.connection.exec("DROP TABLE IF EXISTS income_entries");
    await db.connection.exec("DROP TABLE IF EXISTS fixed_expense_plans");
    await db.connection.exec("PRAGMA user_version = 5");

    await migrateDatabase(db, "2026-10-19T01:00:00.000Z");

    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 8 }]);
    expect(
      await db.select("SELECT version FROM schema_migrations WHERE version IN (5,6,7,8)"),
    ).toEqual([{ version: 5 }, { version: 6 }, { version: 7 }, { version: 8 }]);
    expect(await db.select("SELECT COUNT(*) AS count FROM expenses")).toEqual([{ count: 0 }]);
    expect(await db.select("SELECT COUNT(*) AS count FROM import_batches")).toEqual([{ count: 0 }]);
  });

  it("filters expenses by profile and month, and deletes a stored expense", async () => {
    await repositories.createV2Expense({
      kind: "CASH_DEBIT",
      id: "expense-october",
      profileId: "profile-v2",
      amount: "12.50",
      currency: "CNY",
      occurredOn: "2026-10-19",
      categoryId: "cat-food",
      description: "十月",
      accountId: "cash-1",
    });
    await repositories.createV2Expense({
      kind: "CASH_DEBIT",
      id: "expense-november",
      profileId: "profile-v2",
      amount: "20.00",
      currency: "CNY",
      occurredOn: "2026-11-01",
      categoryId: "cat-food",
      description: "十一月",
      accountId: "cash-1",
    });
    expect((await repositories.listV2Expenses("profile-v2", "2026-10")).map((e) => e.id)).toEqual([
      "expense-october",
    ]);
    expect(await repositories.listV2Expenses("other-profile")).toEqual([]);
    await repositories.deleteV2Expense("expense-october");
    expect(await repositories.getV2ExpenseById("expense-october")).toBeNull();
    await expect(repositories.deleteV2Expense("expense-october")).rejects.toMatchObject({
      code: "EXPENSE_NOT_FOUND",
    });
  });

  it("rejects missing cash and credit accounts without writing", async () => {
    await expect(
      repositories.createV2Expense({
        kind: "CASH_DEBIT",
        id: "expense-no-account",
        profileId: "profile-v2",
        amount: "10.00",
        currency: "CNY",
        occurredOn: "2026-10-19",
        categoryId: "cat-food",
        description: "缺少现金账户",
        accountId: "",
      }),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE_ACCOUNT" });

    await expect(
      repositories.createV2Expense({
        kind: "CREDIT_ONE_TIME",
        id: "expense-no-card",
        profileId: "profile-v2",
        amount: "10.00",
        currency: "CNY",
        occurredOn: "2026-10-19",
        categoryId: "cat-food",
        description: "缺少信用卡",
        creditCardId: "",
      }),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE_ACCOUNT" });

    await expect(
      repositories.createV2Expense({
        kind: "CREDIT_INSTALLMENT",
        id: "expense-no-installment-card",
        profileId: "profile-v2",
        amount: "100.00",
        currency: "CNY",
        occurredOn: "2026-10-19",
        categoryId: "cat-food",
        description: "缺少分期信用卡",
        creditCardId: "",
        totalAmount: "100.00",
        periods: 2,
        fee: "0.00",
        firstInstallmentMonth: "2026-10",
        installmentAmount: "50.00",
      }),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE_ACCOUNT" });
    expect(await db.select("SELECT COUNT(*) AS count FROM expenses")).toEqual([{ count: 0 }]);
  });

  it("requires complete installment fields and preserves an import batch reference", async () => {
    await expect(
      repositories.createV2Expense({
        kind: "CREDIT_INSTALLMENT",
        id: "expense-missing-fee",
        profileId: "profile-v2",
        amount: "100.00",
        currency: "CNY",
        occurredOn: "2026-10-19",
        categoryId: "cat-food",
        description: "缺少手续费",
        creditCardId: "card-1",
        totalAmount: "100.00",
        periods: 2,
        firstInstallmentMonth: "2026-10",
        installmentAmount: "50.00",
      } as Parameters<Repositories["createV2Expense"]>[0]),
    ).rejects.toMatchObject({ code: "INVALID_EXPENSE_INSTALLMENT" });

    await repositories.createImportBatch({
      id: "batch-1",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileSha256: "a".repeat(64),
      totalRows: 2,
      validRows: 1,
      writtenRows: 1,
      skippedRows: 1,
      errorRows: 0,
      createdAt: "2026-10-19T00:00:00.000Z",
    });
    await repositories.createV2Expense(
      {
        kind: "CASH_DEBIT",
        id: "expense-imported",
        profileId: "profile-v2",
        amount: "35.00",
        currency: "CNY",
        occurredOn: "2026-10-19",
        categoryId: "cat-food",
        description: "导入支出",
        accountId: "cash-1",
      },
      "2026-10-19T00:00:00.000Z",
      "batch-1",
    );

    expect(await repositories.getImportBatchById("batch-1")).toMatchObject({
      id: "batch-1",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      totalRows: 2,
      validRows: 1,
      writtenRows: 1,
      skippedRows: 1,
      errorRows: 0,
    });
    expect(await repositories.listImportBatches("profile-v2")).toHaveLength(1);
    expect(
      await db.select("SELECT import_batch_id FROM expenses WHERE id='expense-imported'"),
    ).toEqual([{ import_batch_id: "batch-1" }]);
  });
});
