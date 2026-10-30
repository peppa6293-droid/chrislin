import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  completeOnboarding,
  type ExpenseSubmission,
  getExpenseRecordById,
  getHomeApplicationState,
} from "../src/application/product-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { recordV2CashExpenseForDatabase } from "../src/runtime/tauri-bootstrap.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const today = "2026-10-30";
let db: NodeSqliteDatabase;
let seq = 0;

const exp = (
  amount: string,
  date = today,
  category: ExpenseSubmission["category"] | "NONE" = "FOOD",
  note?: string,
): ExpenseSubmission & { id: string } => ({
  id: `e${String(1000 - ++seq).padStart(4, "0")}`,
  amount,
  dateTime: `${date}T00:00:00.000Z`,
  businessDate: date,
  ...(category !== "NONE" ? { category } : {}),
  ...(note ? { note } : {}),
});
const record = (e: ExpenseSubmission) => recordV2CashExpenseForDatabase(db, e, today);
const home = (date = today) => getHomeApplicationState(db, date);
const count = async (table: string) =>
  Number((await db.select<{ n: number }>(`SELECT count(*) AS n FROM ${table}`))[0]?.n);

beforeEach(async () => {
  seq = 0;
  db = new NodeSqliteDatabase();
  await migrateDatabase(db, `${today}T00:00:00.000Z`);
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
    today,
  );
});
afterEach(() => db.close());

describe("M1 record one expense: amount, category, note, date", () => {
  it("reads back amount, date, category name and note; month total moves by exactly that amount", async () => {
    const before = await home();
    const e = exp("100.50", today, "FOOD", "午餐");
    await record(e);
    const stored = await getExpenseRecordById(db, e.id);
    expect(stored).toMatchObject({ id: e.id, businessDate: today, note: "午餐" });
    expect(String(stored?.amount)).toBe("100.50");
    const after = await home();
    expect(before.currentMonthSpending).toBe("0");
    expect(after.currentMonthSpending).toBe("100.5");
    expect(after.remainingSpendingCapacity).toBe("1899.5");
    expect(after.recentExpenses?.[0]).toMatchObject({
      amount: "100.50",
      businessDate: today,
      categoryName: "餐饮",
      note: "午餐",
    });
  });

  it("each of the six categories is stored and shown by its own name", async () => {
    const names: Array<[NonNullable<ExpenseSubmission["category"]>, string]> = [
      ["FOOD", "餐饮"],
      ["TRANSPORT", "交通"],
      ["SHOPPING", "购物"],
      ["ENTERTAINMENT", "娱乐"],
      ["HOUSEHOLD", "家居"],
      ["OTHER_VARIABLE", "其他"],
    ];
    for (const [category] of names) await record(exp("1", today, category));
    const rows = await db.select<{ name: string }>(
      "SELECT c.name FROM expenses e JOIN expense_categories c ON c.id=e.category_id ORDER BY e.rowid",
    );
    expect(rows.map((r) => r.name)).toEqual(names.map(([, n]) => n));
  });

  it("an expense without a category falls back to 其他", async () => {
    await record(exp("5", today, "NONE"));
    expect((await home()).recentExpenses?.[0]?.categoryName).toBe("其他");
  });

  it.each(["0.01", "999999999999.99"])("accepts amount %s", async (amount) => {
    const e = exp(amount);
    await record(e);
    expect(String((await getExpenseRecordById(db, e.id))?.amount)).toBe(String(Number(amount)));
  });

  it.each(["0", "0.00", "-5", "12.345", "1e3", "abc", "", "1,000", "1000000000000"])(
    "rejects amount %j and writes no row to either ledger",
    async (amount) => {
      await expect(record(exp(amount))).rejects.toBeDefined();
      expect([await count("expenses"), await count("expense_records")]).toEqual([0, 0]);
    },
  );

  it.each(["2026-02-30", "2026-13-01", "2026-10-3", "20261030", ""])(
    "rejects invalid date %j and writes nothing",
    async (date) => {
      await expect(record(exp("5", date))).rejects.toBeDefined();
      expect([await count("expenses"), await count("expense_records")]).toEqual([0, 0]);
    },
  );

  it("a duplicate id (double tap) is rejected and counts once in both ledgers", async () => {
    const e = exp("20");
    await record(e);
    await expect(record(e)).rejects.toBeDefined();
    expect([await count("expenses"), await count("expense_records")]).toEqual([1, 1]);
    expect((await home()).currentMonthSpending).toBe("20");
  });

  it("the two ledgers hold one logical expense each, same id, amount and date", async () => {
    const e = exp("33.30", "2026-10-12", "TRANSPORT", "地铁");
    await record(e);
    const v2 = await db.select("SELECT id, amount, occurred_on FROM expenses");
    const legacy = await db.select("SELECT id, amount, business_date FROM expense_records");
    expect(v2).toEqual([{ id: e.id, amount: "33.30", occurred_on: "2026-10-12" }]);
    expect(legacy).toEqual([{ id: e.id, amount: "33.30", business_date: "2026-10-12" }]);
  });

  it("date boundaries: month attribution follows the business date, not the entry time", async () => {
    await record(exp("10", "2026-10-31"));
    await record(exp("20", "2026-11-01"));
    await record(exp("40", "2026-10-01"));
    expect((await home("2026-10-31")).currentMonthSpending).toBe("50");
    expect((await home("2026-11-01")).currentMonthSpending).toBe("20");
  });

  it("a future-dated entry in this month is saved but not counted until its day", async () => {
    await record(exp("10", today));
    await record(exp("50", "2026-10-31"));
    expect((await home(today)).currentMonthSpending).toBe("10");
    expect((await home("2026-10-31")).currentMonthSpending).toBe("60");
  });

  it("recent list: newest business date first, then newest entered, at most 3", async () => {
    await record(exp("1", today));
    await record(exp("2", today));
    await record(exp("3", today));
    await record(exp("4", today));
    expect((await home()).recentExpenses?.map((r) => r.amount)).toEqual(["4", "3", "2"]);
    await record(exp("9", "2026-10-02"));
    expect((await home()).recentExpenses?.map((r) => r.amount)).toEqual(["4", "3", "2"]);
    await record(exp("7", "2026-10-31"));
    expect((await home()).recentExpenses?.map((r) => r.amount)).toEqual(["7", "4", "3"]);
  });
});
