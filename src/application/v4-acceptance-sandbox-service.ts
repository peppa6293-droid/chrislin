import { invoke } from "@tauri-apps/api/core";
import type { SqlDatabase } from "../persistence/database.js";
import { migrateDatabase } from "../persistence/migrations.js";
import { Repositories } from "../persistence/repositories.js";
import { TauriSqlDatabase } from "../persistence/tauri-database.js";
import { updateFinancialDataAndRecalculate } from "./financial-maintenance-service.js";
import { completeOnboarding, type OnboardingSubmission } from "./product-service.js";
import {
  type V4FinancialReadState,
  V4FoundationService,
  type V4MutationResult,
} from "./v4-foundation-service.js";

export const ACCEPTANCE_AS_OF = "2026-10-07";
export const ACCEPTANCE_MONTH = "2026-10";
export const ACCEPTANCE_CASH_NAME = "余额宝";
export const ACCEPTANCE_ACTUAL_IDS = [
  "acceptance-actual-a",
  "acceptance-actual-future",
  "acceptance-actual-void",
  "acceptance-actual-legacy",
] as const;

export interface AcceptanceRuntimeInfo {
  identifier: string;
  appDataDir: string;
  databasePath: string;
}
export interface AcceptanceDatabase extends SqlDatabase {
  open(): Promise<void>;
}

export interface AcceptanceHistories {
  planning: Array<{
    revision_id: number;
    period_month: string;
    as_of_date: string;
    decision: string;
    amount: string | null;
  }>;
  actual: Array<{
    revision_id: number;
    income_id: string;
    as_of_date: string;
    date: string;
    status: string;
    amount: string;
    active: number;
  }>;
  cash: Array<{ revision_id: number; account_id: string; as_of_date: string; active: number }>;
}

const seed: OnboardingSubmission = {
  displayName: "V4 验收合成资料",
  stableMonthlyIncome: "13000",
  essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
  cashAccounts: [{ name: "余额宝", balance: "4805.61", includeInSafetyResources: true }],
  assets: [],
  debts: [],
  safetyCoverageTargetMonths: 6,
  minimumCashCoverageMonths: 2,
  safetyRecoveryHorizonMonths: 12,
  desiredMonthlyDiscretionarySpending: "1600",
};

export class V4AcceptanceSandboxService {
  private readonly foundation: V4FoundationService;
  constructor(
    private readonly db: AcceptanceDatabase,
    private readonly now = () => "2026-10-07T12:00:00.000Z",
    private readonly getRuntimeInfo: () => Promise<AcceptanceRuntimeInfo> = () =>
      invoke<AcceptanceRuntimeInfo>("acceptance_runtime_info"),
    private readonly resetNativeDatabase: () => Promise<void> = () => invoke("acceptance_reset"),
  ) {
    this.foundation = new V4FoundationService(db, now);
  }

  async initialize(): Promise<AcceptanceRuntimeInfo> {
    const runtime = await this.getRuntimeInfo();
    if (
      runtime.identifier !== "com.personalfinance.console.v4acceptance" ||
      !runtime.databasePath.endsWith(
        "/com.personalfinance.console.v4acceptance/personal-finance-console-v4-acceptance.sqlite3",
      )
    )
      throw new Error("验收运行身份或数据库路径校验失败，已阻止初始化。");
    await this.db.open();
    await migrateDatabase(this.db, this.now());
    const profile = await new Repositories(this.db).getProfile();
    if (!profile) {
      const hasBusinessRows = await this.hasAnyBusinessRows();
      if (hasBusinessRows) throw new Error("数据库不是空白验收库，拒绝自动重新播种。");
      await this.seedSyntheticData();
    }
    return runtime;
  }

  async reset(): Promise<void> {
    const runtime = await this.getRuntimeInfo();
    if (
      runtime.identifier !== "com.personalfinance.console.v4acceptance" ||
      !runtime.databasePath.endsWith(
        "/com.personalfinance.console.v4acceptance/personal-finance-console-v4-acceptance.sqlite3",
      )
    )
      throw new Error("验收运行身份或数据库路径校验失败，已阻止重置。");
    await this.resetNativeDatabase();
    await migrateDatabase(this.db, this.now());
    await this.seedSyntheticData();
  }

  read(month: string, asOfDate: string): Promise<V4FinancialReadState> {
    return this.foundation.read(month, asOfDate);
  }

  savePlanning(month: string, asOfDate: string, amount: string | null): Promise<V4MutationResult> {
    return this.foundation.savePlanningMonthDecision(
      month,
      asOfDate,
      amount === null ? { decision: "INHERIT", amount: null } : { decision: "OVERRIDE", amount },
    );
  }

  async updateStableIncome(amount: string, asOfDate: string): Promise<void> {
    await updateFinancialDataAndRecalculate(this.db, { stableMonthlyIncome: amount }, asOfDate);
  }

  async stableIncome(month: string, asOfDate: string): Promise<string> {
    return (await new Repositories(this.db).stablePlanningIncomeAt(month, asOfDate))?.amount ?? "0";
  }

  reviseActual(input: {
    incomeId: string;
    asOfDate: string;
    date: string;
    amount: string;
    status: "EXPECTED" | "PENDING" | "RECEIVED";
    void?: boolean;
  }): Promise<V4MutationResult> {
    return this.foundation.reviseActualIncome({ ...input, periodMonth: ACCEPTANCE_MONTH });
  }

  async deactivateCash(asOfDate: string): Promise<V4MutationResult> {
    const row = (
      await this.db.select<{ id: string }>(
        "SELECT id FROM cash_accounts WHERE name=? ORDER BY created_at LIMIT 1",
        [ACCEPTANCE_CASH_NAME],
      )
    )[0];
    if (!row) throw new Error("验收现金账户不存在。");
    return this.foundation.deactivateCashAccount(row.id, asOfDate);
  }

  histories(): Promise<AcceptanceHistories> {
    return this.db
      .select(
        "SELECT revision_id,period_month,as_of_date,decision,amount FROM planning_income_month_revisions ORDER BY revision_id",
      )
      .then(async (planning) => {
        const actual = await this.db.select(
          "SELECT revision_id,income_id,as_of_date,date,status,amount,active FROM actual_income_revisions ORDER BY revision_id",
        );
        const cash = await this.db.select(
          "SELECT revision_id,account_id,as_of_date,active FROM cash_account_lifecycle_revisions ORDER BY revision_id",
        );
        return {
          planning: planning as AcceptanceHistories["planning"],
          actual: actual as AcceptanceHistories["actual"],
          cash: cash as AcceptanceHistories["cash"],
        };
      });
  }

  private async hasAnyBusinessRows(): Promise<boolean> {
    const tables = await this.db.select<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name <> 'schema_migrations'",
    );
    for (const { name } of tables) {
      const rows = await this.db.select<{ count: number }>(
        `SELECT COUNT(*) AS count FROM "${name.replaceAll('"', '""')}"`,
      );
      if (Number(rows[0]?.count ?? 0) > 0) return true;
    }
    return false;
  }

  private async seedSyntheticData(): Promise<void> {
    await completeOnboarding(this.db, seed, ACCEPTANCE_AS_OF);
    const profile = await new Repositories(this.db).getProfile();
    if (!profile) throw new Error("合成验收资料初始化失败。");
    const records = ACCEPTANCE_ACTUAL_IDS.map((id, index) => ({
      id,
      date: "2026-10-02",
      createdAt: index === 3 ? "2026-10-07T12:00:00.000Z" : "2026-10-02T09:00:00.000Z",
    }));
    for (const record of records) {
      await new Repositories(this.db).saveIncome(
        { id: record.id, kind: "ACTUAL", status: "RECEIVED", amount: "800", date: record.date },
        profile.id,
        ACCEPTANCE_MONTH,
        record.createdAt,
      );
    }
  }
}

export async function createV4AcceptanceSandboxService(): Promise<{
  service: V4AcceptanceSandboxService;
  runtime: AcceptanceRuntimeInfo;
}> {
  const db = new TauriSqlDatabase();
  const service = new V4AcceptanceSandboxService(db);
  const runtime = await service.initialize();
  return { service, runtime };
}
