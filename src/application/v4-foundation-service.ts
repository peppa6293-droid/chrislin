import { assertUserInputMoney, money } from "../model/money.js";
import { ApplicationDataError, type SqlDatabase } from "../persistence/database.js";
import { type PlanningIncomeMonthDecision, Repositories } from "../persistence/repositories.js";
import { sameMoneyValue } from "./value-equality.js";

export interface V4FinancialReadState {
  planningIncome: Awaited<ReturnType<Repositories["resolvePlanningIncomeForMonth"]>>;
  actualIncome: Awaited<ReturnType<Repositories["actualIncomeAt"]>>;
  cashAccounts: Awaited<ReturnType<Repositories["cashAccountsAt"]>>;
}

export type V4MutationResult =
  | { status: "NO_CHANGE"; persistenceConfirmed: true; persistenceOutcome: "CONFIRMED_PERSISTED" }
  | {
      status: "SAVED";
      revisionId: number;
      persistenceConfirmed: true;
      persistenceOutcome: "CONFIRMED_PERSISTED";
    }
  | {
      status: "VALIDATION_FAILED";
      code: string;
      persistenceConfirmed: false;
      persistenceOutcome: "NOT_ATTEMPTED";
    }
  | {
      status: "SAVE_FAILED";
      persistenceConfirmed: boolean;
      persistenceOutcome: "CONFIRMED_PERSISTED" | "OUTCOME_UNKNOWN";
      code: string;
    };

function dateValid(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 0));
  return date.getUTCFullYear() === y && date.getUTCMonth() + 1 === m && date.getUTCDate() === d;
}
function monthValid(value: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(value);
}
function codeOf(error: unknown): string {
  return error instanceof ApplicationDataError ? error.code : "SAVE_FAILED";
}
function validRevisionId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function unknownFailure(error: unknown): V4MutationResult {
  return {
    status: "SAVE_FAILED",
    code: codeOf(error),
    persistenceConfirmed: false,
    persistenceOutcome: "OUTCOME_UNKNOWN",
  };
}
function committedReadbackFailure(code: string): V4MutationResult {
  return {
    status: "SAVE_FAILED",
    code,
    persistenceConfirmed: true,
    persistenceOutcome: "CONFIRMED_PERSISTED",
  };
}

export class V4FoundationService {
  private readonly repositories: Repositories;
  constructor(
    private readonly db: SqlDatabase,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {
    this.repositories = new Repositories(db);
  }

  async read(periodMonth: string, asOfDate: string): Promise<V4FinancialReadState> {
    if (!monthValid(periodMonth) || !dateValid(asOfDate))
      throw new ApplicationDataError(
        "INVALID_DATE",
        "A valid period month and as-of date are required.",
      );
    const [planningIncome, actualIncome, cashAccounts] = await Promise.all([
      this.repositories.resolvePlanningIncomeForMonth(periodMonth, asOfDate),
      this.repositories.actualIncomeAt(periodMonth, asOfDate),
      this.repositories.cashAccountsAt(asOfDate),
    ]);
    return { planningIncome, actualIncome, cashAccounts };
  }

  async savePlanningMonthDecision(
    periodMonth: string,
    asOfDate: string,
    decision: PlanningIncomeMonthDecision,
  ): Promise<V4MutationResult> {
    if (!monthValid(periodMonth) || !dateValid(asOfDate))
      return {
        status: "VALIDATION_FAILED",
        code: "INVALID_DATE",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    let normalized: PlanningIncomeMonthDecision;
    try {
      normalized =
        decision.decision === "INHERIT"
          ? { decision: "INHERIT", amount: null }
          : {
              decision: "OVERRIDE",
              amount: assertUserInputMoney(decision.amount, "Planning income"),
            };
      if (normalized.decision === "OVERRIDE" && money(normalized.amount).isNegative())
        throw new RangeError("Planning income cannot be negative.");
    } catch {
      return {
        status: "VALIDATION_FAILED",
        code: "INVALID_PLANNING_INCOME",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    }
    const profile = await this.repositories.getProfile();
    if (!profile)
      return {
        status: "VALIDATION_FAILED",
        code: "PROFILE_NOT_FOUND",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    const prior = await this.repositories.planningIncomeMonthDecisionAt(
      profile.id,
      periodMonth,
      asOfDate,
    );
    if (
      prior &&
      prior.asOfDate === asOfDate &&
      ((prior.decision.decision === "INHERIT" && normalized.decision === "INHERIT") ||
        (prior.decision.decision === "OVERRIDE" &&
          normalized.decision === "OVERRIDE" &&
          sameMoneyValue(prior.decision.amount, normalized.amount)))
    )
      return {
        status: "NO_CHANGE",
        persistenceConfirmed: true,
        persistenceOutcome: "CONFIRMED_PERSISTED",
      };
    let revisionId: number | undefined;
    try {
      revisionId = await this.repositories.appendPlanningIncomeMonthDecision(
        profile.id,
        periodMonth,
        asOfDate,
        normalized,
        this.now(),
      );
    } catch (error) {
      return unknownFailure(error);
    }
    if (!validRevisionId(revisionId))
      return {
        status: "SAVE_FAILED",
        code: "MISSING_REVISION_ID",
        persistenceConfirmed: false,
        persistenceOutcome: "OUTCOME_UNKNOWN",
      };
    try {
      const row = await this.repositories.planningIncomeMonthRevisionById(revisionId);
      if (
        !row ||
        Number(row.revision_id) !== revisionId ||
        row.profile_id !== profile.id ||
        row.period_month !== periodMonth ||
        row.as_of_date !== asOfDate ||
        row.decision !== normalized.decision ||
        (normalized.decision === "INHERIT" ? row.amount !== null : row.amount !== normalized.amount)
      )
        return committedReadbackFailure("READBACK_MISMATCH");
      return {
        status: "SAVED",
        revisionId,
        persistenceConfirmed: true,
        persistenceOutcome: "CONFIRMED_PERSISTED",
      };
    } catch (error) {
      return committedReadbackFailure(
        codeOf(error) === "SAVE_FAILED" ? "READBACK_FAILED" : codeOf(error),
      );
    }
  }

  async reviseActualIncome(input: {
    incomeId: string;
    periodMonth: string;
    asOfDate: string;
    amount: string;
    status: "EXPECTED" | "PENDING" | "RECEIVED";
    date: string;
    void?: boolean;
  }): Promise<V4MutationResult> {
    if (
      !input.incomeId ||
      !monthValid(input.periodMonth) ||
      !dateValid(input.asOfDate) ||
      !dateValid(input.date) ||
      input.date.slice(0, 7) !== input.periodMonth ||
      !(input.status === "EXPECTED" || input.status === "PENDING" || input.status === "RECEIVED")
    )
      return {
        status: "VALIDATION_FAILED",
        code: "INVALID_ACTUAL_INCOME",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    let amount: string;
    try {
      amount = assertUserInputMoney(input.amount, "Actual income");
      if (money(amount).isNegative()) throw new RangeError();
    } catch {
      return {
        status: "VALIDATION_FAILED",
        code: "INVALID_ACTUAL_INCOME_AMOUNT",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    }
    const existing = await this.db.select(
      "SELECT id FROM income_records WHERE id=? AND kind='ACTUAL' AND period_month=?",
      [input.incomeId, input.periodMonth],
    );
    if (!existing.length)
      return {
        status: "VALIDATION_FAILED",
        code: "ACTUAL_INCOME_NOT_FOUND",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    let revisionId: number | undefined;
    try {
      revisionId = await this.repositories.appendActualIncomeRevision({
        incomeId: input.incomeId,
        asOfDate: input.asOfDate,
        amount,
        status: input.status,
        date: input.date,
        active: !input.void,
        now: this.now(),
      });
    } catch (error) {
      return unknownFailure(error);
    }
    if (!validRevisionId(revisionId))
      return {
        status: "SAVE_FAILED",
        code: "MISSING_REVISION_ID",
        persistenceConfirmed: false,
        persistenceOutcome: "OUTCOME_UNKNOWN",
      };
    try {
      const row = await this.db.select(
        "SELECT income_id,as_of_date,amount,status,date,active FROM actual_income_revisions WHERE revision_id=?",
        [revisionId],
      );
      const saved = row[0];
      if (
        !saved ||
        saved.income_id !== input.incomeId ||
        saved.as_of_date !== input.asOfDate ||
        saved.amount !== amount ||
        saved.status !== input.status ||
        saved.date !== input.date ||
        Number(saved.active) !== (input.void ? 0 : 1)
      )
        return committedReadbackFailure("READBACK_MISMATCH");
      return {
        status: "SAVED",
        revisionId,
        persistenceConfirmed: true,
        persistenceOutcome: "CONFIRMED_PERSISTED",
      };
    } catch (error) {
      return committedReadbackFailure(
        codeOf(error) === "SAVE_FAILED" ? "READBACK_FAILED" : codeOf(error),
      );
    }
  }

  async deactivateCashAccount(accountId: string, asOfDate: string): Promise<V4MutationResult> {
    if (!accountId || !dateValid(asOfDate))
      return {
        status: "VALIDATION_FAILED",
        code: "INVALID_CASH_LIFECYCLE",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    const account = (
      await this.db.select("SELECT id,active FROM cash_accounts WHERE id=?", [accountId])
    )[0];
    if (!account)
      return {
        status: "VALIDATION_FAILED",
        code: "CASH_ACCOUNT_NOT_FOUND",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    const prior = (
      await this.db.select(
        "SELECT active,as_of_date FROM cash_account_lifecycle_revisions WHERE account_id=? AND as_of_date<=? ORDER BY as_of_date DESC,revision_id DESC LIMIT 1",
        [accountId, asOfDate],
      )
    )[0];
    if (Number(prior?.active ?? account.active) === 0)
      return {
        status: "NO_CHANGE",
        persistenceConfirmed: true,
        persistenceOutcome: "CONFIRMED_PERSISTED",
      };
    let revisionId: number | undefined;
    try {
      const result = await this.db.execute(
        "INSERT INTO cash_account_lifecycle_revisions(account_id,as_of_date,active,created_at) VALUES(?,?,0,?)",
        [accountId, asOfDate, this.now()],
      );
      revisionId = result.lastInsertId;
    } catch (error) {
      return unknownFailure(error);
    }
    if (!validRevisionId(revisionId))
      return {
        status: "SAVE_FAILED",
        code: "MISSING_REVISION_ID",
        persistenceConfirmed: false,
        persistenceOutcome: "OUTCOME_UNKNOWN",
      };
    try {
      const row = (
        await this.db.select(
          "SELECT account_id,as_of_date,active FROM cash_account_lifecycle_revisions WHERE revision_id=?",
          [revisionId],
        )
      )[0];
      if (
        !row ||
        row.account_id !== accountId ||
        row.as_of_date !== asOfDate ||
        Number(row.active) !== 0
      )
        return committedReadbackFailure("READBACK_MISMATCH");
      return {
        status: "SAVED",
        revisionId,
        persistenceConfirmed: true,
        persistenceOutcome: "CONFIRMED_PERSISTED",
      };
    } catch (error) {
      return committedReadbackFailure(
        codeOf(error) === "SAVE_FAILED" ? "READBACK_FAILED" : codeOf(error),
      );
    }
  }
}
