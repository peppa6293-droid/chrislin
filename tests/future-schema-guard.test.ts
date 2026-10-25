import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { CURRENT_SCHEMA_VERSION, migrateDatabase } from "../src/persistence/migrations.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";
import { snapshotDatabase } from "./helpers/sqlite-snapshot.js";

const directories: string[] = [];
const databases: NodeSqliteDatabase[] = [];

function fixture(userVersion: number, migrationVersion?: number): NodeSqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "future-schema-guard-"));
  directories.push(directory);
  const db = new NodeSqliteDatabase(new DatabaseSync(join(directory, "future.sqlite3")));
  databases.push(db);
  db.connection.exec(
    "CREATE TABLE schema_migrations(version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL); CREATE TABLE sentinel(value TEXT NOT NULL); INSERT INTO sentinel VALUES ('unchanged');",
  );
  if (migrationVersion !== undefined)
    db.connection
      .prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, 'fixture')")
      .run(migrationVersion);
  db.connection.exec(`PRAGMA user_version = ${userVersion}`);
  return db;
}

function fileHash(db: NodeSqliteDatabase): string {
  const path = db.connection.prepare("PRAGMA database_list").get() as { file: string };
  return createHash("sha256").update(readFileSync(path.file)).digest("hex");
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("forward schema guard", () => {
  it("rejects user_version 9 and migration version 9 before any database write", async () => {
    const db = fixture(9, 9);
    const before = fileHash(db);

    await expect(migrateDatabase(db)).rejects.toThrow(/newer than this runtime/);
    expect(fileHash(db)).toBe(before);
    expect(db.connection.prepare("SELECT value FROM sentinel").get()).toEqual({
      value: "unchanged",
    });
  });

  it("rejects user_version 9 when schema_migrations only reports 8 without writing", async () => {
    const db = fixture(9, 8);
    const before = fileHash(db);

    await expect(migrateDatabase(db)).rejects.toThrow(/newer than this runtime/);
    expect(fileHash(db)).toBe(before);
  });

  it("rejects schema_migrations version 9 when user_version reports 8 without writing", async () => {
    const db = fixture(8, 9);
    const before = fileHash(db);

    await expect(migrateDatabase(db)).rejects.toThrow(/newer than this runtime/);
    expect(fileHash(db)).toBe(before);
  });

  it("accepts an already-valid V8 database without migration writes", async () => {
    const db = new NodeSqliteDatabase();
    databases.push(db);
    await migrateDatabase(db, "2026-10-08T00:00:00.000Z");
    const before = snapshotDatabase(db);

    await migrateDatabase(db, "2026-10-09T00:00:00.000Z");

    expect(CURRENT_SCHEMA_VERSION).toBe(8);
    expect(Buffer.compare(snapshotDatabase(db), before)).toBe(0);
  });

  it("allows an isolated valid V3 database to migrate to V8", async () => {
    const db = new NodeSqliteDatabase();
    databases.push(db);
    await migrateDatabase(db, "2026-10-08T00:00:00.000Z", 3);
    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 3 }]);

    await migrateDatabase(db, "2026-10-09T00:00:00.000Z");

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
  });
});
