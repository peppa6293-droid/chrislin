import type { ExecuteResult, SqlDatabase } from "../../src/persistence/database.js";
import { TransactionError } from "../../src/persistence/transaction-errors.js";

// node:sqlite is a Node built-in: load it without a static specifier so the
// happy-dom (client) transform graph never tries to bundle it.
const { DatabaseSync } = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");

/**
 * Deterministic fault injection for the driver-boundary tests (C6, T-29..T-32).
 *
 * Hooks exist only on the test fixture; production code has no equivalent
 * switch. Each hook sits at exactly one point of the transaction lifecycle, so
 * a test can make a specific step fail without touching business code.
 */
export interface NodeSqliteTransactionHooks {
  /** Runs inside the open transaction, right after `BEGIN IMMEDIATE`. */
  afterBegin?: () => void;
  /** Runs after the callback resolved and before `COMMIT`. */
  beforeCommit?: () => void;
  /** Runs right after a successful `COMMIT` ("committed, but the reply was lost"). */
  afterCommit?: () => void;
  /** Runs before `ROLLBACK`; throwing here simulates a ROLLBACK that itself fails. */
  beforeRollback?: () => void;
}

interface RollbackOutcome {
  failed: boolean;
  error?: unknown;
}

export class NodeSqliteDatabase implements SqlDatabase {
  private transactionOpen = false;
  /** Installed by tests that need a mid-transaction fault; `null` in normal suites. */
  hooks: NodeSqliteTransactionHooks | null = null;
  /**
   * When true, `transaction` throws {@link TransactionError} with the phase
   * recorded at the throw site, mirroring `TauriSqlDatabase`. Left false by
   * default so the existing suites keep receiving the original error object.
   */
  transactionErrors = false;

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
    // One `finally` for the whole lifecycle: a throw from either phase must not
    // leave the flag set, or the next transaction on this connection is "nested".
    try {
      this.hooks?.afterBegin?.();
      let result: T;
      try {
        result = await work(this);
        this.hooks?.beforeCommit?.();
      } catch (error) {
        const rollback = this.rollbackAfterFailure();
        throw this.failure("callback", error, rollback);
      }
      try {
        this.connection.exec("COMMIT");
      } catch (error) {
        const rollback = this.rollbackAfterFailure();
        throw this.failure("commit", error, rollback);
      }
      try {
        this.hooks?.afterCommit?.();
      } catch (error) {
        // The COMMIT already happened: no rollback is possible, so this is a lost reply.
        throw this.failure("commit", error, { failed: false });
      }
      return result;
    } finally {
      this.transactionOpen = false;
    }
  }

  /**
   * Wrap a failure per the driver contract, or rethrow it untouched so the
   * 52 suites that predate this contract keep their assertions.
   */
  private failure(
    phase: "callback" | "commit",
    error: unknown,
    rollback: RollbackOutcome,
  ): unknown {
    if (!this.transactionErrors) return error;
    return new TransactionError(
      phase,
      error,
      rollback.failed,
      phase === "commit" ? "Transaction commit failed" : "Transaction callback failed",
      rollback.error === undefined ? {} : { rollbackCause: rollback.error },
    );
  }

  /** Always attempts the ROLLBACK; a throwing hook counts as a failed rollback. */
  private rollbackAfterFailure(): RollbackOutcome {
    let hookError: unknown;
    try {
      this.hooks?.beforeRollback?.();
    } catch (error) {
      hookError = error;
    }
    let rollbackError: unknown;
    try {
      this.connection.exec("ROLLBACK");
    } catch (error) {
      rollbackError = error;
    }
    const error = hookError ?? rollbackError;
    return error === undefined
      ? { failed: false }
      : { failed: hookError !== undefined || rollbackError !== undefined, error };
  }

  close(): void {
    this.connection.close();
  }
}
