import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { completeOnboarding } from "../../src/application/product-service.js";
import {
  listEssentialPaymentItems,
  listEssentialPayments,
  recordEssentialPayment,
  saveEssentialItems,
} from "../../src/application/ux-ledger-service.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import { localDate } from "../../src/ui/date.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

let db: NodeSqliteDatabase;
let repositories: Repositories;
let asOfDate: string;

beforeEach(async () => {
  asOfDate = localDate(new Date());
  db = new NodeSqliteDatabase();
  repositories = new Repositories(db);
  await migrateDatabase(db, `${asOfDate}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    asOfDate,
  );
});

afterEach(() => db.close());

async function payByAmount(
  items: Array<{ id: string; name: string; monthlyAmount: string }>,
  name: string,
  amount: string,
): Promise<void> {
  const item = items.find((candidate) => candidate.name === name);
  if (!item) throw new Error(`missing essential item: ${name}`);
  await recordEssentialPayment(db, {
    itemId: item.id,
    amount,
    paidOn: asOfDate,
  });
}

describe("fixed-expense payments keep their own item identity", () => {
  it("two items in the same category are listed under their own names", async () => {
    await saveEssentialItems(
      db,
      [
        { name: "房租", category: "HOUSING", monthlyAmount: "3000" },
        { name: "物业费", category: "HOUSING", monthlyAmount: "200" },
      ],
      asOfDate,
    );
    const items = await listEssentialPaymentItems(db, asOfDate);
    await payByAmount(items, "房租", "3000");
    await payByAmount(items, "物业费", "200");

    const payments = await listEssentialPayments(db, asOfDate.slice(0, 7));
    const byAmount = new Map(payments.map((payment) => [payment.amount, payment]));
    const rent = items.find((item) => item.name === "房租");
    const management = items.find((item) => item.name === "物业费");
    if (!rent || !management) throw new Error("seed items missing");

    expect(byAmount.get("3000")?.itemName).toBe("房租");
    expect(byAmount.get("3000")?.itemId).toBe(rent.id);
    expect(byAmount.get("200")?.itemName).toBe("物业费");
    expect(byAmount.get("200")?.itemId).toBe(management.id);
    expect(new Set(payments.map((payment) => payment.itemName)).size).toBe(2);
  });

  it("falls back without throwing when the payment log was trimmed", async () => {
    // BASIC_FOOD 没有 onboarding 预置条目，类别反查结果唯一，断言不依赖排序。
    await saveEssentialItems(
      db,
      [{ name: "菜钱", category: "BASIC_FOOD", monthlyAmount: "800" }],
      asOfDate,
    );
    const items = await listEssentialPaymentItems(db, asOfDate);
    await payByAmount(items, "菜钱", "800");
    await repositories.setMeta("ux.essential-payments.v1", "[]");

    const payments = await listEssentialPayments(db, asOfDate.slice(0, 7));
    expect(payments).toHaveLength(1);
    expect(payments[0]?.itemId).toBe("");
    expect(payments[0]?.itemName).toBe("菜钱");
    expect(payments[0]?.amount).toBe("800");
  });
});
