import { afterEach, describe, expect, it } from "vitest";
import {
  getFinancialMaintenanceState,
  updateFinancialDataAndRecalculate,
} from "../src/application/financial-maintenance-service.js";
import { completeOnboarding, getHomeApplicationState } from "../src/application/product-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";
import { snapshotDatabase } from "./helpers/sqlite-snapshot.js";

const opened: NodeSqliteDatabase[] = [];

function memory(): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase();
  opened.push(db);
  return db;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
});

const NEW_COLUMNS = ["source_payment_id", "daily_spending_mode"];

/** Old-column-only image of every table, for V8↔V9 "nothing else changed" checks. */
async function oldColumnDump(db: NodeSqliteDatabase): Promise<Record<string, string[]>> {
  const tables = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const dump: Record<string, string[]> = {};
  for (const { name } of tables) {
    if (name === "schema_migrations") continue; // the V9 ledger row is the migration itself
    const columns = (await db.select<{ name: string }>(`PRAGMA table_info("${name}")`))
      .map((column) => column.name)
      .filter((column) => !NEW_COLUMNS.includes(column));
    const rows = await db.select(`SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM "${name}"`);
    dump[name] = rows.map((row) => JSON.stringify(row)).sort();
  }
  return dump;
}

async function onboard(db: NodeSqliteDatabase, asOfDate: string): Promise<void> {
  await migrateDatabase(db, `${asOfDate}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
      assets: [{ name: "Fund", currentValue: "1000", includeInSafetyResources: true }],
      debts: [
        {
          name: "Loan",
          currentBalance: "2000",
          currentMonthDue: "500",
          fixedMonthlyPayment: "400",
        },
      ],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "2000",
    },
    asOfDate,
  );
}

/** Turn a V9 database into a genuine V8 one: drop the V9 columns, row and version. */
async function unwrapToV8(db: NodeSqliteDatabase): Promise<void> {
  await db.connection.exec("ALTER TABLE cash_account_revisions DROP COLUMN source_payment_id");
  await db.connection.exec("ALTER TABLE debt_revisions DROP COLUMN source_payment_id");
  await db.connection.exec("ALTER TABLE debts DROP COLUMN daily_spending_mode");
  await db.connection.exec("ALTER TABLE expenses DROP COLUMN deleted_at");
  await db.connection.exec("ALTER TABLE expenses DROP COLUMN deduction_account_id");
  await db.connection.exec("ALTER TABLE expenses DROP COLUMN deduction_applied_on");
  await db.connection.exec("ALTER TABLE expense_records DROP COLUMN deleted_at");
  await db.connection.exec("DELETE FROM schema_migrations WHERE version IN (9,10)");
  await db.connection.exec("PRAGMA user_version=8");
}

async function columnNames(db: NodeSqliteDatabase, table: string): Promise<string[]> {
  return (await db.select<{ name: string }>(`PRAGMA table_info(${table})`)).map(
    (column) => column.name,
  );
}

describe("S1 B2b T1 V9 migration structure and atomicity", () => {
  it("migrates a fresh database to V10 with both version authorities and a clean schema", async () => {
    const db = memory();
    await migrateDatabase(db);
    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 10 }]);
    expect(await db.select("SELECT MAX(version) AS version FROM schema_migrations")).toEqual([
      { version: 10 },
    ]);
    expect(await db.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual(
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((version) => ({ version })),
    );
    expect(await db.select("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
  });

  it("adds exactly the three V9 columns and preserves every old column row", async () => {
    const db = memory();
    await onboard(db, "2026-09-01");
    await unwrapToV8(db);
    const before = await oldColumnDump(db);

    await migrateDatabase(db, "2026-09-02T00:00:00.000Z", 9);

    const cashRevision = (
      await db.select<Record<string, unknown>>("PRAGMA table_info(cash_account_revisions)")
    ).find((column) => column.name === "source_payment_id");
    expect(cashRevision).toMatchObject({ type: "TEXT", notnull: 0, dflt_value: null });
    const debtRevision = (
      await db.select<Record<string, unknown>>("PRAGMA table_info(debt_revisions)")
    ).find((column) => column.name === "source_payment_id");
    expect(debtRevision).toMatchObject({ type: "TEXT", notnull: 0, dflt_value: null });
    const mode = (await db.select<Record<string, unknown>>("PRAGMA table_info(debts)")).find(
      (column) => column.name === "daily_spending_mode",
    );
    expect(mode).toMatchObject({ type: "INTEGER", notnull: 1, dflt_value: "0" });

    expect(await oldColumnDump(db)).toEqual(before);
    expect(await db.select("PRAGMA integrity_check")).toEqual([{ integrity_check: "ok" }]);
    expect(await db.select("PRAGMA foreign_key_check")).toEqual([]);
    expect(
      await db.select(
        "SELECT COUNT(*) AS count FROM cash_account_revisions WHERE source_payment_id IS NOT NULL",
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      await db.select("SELECT COUNT(*) AS count FROM debts WHERE daily_spending_mode<>0"),
    ).toEqual([{ count: 0 }]);
  });

  it("rejects an out-of-range spending mode through the column CHECK", async () => {
    const db = memory();
    await onboard(db, "2026-09-01");
    const profile = (await db.select<{ id: string }>("SELECT id FROM profiles LIMIT 1"))[0];
    await expect(
      db.execute(
        "INSERT INTO debts(id,profile_id,name,active,created_at,daily_spending_mode) VALUES(?,?,?,?,?,2)",
        ["debt-bad", profile?.id, "bad", 1, "2026-09-01T00:00:00.000Z"],
      ),
    ).rejects.toThrow(/CHECK/i);
  });

  it("treats an already-V9 database as a no-op", async () => {
    const db = memory();
    await onboard(db, "2026-09-01");
    const before = snapshotDatabase(db);
    await migrateDatabase(db, "2026-09-02T00:00:00.000Z");
    expect(Buffer.compare(snapshotDatabase(db), before)).toBe(0);
    expect(
      await db.select("SELECT COUNT(*) AS count FROM schema_migrations WHERE version=9"),
    ).toEqual([{ count: 1 }]);
  });

  it("rejects disagreeing version authorities before any DDL", async () => {
    const db = memory();
    await onboard(db, "2026-09-01");
    await unwrapToV8(db);
    await db.connection.exec("PRAGMA user_version=9");

    await expect(migrateDatabase(db)).rejects.toThrow(/authorities disagree/);
    expect(await columnNames(db, "cash_account_revisions")).not.toContain("source_payment_id");
    expect(await columnNames(db, "debt_revisions")).not.toContain("source_payment_id");
    expect(await columnNames(db, "debts")).not.toContain("daily_spending_mode");
  });

  it("rolls the whole V9 transaction back when a later ALTER fails", async () => {
    const db = memory();
    await onboard(db, "2026-09-01");
    await unwrapToV8(db);
    // Pre-existing column makes the third statement fail after the first two succeeded.
    await db.connection.exec(
      "ALTER TABLE debts ADD COLUMN daily_spending_mode INTEGER NOT NULL DEFAULT 0",
    );

    await expect(migrateDatabase(db)).rejects.toThrow(/duplicate column name/);
    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 8 }]);
    expect(await db.select("SELECT MAX(version) AS version FROM schema_migrations")).toEqual([
      { version: 8 },
    ]);
    expect(await columnNames(db, "cash_account_revisions")).not.toContain("source_payment_id");
    expect(await columnNames(db, "debt_revisions")).not.toContain("source_payment_id");
  });
});

describe("S1 B2b T2 old data keeps its behavior across V8→V10", () => {
  it("keeps maintenance and home output identical before and after the migration", async () => {
    const db = memory();
    await onboard(db, "2026-09-01");
    const seeded = await getFinancialMaintenanceState(db, "2026-09-05");
    const [cash] = seeded.cashAccounts;
    const [debt] = seeded.debts;
    if (!cash || !debt) throw new Error("Onboarding fixtures are missing.");
    await updateFinancialDataAndRecalculate(
      db,
      {
        cashAccounts: [
          { id: cash.id, name: cash.name, balance: "5200", includeInSafetyResources: true },
        ],
        debts: [
          {
            id: debt.id,
            name: debt.name,
            currentBalance: "2100",
            currentMonthDue: "500",
            fixedMonthlyPayment: "400",
          },
        ],
      },
      "2026-09-03",
    );
    const stateBefore = await getFinancialMaintenanceState(db, "2026-09-05");
    const homeBefore = await getHomeApplicationState(db, "2026-09-05");

    await unwrapToV8(db);

    await migrateDatabase(db, "2026-09-06T00:00:00.000Z");

    expect(await getFinancialMaintenanceState(db, "2026-09-05")).toEqual(stateBefore);
    expect(await getHomeApplicationState(db, "2026-09-05")).toEqual(homeBefore);
    expect(await db.select("SELECT COUNT(*) AS count FROM cash_account_revisions")).not.toEqual([
      { count: 0 },
    ]);
    expect(await db.select("SELECT COUNT(*) AS count FROM debt_revisions")).not.toEqual([
      { count: 0 },
    ]);
    expect(
      await db.select(
        "SELECT COUNT(*) AS count FROM cash_account_revisions WHERE source_payment_id IS NOT NULL",
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      await db.select(
        "SELECT COUNT(*) AS count FROM debt_revisions WHERE source_payment_id IS NOT NULL",
      ),
    ).toEqual([{ count: 0 }]);
    expect(
      await db.select("SELECT COUNT(*) AS count FROM debts WHERE daily_spending_mode<>0"),
    ).toEqual([{ count: 0 }]);
  });
});
