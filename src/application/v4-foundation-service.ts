import { assertUserInputMoney, money } from "../model/money.js";
import { ApplicationDataError, type SqlDatabase } from "../persistence/database.js";
import { type PlanningIncomeMonthDecision, Repositories } from "../persistence/repositories.js";
import { sameMoneyValue } from "./value-equality.js";

export interface V4FinancialReadState {
  planningIncome: Awaited<ReturnType<Repositories["resolvePlanningIncomeForMonth"]>>;
  actualIncome: Awaited<ReturnType<Repositories["actualIncomeAt"]>>;
  actualIncomeHistory: Array<{
    id: string;
    revisionId: number | null;
    asOfDate: string;
    amount: string;
    status: "EXPECTED" | "PENDING" | "RECEIVED";
    date: string;
    active: boolean;
  }>;
  cashAccounts: Awaited<ReturnType<Repositories["cashAccountsAt"]>>;
  cashHistory: Array<{
    id: string;
    asOfDate: string;
    name: string;
    balance: string | null;
    includeInSafetyResources: boolean | null;
    active: boolean;
    revisionId: number | null;
  }>;
  assetHistory: Array<{
    id: string;
    asOfDate: string;
    name: string;
    kind: "LIQUID_INVESTMENT" | "OTHER";
    currentValue: string | null;
    includeInSafetyResources: boolean;
    active: boolean;
    revisionId: number | null;
  }>;
  debtHistory: Array<{
    id: string;
    asOfDate: string;
    periodMonth: string;
    name: string;
    currentBalance: string | null;
    currentMonthDue: string | null;
    fixedMonthlyPayment: string | null;
    active: boolean;
    revisionId: number | null;
  }>;
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
    const [planningIncome, actualIncome, cashAccounts, historyRows, cashRows, assetRows, debtRows] =
      await Promise.all([
        this.repositories.resolvePlanningIncomeForMonth(periodMonth, asOfDate),
        this.repositories.actualIncomeAt(periodMonth, asOfDate),
        this.repositories.cashAccountsAt(asOfDate),
        this.db.select(
          `SELECT i.id,NULL AS revision_id,i.created_at AS as_of_date,i.amount,i.status,i.date,1 AS active
        FROM income_records i WHERE i.kind='ACTUAL' AND i.period_month=? AND i.date<=?
        UNION ALL
        SELECT r.income_id AS id,r.revision_id,r.as_of_date,r.amount,r.status,r.date,r.active
        FROM actual_income_revisions r JOIN income_records i ON i.id=r.income_id
        WHERE i.kind='ACTUAL' AND i.period_month=? AND r.as_of_date<=?
        ORDER BY as_of_date,revision_id`,
          [periodMonth, asOfDate, periodMonth, asOfDate],
        ),
        this.db.select(
          `SELECT a.id,s.as_of_date,a.name,s.balance,a.include_in_safety_resources,1 AS active,NULL AS revision_id
        FROM cash_balance_snapshots s JOIN cash_accounts a ON a.id=s.account_id WHERE s.as_of_date<=?
        UNION ALL SELECT account_id,as_of_date,name,balance,include_in_safety_resources,1,revision_id FROM cash_account_revisions WHERE as_of_date<=?
        UNION ALL SELECT l.account_id,l.as_of_date,a.name,NULL,a.include_in_safety_resources,l.active,l.revision_id FROM cash_account_lifecycle_revisions l JOIN cash_accounts a ON a.id=l.account_id WHERE l.as_of_date<=?
        ORDER BY as_of_date,revision_id`,
          [asOfDate, asOfDate, asOfDate],
        ),
        this.db.select(
          `SELECT a.id,s.as_of_date,a.name,a.kind,s.value AS current_value,a.include_in_safety_resources,1 AS active,NULL AS revision_id
        FROM asset_value_snapshots s JOIN assets a ON a.id=s.asset_id WHERE s.as_of_date<=?
        UNION ALL SELECT asset_id,as_of_date,name,kind,current_value,include_in_safety_resources,active,revision_id FROM asset_revisions WHERE as_of_date<=?
        ORDER BY as_of_date,revision_id`,
          [asOfDate, asOfDate],
        ),
        this.db.select(
          `SELECT d.id,f.as_of_date,f.period_month,d.name,f.current_balance,f.current_month_due,d.fixed_monthly_payment,1 AS active,NULL AS revision_id
        FROM debt_period_facts f JOIN debts d ON d.id=f.debt_id WHERE f.as_of_date<=?
        UNION ALL SELECT debt_id,as_of_date,period_month,name,current_balance,current_month_due,fixed_monthly_payment,active,revision_id FROM debt_revisions WHERE as_of_date<=?
        ORDER BY as_of_date,revision_id`,
          [asOfDate, asOfDate],
        ),
      ]);
    const actualIncomeHistory = historyRows.map((row) => ({
      id: String(row.id),
      revisionId: row.revision_id === null ? null : Number(row.revision_id),
      asOfDate: String(row.as_of_date).slice(0, 10),
      amount: String(row.amount),
      status: String(row.status) as "EXPECTED" | "PENDING" | "RECEIVED",
      date: String(row.date),
      active: Number(row.active) === 1,
    }));
    const cashHistory = cashRows.map((row) => ({
      id: String(row.id),
      asOfDate: String(row.as_of_date).slice(0, 10),
      name: String(row.name),
      balance: row.balance === null ? null : String(row.balance),
      includeInSafetyResources:
        row.include_in_safety_resources === null
          ? null
          : Number(row.include_in_safety_resources) === 1,
      active: Number(row.active) === 1,
      revisionId: row.revision_id === null ? null : Number(row.revision_id),
    }));
    const assetHistory = assetRows.map((row) => ({
      id: String(row.id),
      asOfDate: String(row.as_of_date).slice(0, 10),
      name: String(row.name),
      kind: String(row.kind) as "LIQUID_INVESTMENT" | "OTHER",
      currentValue: row.current_value === null ? null : String(row.current_value),
      includeInSafetyResources: Number(row.include_in_safety_resources) === 1,
      active: Number(row.active) === 1,
      revisionId: row.revision_id === null ? null : Number(row.revision_id),
    }));
    const debtHistory = debtRows.map((row) => ({
      id: String(row.id),
      asOfDate: String(row.as_of_date).slice(0, 10),
      periodMonth: String(row.period_month),
      name: String(row.name),
      currentBalance: row.current_balance === null ? null : String(row.current_balance),
      currentMonthDue: row.current_month_due === null ? null : String(row.current_month_due),
      fixedMonthlyPayment:
        row.fixed_monthly_payment === null ? null : String(row.fixed_monthly_payment),
      active: Number(row.active) === 1,
      revisionId: row.revision_id === null ? null : Number(row.revision_id),
    }));
    return {
      planningIncome,
      actualIncome,
      actualIncomeHistory,
      cashAccounts,
      cashHistory,
      assetHistory,
      debtHistory,
    };
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
    if (!prior && normalized.decision === "INHERIT")
      return {
        status: "NO_CHANGE",
        persistenceConfirmed: true,
        persistenceOutcome: "CONFIRMED_PERSISTED",
      };
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

  async deactivateAsset(assetId: string, asOfDate: string): Promise<V4MutationResult> {
    if (!assetId || !dateValid(asOfDate))
      return {
        status: "VALIDATION_FAILED",
        code: "INVALID_ASSET_LIFECYCLE",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    const asset = (await this.repositories.assetsAt(asOfDate)).find((item) => item.id === assetId);
    if (!asset)
      return {
        status: "VALIDATION_FAILED",
        code: "ASSET_NOT_FOUND_OR_INACTIVE",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    try {
      const result = await this.db.execute(
        "INSERT INTO asset_revisions(asset_id,as_of_date,name,kind,include_in_safety_resources,current_value,active,created_at) VALUES(?,?,?,?,?,?,0,?)",
        [
          asset.id,
          asOfDate,
          asset.name,
          asset.kind,
          Number(asset.includeInSafetyResources),
          asset.currentValue,
          this.now(),
        ],
      );
      const row = (
        await this.db.select(
          "SELECT asset_id,as_of_date,active FROM asset_revisions WHERE revision_id=?",
          [result.lastInsertId],
        )
      )[0];
      return row &&
        row.asset_id === asset.id &&
        row.as_of_date === asOfDate &&
        Number(row.active) === 0
        ? {
            status: "SAVED",
            revisionId: Number(result.lastInsertId),
            persistenceConfirmed: true,
            persistenceOutcome: "CONFIRMED_PERSISTED",
          }
        : committedReadbackFailure("READBACK_MISMATCH");
    } catch (error) {
      return unknownFailure(error);
    }
  }

  async deactivateDebt(
    debtId: string,
    periodMonth: string,
    asOfDate: string,
  ): Promise<V4MutationResult> {
    if (!debtId || !monthValid(periodMonth) || !dateValid(asOfDate))
      return {
        status: "VALIDATION_FAILED",
        code: "INVALID_DEBT_LIFECYCLE",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    const debt = (await this.repositories.debtsAt(periodMonth, asOfDate, true)).find(
      (item) => item.id === debtId,
    );
    if (!debt)
      return {
        status: "VALIDATION_FAILED",
        code: "DEBT_FACT_REQUIRED_BEFORE_DEACTIVATION",
        persistenceConfirmed: false,
        persistenceOutcome: "NOT_ATTEMPTED",
      };
    try {
      const result = await this.db.execute(
        "INSERT INTO debt_revisions(debt_id,period_month,as_of_date,name,current_balance,current_month_due,fixed_monthly_payment,active,created_at) VALUES(?,?,?,?,?,?,?,0,?)",
        [
          debt.id,
          periodMonth,
          asOfDate,
          debt.name,
          debt.currentBalance,
          debt.currentMonthDue ?? null,
          debt.fixedMonthlyPayment,
          this.now(),
        ],
      );
      const row = (
        await this.db.select(
          "SELECT debt_id,period_month,as_of_date,active FROM debt_revisions WHERE revision_id=?",
          [result.lastInsertId],
        )
      )[0];
      return row &&
        row.debt_id === debt.id &&
        row.period_month === periodMonth &&
        row.as_of_date === asOfDate &&
        Number(row.active) === 0
        ? {
            status: "SAVED",
            revisionId: Number(result.lastInsertId),
            persistenceConfirmed: true,
            persistenceOutcome: "CONFIRMED_PERSISTED",
          }
        : committedReadbackFailure("READBACK_MISMATCH");
    } catch (error) {
      return unknownFailure(error);
    }
  }
}
