import { invoke } from "@tauri-apps/api/core";
import type { ExecuteResult, SqlDatabase } from "./database.js";

interface DatabaseReply {
  rowsAffected: number;
  lastInsertId?: number;
}

export class TauriSqlDatabase implements SqlDatabase {
  constructor(private readonly transactionId: string | null = null) {}

  async open(): Promise<void> {
    await invoke("database_open");
  }

  async execute(sql: string, bindValues: unknown[] = []): Promise<ExecuteResult> {
    const result = await invoke<DatabaseReply>("database_execute", {
      sql,
      bindValues,
      transactionId: this.transactionId,
    });
    return result;
  }

  async select<T extends Record<string, unknown>>(
    sql: string,
    bindValues: unknown[] = [],
  ): Promise<T[]> {
    return invoke<T[]>("database_select", { sql, bindValues, transactionId: this.transactionId });
  }

  async transaction<T>(work: (transactionDb: SqlDatabase) => Promise<T>): Promise<T> {
    if (this.transactionId !== null)
      throw new Error("Nested database transactions are not supported.");
    const transactionId = crypto.randomUUID();
    await invoke("database_begin", { transactionId });
    try {
      const result = await work(new TauriSqlDatabase(transactionId));
      await invoke("database_commit", { transactionId });
      return result;
    } catch (error) {
      await invoke("database_rollback", { transactionId });
      throw error;
    }
  }
}
