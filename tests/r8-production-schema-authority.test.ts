import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { migrateDatabase } from "../src/persistence/migrations.js";
import {
  bootstrapTauriApplication,
  createTauriApplicationServices,
  PRODUCTION_RUNTIME_IDENTIFIER,
  resolveRuntimeSchemaAuthority,
} from "../src/runtime/tauri-bootstrap.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";
import { snapshotDatabase } from "./helpers/sqlite-snapshot.js";

const directories: string[] = [];
const databases: NodeSqliteDatabase[] = [];

function fixture(): NodeSqliteDatabase {
  const directory = mkdtempSync(join(tmpdir(), "r8-schema-authority-"));
  directories.push(directory);
  const db = new NodeSqliteDatabase(new DatabaseSync(join(directory, "isolated.sqlite3")));
  databases.push(db);
  return db;
}

async function versionState(
  db: NodeSqliteDatabase,
): Promise<{ userVersion: number; migrationVersion: number }> {
  const user = await db.select<{ user_version: number }>("PRAGMA user_version");
  let migrationVersion = 0;
  try {
    const rows = await db.select<{ version: number | null }>(
      "SELECT MAX(version) AS version FROM schema_migrations",
    );
    migrationVersion = Number(rows[0]?.version ?? 0);
  } catch {
    migrationVersion = 0;
  }
  return { userVersion: Number(user[0]?.user_version ?? 0), migrationVersion };
}

afterEach(() => {
  for (const db of databases.splice(0)) db.close();
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("runtime schema authority policy", () => {
  it("assigns Production exclusively to the native V8 gate", () => {
    expect(resolveRuntimeSchemaAuthority(PRODUCTION_RUNTIME_IDENTIFIER)).toBe("NATIVE_V8_GATE");
  });

  it.each([
    "com.personalfinance.console.smoke",
    "com.personalfinance.console.v4acceptance",
    "com.personalfinance.console.wp02preview",
    "com.personalfinance.console.wp03preview",
    "org.pfc.quiescence.integration",
  ])("assigns isolated identity %s to TypeScript migrations", (identifier) => {
    expect(resolveRuntimeSchemaAuthority(identifier)).toBe("TYPESCRIPT_MIGRATION");
  });

  it("fails closed for an unrecognized or empty identity", () => {
    expect(() => resolveRuntimeSchemaAuthority("com.example.unknown")).toThrow(
      /unexpected runtime identity/,
    );
    expect(() => resolveRuntimeSchemaAuthority("")).toThrow(/unexpected runtime identity/);
  });
});

describe("Production composition root never applies TypeScript DDL", () => {
  it("bootstrap leaves an isolated V3 fixture at V3 and performs no migration", async () => {
    const db = fixture();
    await migrateDatabase(db, "2026-10-22T00:00:00.000Z", 3);
    const before = await versionState(db);
    expect(before).toEqual({ userVersion: 3, migrationVersion: 3 });

    const result = await bootstrapTauriApplication({
      identifyRuntime: async () => PRODUCTION_RUNTIME_IDENTIFIER,
      openDatabase: async () => db,
    });

    expect(result.status).toBe("ERROR");
    expect(await versionState(db)).toEqual(before);
    expect(
      await db.select(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='income_entries'",
      ),
    ).toEqual([]);
  });

  it("services leave an isolated V3 fixture at V3 and never enter business I/O", async () => {
    const db = fixture();
    await migrateDatabase(db, "2026-10-22T00:00:00.000Z", 3);

    await expect(
      createTauriApplicationServices({
        identifyRuntime: async () => PRODUCTION_RUNTIME_IDENTIFIER,
        openDatabase: async () => db,
      }),
    ).rejects.toThrow();

    expect(await versionState(db)).toEqual({ userVersion: 3, migrationVersion: 3 });
  });

  it("bootstrap accepts an already-V8 Production database without any write", async () => {
    const db = fixture();
    await migrateDatabase(db, "2026-10-22T00:00:00.000Z", 8);
    const before = snapshotDatabase(db);

    const result = await bootstrapTauriApplication({
      identifyRuntime: async () => PRODUCTION_RUNTIME_IDENTIFIER,
      openDatabase: async () => db,
    });

    expect(result.status).toBe("INITIALIZATION_REQUIRED");
    expect(Buffer.compare(snapshotDatabase(db), before)).toBe(0);
  });

  it("does not open a database when native identity is unavailable", async () => {
    const openDatabase = vi.fn(async () => fixture());

    const result = await bootstrapTauriApplication({
      identifyRuntime: async () => {
        throw new Error("IPC unavailable");
      },
      openDatabase,
    });

    expect(result.status).toBe("ERROR");
    expect(openDatabase).not.toHaveBeenCalled();
    expect(databases).toEqual([]);
  });

  it("does not open a database for an unrecognized identity", async () => {
    const openDatabase = vi.fn(async () => fixture());

    const result = await bootstrapTauriApplication({
      identifyRuntime: async () => "com.example.alias",
      openDatabase,
    });

    expect(result.status).toBe("ERROR");
    expect(openDatabase).not.toHaveBeenCalled();
  });
});

describe("isolated runtimes still own the TypeScript V1..V11 chain", () => {
  it.each(["com.personalfinance.console.smoke", "com.personalfinance.console.v4acceptance"])(
    "bootstrap migrates an isolated V3 fixture to V11 for %s",
    async (identifier) => {
      const db = fixture();
      await migrateDatabase(db, "2026-10-22T00:00:00.000Z", 3);

      const result = await bootstrapTauriApplication({
        identifyRuntime: async () => identifier,
        openDatabase: async () => db,
      });

      expect(result.status).toBe("INITIALIZATION_REQUIRED");
      expect(await versionState(db)).toEqual({ userVersion: 11, migrationVersion: 11 });
      expect(await db.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual(
        [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((version) => ({ version })),
      );
    },
  );

  it("services complete the chain for an isolated V1 fixture", async () => {
    const db = fixture();
    await migrateDatabase(db, "2026-10-22T00:00:00.000Z", 1);

    const services = await createTauriApplicationServices({
      identifyRuntime: async () => "com.personalfinance.console.smoke",
      openDatabase: async () => db,
    });

    expect(services.initialization.status).toBe("INITIALIZATION_REQUIRED");
    expect(await versionState(db)).toEqual({ userVersion: 11, migrationVersion: 11 });
  });
});

describe("targetVersion is authoritative for the entire migration chain", () => {
  it.each([1, 2, 3] as const)("stops exactly at targetVersion %i", async (target) => {
    const db = fixture();
    await migrateDatabase(db, "2026-10-22T00:00:00.000Z", target);

    expect(await versionState(db)).toEqual({
      userVersion: target,
      migrationVersion: target,
    });
    expect(await db.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual(
      Array.from({ length: target }, (_, index) => ({ version: index + 1 })),
    );
  });

  it("defaults to the full V11 chain unchanged", async () => {
    const db = fixture();
    await migrateDatabase(db);
    expect(await versionState(db)).toEqual({ userVersion: 11, migrationVersion: 11 });
  });
});
