import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { MIGRATION_SQL } from "../src/persistence/migrations.js";

const repositoryRoot = join(import.meta.dirname, "..");

function normalized(sql: string): string {
  return sql.replace(/\r\n/g, "\n").trim();
}

function schemaRows(connection: DatabaseSync) {
  return connection
    .prepare(
      "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE sql IS NOT NULL ORDER BY type,name",
    )
    .all();
}

describe("R8 native migration SQL is the exact TypeScript migration source", () => {
  it.each([5, 6, 7, 8] as const)(
    "migrations/00%i.sql matches the TypeScript migration source byte-for-byte",
    (version) => {
      const file = readFileSync(join(repositoryRoot, "migrations", `00${version}.sql`), "utf8");
      expect(normalized(file)).toBe(normalized(MIGRATION_SQL[version] ?? ""));
    },
  );

  it.each([5, 6, 7, 8] as const)(
    "applying the native SQL chain through V%i produces the accepted schema snapshot",
    (version) => {
      const connection = new DatabaseSync(":memory:");
      try {
        connection.exec("PRAGMA foreign_keys = ON");
        connection.exec(readFileSync(join(repositoryRoot, "migrations/003-bootstrap.sql"), "utf8"));
        for (let current = 4; current <= version; current += 1) {
          connection.exec(
            readFileSync(join(repositoryRoot, "migrations", `00${current}.sql`), "utf8"),
          );
        }

        const expected = JSON.parse(
          readFileSync(join(repositoryRoot, "migrations", `v${version}-schema.json`), "utf8"),
        ) as unknown;
        expect(schemaRows(connection)).toEqual(expected);

        const authority = connection.prepare("PRAGMA user_version").get() as {
          user_version: number;
        };
        expect(authority.user_version).toBe(version);
      } finally {
        connection.close();
      }
    },
  );
});
