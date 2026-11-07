import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, migrateDatabase } from "../src/persistence/migrations.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

// T-16 + T-V11-1..3: V11 creates the three transfer tables and their indexes, enforces
// "one current leg per side", keeps V10 data intact, is idempotent, and refuses to run
// against a database that is already newer than the requested target.

const NOW = "2026-11-06T00:00:00.000Z";
const databases: NodeSqliteDatabase[] = [];

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function open(): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase();
  databases.push(db);
  return db;
}

async function totalChanges(db: NodeSqliteDatabase): Promise<number> {
  const rows = await db.select("SELECT total_changes() AS c");
  return Number((rows[0] as { c: number }).c);
}

async function tableNames(db: NodeSqliteDatabase): Promise<string[]> {
  const rows = await db.select(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return rows.map((row) => String((row as { name: string }).name));
}

async function migrationVersions(db: NodeSqliteDatabase): Promise<number[]> {
  const rows = await db.select("SELECT version FROM schema_migrations ORDER BY version");
  return rows.map((row) => Number((row as { version: number }).version));
}

async function seedAccounts(db: NodeSqliteDatabase): Promise<void> {
  await db.execute(
    "INSERT INTO profiles(id,display_name,created_at) VALUES('p1','P','2026-11-01T00:00:00.000Z')",
  );
  await db.execute(
    "INSERT INTO cash_accounts(id,profile_id,name,include_in_safety_resources,active,created_at) VALUES('acc','p1','Cash',1,1,'2026-11-01T00:00:00.000Z')",
  );
  await db.execute(
    "INSERT INTO cash_account_revisions(account_id,name,include_in_safety_resources,as_of_date,balance,created_at) VALUES('acc','Cash',1,'2026-11-01','1000','2026-11-01T00:00:00.000Z')",
  );
  await db.execute(
    "INSERT INTO cash_accounts(id,profile_id,name,include_in_safety_resources,active,created_at) VALUES('acc2','p1','B',1,1,'2026-11-01T00:00:00.000Z')",
  );
}

async function insertRecord(db: NodeSqliteDatabase, id: string): Promise<void> {
  await db.execute(
    `INSERT INTO transfer_records(id,profile_id,from_account_id,to_account_id,amount,occurred_on,note,created_at,deleted_at)
     VALUES(?,'p1','acc','acc2','100','2026-11-06','',?,NULL)`,
    [id, NOW],
  );
}

async function insertLeg(
  db: NodeSqliteDatabase,
  id: string,
  side: string,
  endedOn: string | null,
): Promise<void> {
  await db.execute(
    `INSERT INTO transfer_legs(id,profile_id,transfer_id,side,account_id,state,applied_on,applied_amount,ended_on,end_reason,created_at)
     VALUES(?,'p1','t1',?,?,'APPLIED','2026-11-06','100',?,?,?)`,
    [id, side, side === "IN" ? "acc2" : "acc", endedOn, endedOn === null ? null : "REVERSED", NOW],
  );
}

describe("V11 migration", () => {
  it("T-16 migrates an empty database to V11 with the transfer tables and indexes in place", async () => {
    const db = open();
    await migrateDatabase(db, NOW);

    expect(CURRENT_SCHEMA_VERSION).toBe(11);
    const version = await db.select("PRAGMA user_version");
    expect(Number((version[0] as { user_version: number }).user_version)).toBe(11);
    expect((await migrationVersions(db)).at(-1)).toBe(11);

    const tables = await tableNames(db);
    for (const table of ["transfer_records", "transfer_legs", "transfer_outcome_locks"]) {
      expect(tables).toContain(table);
    }

    const indexes = (
      await db.select(
        "SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
    ).map((row) => String((row as { name: string }).name));
    expect(indexes).toEqual(
      expect.arrayContaining([
        "transfer_records_ledger",
        "transfer_records_month",
        "transfer_legs_account",
        "transfer_legs_current",
        "transfer_legs_transfer",
        "transfer_outcome_locks_profile",
      ]),
    );
  });

  it("T-16 refuses a second current leg on the same side and accepts one once the first has ended", async () => {
    const db = open();
    await migrateDatabase(db, NOW);
    await seedAccounts(db);
    await insertRecord(db, "t1");
    await insertLeg(db, "l1", "IN", null);

    await expect(insertLeg(db, "l2", "IN", null)).rejects.toThrow(/UNIQUE/);

    await db.execute(
      "UPDATE transfer_legs SET ended_on='2026-11-07', end_reason='REVERSED' WHERE id='l1'",
    );
    await insertLeg(db, "l3", "IN", null);

    const current = await db.select(
      "SELECT id FROM transfer_legs WHERE transfer_id='t1' AND side='IN' AND ended_on IS NULL",
    );
    expect(current.map((row) => (row as { id: string }).id)).toEqual(["l3"]);
    // The OUT side is independent of the IN side.
    await insertLeg(db, "l4", "OUT", null);
    const both = await db.select(
      "SELECT side FROM transfer_legs WHERE transfer_id='t1' AND ended_on IS NULL ORDER BY side",
    );
    expect(both.map((row) => (row as { side: string }).side)).toEqual(["IN", "OUT"]);
  });

  it("T-V11-1 upgrades a populated V10 database without touching a single existing row", async () => {
    const db = open();
    await migrateDatabase(db, NOW, 10);
    await seedAccounts(db);
    const before = await db.select(
      "SELECT account_id, as_of_date, balance FROM cash_account_revisions ORDER BY revision_id",
    );
    const tablesBefore = await tableNames(db);

    await migrateDatabase(db, NOW);

    expect((await migrationVersions(db)).at(-1)).toBe(11);
    const after = await db.select(
      "SELECT account_id, as_of_date, balance FROM cash_account_revisions ORDER BY revision_id",
    );
    expect(after).toEqual(before);
    expect(await tableNames(db)).toEqual(
      expect.arrayContaining(
        tablesBefore.concat(["transfer_records", "transfer_legs", "transfer_outcome_locks"]),
      ),
    );
    expect((await tableNames(db)).length).toBe(tablesBefore.length + 3);
  });

  it("T-V11-2 re-running the migration writes nothing", async () => {
    const db = open();
    await migrateDatabase(db, NOW);
    const versions = await migrationVersions(db);
    const changes = await totalChanges(db);

    await migrateDatabase(db, NOW);

    expect(await migrationVersions(db)).toEqual(versions);
    expect(await totalChanges(db)).toBe(changes);
  });

  it("T-V11-3 a V11 database is never migrated down to an older target", async () => {
    const db = open();
    await migrateDatabase(db, NOW);
    const versions = await migrationVersions(db);
    const tables = await tableNames(db);
    const changes = await totalChanges(db);

    await expect(migrateDatabase(db, NOW, 10)).rejects.toThrow(/newer than target 10/);

    expect(await migrationVersions(db)).toEqual(versions);
    expect(await tableNames(db)).toEqual(tables);
    expect(await totalChanges(db)).toBe(changes);
  });
});
