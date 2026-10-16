import { invoke } from "@tauri-apps/api/core";
import {
  type SaveCurrentMonthDebtFactCommand,
  type SaveCurrentMonthDebtFactResult,
  saveCurrentMonthDebtFact,
} from "../application/debt-fact-service.js";
import {
  type FinancialMaintenancePatch,
  type FinancialMaintenanceState,
  type FinancialMaintenanceUpdateResult,
  getFinancialMaintenanceRequirement,
  getFinancialMaintenanceState,
  updateFinancialDataAndRecalculate,
} from "../application/financial-maintenance-service.js";
import {
  type ApplicationInitializationState,
  getApplicationInitializationState,
} from "../application/initialization-service.js";
import {
  completeOnboarding,
  type ExpenseSubmission,
  getExpenseRecordById,
  getHomeApplicationState,
  getOnboardingRequirement,
  type HomeApplicationState,
  type OnboardingSubmission,
  recordExpenseAndRecalculate,
} from "../application/product-service.js";
import type { V4FinancialReadState } from "../application/v4-foundation-service.js";
import {
  V4FoundationService,
  type V4MutationResult,
} from "../application/v4-foundation-service.js";
import { migrateDatabase } from "../persistence/migrations.js";
import type { PlanningIncomeMonthDecision } from "../persistence/repositories.js";
import { TauriSqlDatabase } from "../persistence/tauri-database.js";

declare const __WP03_PREVIEW_BUILD__: boolean;

export async function getWp03PreviewTestDate(): Promise<string | null> {
  if (!__WP03_PREVIEW_BUILD__) return null;
  return invoke<string | null>("wp03_preview_get_test_date");
}

export async function setWp03PreviewTestDate(testDate: string | null): Promise<void> {
  if (!__WP03_PREVIEW_BUILD__) throw new Error("WP-03 验收日期仅在 WP-03 测试版中可用。");
  await invoke("wp03_preview_set_test_date", { testDate });
}

export type ApplicationStartupState =
  | ApplicationInitializationState
  | { status: "ERROR"; message: string };

export async function bootstrapTauriApplication(): Promise<ApplicationStartupState> {
  try {
    const db = new TauriSqlDatabase();
    await db.open();
    await migrateDatabase(db);
    return await getApplicationInitializationState(db);
  } catch (error) {
    return {
      status: "ERROR",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/** UI-facing application boundary. The database stays private to this composition root. */
export interface TauriApplicationServices {
  initialization: ApplicationStartupState;
  completeOnboarding(
    submission: OnboardingSubmission,
    asOfDate: string,
  ): Promise<HomeApplicationState>;
  getHome(asOfDate: string): Promise<HomeApplicationState>;
  getExpenseRecordById(expenseId: string): ReturnType<typeof getExpenseRecordById>;
  recordExpense(expense: ExpenseSubmission, asOfDate: string): Promise<HomeApplicationState>;
  getFinancialMaintenanceState(asOfDate: string): Promise<FinancialMaintenanceState>;
  getFinancialMaintenanceRequirement(
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ): Promise<{ requiresSafetyRecoveryHorizon: boolean }>;
  updateFinancialData(
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ): Promise<FinancialMaintenanceUpdateResult>;
  saveCurrentMonthDebtFact(
    command: SaveCurrentMonthDebtFactCommand,
    asOfDate: string,
  ): Promise<SaveCurrentMonthDebtFactResult>;
  savePlanningMonthDecision(
    month: string,
    asOfDate: string,
    decision: PlanningIncomeMonthDecision,
  ): Promise<V4MutationResult>;
  reviseActualIncome(input: {
    incomeId: string;
    periodMonth: string;
    asOfDate: string;
    amount: string;
    status: "EXPECTED" | "PENDING" | "RECEIVED";
    date: string;
    void?: boolean;
  }): Promise<V4MutationResult>;
  getV4FinancialReadState(month: string, asOfDate: string): Promise<V4FinancialReadState>;
  deactivateCashAccount(accountId: string, asOfDate: string): Promise<V4MutationResult>;
  deactivateAsset(assetId: string, asOfDate: string): Promise<V4MutationResult>;
  deactivateDebt(debtId: string, month: string, asOfDate: string): Promise<V4MutationResult>;
}

export interface TauriProductServices {
  bootstrap(): Promise<ApplicationStartupState>;
  getOnboardingRequirement: typeof getOnboardingRequirement;
  completeOnboarding(
    submission: OnboardingSubmission,
    asOfDate: string,
  ): Promise<HomeApplicationState>;
  getHomeApplicationState(asOfDate: string): Promise<HomeApplicationState>;
  getExpenseRecordById(expenseId: string): ReturnType<typeof getExpenseRecordById>;
  recordExpenseAndRecalculate(
    expense: ExpenseSubmission,
    asOfDate: string,
  ): Promise<HomeApplicationState>;
  getFinancialMaintenanceState(asOfDate: string): Promise<FinancialMaintenanceState>;
  getFinancialMaintenanceRequirement(
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ): Promise<{ requiresSafetyRecoveryHorizon: boolean }>;
  updateFinancialDataAndRecalculate(
    patch: FinancialMaintenancePatch,
    asOfDate: string,
  ): Promise<FinancialMaintenanceUpdateResult>;
  saveCurrentMonthDebtFact(
    command: SaveCurrentMonthDebtFactCommand,
    asOfDate: string,
  ): Promise<SaveCurrentMonthDebtFactResult>;
  savePlanningMonthDecision(
    month: string,
    asOfDate: string,
    decision: PlanningIncomeMonthDecision,
  ): Promise<V4MutationResult>;
  reviseActualIncome(input: {
    incomeId: string;
    periodMonth: string;
    asOfDate: string;
    amount: string;
    status: "EXPECTED" | "PENDING" | "RECEIVED";
    date: string;
    void?: boolean;
  }): Promise<V4MutationResult>;
  getV4FinancialReadState(month: string, asOfDate: string): Promise<V4FinancialReadState>;
  deactivateCashAccount(accountId: string, asOfDate: string): Promise<V4MutationResult>;
  deactivateAsset(assetId: string, asOfDate: string): Promise<V4MutationResult>;
  deactivateDebt(debtId: string, month: string, asOfDate: string): Promise<V4MutationResult>;
}

export async function createTauriApplicationServices(): Promise<TauriApplicationServices> {
  const db = new TauriSqlDatabase();
  await db.open();
  await migrateDatabase(db);
  const initialization = await getApplicationInitializationState(db);
  const foundation = new V4FoundationService(db);
  return {
    initialization,
    completeOnboarding: (submission, asOfDate) => completeOnboarding(db, submission, asOfDate),
    getHome: (asOfDate) => getHomeApplicationState(db, asOfDate),
    getExpenseRecordById: (expenseId) => getExpenseRecordById(db, expenseId),
    recordExpense: (expense, asOfDate) => recordExpenseAndRecalculate(db, expense, asOfDate),
    getFinancialMaintenanceState: (asOfDate) => getFinancialMaintenanceState(db, asOfDate),
    getFinancialMaintenanceRequirement: (patch, asOfDate) =>
      getFinancialMaintenanceRequirement(db, patch, asOfDate),
    updateFinancialData: (patch, asOfDate) =>
      updateFinancialDataAndRecalculate(db, patch, asOfDate),
    saveCurrentMonthDebtFact: (command, asOfDate) =>
      saveCurrentMonthDebtFact(db, command, asOfDate),
    savePlanningMonthDecision: (month, asOfDate, decision) =>
      foundation.savePlanningMonthDecision(month, asOfDate, decision),
    reviseActualIncome: (input) => foundation.reviseActualIncome(input),
    getV4FinancialReadState: (month, asOfDate) => foundation.read(month, asOfDate),
    deactivateCashAccount: (accountId, asOfDate) =>
      foundation.deactivateCashAccount(accountId, asOfDate),
    deactivateAsset: (assetId, asOfDate) => foundation.deactivateAsset(assetId, asOfDate),
    deactivateDebt: (debtId, month, asOfDate) => foundation.deactivateDebt(debtId, month, asOfDate),
  };
}

/** Stable UI API with lazy startup; neither the UI nor its contract receives the database. */
export function getTauriProductServices(): TauriProductServices {
  let application: Promise<TauriApplicationServices> | undefined;
  const open = () => (application ??= createTauriApplicationServices());
  return {
    bootstrap: async () => {
      try {
        return (await open()).initialization;
      } catch (error) {
        return {
          status: "ERROR",
          message: error instanceof Error ? error.message : String(error),
        };
      }
    },
    getOnboardingRequirement,
    completeOnboarding: async (submission, asOfDate) =>
      (await open()).completeOnboarding(submission, asOfDate),
    getHomeApplicationState: async (asOfDate) => (await open()).getHome(asOfDate),
    getExpenseRecordById: async (expenseId) => (await open()).getExpenseRecordById(expenseId),
    recordExpenseAndRecalculate: async (expense, asOfDate) =>
      (await open()).recordExpense(expense, asOfDate),
    getFinancialMaintenanceState: async (asOfDate) =>
      (await open()).getFinancialMaintenanceState(asOfDate),
    getFinancialMaintenanceRequirement: async (patch, asOfDate) =>
      (await open()).getFinancialMaintenanceRequirement(patch, asOfDate),
    updateFinancialDataAndRecalculate: async (patch, asOfDate) =>
      (await open()).updateFinancialData(patch, asOfDate),
    saveCurrentMonthDebtFact: async (command, asOfDate) =>
      (await open()).saveCurrentMonthDebtFact(command, asOfDate),
    savePlanningMonthDecision: async (month, asOfDate, decision) =>
      (await open()).savePlanningMonthDecision(month, asOfDate, decision),
    reviseActualIncome: async (input) => (await open()).reviseActualIncome(input),
    getV4FinancialReadState: async (month, asOfDate) =>
      (await open()).getV4FinancialReadState(month, asOfDate),
    deactivateCashAccount: async (accountId, asOfDate) =>
      (await open()).deactivateCashAccount(accountId, asOfDate),
    deactivateAsset: async (assetId, asOfDate) => (await open()).deactivateAsset(assetId, asOfDate),
    deactivateDebt: async (debtId, month, asOfDate) =>
      (await open()).deactivateDebt(debtId, month, asOfDate),
  };
}
