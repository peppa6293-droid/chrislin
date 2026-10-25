import type { ExecuteResult, SqlDatabase } from "../../src/persistence/database.js";

// node:sqlite is a Node built-in: load it without a static specifier so the
// happy-dom (client) transform graph never tries to bundle it.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

export class NodeSqliteDatabase implements SqlDatabase {
  private transactionOpen = false;

  constructor(readonly connection = new DatabaseSync(":memory:")) {
    connection.exec("PRAGMA foreign_keys = ON");
  }

  async open(): Promise<void> {}

  async execute(sql: string, bindValues: unknown[] = []): Promise<ExecuteResult> {
    const result = this.connection
      .prepare(sql)
      .run(...(bindValues as (string | number | bigint | null | Uint8Array)[]));
    return {
      rowsAffected: Number(result.changes),
      ...(result.lastInsertRowid === undefined
        ? {}
        : { lastInsertId: Number(result.lastInsertRowid) }),
    };
  }

  async select<T extends Record<string, unknown>>(
    sql: string,
    bindValues: unknown[] = [],
  ): Promise<T[]> {
    return this.connection
      .prepare(sql)
      .all(...(bindValues as (string | number | bigint | null | Uint8Array)[])) as T[];
  }

  async transaction<T>(work: (transactionDb: SqlDatabase) => Promise<T>): Promise<T> {
    if (this.transactionOpen) throw new Error("Nested database transactions are not supported.");
    this.connection.exec("BEGIN IMMEDIATE");
    this.transactionOpen = true;
    try {
      const result = await work(this);
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    } finally {
      this.transactionOpen = false;
    }
  }

  close(): void {
    this.connection.close();
  }
}
