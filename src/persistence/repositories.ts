import { assertUserInputMoney, money } from "../model/money.js";
import type {
  Asset,
  Debt,
  ExpenseCategory,
  ExpenseKind,
  ExpenseRecord,
  FinancialProfile,
  FinancialSettings,
  IncomeRecord,
} from "../model/types.js";
import { ApplicationDataError, type SqlDatabase } from "./database.js";

export interface EssentialExpenseItem {
  id: string;
  category: ExpenseCategory;
  name: string;
  monthlyAmount: string;
}

export interface CashAccountRecord {
  id: string;
  name: string;
  includeInSafetyResources: boolean;
  balance: string;
}

export interface AssetRecord extends Asset {
  name: string;
}

export interface DebtRecord extends Debt {
  active: boolean;
}

export interface MaintenanceEssentialExpense {
  id?: string;
  category: ExpenseCategory;
  name: string;
  monthlyAmount: string;
}
export interface MaintenanceCashAccount {
  id?: string;
  name: string;
  includeInSafetyResources: boolean;
  balance: string;
}
export interface MaintenanceAsset {
  id?: string;
  name: string;
  kind: Asset["kind"];
  includeInSafetyResources: boolean;
  currentValue: string;
}
export interface MaintenanceDebt {
  id?: string;
  name: string;
  currentBalance: string;
  currentMonthDue: string | null;
  fixedMonthlyPayment: string | null;
}

export type PlanningIncomeMonthDecision =
  | { decision: "OVERRIDE"; amount: string }
  | { decision: "INHERIT"; amount: null };

export interface PlanningIncomeResolution {
  amount: string | null;
  source: "STABLE_BASELINE" | "MONTH_OVERRIDE" | "MONTH_INHERIT" | "LEGACY_V3_COMPATIBILITY";
  periodMonth: string;
  asOfDate: string;
  effectiveDate: string | null;
  revisionId?: number;
  recordId?: string;
}

export interface ActualIncomeRevisionState extends IncomeRecord {
  periodMonth: string;
  active: boolean;
}

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw invalidColumn(key);
  return value;
}

function nullableText(row: Row, key: string): string | null {
  const value = row[key];
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") throw invalidColumn(key);
  return value;
}

function bool(row: Row, key: string): boolean {
  const value = row[key];
  if (value === 0 || value === 1) return value === 1;
  if (value === false || value === true) return value;
  throw invalidColumn(key);
}

function invalidColumn(column: string): ApplicationDataError {
  return new ApplicationDataError(
    "INVALID_STORED_DATA",
    `Database column ${column} has an invalid value.`,
  );
}

function requireStoredUserInputMoney(value: string): string {
  try {
    return assertUserInputMoney(value, "Stored user amount");
  } catch {
    throw new ApplicationDataError(
      "INVALID_STORED_MONEY",
      "A stored money amount exceeds the supported money contract.",
    );
  }
}

export class Repositories {
  constructor(private readonly db: SqlDatabase) {}

  async createProfile(
    profile: FinancialProfile,
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    await this.db.execute("INSERT INTO profiles(id, display_name, created_at) VALUES(?,?,?)", [
      profile.id,
      profile.displayName ?? null,
      createdAt,
    ]);
  }

  /** Save the stable monthly planning income as a profile-wide planning record. */
  async saveStablePlanningIncome(
    profileId: string,
    amount: string,
    asOfDate: string,
    id: string,
  ): Promise<void> {
    await this.saveIncome(
      { id, kind: "PLANNING", status: "EXPECTED", amount, date: asOfDate },
      profileId,
      null,
      `${asOfDate}T00:00:00.000Z`,
    );
  }

  async getProfile(): Promise<FinancialProfile | null> {
    const row = (await this.db.select("SELECT id, display_name FROM profiles LIMIT 1"))[0];
    if (!row) return null;
    const displayName = nullableText(row, "display_name");
    return { id: text(row, "id"), ...(displayName === null ? {} : { displayName }) };
  }

  async updateProfile(profile: FinancialProfile): Promise<void> {
    const result = await this.db.execute("UPDATE profiles SET display_name=? WHERE id=?", [
      profile.displayName ?? null,
      profile.id,
    ]);
    if (!result.rowsAffected)
      throw new ApplicationDataError("PROFILE_NOT_FOUND", "Profile does not exist.");
  }

  async deleteProfile(id: string): Promise<void> {
    const result = await this.db.execute("DELETE FROM profiles WHERE id=?", [id]);
    if (!result.rowsAffected)
      throw new ApplicationDataError("PROFILE_NOT_FOUND", "Profile does not exist.");
  }

  async getSettings(): Promise<FinancialSettings | null> {
    const row = (await this.db.select("SELECT * FROM financial_settings LIMIT 1"))[0];
    if (!row) return null;
    const horizon = row.safety_recovery_horizon_months;
    if (horizon !== null && horizon !== undefined && typeof horizon !== "number")
      throw invalidColumn("safety_recovery_horizon_months");
    const target = row.safety_coverage_target_months;
    const floor = row.minimum_cash_coverage_months;
    if (typeof target !== "number" || typeof floor !== "number")
      throw invalidColumn("financial_settings months");
    const desired = requireStoredUserInputMoney(
      text(row, "desired_monthly_discretionary_spending"),
    );
    return {
      safetyCoverageTargetMonths: target,
      minimumCashCoverageMonths: floor,
      ...(typeof horizon === "number" ? { safetyRecoveryHorizonMonths: horizon } : {}),
      desiredMonthlyDiscretionarySpending: desired,
    };
  }

  async getSettingsAt(targetMonth: string, asOfDate: string): Promise<FinancialSettings | null> {
    const row = (
      await this.db.select(
        `SELECT safety_coverage_target_months,minimum_cash_coverage_months,safety_recovery_horizon_months,desired_monthly_discretionary_spending
       FROM settings_revisions WHERE effective_month<=? AND as_of_date<=? ORDER BY effective_month DESC,as_of_date DESC,revision_id DESC LIMIT 1`,
        [targetMonth, asOfDate],
      )
    )[0];
    if (!row) return this.getSettings();
    const horizon = row.safety_recovery_horizon_months;
    return {
      safetyCoverageTargetMonths: Number(row.safety_coverage_target_months),
      minimumCashCoverageMonths: Number(row.minimum_cash_coverage_months),
      ...(horizon === null || horizon === undefined
        ? {}
        : { safetyRecoveryHorizonMonths: Number(horizon) }),
      desiredMonthlyDiscretionarySpending: requireStoredUserInputMoney(
        String(row.desired_monthly_discretionary_spending),
      ),
    };
  }

  async appendPlanningIncomeRevision(
    profileId: string,
    effectiveMonth: string,
    asOfDate: string,
    amount: string,
    now: string,
  ): Promise<void> {
    await this.db.execute(
      "INSERT INTO planning_income_revisions(profile_id,effective_month,as_of_date,amount,created_at) VALUES(?,?,?,?,?)",
      [profileId, effectiveMonth, asOfDate, requireStoredUserInputMoney(amount), now],
    );
  }

  async appendPlanningIncomeMonthDecision(
    profileId: string,
    periodMonth: string,
    asOfDate: string,
    decision: PlanningIncomeMonthDecision,
    now: string,
  ): Promise<number | undefined> {
    const result = await this.db.execute(
      "INSERT INTO planning_income_month_revisions(profile_id,period_month,as_of_date,decision,amount,created_at) VALUES(?,?,?,?,?,?)",
      [
        profileId,
        periodMonth,
        asOfDate,
        decision.decision,
        decision.decision === "OVERRIDE" ? requireStoredUserInputMoney(decision.amount) : null,
        now,
      ],
    );
    return result.lastInsertId;
  }

  async planningIncomeMonthDecisionAt(
    profileId: string,
    periodMonth: string,
    asOfDate: string,
  ): Promise<{
    revisionId: number;
    decision: PlanningIncomeMonthDecision;
    asOfDate: string;
  } | null> {
    const row = (
      await this.db.select(
        `SELECT revision_id,decision,amount,as_of_date FROM planning_income_month_revisions
         WHERE profile_id=? AND period_month=? AND as_of_date<=?
         ORDER BY as_of_date DESC,revision_id DESC LIMIT 1`,
        [profileId, periodMonth, asOfDate],
      )
    )[0];
    if (!row) return null;
    const decision = text(row, "decision");
    const amount = nullableText(row, "amount");
    if (decision === "OVERRIDE" && amount !== null)
      return {
        revisionId: Number(row.revision_id),
        decision: { decision: "OVERRIDE", amount: requireStoredUserInputMoney(amount) },
        asOfDate: text(row, "as_of_date"),
      };
    if (decision === "INHERIT" && amount === null)
      return {
        revisionId: Number(row.revision_id),
        decision: { decision: "INHERIT", amount: null },
        asOfDate: text(row, "as_of_date"),
      };
    throw invalidColumn("planning_income_month_revisions decision/amount");
  }

  async planningIncomeMonthRevisionById(
    revisionId: number,
  ): Promise<Record<string, unknown> | null> {
    return (
      (
        await this.db.select(
          "SELECT revision_id,profile_id,period_month,as_of_date,decision,amount FROM planning_income_month_revisions WHERE revision_id=?",
          [revisionId],
        )
      )[0] ?? null
    );
  }

  async stablePlanningIncomeAt(
    periodMonth: string,
    asOfDate: string,
  ): Promise<{ amount: string; date: string; revisionId?: number; recordId?: string } | null> {
    const profile = await this.getProfile();
    const revision = profile
      ? (
          await this.db.select(
            `SELECT revision_id,as_of_date,amount FROM planning_income_revisions
             WHERE profile_id=? AND effective_month<=? AND as_of_date<=?
             ORDER BY effective_month DESC,as_of_date DESC,revision_id DESC LIMIT 1`,
            [profile.id, periodMonth, asOfDate],
          )
        )[0]
      : undefined;
    if (revision)
      return {
        amount: requireStoredUserInputMoney(text(revision, "amount")),
        date: text(revision, "as_of_date"),
        revisionId: Number(revision.revision_id),
      };
    const row = (
      await this.db.select(
        `SELECT id,amount,date FROM income_records WHERE kind='PLANNING' AND period_month IS NULL AND date<=?
         ORDER BY date DESC,id DESC LIMIT 1`,
        [asOfDate],
      )
    )[0];
    if (!row) return null;
    return {
      amount: requireStoredUserInputMoney(text(row, "amount")),
      date: text(row, "date"),
      recordId: text(row, "id"),
    };
  }

  async resolvePlanningIncomeForMonth(
    periodMonth: string,
    asOfDate: string,
  ): Promise<PlanningIncomeResolution> {
    const profile = await this.getProfile();
    const stable = await this.stablePlanningIncomeAt(periodMonth, asOfDate);
    if (!profile)
      return {
        amount: stable?.amount ?? null,
        source: "STABLE_BASELINE",
        periodMonth,
        asOfDate,
        effectiveDate: stable?.date ?? null,
      };

    const v4Decision = await this.planningIncomeMonthDecisionAt(profile.id, periodMonth, asOfDate);
    if (v4Decision?.decision.decision === "OVERRIDE")
      return {
        amount: v4Decision.decision.amount,
        source: "MONTH_OVERRIDE",
        periodMonth,
        asOfDate,
        effectiveDate: v4Decision.asOfDate,
        revisionId: v4Decision.revisionId,
      };
    if (v4Decision?.decision.decision === "INHERIT")
      return {
        amount: stable?.amount ?? null,
        source: "MONTH_INHERIT",
        periodMonth,
        asOfDate,
        effectiveDate: stable?.date ?? null,
        revisionId: v4Decision.revisionId,
      };

    const migration = (
      await this.db.select("SELECT applied_at FROM schema_migrations WHERE version=4")
    )[0];
    const migrationAt = migration ? text(migration, "applied_at") : null;
    const migrationMonth = migrationAt?.slice(0, 7) ?? null;
    const legacyMonthScoped =
      migrationMonth === null || periodMonth <= migrationMonth
        ? (
            await this.db.select(
              `SELECT id,period_month,date,amount FROM income_records
             WHERE kind='PLANNING' AND period_month IS NOT NULL AND period_month<=? AND date<=?
             ORDER BY period_month DESC,date DESC,id DESC LIMIT 1`,
              [periodMonth, asOfDate],
            )
          )[0]
        : (
            await this.db.select(
              `SELECT id,period_month,date,amount FROM income_records
             WHERE kind='PLANNING' AND period_month=? AND date<=?
             ORDER BY date DESC,id DESC LIMIT 1`,
              [periodMonth, asOfDate],
            )
          )[0];

    // V3's real stable-maintenance path wrote planning_income_revisions;
    // preserve its long-term effective_month<= behavior independently from
    // the month-scoped income_records compatibility bridge.
    if (stable?.revisionId || !legacyMonthScoped)
      return {
        amount: stable?.amount ?? null,
        source: "STABLE_BASELINE",
        periodMonth,
        asOfDate,
        effectiveDate: stable?.date ?? null,
        ...(stable?.revisionId ? { revisionId: stable.revisionId } : {}),
        ...(stable?.recordId ? { recordId: stable.recordId } : {}),
      };
    return {
      amount: requireStoredUserInputMoney(text(legacyMonthScoped, "amount")),
      source: "LEGACY_V3_COMPATIBILITY",
      periodMonth,
      asOfDate,
      effectiveDate: text(legacyMonthScoped, "date"),
      recordId: text(legacyMonthScoped, "id"),
    };
  }

  async appendSettingsRevision(
    profileId: string,
    effectiveMonth: string,
    asOfDate: string,
    settings: FinancialSettings,
    now: string,
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO settings_revisions(profile_id,effective_month,as_of_date,safety_coverage_target_months,minimum_cash_coverage_months,safety_recovery_horizon_months,desired_monthly_discretionary_spending,created_at) VALUES(?,?,?,?,?,?,?,?)`,
      [
        profileId,
        effectiveMonth,
        asOfDate,
        settings.safetyCoverageTargetMonths,
        settings.minimumCashCoverageMonths,
        settings.safetyRecoveryHorizonMonths ?? null,
        requireStoredUserInputMoney(String(settings.desiredMonthlyDiscretionarySpending)),
        now,
      ],
    );
  }

  async saveSettings(profileId: string, settings: FinancialSettings): Promise<void> {
    await this.db.execute(
      `INSERT INTO financial_settings(profile_id,safety_coverage_target_months,minimum_cash_coverage_months,safety_recovery_horizon_months,desired_monthly_discretionary_spending)
       VALUES(?,?,?,?,?) ON CONFLICT(profile_id) DO UPDATE SET safety_coverage_target_months=excluded.safety_coverage_target_months,
       minimum_cash_coverage_months=excluded.minimum_cash_coverage_months,safety_recovery_horizon_months=excluded.safety_recovery_horizon_months,
       desired_monthly_discretionary_spending=excluded.desired_monthly_discretionary_spending`,
      [
        profileId,
        settings.safetyCoverageTargetMonths,
        settings.minimumCashCoverageMonths,
        settings.safetyRecoveryHorizonMonths ?? null,
        requireStoredUserInputMoney(String(settings.desiredMonthlyDiscretionarySpending)),
      ],
    );
  }

  async saveEssentialExpense(
    item: EssentialExpenseItem,
    profileId: string,
    now = new Date().toISOString(),
  ): Promise<void> {
    const amount = requireStoredUserInputMoney(item.monthlyAmount);
    await this.db.transaction(async (transactionDb) => {
      await transactionDb.execute(
        `INSERT INTO essential_expense_items(id,profile_id,category,name,monthly_amount,created_at,updated_at) VALUES(?,?,?,?,?,?,?)
         ON CONFLICT(id) DO UPDATE SET category=excluded.category,name=excluded.name,monthly_amount=excluded.monthly_amount,active=1,updated_at=excluded.updated_at`,
        [item.id, profileId, item.category, item.name, amount, now, now],
      );
      await transactionDb.execute(
        `INSERT INTO essential_expense_snapshots(id,item_id,as_of_date,monthly_amount,created_at)
        VALUES(?,?,?,?,?) ON CONFLICT(item_id,as_of_date) DO UPDATE SET monthly_amount=excluded.monthly_amount`,
        [`${item.id}:${now.slice(0, 10)}`, item.id, now.slice(0, 10), amount, now],
      );
    });
  }

  /** Insert an essential-expense master and snapshot inside a caller-owned transaction. */
  async saveEssentialExpenseInTransaction(
    item: EssentialExpenseItem,
    profileId: string,
    asOfDate: string,
    now = new Date().toISOString(),
  ): Promise<void> {
    const amount = requireStoredUserInputMoney(item.monthlyAmount);
    await this.db.execute(
      `INSERT INTO essential_expense_items(id,profile_id,category,name,monthly_amount,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,
      [item.id, profileId, item.category, item.name, amount, now, now],
    );
    await this.db.execute(
      `INSERT INTO essential_expense_snapshots(id,item_id,as_of_date,monthly_amount,created_at) VALUES(?,?,?,?,?)`,
      [`${item.id}:${asOfDate}`, item.id, asOfDate, amount, now],
    );
  }

  async appendEssentialRevision(
    profileId: string,
    item: MaintenanceEssentialExpense,
    asOfDate: string,
    now: string,
    createId: () => string,
  ): Promise<string> {
    const id = item.id ?? createId();
    const amount = requireStoredUserInputMoney(item.monthlyAmount);
    if (!(await this.exists("essential_expense_items", id))) {
      await this.db.execute(
        "INSERT INTO essential_expense_items(id,profile_id,category,name,monthly_amount,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
        [id, profileId, item.category, item.name, amount, now, now],
      );
    }
    await this.db.execute(
      "INSERT INTO essential_expense_revisions(item_id,as_of_date,name,category,monthly_amount,active,created_at) VALUES(?,?,?,?,?,1,?)",
      [id, asOfDate, item.name, item.category, amount, now],
    );
    return id;
  }

  async appendCashRevision(
    profileId: string,
    item: MaintenanceCashAccount,
    asOfDate: string,
    now: string,
    createId: () => string,
  ): Promise<string> {
    const id = item.id ?? createId();
    const balance = requireStoredUserInputMoney(item.balance);
    if (!(await this.exists("cash_accounts", id)))
      await this.createCashAccount(
        { id, name: item.name, includeInSafetyResources: item.includeInSafetyResources },
        profileId,
        now,
      );
    await this.db.execute(
      "INSERT INTO cash_account_revisions(account_id,as_of_date,name,include_in_safety_resources,balance,created_at) VALUES(?,?,?,?,?,?)",
      [id, asOfDate, item.name, Number(item.includeInSafetyResources), balance, now],
    );
    return id;
  }

  async appendAssetRevision(
    profileId: string,
    item: MaintenanceAsset,
    asOfDate: string,
    now: string,
    createId: () => string,
  ): Promise<string> {
    const id = item.id ?? createId();
    const value = requireStoredUserInputMoney(item.currentValue);
    if (!(await this.exists("assets", id)))
      await this.createAsset(
        {
          id,
          name: item.name,
          kind: item.kind,
          includeInSafetyResources: item.includeInSafetyResources,
        },
        profileId,
        now,
      );
    await this.db.execute(
      "INSERT INTO asset_revisions(asset_id,as_of_date,name,kind,include_in_safety_resources,current_value,active,created_at) VALUES(?,?,?,?,?,?,1,?)",
      [id, asOfDate, item.name, item.kind, Number(item.includeInSafetyResources), value, now],
    );
    return id;
  }

  async appendDebtRevision(
    profileId: string,
    item: MaintenanceDebt,
    periodMonth: string,
    asOfDate: string,
    now: string,
    createId: () => string,
  ): Promise<string> {
    const id = item.id ?? createId();
    const balance = requireStoredUserInputMoney(item.currentBalance);
    if (!(await this.exists("debts", id)))
      await this.createDebt(
        { id, name: item.name, fixedMonthlyPayment: item.fixedMonthlyPayment },
        profileId,
        now,
      );
    await this.db.execute(
      `INSERT INTO debt_revisions(debt_id,period_month,as_of_date,name,current_balance,current_month_due,fixed_monthly_payment,active,created_at) VALUES(?,?,?,?,?,?,?,1,?)`,
      [
        id,
        periodMonth,
        asOfDate,
        item.name,
        balance,
        item.currentMonthDue === null ? null : requireStoredUserInputMoney(item.currentMonthDue),
        item.fixedMonthlyPayment === null
          ? null
          : requireStoredUserInputMoney(item.fixedMonthlyPayment),
        now,
      ],
    );
    return id;
  }

  async listEssentialExpenses(): Promise<EssentialExpenseItem[]> {
    const rows = await this.db.select(
      "SELECT id,category,name,monthly_amount FROM essential_expense_items WHERE active=1 ORDER BY id",
    );
    return rows.map((row) => ({
      id: text(row, "id"),
      category: text(row, "category") as ExpenseCategory,
      name: text(row, "name"),
      monthlyAmount: requireStoredUserInputMoney(text(row, "monthly_amount")),
    }));
  }

  async listEssentialExpensesAt(asOfDate: string): Promise<EssentialExpenseItem[]> {
    const rows = await this.db.select(
      `WITH versions AS (
        SELECT item_id,as_of_date,monthly_amount,0 AS revision_id FROM essential_expense_snapshots WHERE as_of_date<=?
        UNION ALL SELECT item_id,as_of_date,monthly_amount,revision_id FROM essential_expense_revisions WHERE as_of_date<=?
      ), latest AS (
        SELECT item_id,monthly_amount FROM (SELECT item_id,monthly_amount,ROW_NUMBER() OVER(PARTITION BY item_id ORDER BY as_of_date DESC,revision_id DESC) AS row_num FROM versions) WHERE row_num=1
      ), latest_meta AS (
        SELECT item_id,name,category,active FROM (SELECT item_id,name,category,active,ROW_NUMBER() OVER(PARTITION BY item_id ORDER BY as_of_date DESC,revision_id DESC) AS row_num FROM (
          SELECT item_id,as_of_date,0 AS revision_id,NULL AS name,NULL AS category,1 AS active FROM essential_expense_snapshots WHERE as_of_date<=?
          UNION ALL SELECT item_id,as_of_date,revision_id,name,category,active FROM essential_expense_revisions WHERE as_of_date<=?
        )) WHERE row_num=1
      )
      SELECT i.id,COALESCE(m.category,i.category) AS category,COALESCE(m.name,i.name) AS name,l.monthly_amount
      FROM essential_expense_items i JOIN latest l ON l.item_id=i.id JOIN latest_meta m ON m.item_id=i.id
      WHERE i.active=1 AND m.active=1 ORDER BY i.id`,
      [asOfDate, asOfDate, asOfDate, asOfDate],
    );
    return rows.map((row) => ({
      id: text(row, "id"),
      category: text(row, "category") as ExpenseCategory,
      name: text(row, "name"),
      monthlyAmount: requireStoredUserInputMoney(text(row, "monthly_amount")),
    }));
  }

  async saveIncome(
    record: IncomeRecord,
    profileId: string,
    periodMonth: string | null = null,
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO income_records(id,profile_id,kind,status,amount,date,period_month,created_at) VALUES(?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET kind=excluded.kind,status=excluded.status,amount=excluded.amount,date=excluded.date,period_month=excluded.period_month`,
      [
        record.id,
        profileId,
        record.kind,
        record.status,
        requireStoredUserInputMoney(String(record.amount)),
        record.date,
        periodMonth,
        createdAt,
      ],
    );
  }

  async appendActualIncomeRevision(input: {
    incomeId: string;
    asOfDate: string;
    amount: string;
    status: IncomeRecord["status"];
    date: string;
    active: boolean;
    now: string;
  }): Promise<number | undefined> {
    const result = await this.db.execute(
      "INSERT INTO actual_income_revisions(income_id,as_of_date,amount,status,date,active,created_at) VALUES(?,?,?,?,?,?,?)",
      [
        input.incomeId,
        input.asOfDate,
        requireStoredUserInputMoney(input.amount),
        input.status,
        input.date,
        Number(input.active),
        input.now,
      ],
    );
    return result.lastInsertId;
  }

  async actualIncomeAt(
    periodMonth: string,
    asOfDate: string,
  ): Promise<ActualIncomeRevisionState[]> {
    const rows = await this.db.select(
      `WITH ranked_revisions AS (
        SELECT r.income_id,r.as_of_date,r.amount,r.status,r.date,r.active,r.revision_id,
          ROW_NUMBER() OVER(PARTITION BY r.income_id ORDER BY r.as_of_date DESC,r.revision_id DESC) AS rn
        FROM actual_income_revisions r
        JOIN income_records i ON i.id=r.income_id
        WHERE i.kind='ACTUAL' AND i.period_month=? AND r.as_of_date<=?
      ), latest_revisions AS (
        SELECT income_id,as_of_date,amount,status,date,active,revision_id
        FROM ranked_revisions WHERE rn=1
      )
      SELECT i.id,'ACTUAL' AS kind,r.status,r.amount,r.date,i.period_month,r.active
      FROM latest_revisions r
      JOIN income_records i ON i.id=r.income_id
      WHERE r.active=1 AND r.date<=?
      UNION ALL
      SELECT i.id,i.kind,i.status,i.amount,i.date,i.period_month,1 AS active
      FROM income_records i
      WHERE i.kind='ACTUAL' AND i.period_month=? AND i.date<=?
        AND NOT EXISTS (SELECT 1 FROM latest_revisions r WHERE r.income_id=i.id)
      ORDER BY date,id`,
      [periodMonth, asOfDate, asOfDate, periodMonth, asOfDate],
    );
    return rows.map((row) => ({
      id: text(row, "id"),
      kind: "ACTUAL",
      status: text(row, "status") as IncomeRecord["status"],
      amount: requireStoredUserInputMoney(text(row, "amount")),
      date: text(row, "date"),
      periodMonth: text(row, "period_month"),
      active: bool(row, "active"),
    }));
  }

  async listIncome(targetMonth: string, asOfDate: string): Promise<IncomeRecord[]> {
    const v4 = (
      await this.db.select("SELECT 1 AS present FROM schema_migrations WHERE version=4")
    )[0];
    if (!v4) return this.listIncomeV3(targetMonth, asOfDate);
    const actual = await this.actualIncomeAt(targetMonth, asOfDate);
    const plan = await this.resolvePlanningIncomeForMonth(targetMonth, asOfDate);
    const planning: IncomeRecord[] =
      plan.amount === null
        ? []
        : [
            {
              id: plan.revisionId
                ? `planning-revision-${plan.revisionId}`
                : (plan.recordId ?? `planning-${targetMonth}`),
              kind: "PLANNING",
              status: "EXPECTED",
              amount: plan.amount,
              date: plan.effectiveDate ?? asOfDate,
            },
          ];
    return [...actual, ...planning];
  }

  private async listIncomeV3(targetMonth: string, asOfDate: string): Promise<IncomeRecord[]> {
    const actualRows = await this.db.select(
      "SELECT id,kind,status,amount,date FROM income_records WHERE period_month=? AND kind='ACTUAL' AND date<=? ORDER BY date,id",
      [targetMonth, asOfDate],
    );
    const actual: IncomeRecord[] = actualRows.map((row) => ({
      id: text(row, "id"),
      kind: "ACTUAL",
      status: text(row, "status") as IncomeRecord["status"],
      amount: requireStoredUserInputMoney(text(row, "amount")),
      date: text(row, "date"),
    }));
    const profile = await this.getProfile();
    const revision = profile
      ? (
          await this.db.select(
            "SELECT revision_id,amount,as_of_date FROM planning_income_revisions WHERE profile_id=? AND effective_month<=? AND as_of_date<=? ORDER BY effective_month DESC,as_of_date DESC,revision_id DESC LIMIT 1",
            [profile.id, targetMonth, asOfDate],
          )
        )[0]
      : undefined;
    const legacy = revision
      ? undefined
      : (
          await this.db.select(
            "SELECT id,date,amount FROM income_records WHERE kind='PLANNING' AND date<=? AND (period_month<=? OR period_month IS NULL) ORDER BY CASE WHEN period_month IS NULL THEN 0 ELSE 1 END DESC,period_month DESC,date DESC,id DESC LIMIT 1",
            [asOfDate, targetMonth],
          )
        )[0];
    const plan: IncomeRecord[] = revision
      ? [
          {
            id: `planning-revision-${String(revision.revision_id)}`,
            kind: "PLANNING",
            status: "EXPECTED",
            amount: text(revision, "amount"),
            date: text(revision, "as_of_date"),
          },
        ]
      : legacy
        ? [
            {
              id: text(legacy, "id"),
              kind: "PLANNING",
              status: "EXPECTED",
              amount: text(legacy, "amount"),
              date: text(legacy, "date"),
            },
          ]
        : [];
    return [...actual, ...plan];
  }

  async saveExpense(
    record: Omit<ExpenseRecord, "category"> & { category?: ExpenseCategory },
    profileId: string,
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    await this.db.execute(
      `INSERT INTO expense_records(id,profile_id,amount,occurred_at,kind,category,note,created_at,business_date) VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET amount=excluded.amount,occurred_at=excluded.occurred_at,kind=excluded.kind,category=excluded.category,note=excluded.note,business_date=excluded.business_date`,
      [
        record.id,
        profileId,
        requireStoredUserInputMoney(String(record.amount)),
        record.dateTime,
        record.kind,
        record.category ?? null,
        record.note ?? null,
        createdAt,
        record.businessDate,
      ],
    );
  }

  async listExpenses(fromDateTime: string, throughDateTime: string): Promise<ExpenseRecord[]> {
    const nextDate = addCalendarDays(throughDateTime, 1);
    const rows = await this.db.select(
      "SELECT id,amount,occurred_at,kind,category,note,business_date FROM expense_records WHERE business_date>=? AND business_date<? ORDER BY business_date,occurred_at,id",
      [fromDateTime, nextDate],
    );
    return rows.map((row) => {
      const category = nullableText(row, "category");
      const note = nullableText(row, "note");
      return {
        id: text(row, "id"),
        amount: requireStoredUserInputMoney(text(row, "amount")),
        dateTime: text(row, "occurred_at"),
        businessDate: text(row, "business_date"),
        kind: text(row, "kind") as ExpenseKind,
        category: (category ?? "OTHER_VARIABLE") as ExpenseCategory,
        ...(note === null ? {} : { note }),
      };
    });
  }

  async createCashAccount(
    input: { id: string; name: string; includeInSafetyResources: boolean },
    profileId: string,
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    await this.db.execute(
      "INSERT INTO cash_accounts(id,profile_id,name,include_in_safety_resources,created_at) VALUES(?,?,?,?,?)",
      [input.id, profileId, input.name, Number(input.includeInSafetyResources), createdAt],
    );
  }

  async saveCashSnapshot(
    input: { id: string; accountId: string; asOfDate: string; balance: string },
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    await this.db.execute(
      "INSERT INTO cash_balance_snapshots(id,account_id,as_of_date,balance,created_at) VALUES(?,?,?,?,?) ON CONFLICT(account_id,as_of_date) DO UPDATE SET balance=excluded.balance",
      [
        input.id,
        input.accountId,
        input.asOfDate,
        requireStoredUserInputMoney(input.balance),
        createdAt,
      ],
    );
  }

  async cashAccountsAt(asOfDate: string): Promise<CashAccountRecord[]> {
    const v4 = (
      await this.db.select("SELECT 1 AS present FROM schema_migrations WHERE version=4")
    )[0];
    const rows = await this.db.select(
      v4
        ? `WITH versions AS (
        SELECT s.account_id,s.as_of_date,s.balance,a.name,a.include_in_safety_resources,0 AS revision_id
        FROM cash_balance_snapshots s JOIN cash_accounts a ON a.id=s.account_id WHERE s.as_of_date<=?
        UNION ALL
        SELECT account_id,as_of_date,balance,name,include_in_safety_resources,revision_id FROM cash_account_revisions WHERE as_of_date<=?
      ), latest AS (
        SELECT account_id,as_of_date,balance,name,include_in_safety_resources FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY account_id ORDER BY as_of_date DESC,revision_id DESC) AS row_num FROM versions) WHERE row_num=1
      )
      , lifecycle AS (
        SELECT account_id,active FROM (
          SELECT account_id,active,ROW_NUMBER() OVER(PARTITION BY account_id ORDER BY as_of_date DESC,revision_id DESC) AS row_num
          FROM cash_account_lifecycle_revisions WHERE as_of_date<=?
        ) WHERE row_num=1
      )
      SELECT a.id,COALESCE(l.name,a.name) AS name,COALESCE(l.include_in_safety_resources,a.include_in_safety_resources) AS include_in_safety_resources,a.created_at,l.balance,l.as_of_date AS snapshot_date,COALESCE(lc.active,a.active) AS effective_active
      FROM cash_accounts a LEFT JOIN latest l ON l.account_id=a.id
      LEFT JOIN lifecycle lc ON lc.account_id=a.id
      WHERE COALESCE(lc.active,a.active)=1 ORDER BY a.id`
        : `WITH versions AS (
        SELECT s.account_id,s.as_of_date,s.balance,a.name,a.include_in_safety_resources,0 AS revision_id FROM cash_balance_snapshots s JOIN cash_accounts a ON a.id=s.account_id WHERE s.as_of_date<=?
        UNION ALL SELECT account_id,as_of_date,balance,name,include_in_safety_resources,revision_id FROM cash_account_revisions WHERE as_of_date<=?
      ), latest AS (SELECT account_id,as_of_date,balance,name,include_in_safety_resources FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY account_id ORDER BY as_of_date DESC,revision_id DESC) AS row_num FROM versions) WHERE row_num=1)
      SELECT a.id,COALESCE(l.name,a.name) AS name,COALESCE(l.include_in_safety_resources,a.include_in_safety_resources) AS include_in_safety_resources,a.created_at,l.balance,l.as_of_date AS snapshot_date
      FROM cash_accounts a LEFT JOIN latest l ON l.account_id=a.id WHERE a.active=1 ORDER BY a.id`,
      v4 ? [asOfDate, asOfDate, asOfDate] : [asOfDate, asOfDate],
    );
    return rows.flatMap((row) => {
      if (nullableText(row, "snapshot_date") === null) {
        if (text(row, "created_at").slice(0, 10) <= asOfDate) {
          throw new ApplicationDataError(
            "MISSING_CASH_SNAPSHOT",
            `Cash account ${text(row, "id")} has no valid balance snapshot for ${asOfDate}.`,
          );
        }
        return [];
      }
      return [
        {
          id: text(row, "id"),
          name: text(row, "name"),
          includeInSafetyResources: bool(row, "include_in_safety_resources"),
          balance: requireStoredUserInputMoney(text(row, "balance")),
        },
      ];
    });
  }

  async createAsset(
    input: { id: string; name: string; kind: Asset["kind"]; includeInSafetyResources: boolean },
    profileId: string,
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    await this.db.execute(
      "INSERT INTO assets(id,profile_id,name,kind,include_in_safety_resources,created_at) VALUES(?,?,?,?,?,?)",
      [
        input.id,
        profileId,
        input.name,
        input.kind,
        Number(input.includeInSafetyResources),
        createdAt,
      ],
    );
  }

  async saveAssetSnapshot(
    input: { id: string; assetId: string; asOfDate: string; value: string },
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    await this.db.execute(
      "INSERT INTO asset_value_snapshots(id,asset_id,as_of_date,value,created_at) VALUES(?,?,?,?,?) ON CONFLICT(asset_id,as_of_date) DO UPDATE SET value=excluded.value",
      [
        input.id,
        input.assetId,
        input.asOfDate,
        requireStoredUserInputMoney(input.value),
        createdAt,
      ],
    );
  }

  async assetsAt(asOfDate: string): Promise<AssetRecord[]> {
    const rows = await this.db.select(
      `WITH versions AS (
        SELECT s.asset_id,s.as_of_date,s.value AS current_value,a.name,a.kind,a.include_in_safety_resources,0 AS revision_id,1 AS active
        FROM asset_value_snapshots s JOIN assets a ON a.id=s.asset_id WHERE s.as_of_date<=?
        UNION ALL
        SELECT asset_id,as_of_date,current_value,name,kind,include_in_safety_resources,revision_id,active FROM asset_revisions WHERE as_of_date<=?
      ), latest AS (
        SELECT asset_id,as_of_date,current_value,name,kind,include_in_safety_resources,active FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY asset_id ORDER BY as_of_date DESC,revision_id DESC) AS row_num FROM versions) WHERE row_num=1
      )
      SELECT a.id,COALESCE(l.name,a.name) AS name,COALESCE(l.kind,a.kind) AS kind,COALESCE(l.include_in_safety_resources,a.include_in_safety_resources) AS include_in_safety_resources,a.created_at,l.current_value,l.as_of_date AS snapshot_date,COALESCE(l.active,a.active) AS active
      FROM assets a LEFT JOIN latest l ON l.asset_id=a.id
      WHERE a.active=1 AND COALESCE(l.active,a.active)=1 ORDER BY a.id`,
      [asOfDate, asOfDate],
    );
    return rows.flatMap((row) => {
      if (nullableText(row, "snapshot_date") === null) {
        if (text(row, "created_at").slice(0, 10) <= asOfDate) {
          throw new ApplicationDataError(
            "MISSING_ASSET_SNAPSHOT",
            `Asset ${text(row, "id")} has no valid value snapshot for ${asOfDate}.`,
          );
        }
        return [];
      }
      return [
        {
          id: text(row, "id"),
          name: text(row, "name"),
          kind: text(row, "kind") as Asset["kind"],
          includeInSafetyResources: bool(row, "include_in_safety_resources"),
          currentValue: requireStoredUserInputMoney(text(row, "current_value")),
        },
      ];
    });
  }

  async createDebt(
    input: { id: string; name: string; fixedMonthlyPayment: string | null; active?: boolean },
    profileId: string,
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    await this.db.execute(
      "INSERT INTO debts(id,profile_id,name,fixed_monthly_payment,active,created_at) VALUES(?,?,?,?,?,?)",
      [
        input.id,
        profileId,
        input.name,
        input.fixedMonthlyPayment === null
          ? null
          : requireStoredUserInputMoney(input.fixedMonthlyPayment),
        Number(input.active ?? true),
        createdAt,
      ],
    );
  }

  async saveDebtPeriodFact(
    input: {
      id: string;
      debtId: string;
      periodMonth: string;
      asOfDate: string;
      currentBalance: string;
      currentMonthDue: string | null;
    },
    createdAt = new Date().toISOString(),
  ): Promise<void> {
    await this.db.execute(
      "INSERT INTO debt_period_facts(id,debt_id,period_month,as_of_date,current_balance,current_month_due,created_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(debt_id,period_month) DO UPDATE SET as_of_date=excluded.as_of_date,current_balance=excluded.current_balance,current_month_due=excluded.current_month_due",
      [
        input.id,
        input.debtId,
        input.periodMonth,
        input.asOfDate,
        requireStoredUserInputMoney(input.currentBalance),
        input.currentMonthDue === null ? null : requireStoredUserInputMoney(input.currentMonthDue),
        createdAt,
      ],
    );
  }

  async activeDebtMetadataAt(
    debtId: string,
    targetMonth: string,
    asOfDate: string,
  ): Promise<{ id: string; name: string; fixedMonthlyPayment: string | null } | null> {
    const rows = await this.db.select(
      `WITH payment_versions AS (
        SELECT d.id AS debt_id,'0000-00' AS effective_month,d.created_at AS as_of_date,d.name,d.fixed_monthly_payment,0 AS revision_id
        FROM debts d
        UNION ALL
        SELECT debt_id,period_month,as_of_date,name,fixed_monthly_payment,revision_id
        FROM debt_revisions WHERE period_month<=? AND as_of_date<=?
      ), latest_payment AS (
        SELECT debt_id,name,fixed_monthly_payment FROM (
          SELECT *,ROW_NUMBER() OVER(PARTITION BY debt_id ORDER BY effective_month DESC,as_of_date DESC,revision_id DESC) AS row_num
          FROM payment_versions
        ) WHERE row_num=1
      )
      SELECT d.id,COALESCE(p.name,d.name) AS name,p.fixed_monthly_payment
      FROM debts d LEFT JOIN latest_payment p ON p.debt_id=d.id
      WHERE d.id=? AND d.active=1`,
      [targetMonth, asOfDate, debtId],
    );
    const row = rows[0];
    return row
      ? {
          id: text(row, "id"),
          name: text(row, "name"),
          fixedMonthlyPayment:
            nullableText(row, "fixed_monthly_payment") === null
              ? null
              : requireStoredUserInputMoney(nullableText(row, "fixed_monthly_payment") as string),
        }
      : null;
  }

  async currentDebtFactAt(
    debtId: string,
    targetMonth: string,
    asOfDate: string,
  ): Promise<{ currentBalance: string; currentMonthDue: string | null } | null> {
    const rows = await this.db.select(
      `WITH facts AS (
        SELECT debt_id,as_of_date,current_balance,current_month_due,0 AS revision_id
        FROM debt_period_facts WHERE debt_id=? AND period_month=? AND as_of_date<=?
        UNION ALL
        SELECT debt_id,as_of_date,current_balance,current_month_due,revision_id
        FROM debt_revisions WHERE debt_id=? AND period_month=? AND as_of_date<=?
      )
      SELECT current_balance,current_month_due FROM facts
      ORDER BY as_of_date DESC,revision_id DESC LIMIT 1`,
      [debtId, targetMonth, asOfDate, debtId, targetMonth, asOfDate],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      currentBalance: requireStoredUserInputMoney(text(row, "current_balance")),
      currentMonthDue:
        nullableText(row, "current_month_due") === null
          ? null
          : requireStoredUserInputMoney(nullableText(row, "current_month_due") as string),
    };
  }

  async missingCurrentMonthDebtFactIds(targetMonth: string, asOfDate: string): Promise<string[]> {
    const rows = await this.db.select(
      `SELECT d.id FROM debts d
      WHERE d.active=1
        AND (substr(d.created_at,1,10)<=?
          OR EXISTS(SELECT 1 FROM debt_period_facts prior WHERE prior.debt_id=d.id AND prior.period_month<?)
          OR EXISTS(SELECT 1 FROM debt_revisions prior WHERE prior.debt_id=d.id AND prior.period_month<?))
        AND NOT EXISTS(SELECT 1 FROM debt_period_facts current_fact WHERE current_fact.debt_id=d.id AND current_fact.period_month=? AND current_fact.as_of_date<=?)
        AND NOT EXISTS(SELECT 1 FROM debt_revisions current_revision WHERE current_revision.debt_id=d.id AND current_revision.period_month=? AND current_revision.as_of_date<=?)
      ORDER BY d.id`,
      [asOfDate, targetMonth, targetMonth, targetMonth, asOfDate, targetMonth, asOfDate],
    );
    return rows.map((row) => text(row, "id"));
  }

  async debtsAt(
    targetMonth: string,
    asOfDate: string,
    includeMissing = false,
  ): Promise<DebtRecord[]> {
    const rows = await this.db.select(
      `WITH facts AS (
        SELECT debt_id,period_month,as_of_date,current_balance,current_month_due,0 AS revision_id FROM debt_period_facts WHERE period_month=? AND as_of_date<=?
        UNION ALL SELECT debt_id,period_month,as_of_date,current_balance,current_month_due,revision_id FROM debt_revisions WHERE period_month=? AND as_of_date<=?
      ), latest_fact AS (
        SELECT debt_id,current_balance,current_month_due FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY debt_id ORDER BY as_of_date DESC,revision_id DESC) AS row_num FROM facts) WHERE row_num=1
      ), payment_versions AS (
        SELECT d.id AS debt_id,'0000-00' AS effective_month,d.created_at AS as_of_date,d.name,d.fixed_monthly_payment,0 AS revision_id FROM debts d
        UNION ALL SELECT debt_id,period_month,as_of_date,name,fixed_monthly_payment,revision_id FROM debt_revisions WHERE period_month<=? AND as_of_date<=?
      ), latest_payment AS (
        SELECT debt_id,name,fixed_monthly_payment FROM (SELECT *,ROW_NUMBER() OVER(PARTITION BY debt_id ORDER BY effective_month DESC,as_of_date DESC,revision_id DESC) AS row_num FROM payment_versions) WHERE row_num=1
      )
      SELECT d.id,COALESCE(p.name,d.name) AS name,
       p.fixed_monthly_payment,d.active,d.created_at,f.current_balance,f.current_month_due,
       EXISTS(SELECT 1 FROM debt_period_facts p3 WHERE p3.debt_id=d.id AND p3.period_month<?) OR EXISTS(SELECT 1 FROM debt_revisions p4 WHERE p4.debt_id=d.id AND p4.period_month<?) AS has_prior_fact
      FROM debts d LEFT JOIN latest_fact f ON f.debt_id=d.id LEFT JOIN latest_payment p ON p.debt_id=d.id WHERE d.active=1 ORDER BY d.id`,
      [
        targetMonth,
        asOfDate,
        targetMonth,
        asOfDate,
        targetMonth,
        asOfDate,
        targetMonth,
        targetMonth,
      ],
    );
    const facts: DebtRecord[] = [];
    for (const row of rows) {
      const balance = nullableText(row, "current_balance");
      if (
        balance === null &&
        text(row, "created_at").slice(0, 10) > asOfDate &&
        !bool(row, "has_prior_fact")
      ) {
        continue;
      }
      if (balance === null && includeMissing) continue;
      if (balance === null)
        throw new ApplicationDataError(
          "MISSING_DEBT_SNAPSHOT",
          `Debt ${text(row, "id")} has no balance fact for ${targetMonth}.`,
        );
      const due = nullableText(row, "current_month_due");
      const fixed = nullableText(row, "fixed_monthly_payment");
      facts.push({
        id: text(row, "id"),
        name: text(row, "name"),
        active: bool(row, "active"),
        currentBalance: requireStoredUserInputMoney(balance),
        ...(due === null ? {} : { currentMonthDue: requireStoredUserInputMoney(due) }),
        fixedMonthlyPayment: fixed === null ? null : requireStoredUserInputMoney(fixed),
      });
    }
    return facts;
  }

  /** Editable recovery state for a new month; carries prior balance only, never prior due. */
  async priorDebtsForMaintenance(targetMonth: string, asOfDate: string): Promise<DebtRecord[]> {
    const rows = await this.db.select(
      `WITH prior_facts AS (
        SELECT debt_id,period_month,as_of_date,current_balance,0 AS revision_id FROM debt_period_facts
        WHERE period_month<? AND as_of_date<=?
        UNION ALL SELECT debt_id,period_month,as_of_date,current_balance,revision_id FROM debt_revisions
        WHERE period_month<? AND as_of_date<=?
      ), latest_fact AS (
        SELECT debt_id,period_month,current_balance FROM (
          SELECT *,ROW_NUMBER() OVER(PARTITION BY debt_id ORDER BY period_month DESC,as_of_date DESC,revision_id DESC) AS row_num FROM prior_facts
        ) WHERE row_num=1
      ), metadata AS (
        SELECT debt_id,name,fixed_monthly_payment FROM (
          SELECT debt_id,name,fixed_monthly_payment,ROW_NUMBER() OVER(PARTITION BY debt_id ORDER BY period_month DESC,as_of_date DESC,revision_id DESC) AS row_num
          FROM debt_revisions WHERE period_month<=? AND as_of_date<=?
        ) WHERE row_num=1
      )
      SELECT d.id,COALESCE(m.name,d.name) AS name,
       CASE WHEN m.debt_id IS NULL THEN d.fixed_monthly_payment ELSE m.fixed_monthly_payment END AS fixed_monthly_payment,
       f.current_balance
      FROM debts d JOIN latest_fact f ON f.debt_id=d.id LEFT JOIN metadata m ON m.debt_id=d.id
      WHERE d.active=1 ORDER BY d.id`,
      [targetMonth, asOfDate, targetMonth, asOfDate, targetMonth, asOfDate],
    );
    return rows.map((row) => {
      const fixed = nullableText(row, "fixed_monthly_payment");
      return {
        id: text(row, "id"),
        name: text(row, "name"),
        active: true,
        currentBalance: requireStoredUserInputMoney(text(row, "current_balance")),
        fixedMonthlyPayment: fixed === null ? null : requireStoredUserInputMoney(fixed),
      };
    });
  }

  async getMeta(key: string): Promise<string | null> {
    const row = (await this.db.select("SELECT value FROM app_metadata WHERE key=?", [key]))[0];
    return row ? text(row, "value") : null;
  }

  async setMeta(key: string, value: string): Promise<void> {
    await this.db.execute(
      "INSERT INTO app_metadata(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [key, value],
    );
  }

  async latestCashDate(asOfDate: string): Promise<string | null> {
    return this.latestDate("cash_balance_snapshots", "as_of_date", asOfDate);
  }

  async latestAssetDate(asOfDate: string): Promise<string | null> {
    return this.latestDate("asset_value_snapshots", "as_of_date", asOfDate);
  }

  async latestDebtDate(asOfDate: string): Promise<string | null> {
    const row = (
      await this.db.select(
        "SELECT MAX(as_of_date) AS date FROM debt_period_facts WHERE period_month < ? AND as_of_date < ?",
        [asOfDate.slice(0, 7), asOfDate],
      )
    )[0];
    return row ? nullableText(row, "date") : null;
  }

  async variableSpending(fromDate: string, throughDate: string): Promise<string> {
    const nextDate = addCalendarDays(throughDate, 1);
    const rows = await this.db.select(
      "SELECT amount FROM expense_records WHERE kind='VARIABLE' AND business_date>=? AND business_date<? ORDER BY business_date,occurred_at,id",
      [fromDate, nextDate],
    );
    return rows
      .reduce(
        (total, row) => total.plus(requireStoredUserInputMoney(text(row, "amount"))),
        money(0),
      )
      .toString();
  }

  private async latestDate(
    table: "cash_balance_snapshots" | "asset_value_snapshots",
    column: "as_of_date",
    asOfDate: string,
  ): Promise<string | null> {
    const row = (
      await this.db.select(`SELECT MAX(${column}) AS date FROM ${table} WHERE ${column}<?`, [
        asOfDate,
      ])
    )[0];
    return row ? nullableText(row, "date") : null;
  }

  private async exists(
    table: "essential_expense_items" | "cash_accounts" | "assets" | "debts",
    id: string,
  ): Promise<boolean> {
    return (
      (await this.db.select(`SELECT 1 AS found FROM ${table} WHERE id=? LIMIT 1`, [id])).length > 0
    );
  }
}

function addCalendarDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (day ?? 1) + days));
  return `${next.getUTCFullYear().toString().padStart(4, "0")}-${String(next.getUTCMonth() + 1).padStart(2, "0")}-${String(next.getUTCDate()).padStart(2, "0")}`;
}
