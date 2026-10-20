import type {
  SaveCurrentMonthDebtFactCommand,
  SaveCurrentMonthDebtFactResult,
} from "../application/debt-fact-service.js";
import type {
  FinancialMaintenancePatch,
  FinancialMaintenanceState,
  FinancialMaintenanceUpdateResult,
} from "../application/financial-maintenance-service.js";
import type {
  ExpenseSubmission,
  HomeApplicationState,
  OnboardingRequirement,
  OnboardingSubmission,
} from "../application/product-service.js";
import type { ConfirmedImportInput, ImportBatchResult } from "../application/v2-import-service.js";
import type {
  V4FinancialReadState,
  V4MutationResult,
} from "../application/v4-foundation-service.js";
import type { ExpenseRecord } from "../model/types.js";
import type { PlanningIncomeMonthDecision } from "../persistence/repositories.js";
import type { ApplicationStartupState } from "../runtime/tauri-bootstrap.js";

/** Options the import page needs before writing: active categories, cash accounts, dedupe keys. */
export interface V2ImportContext {
  categories: Array<{ id: string; name: string }>;
  accounts: Array<{ id: string; name: string }>;
  dedupeKeys: string[];
}

/** The composition root resolves the single profile; the UI never sees a profile id. */
export type V2ImportWriteInput = Omit<ConfirmedImportInput, "profileId">;

export type V2ImportWriteResult = Pick<
  ImportBatchResult,
  "writtenRows" | "skippedRows" | "errorRows"
>;

export interface ProductApplicationServices {
  bootstrap(): Promise<ApplicationStartupState>;
  getOnboardingRequirement(
    submission: OnboardingSubmission,
    asOfDate: string,
  ): OnboardingRequirement;
  completeOnboarding(
    submission: OnboardingSubmission,
    asOfDate: string,
  ): Promise<HomeApplicationState>;
  getHomeApplicationState(asOfDate: string): Promise<HomeApplicationState>;
  getExpenseRecordById(expenseId: string): Promise<ExpenseRecord | null>;
  recordExpenseAndRecalculate(
    expense: ExpenseSubmission,
    asOfDate: string,
  ): Promise<HomeApplicationState>;
  recordV2CashExpense(
    submission: ExpenseSubmission,
    asOfDate: string,
  ): Promise<{ expenseId: string }>;
  getV2ImportOptions(): Promise<V2ImportContext>;
  writeV2Import(input: V2ImportWriteInput): Promise<V2ImportWriteResult>;
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
