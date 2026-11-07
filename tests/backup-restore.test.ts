import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

const EXPECTED_SCHEMA_VERSION = 11;
const EXPECTED_TABLE_COUNT = 32;

const openDatabases: NodeSqliteDatabase[] = [];
const tempDirs: string[] = [];

function tempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "m2-s1-b1-"));
  tempDirs.push(directory);
  return directory;
}

function fileDatabase(path: string): NodeSqliteDatabase {
  const db = new NodeSqliteDatabase(new DatabaseSync(path));
  openDatabases.push(db);
  return db;
}

function closeDatabase(db: NodeSqliteDatabase): void {
  const index = openDatabases.indexOf(db);
  if (index >= 0) openDatabases.splice(index, 1);
  db.close();
}

async function seededDatabase(path: string): Promise<NodeSqliteDatabase> {
  const db = fileDatabase(path);
  await migrateDatabase(db);
  await db.execute("INSERT INTO app_metadata(key,value) VALUES(?,?)", ["drill", "1"]);
  return db;
}

function sha256File(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function finalizeBackup(rawPath: string, directory: string): string {
  const hash = sha256File(rawPath);
  const backup = join(directory, `xiaoqianjia-db-20261104-${hash.slice(0, 16)}.sqlite3`);
  renameSync(rawPath, backup);
  return backup;
}

function makeBackup(db: NodeSqliteDatabase, directory: string): string {
  const raw = join(directory, `raw-${Date.now()}-${Math.random().toString(16).slice(2)}.sqlite3`);
  db.connection.exec(`VACUUM INTO ${sqlString(raw)}`);
  return finalizeBackup(raw, directory);
}

function tableNames(connection: InstanceType<typeof DatabaseSync>): string[] {
  return connection
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((row) => String((row as { name: string }).name));
}

function validateBackup(path: string): { sha256: string; userVersion: number; tableCount: number } {
  const match = /^xiaoqianjia-db-\d{8}-([0-9a-f]{16})\.sqlite3$/.exec(basename(path));
  const prefix = match?.[1];
  if (!prefix) throw new Error("BACKUP_NAME_INVALID");
  const sha256 = sha256File(path);
  if (!sha256.startsWith(prefix)) throw new Error("BACKUP_HASH_MISMATCH");
  const connection = new DatabaseSync(path);
  try {
    const integrity = connection.prepare("PRAGMA integrity_check").get() as {
      integrity_check: string;
    };
    if (integrity.integrity_check !== "ok") throw new Error("BACKUP_INTEGRITY_FAILED");
    const userVersion = Number(
      (connection.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    );
    const tableCount = tableNames(connection).length;
    if (userVersion !== EXPECTED_SCHEMA_VERSION) {
      throw new Error(`BACKUP_SCHEMA_VERSION_MISMATCH:${userVersion}`);
    }
    if (tableCount !== EXPECTED_TABLE_COUNT) {
      throw new Error(`BACKUP_TABLE_COUNT_MISMATCH:${tableCount}`);
    }
    return { sha256, userVersion, tableCount };
  } finally {
    connection.close();
  }
}

function restoreBackup(source: string, target: string): { sha256: string } {
  const validated = validateBackup(source);
  const temporary = `${target}.restore-${process.pid}-${Date.now()}`;
  try {
    copyFileSync(source, temporary);
    if (sha256File(temporary) !== validated.sha256) throw new Error("RESTORE_COPY_MISMATCH");
    renameSync(temporary, target);
    return { sha256: sha256File(target) };
  } catch (error) {
    if (existsSync(temporary)) rmSync(temporary, { force: true });
    throw error;
  }
}

function compareTables(source: string, target: string): string[] {
  const connection = new DatabaseSync(target);
  try {
    connection.prepare("ATTACH DATABASE ? AS src").run(source);
    const sourceTables = (
      connection
        .prepare(
          "SELECT name FROM src.sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
        )
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    const targetTables = tableNames(connection);
    if (JSON.stringify(sourceTables) !== JSON.stringify(targetTables)) return ["TABLE_LIST"];
    const mismatches: string[] = [];
    for (const table of sourceTables) {
      const quoted = table.replaceAll('"', '""');
      const forward = connection
        .prepare(
          `SELECT COUNT(*) AS n FROM (SELECT * FROM src."${quoted}" EXCEPT SELECT * FROM main."${quoted}")`,
        )
        .get() as { n: number };
      const reverse = connection
        .prepare(
          `SELECT COUNT(*) AS n FROM (SELECT * FROM main."${quoted}" EXCEPT SELECT * FROM src."${quoted}")`,
        )
        .get() as { n: number };
      if (Number(forward.n) !== 0 || Number(reverse.n) !== 0) mismatches.push(table);
    }
    return mismatches;
  } finally {
    connection.close();
  }
}

afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  for (const directory of tempDirs.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("S1 B1 backup and isolated restore", () => {
  it("backs up and restores a single-file database with zero table differences", async () => {
    const directory = tempDirectory();
    const sourcePath = join(directory, "source.sqlite3");
    const source = await seededDatabase(sourcePath);
    const sourceBefore = sha256File(sourcePath);
    const backup = makeBackup(source, directory);
    expect(sha256File(sourcePath)).toBe(sourceBefore);

    const validated = validateBackup(backup);
    const targetPath = join(directory, "restored.sqlite3");
    const restored = restoreBackup(backup, targetPath);
    expect(restored.sha256).toBe(validated.sha256);

    const restoredDb = fileDatabase(targetPath);
    const integrity = await restoredDb.select<{ integrity_check: string }>(
      "PRAGMA integrity_check",
    );
    expect(integrity[0]?.integrity_check).toBe("ok");
    expect(
      Number(
        (await restoredDb.select<{ user_version: number }>("PRAGMA user_version"))[0]?.user_version,
      ),
    ).toBe(EXPECTED_SCHEMA_VERSION);
    expect(
      Number(
        (
          await restoredDb.select<{ count: number }>(
            "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
          )
        )[0]?.count,
      ),
    ).toBe(EXPECTED_TABLE_COUNT);
    expect(compareTables(backup, targetPath)).toEqual([]);
  });

  it("rejects a one-byte tampered backup and leaves the target unchanged", async () => {
    const directory = tempDirectory();
    const sourcePath = join(directory, "source.sqlite3");
    const source = await seededDatabase(sourcePath);
    const backup = makeBackup(source, directory);
    const tamperedDirectory = join(directory, "tampered");
    mkdirSync(tamperedDirectory);
    const tampered = join(tamperedDirectory, basename(backup));
    const bytes = readFileSync(backup);
    const index = Math.floor(bytes.length / 2);
    bytes[index] = (bytes[index] ?? 0) ^ 0xff;
    writeFileSync(tampered, bytes);

    const targetPath = join(directory, "target.sqlite3");
    writeFileSync(targetPath, "original-target");
    const targetBefore = sha256File(targetPath);
    expect(() => restoreBackup(tampered, targetPath)).toThrow(/BACKUP_HASH_MISMATCH/);
    expect(sha256File(targetPath)).toBe(targetBefore);
  });

  it("handles a real WAL/SHM backup on an isolated copy", async () => {
    const directory = tempDirectory();
    const sourcePath = join(directory, "wal-source.sqlite3");
    const source = fileDatabase(sourcePath);
    await migrateDatabase(source);
    const journal = source.connection.prepare("PRAGMA journal_mode=WAL").get() as {
      journal_mode: string;
    };
    expect(journal.journal_mode).toBe("wal");
    source.connection.exec("PRAGMA wal_autocheckpoint=0");
    await source.execute("INSERT INTO app_metadata(key,value) VALUES(?,?)", ["wal-proof", "1"]);
    expect(existsSync(`${sourcePath}-wal`)).toBe(true);
    expect(statSync(`${sourcePath}-wal`).size).toBeGreaterThan(0);
    expect(existsSync(`${sourcePath}-shm`)).toBe(true);

    const copyDirectory = join(directory, "wal-copy");
    mkdirSync(copyDirectory);
    const copyPath = join(copyDirectory, "copy.sqlite3");
    copyFileSync(sourcePath, copyPath);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(`${sourcePath}${suffix}`))
        copyFileSync(`${sourcePath}${suffix}`, `${copyPath}${suffix}`);
    }

    const copy = new NodeSqliteDatabase(new DatabaseSync(copyPath));
    copy.connection.prepare("PRAGMA wal_checkpoint(TRUNCATE)").all();
    const singlePath = join(copyDirectory, "single.sqlite3");
    copy.connection.exec(`VACUUM INTO ${sqlString(singlePath)}`);
    closeDatabase(copy);
    for (const suffix of ["-wal", "-shm"]) {
      if (existsSync(`${copyPath}${suffix}`)) rmSync(`${copyPath}${suffix}`, { force: true });
    }

    const backup = finalizeBackup(singlePath, directory);
    expect(existsSync(`${backup}-wal`)).toBe(false);
    expect(existsSync(`${backup}-shm`)).toBe(false);
    const targetPath = join(directory, "wal-restored.sqlite3");
    restoreBackup(backup, targetPath);
    expect(compareTables(backup, targetPath)).toEqual([]);
  });

  it("rejects old or heterogeneous backups without touching the target", async () => {
    const directory = tempDirectory();
    const targetPath = join(directory, "target.sqlite3");
    writeFileSync(targetPath, "original-target");
    const targetBefore = sha256File(targetPath);

    const oldPath = join(directory, "old.sqlite3");
    const oldDb = fileDatabase(oldPath);
    await migrateDatabase(oldDb);
    oldDb.connection.exec("PRAGMA user_version=7");
    const oldBackup = makeBackup(oldDb, directory);
    expect(() => restoreBackup(oldBackup, targetPath)).toThrow(/BACKUP_SCHEMA_VERSION_MISMATCH/);
    expect(sha256File(targetPath)).toBe(targetBefore);

    const heterogeneousPath = join(directory, "heterogeneous.sqlite3");
    const heterogeneousDb = fileDatabase(heterogeneousPath);
    await migrateDatabase(heterogeneousDb);
    heterogeneousDb.connection.exec("DROP TABLE app_metadata");
    const heterogeneousBackup = makeBackup(heterogeneousDb, directory);
    expect(() => restoreBackup(heterogeneousBackup, targetPath)).toThrow(
      /BACKUP_TABLE_COUNT_MISMATCH/,
    );
    expect(sha256File(targetPath)).toBe(targetBefore);
  });
});
