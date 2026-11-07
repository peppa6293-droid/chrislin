import { afterEach, describe, expect, it } from "vitest";
import { listEssentialPayments } from "../src/application/ux-ledger-service.js";
import { CURRENT_SCHEMA_VERSION, migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";
import { snapshotDatabase } from "./helpers/sqlite-snapshot.js";

// C2: V10 migration success/backfill, mid-migration rollback, and the V9-app rejection boundary.

const NOW = "2026-11-02T00:00:00.000Z";
const databases: NodeSqliteDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

async function v9Fixture(): Promise<NodeSqliteDatabase> {
  const db = new NodeSqliteDatabase();
  databases.push(db);
  await migrateDatabase(db, "2026-11-01T00:00:00.000Z", 9);
  await db.execute(
    "INSERT INTO profiles(id,display_name,created_at) VALUES('p1','P','2026-11-01T00:00:00.000Z')",
  );
  await db.execute(
    `INSERT INTO expense_categories(id,profile_id,name,icon,color,monthly_budget,overspending_alert,savings_related,adjustable,builtin,active,created_at)
     VALUES('cat','p1','Food','Utensils','#fff',NULL,0,0,1,1,1,'2026-11-01T00:00:00.000Z')`,
  );
  await db.execute(
    "INSERT INTO cash_accounts(id,profile_id,name,include_in_safety_resources,active,created_at) VALUES('acc','p1','Cash',1,1,'2026-11-01T00:00:00.000Z')",
  );
  await db.execute(
    "INSERT INTO cash_balance_snapshots(id,account_id,as_of_date,balance,created_at) VALUES('snap','acc','2026-11-01','1000','2026-11-01T00:00:00.000Z')",
  );
  await db.execute(
    `INSERT INTO expenses(id,profile_id,kind,amount,currency,occurred_on,category_id,description,account_id,credit_card_id,created_at)
     VALUES('e-cash','p1','CASH_DEBIT','100','CNY','2026-11-02','cat','',NULL,NULL,'2026-11-02T00:00:00.000Z')`,
  );
  await db.execute(
    `INSERT INTO cash_account_revisions(account_id,as_of_date,name,include_in_safety_resources,balance,created_at,source_payment_id)
     VALUES('acc','2026-11-02','Cash',1,'900','2026-11-02T00:00:00.000Z','e-cash')`,
  );
  await db.execute(
    "INSERT INTO debts(id,profile_id,name,fixed_monthly_payment,active,created_at,daily_spending_mode) VALUES('debt','p1','Card',NULL,1,'2026-11-01T00:00:00.000Z',1)",
  );
  await db.execute(
    `INSERT INTO expenses(id,profile_id,kind,amount,currency,occurred_on,category_id,description,account_id,credit_card_id,created_at)
     VALUES('e-debt','p1','CASH_DEBIT','100','CNY','2026-11-03','cat','',NULL,NULL,'2026-11-03T00:00:00.000Z')`,
  );
  await db.execute(
    `INSERT INTO debt_revisions(debt_id,period_month,as_of_date,name,current_balance,current_month_due,fixed_monthly_payment,active,created_at,source_payment_id)
     VALUES('debt','2026-11','2026-11-03','Card','1100',NULL,NULL,1,'2026-11-03T00:00:00.000Z','e-debt')`,
  );
  return db;
}

async function columns(db: NodeSqliteDatabase, table: string): Promise<string[]> {
  return (await db.select<{ name: string }>(`PRAGMA table_info(${table})`)).map((row) => row.name);
}

describe("S2 B-core V10 migration", () => {
  it("adds the status columns and backfills each deduction entity deterministically", async () => {
    const db = await v9Fixture();
    const counts = {
      expenses: await db.select("SELECT COUNT(*) AS count FROM expenses"),
      cash: await db.select("SELECT COUNT(*) AS count FROM cash_account_revisions"),
      debt: await db.select("SELECT COUNT(*) AS count FROM debt_revisions"),
    };

    // Target V10 explicitly: this test owns the V10 backfill contract, and the runtime's
    // CURRENT_SCHEMA_VERSION moves with every later migration (V11 adds transfer tables).
    await migrateDatabase(db, NOW, 10);

    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(10);
    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 10 }]);
    expect(await db.select("SELECT MAX(version) AS version FROM schema_migrations")).toEqual([
      { version: 10 },
    ]);
    expect(await columns(db, "expenses")).toEqual(
      expect.arrayContaining(["deleted_at", "deduction_account_id", "deduction_applied_on"]),
    );
    expect(await columns(db, "expense_records")).toContain("deleted_at");
    expect(
      await db.select(
        "SELECT id,deduction_account_id,deduction_applied_on,deleted_at FROM expenses ORDER BY id",
      ),
    ).toEqual([
      {
        id: "e-cash",
        deduction_account_id: "acc",
        deduction_applied_on: "2026-11-02",
        deleted_at: null,
      },
      {
        id: "e-debt",
        deduction_account_id: "debt",
        deduction_applied_on: "2026-11-03",
        deleted_at: null,
      },
    ]);
    expect(await db.select("SELECT COUNT(*) AS count FROM expenses")).toEqual(counts.expenses);
    expect(await db.select("SELECT COUNT(*) AS count FROM cash_account_revisions")).toEqual(
      counts.cash,
    );
    expect(await db.select("SELECT COUNT(*) AS count FROM debt_revisions")).toEqual(counts.debt);
  });

  it("rolls the whole V10 transaction back when a later statement fails", async () => {
    const db = await v9Fixture();
    const before = {
      expenses: await db.select("SELECT COUNT(*) AS count FROM expenses"),
      cash: await db.select("SELECT COUNT(*) AS count FROM cash_account_revisions"),
    };
    // Pre-existing column makes the second statement fail after the first succeeded.
    await db.execute("ALTER TABLE expenses ADD COLUMN deduction_account_id TEXT");

    await expect(migrateDatabase(db, NOW)).rejects.toThrow(/duplicate column/);

    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 9 }]);
    expect(await db.select("SELECT MAX(version) AS version FROM schema_migrations")).toEqual([
      { version: 9 },
    ]);
    expect(await columns(db, "expenses")).not.toContain("deleted_at");
    expect(await columns(db, "expenses")).not.toContain("deduction_applied_on");
    expect(await columns(db, "expense_records")).not.toContain("deleted_at");
    expect(await db.select("SELECT COUNT(*) AS count FROM expenses")).toEqual(before.expenses);
    expect(await db.select("SELECT COUNT(*) AS count FROM cash_account_revisions")).toEqual(
      before.cash,
    );
  });

  it("refuses to run a V10 database at target V9 and writes nothing", async () => {
    const db = new NodeSqliteDatabase();
    databases.push(db);
    await migrateDatabase(db, NOW);
    const before = snapshotDatabase(db);

    await expect(migrateDatabase(db, "2026-11-03T00:00:00.000Z", 9)).rejects.toThrow(RangeError);
    expect(Buffer.compare(snapshotDatabase(db), before)).toBe(0);
  });

  it("keeps soft-deleted rows out of every old read path", async () => {
    const db = new NodeSqliteDatabase();
    databases.push(db);
    await migrateDatabase(db, NOW);
    const repositories = new Repositories(db);
    await db.execute(
      "INSERT INTO profiles(id,display_name,created_at) VALUES('p1','P','2026-11-01T00:00:00.000Z')",
    );
    await db.execute(
      "INSERT INTO expense_categories(id,profile_id,name,icon,color,monthly_budget,overspending_alert,savings_related,adjustable,builtin,active,created_at) VALUES('cat','p1','Food','Utensils','#fff',NULL,0,0,1,1,1,'2026-11-01T00:00:00.000Z')",
    );
    await db.execute(
      "INSERT INTO accounts(id,profile_id,name,type,currency,active,created_at) VALUES('acc','p1','Cash','CASH','CNY',1,'2026-11-01T00:00:00.000Z')",
    );
    for (const id of ["live", "gone"]) {
      await db.execute(
        `INSERT INTO expenses(id,profile_id,kind,amount,currency,occurred_on,category_id,description,account_id,credit_card_id,created_at)
         VALUES(?,'p1','CASH_DEBIT','100','CNY','2026-11-02','cat','','acc',NULL,'2026-11-02T00:00:00.000Z')`,
        [id],
      );
      await db.execute(
        `INSERT INTO expense_records(id,profile_id,amount,occurred_at,kind,category,note,created_at,business_date)
         VALUES(?,'p1','100','2026-11-02T00:00:00.000Z','VARIABLE','OTHER_VARIABLE',NULL,'2026-11-02T00:00:00.000Z','2026-11-02')`,
        [id],
      );
    }
    await db.execute("UPDATE expenses SET deleted_at=? WHERE id='gone'", [NOW]);
    await db.execute("UPDATE expense_records SET deleted_at=? WHERE id='gone'", [NOW]);
    await db.execute(
      `INSERT INTO expense_records(id,profile_id,amount,occurred_at,kind,category,note,created_at,business_date)
       VALUES('essential','p1','50','2026-11-02T00:00:00.000Z','ESSENTIAL','HOUSING',NULL,'2026-11-02T00:00:00.000Z','2026-11-02')`,
    );
    await db.execute("UPDATE expense_records SET deleted_at=? WHERE id='essential'", [NOW]);

    expect((await repositories.listV2Expenses("p1")).map((row) => row.id)).toEqual(["live"]);
    expect((await repositories.listRecentExpenses(10)).map((row) => row.id)).toEqual(["live"]);
    expect(
      (await repositories.listExpenses("2026-11-01", "2026-11-30")).map((row) => row.id),
    ).toEqual(["live"]);
    expect(await listEssentialPayments(db)).toEqual([]);
  });
});
