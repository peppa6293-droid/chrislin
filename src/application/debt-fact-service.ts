import { assertUserInputMoney, money } from "../model/money.js";
import { calculateMonthlyModel } from "../model/monthly-model.js";
import { ApplicationDataError, type SqlDatabase } from "../persistence/database.js";
import { Repositories } from "../persistence/repositories.js";
import { ApplicationModelError, buildMonthlyModelInput } from "./monthly-model-service.js";
import { getHomeApplicationState, type HomeApplicationState } from "./product-service.js";
import { sameMoneyValue } from "./value-equality.js";

export interface SaveCurrentMonthDebtFactCommand {
  debtId: string;
  currentBalance: string;
  currentMonthDue: string | null;
}

interface ConfirmedFact {
  debtId: string;
  currentBalance: string;
  currentMonthDue: string | null;
  confirmation: "COMMIT_AND_READBACK" | "READBACK_AFTER_COMMIT_ERROR";
}

export type SaveCurrentMonthDebtFactResult =
  | ({ status: "SAVED_MODEL_READY"; home: HomeApplicationState } & ConfirmedFact)
  | ({
      status: "SAVED_NEEDS_CURRENT_MONTH_DEBT_FACTS";
      unresolvedDebtIds: string[];
    } & ConfirmedFact)
  | {
      status: "NO_CHANGE";
      debtId: string;
      currentBalance: string;
      currentMonthDue: string | null;
      unresolvedDebtIds: string[];
    }
  | {
      status: "VALIDATION_FAILED";
      code: string;
      message: string;
      persistenceConfirmed: false;
      persistenceOutcome: "NOT_ATTEMPTED";
    }
  | { status: "CONFLICT_OR_UNKNOWN_ID"; code: string; message: string }
  | {
      status: "SAVE_FAILED";
      code: string;
      message: string;
      persistenceConfirmed: boolean;
      persistenceOutcome:
        | "CONFIRMED_PERSISTED"
        | "CONFIRMED_ROLLED_BACK"
        | "OUTCOME_UNKNOWN"
        | "NOT_ATTEMPTED";
    };

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 0));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

function readCommand(
  value: unknown,
  asOfDate: unknown,
):
  | { ok: true; command: SaveCurrentMonthDebtFactCommand; asOfDate: string }
  | {
      ok: false;
      result: Extract<SaveCurrentMonthDebtFactResult, { status: "VALIDATION_FAILED" }>;
    } {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return {
      ok: false,
      result: {
        status: "VALIDATION_FAILED",
        code: "INVALID_COMMAND",
        message: "A debt-fact command is required.",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      },
    };
  const raw = value as Record<string, unknown>;
  if (
    Object.keys(raw).some((key) => !["debtId", "currentBalance", "currentMonthDue"].includes(key))
  )
    return {
      ok: false,
      result: {
        status: "VALIDATION_FAILED",
        code: "INVALID_COMMAND",
        message: "The debt-fact command contains unsupported fields.",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      },
    };
  if (typeof raw.debtId !== "string" || raw.debtId.trim() === "")
    return {
      ok: false,
      result: {
        status: "VALIDATION_FAILED",
        code: "INVALID_DEBT_ID",
        message: "A debt ID is required.",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      },
    };
  if (typeof asOfDate !== "string" || !validDate(asOfDate))
    return {
      ok: false,
      result: {
        status: "VALIDATION_FAILED",
        code: "INVALID_DATE",
        message: "A valid as-of date is required.",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      },
    };
  if (typeof raw.currentBalance !== "string" || raw.currentBalance.trim() === "")
    return {
      ok: false,
      result: {
        status: "VALIDATION_FAILED",
        code: "INVALID_CURRENT_BALANCE",
        message: "Current balance is required; blank is not zero.",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      },
    };
  if (
    raw.currentMonthDue !== null &&
    (typeof raw.currentMonthDue !== "string" || raw.currentMonthDue.trim() === "")
  )
    return {
      ok: false,
      result: {
        status: "VALIDATION_FAILED",
        code: "INVALID_CURRENT_MONTH_DUE",
        message: "Current-month due must be an amount or explicit null.",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      },
    };
  try {
    const balance = assertUserInputMoney(raw.currentBalance.trim(), "Current balance");
    if (money(balance).isNegative()) throw new RangeError("Current balance cannot be negative.");
    const due =
      raw.currentMonthDue === null
        ? null
        : assertUserInputMoney((raw.currentMonthDue as string).trim(), "Current-month due");
    if (due !== null && money(due).isNegative())
      throw new RangeError("Current-month due cannot be negative.");
    return {
      ok: true,
      command: { debtId: raw.debtId.trim(), currentBalance: balance, currentMonthDue: due },
      asOfDate,
    };
  } catch (error) {
    return {
      ok: false,
      result: {
        status: "VALIDATION_FAILED",
        code: "INVALID_DEBT_FACT",
        message: error instanceof Error ? error.message : "Debt fact is invalid.",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      },
    };
  }
}

function factMatches(
  fact: { currentBalance: string; currentMonthDue: string | null } | null,
  command: SaveCurrentMonthDebtFactCommand,
): boolean {
  return Boolean(
    fact &&
      sameMoneyValue(fact.currentBalance, command.currentBalance) &&
      ((fact.currentMonthDue === null && command.currentMonthDue === null) ||
        (fact.currentMonthDue !== null &&
          command.currentMonthDue !== null &&
          sameMoneyValue(fact.currentMonthDue, command.currentMonthDue))),
  );
}

function errorResult(
  error: unknown,
  persistenceOutcome:
    | "CONFIRMED_PERSISTED"
    | "CONFIRMED_ROLLED_BACK"
    | "OUTCOME_UNKNOWN"
    | "NOT_ATTEMPTED" = "OUTCOME_UNKNOWN",
): SaveCurrentMonthDebtFactResult {
  const code = error instanceof ApplicationDataError ? error.code : "SAVE_FAILED";
  const message = error instanceof Error ? error.message : "Debt fact could not be saved.";
  if (
    persistenceOutcome === "NOT_ATTEMPTED" &&
    ["RECORD_NOT_FOUND", "UNKNOWN_DEBT_ID", "INACTIVE_DEBT"].includes(code)
  )
    return { status: "CONFLICT_OR_UNKNOWN_ID", code, message };
  if (error instanceof ApplicationModelError)
    return {
      status: "SAVE_FAILED",
      code: persistenceOutcome === "CONFIRMED_PERSISTED" ? "MODEL_REFRESH_FAILED" : error.code,
      message:
        persistenceOutcome === "CONFIRMED_PERSISTED"
          ? `Debt fact was saved, but Home/model refresh failed: ${message}`
          : message,
      persistenceConfirmed: persistenceOutcome === "CONFIRMED_PERSISTED",
      persistenceOutcome,
    };
  return {
    status: "SAVE_FAILED",
    code,
    message,
    persistenceConfirmed: persistenceOutcome === "CONFIRMED_PERSISTED",
    persistenceOutcome,
  };
}

/** Save one current-month debt fact; never calculates or returns a model while another active debt fact is missing. */
export async function saveCurrentMonthDebtFact(
  db: SqlDatabase,
  rawCommand: unknown,
  rawAsOfDate: unknown,
): Promise<SaveCurrentMonthDebtFactResult> {
  const parsed = readCommand(rawCommand, rawAsOfDate);
  if (!parsed.ok) return parsed.result;
  const { command, asOfDate } = parsed;
  const targetMonth = asOfDate.slice(0, 7);
  const repositories = new Repositories(db);

  let metadata: Awaited<ReturnType<Repositories["activeDebtMetadataAt"]>>;
  let priorFact: Awaited<ReturnType<Repositories["currentDebtFactAt"]>>;
  let unresolvedBefore: string[];
  try {
    [metadata, priorFact, unresolvedBefore] = await Promise.all([
      repositories.activeDebtMetadataAt(command.debtId, targetMonth, asOfDate),
      repositories.currentDebtFactAt(command.debtId, targetMonth, asOfDate),
      repositories.missingCurrentMonthDebtFactIds(targetMonth, asOfDate),
    ]);
  } catch (error) {
    return errorResult(error, "NOT_ATTEMPTED");
  }
  if (!metadata)
    return {
      status: "CONFLICT_OR_UNKNOWN_ID",
      code: "UNKNOWN_DEBT_ID",
      message: `Active debt ${command.debtId} does not exist.`,
    };

  if (factMatches(priorFact, command))
    return {
      status: "NO_CHANGE",
      debtId: command.debtId,
      currentBalance: priorFact?.currentBalance ?? command.currentBalance,
      currentMonthDue: priorFact?.currentMonthDue ?? null,
      unresolvedDebtIds: unresolvedBefore,
    };

  let transactionFailureValue: unknown;
  let transactionThrew = false;
  let transactionCompletedSuccessfully = false;
  let insertedRevisionId: number | undefined;
  try {
    await db.transaction(async (tx) => {
      const profile = await new Repositories(tx).getProfile();
      if (!profile)
        throw new ApplicationDataError(
          "INITIALIZATION_REQUIRED",
          "Financial settings are required.",
        );
      const recordingTx: SqlDatabase = {
        select: (sql, binds) => tx.select(sql, binds),
        transaction: (work) => tx.transaction(work),
        execute: async (sql, binds) => {
          const result = await tx.execute(sql, binds);
          if (/^\s*INSERT\s+INTO\s+debt_revisions\b/i.test(sql)) {
            insertedRevisionId = result.lastInsertId;
          }
          return result;
        },
      };
      const txRepos = new Repositories(recordingTx);
      await txRepos.appendDebtRevision(
        profile.id,
        {
          id: command.debtId,
          name: metadata.name,
          currentBalance: command.currentBalance,
          currentMonthDue: command.currentMonthDue,
          fixedMonthlyPayment: metadata.fixedMonthlyPayment,
        },
        targetMonth,
        asOfDate,
        `${asOfDate}T00:00:00.000Z`,
        () => command.debtId,
      );
      const unresolved = await txRepos.missingCurrentMonthDebtFactIds(targetMonth, asOfDate);
      if (unresolved.length === 0) {
        const built = await buildMonthlyModelInput(tx, targetMonth, asOfDate);
        if (built.status !== "READY")
          throw new ApplicationDataError(
            "INITIALIZATION_REQUIRED",
            "Financial settings are required.",
          );
        try {
          calculateMonthlyModel(built.input);
        } catch (error) {
          throw new ApplicationModelError(error);
        }
      }
    });
    transactionCompletedSuccessfully = true;
  } catch (error) {
    transactionThrew = true;
    transactionFailureValue = error;
  }

  // A successful transaction API response is positive commit evidence. A lost
  // response can only be recovered by checking the exact inserted revision;
  // the latest effective fact may have been superseded by another revision.
  let transactionConfirmed = transactionCompletedSuccessfully;
  if (transactionThrew && insertedRevisionId !== undefined) {
    try {
      const exactRevision = await db.select(
        `SELECT debt_id,period_month,as_of_date,current_balance,current_month_due
         FROM debt_revisions WHERE revision_id=?`,
        [insertedRevisionId],
      );
      const row = exactRevision[0];
      if (row) {
        const matches =
          row.debt_id === command.debtId &&
          row.period_month === targetMonth &&
          row.as_of_date === asOfDate &&
          typeof row.current_balance === "string" &&
          sameMoneyValue(row.current_balance, command.currentBalance) &&
          (row.current_month_due === null
            ? command.currentMonthDue === null
            : typeof row.current_month_due === "string" &&
              command.currentMonthDue !== null &&
              sameMoneyValue(row.current_month_due, command.currentMonthDue));
        if (matches) {
          // Historical exact-revision evidence proves this command committed.
          transactionConfirmed = true;
        } else {
          return errorResult(transactionFailureValue, "OUTCOME_UNKNOWN");
        }
      } else {
        // Failed transaction plus authoritative absence of its exact inserted
        // row is positive rollback evidence.
        return errorResult(transactionFailureValue, "CONFIRMED_ROLLED_BACK");
      }
    } catch (error) {
      return errorResult(error, "OUTCOME_UNKNOWN");
    }
  } else if (transactionThrew) {
    // Without an exact inserted-row receipt, latest-value mismatch cannot
    // distinguish rollback from a committed revision later superseded.
    return errorResult(transactionFailureValue, "OUTCOME_UNKNOWN");
  }

  let persistedFact: Awaited<ReturnType<Repositories["currentDebtFactAt"]>>;
  let unresolvedAfter: string[];
  try {
    const readback = new Repositories(db);
    [persistedFact, unresolvedAfter] = await Promise.all([
      readback.currentDebtFactAt(command.debtId, targetMonth, asOfDate),
      readback.missingCurrentMonthDebtFactIds(targetMonth, asOfDate),
    ]);
  } catch (error) {
    return errorResult(error, transactionConfirmed ? "CONFIRMED_PERSISTED" : "OUTCOME_UNKNOWN");
  }

  if (!factMatches(persistedFact, command))
    return errorResult(
      new ApplicationDataError(
        "READBACK_MISMATCH",
        "Saved debt fact did not match authoritative readback.",
      ),
      transactionConfirmed ? "CONFIRMED_PERSISTED" : "OUTCOME_UNKNOWN",
    );

  let home: HomeApplicationState | undefined;
  if (unresolvedAfter.length === 0) {
    try {
      home = await getHomeApplicationState(db, asOfDate);
    } catch (error) {
      return errorResult(error, "CONFIRMED_PERSISTED");
    }
  }
  const confirmed: ConfirmedFact = {
    debtId: command.debtId,
    currentBalance: persistedFact?.currentBalance ?? command.currentBalance,
    currentMonthDue: persistedFact?.currentMonthDue ?? null,
    confirmation: transactionThrew ? "READBACK_AFTER_COMMIT_ERROR" : "COMMIT_AND_READBACK",
  };
  if (unresolvedAfter.length > 0)
    return {
      status: "SAVED_NEEDS_CURRENT_MONTH_DEBT_FACTS",
      ...confirmed,
      unresolvedDebtIds: unresolvedAfter,
    };
  if (!home)
    return {
      status: "SAVE_FAILED",
      code: "MODEL_READBACK_FAILED",
      message: "Model-ready Home state was unavailable after fact readback.",
      persistenceConfirmed: true,
      persistenceOutcome: "CONFIRMED_PERSISTED",
    };
  return { status: "SAVED_MODEL_READY", ...confirmed, home };
}
