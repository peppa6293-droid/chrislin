import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { getFinancialMaintenanceState } from "../src/application/financial-maintenance-service.js";
import { completeOnboarding } from "../src/application/product-service.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const opened: NodeSqliteDatabase[] = [];
const dirs: string[] = [];

function fileDatabase(path: string): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase(new DatabaseSync(path));
  opened.push(db);
  return db;
}

function tempDir(): string {
  const directory = mkdtempSync(join(tmpdir(), "s1-b2b-backup-"));
  dirs.push(directory);
  return directory;
}

afterEach(() => {
  for (const db of opened.splice(0)) db.close();
  for (const directory of dirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const NEW_COLUMNS = [
  "source_payment_id",
  "daily_spending_mode",
  "deduction_account_id",
  "deduction_applied_on",
  "deleted_at",
];

async function dump(
  db: NodeSqliteDatabase,
  excludeNewColumns: boolean,
): Promise<Record<string, string[]>> {
  const tables = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  const out: Record<string, string[]> = {};
  for (const { name } of tables) {
    if (excludeNewColumns && name === "schema_migrations") continue; // V9 adds its own ledger row
    const columns = (await db.select<{ name: string }>(`PRAGMA table_info("${name}")`))
      .map((column) => column.name)
      .filter((column) => !excludeNewColumns || !NEW_COLUMNS.includes(column));
    const rows = await db.select(`SELECT ${columns.map((c) => `"${c}"`).join(",")} FROM "${name}"`);
    out[name] = rows.map((row) => JSON.stringify(row)).sort();
  }
  return out;
}

async function onboard(db: NodeSqliteDatabase): Promise<void> {
  await migrateDatabase(db);
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
    "2026-09-01",
  );
}

async function unwrapToV8(db: NodeSqliteDatabase): Promise<void> {
  await db.connection.exec("ALTER TABLE cash_account_revisions DROP COLUMN source_payment_id");
  await db.connection.exec("ALTER TABLE debt_revisions DROP COLUMN source_payment_id");
  await db.connection.exec("ALTER TABLE debts DROP COLUMN daily_spending_mode");
  await db.connection.exec("ALTER TABLE expenses DROP COLUMN deleted_at");
  await db.connection.exec("ALTER TABLE expenses DROP COLUMN deduction_account_id");
  await db.connection.exec("ALTER TABLE expenses DROP COLUMN deduction_applied_on");
  await db.connection.exec("ALTER TABLE expense_records DROP COLUMN deleted_at");
  await db.connection.exec("DELETE FROM schema_migrations WHERE version IN (9,10,11)");
  await db.connection.exec("PRAGMA user_version=8");
}

function backup(db: NodeSqliteDatabase, directory: string, name: string): string {
  const path = join(directory, name);
  db.connection.exec(`VACUUM INTO '${path}'`);
  return path;
}

function validate(backupPath: string): number {
  const connection = new DatabaseSync(backupPath);
  try {
    expect(connection.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
    const version = Number(
      (connection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    );
    expect(version).toBe(11);
    expect(
      (
        connection
          .prepare(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
          .get() as { count: number }
      ).count,
    ).toBe(32);
    return version;
  } finally {
    connection.close();
  }
}

describe("S1 B2b T4 backup and restore with V10", () => {
  it("backs up a V10 database, restores an isolated copy, and keeps every table identical", async () => {
    const directory = tempDir();
    const sourcePath = join(directory, "source.sqlite3");
    const source = fileDatabase(sourcePath);
    await onboard(source);
    const state = await getFinancialMaintenanceState(source, "2026-09-05");
    const before = await dump(source, false);

    const backupPath = backup(source, directory, "backup.sqlite3");
    expect(validate(backupPath)).toBe(11);

    const restoredPath = join(directory, "restored.sqlite3");
    copyFileSync(backupPath, restoredPath);
    const restored = fileDatabase(restoredPath);
    expect(await restored.select("PRAGMA user_version")).toEqual([{ user_version: 11 }]);
    expect(await dump(restored, false)).toEqual(before);
    await migrateDatabase(restored, "2026-09-06T00:00:00.000Z");
    expect(await getFinancialMaintenanceState(restored, "2026-09-05")).toEqual(state);
  });

  it("opens a V8 backup outside production and migrates it to V10 without data loss", async () => {
    const directory = tempDir();
    const source = fileDatabase(join(directory, "source.sqlite3"));
    await onboard(source);
    const stateV10 = await getFinancialMaintenanceState(source, "2026-09-05");
    await unwrapToV8(source);
    const before = await dump(source, true);

    const backupPath = backup(source, directory, "v8-backup.sqlite3");
    const targetPath = join(directory, "v8-target.sqlite3");
    copyFileSync(backupPath, targetPath);
    const target = fileDatabase(targetPath);
    expect(await target.select("PRAGMA user_version")).toEqual([{ user_version: 8 }]);

    await migrateDatabase(target, "2026-09-06T00:00:00.000Z");

    expect(await target.select("PRAGMA user_version")).toEqual([{ user_version: 11 }]);
    expect(await dump(target, true)).toEqual(before);
    expect(await getFinancialMaintenanceState(target, "2026-09-05")).toEqual(stateV10);
  });
});
