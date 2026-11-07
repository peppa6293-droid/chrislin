import { invoke } from "@tauri-apps/api/core";
import type { ExecuteResult, SqlDatabase } from "./database.js";
import { type ConnectionState, isConnectionState, TransactionError } from "./transaction-errors.js";

interface DatabaseReply {
  rowsAffected: number;
  lastInsertId?: number;
}

/**
 * Structured failure payload returned by `database_commit` / `database_rollback`
 * (Rust `TransactionFailure`, serde camelCase). It carries facts only: which
 * step failed, whether the connection is still usable, and whether the
 * compensating ROLLBACK failed. It deliberately has no `committed` field.
 */
interface TransactionFailurePayload {
  phase: "rejected" | "commit" | "rollback";
  connectionState: ConnectionState;
  rollbackFailed: boolean;
  error: string;
}

interface RollbackOutcome {
  failed: boolean;
  error?: unknown;
  connectionState: ConnectionState;
}

function payloadOf(error: unknown): TransactionFailurePayload | null {
  if (typeof error !== "object" || error === null) return null;
  const candidate = error as Partial<TransactionFailurePayload>;
  if (typeof candidate.phase !== "string") return null;
  if (!isConnectionState(candidate.connectionState)) return null;
  return candidate as TransactionFailurePayload;
}

/** Copy the connection state reported by Rust; never infer it here. */
function stateOf(error: unknown): ConnectionState {
  const payload = payloadOf(error);
  return payload === null ? "unmodified" : payload.connectionState;
}

/**
 * Connection state after a failed COMMIT: the COMMIT payload wins, the
 * compensating ROLLBACK payload is the fallback. Both are reported facts.
 */
function failureStateOf(error: unknown, rollback: RollbackOutcome): ConnectionState {
  const state = stateOf(error);
  return state === "unmodified" ? rollback.connectionState : state;
}

export class TauriSqlDatabase implements SqlDatabase {
  constructor(private readonly transactionId: string | null = null) {}

  async open(): Promise<void> {
    await invoke("database_open");
  }

  async beginSchemaMigration(): Promise<void> {
    await invoke("database_schema_migration_begin");
  }

  async endSchemaMigration(succeeded: boolean): Promise<void> {
    await invoke("database_schema_migration_end", { succeeded });
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
    // The BEGIN itself is not part of any transaction: if it fails, nothing was
    // opened and the original error is rethrown untouched.
    await invoke("database_begin", { transactionId });
    let result: T;
    try {
      result = await work(new TauriSqlDatabase(transactionId));
    } catch (error) {
      const rollback = await this.tryRollback(transactionId);
      throw new TransactionError(
        "callback",
        error,
        rollback.failed,
        "Transaction callback failed",
        {
          ...(rollback.error === undefined ? {} : { rollbackCause: rollback.error }),
          connectionState: rollback.connectionState,
        },
      );
    }
    try {
      await invoke("database_commit", { transactionId });
    } catch (error) {
      const rollback = await this.tryRollback(transactionId);
      // Even when the compensating rollback succeeds we must not downgrade to a
      // deterministic failure: the COMMIT may already have been persisted.
      throw new TransactionError("commit", error, rollback.failed, "Transaction commit failed", {
        ...(rollback.error === undefined ? {} : { rollbackCause: rollback.error }),
        connectionState: failureStateOf(error, rollback),
      });
    }
    return result;
  }

  private async tryRollback(transactionId: string): Promise<RollbackOutcome> {
    try {
      await invoke("database_rollback", { transactionId });
      // A committed ROLLBACK is the "clean" fact: the transaction is gone and
      // the connection stays usable for the lock write and the next transaction.
      return { failed: false, connectionState: "clean" };
    } catch (error) {
      return { failed: true, error, connectionState: stateOf(error) };
    }
  }
}
