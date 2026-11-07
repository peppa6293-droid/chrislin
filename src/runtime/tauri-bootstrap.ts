import { getIdentifier } from "@tauri-apps/api/app";
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
import {
  type RecoveryEntryReport,
  type RecoveryReport,
  recoverFromJournal,
} from "../application/recovery-service.js";
import {
  listTransfersWithIntegrity,
  type TransferListItem,
} from "../application/transfer-read-model.js";
import * as uxLedger from "../application/ux-ledger-service.js";
import { V2ExpenseService } from "../application/v2-expense-service.js";
import { V2ImportService } from "../application/v2-import-service.js";
import type { V4FinancialReadState } from "../application/v4-foundation-service.js";
import {
  V4FoundationService,
  type V4MutationResult,
} from "../application/v4-foundation-service.js";
import { ApplicationDataError, type SqlDatabase } from "../persistence/database.js";
import { saveDatabaseBackup, saveExportFile } from "../persistence/export-file.js";
import { migrateDatabase } from "../persistence/migrations.js";
import {
  RecoveryJournal,
  type RecoveryJournalChannel,
  type RecoveryJournalDocument,
} from "../persistence/recovery-journal.js";
import { type PlanningIncomeMonthDecision, Repositories } from "../persistence/repositories.js";
import { TauriSqlDatabase } from "../persistence/tauri-database.js";
import type { V2ImportContext, V2ImportWriteInput, V2ImportWriteResult } from "../ui/contracts.js";
import type { V2DashboardProps } from "../ui/v2-dashboard.js";

declare const __WP03_PREVIEW_BUILD__: boolean;

/**
 * The Production bundle id owns a native-only schema authority. Its database is
 * migrated exclusively by the gated Rust runner, which commits the V8 terminal
 * and readback before this composition root can run.
 */
export const PRODUCTION_RUNTIME_IDENTIFIER = "com.personalfinance.console";

/**
 * Every non-Production runtime that may apply the TypeScript migration chain.
 * An unrecognized identity fails closed instead of silently choosing a schema
 * authority (and therefore an application-data directory) at runtime.
 */
const TYPESCRIPT_MANAGED_RUNTIME_IDENTIFIERS: ReadonlySet<string> = new Set([
  "com.personalfinance.console.smoke",
  "com.personalfinance.console.v4acceptance",
  "com.personalfinance.console.wp02preview",
  "com.personalfinance.console.wp03preview",
  "org.pfc.quiescence.integration",
]);

export type RuntimeSchemaAuthority = "NATIVE_V8_GATE" | "TYPESCRIPT_MIGRATION";

export function resolveRuntimeSchemaAuthority(identifier: string): RuntimeSchemaAuthority {
  if (identifier === PRODUCTION_RUNTIME_IDENTIFIER) return "NATIVE_V8_GATE";
  if (TYPESCRIPT_MANAGED_RUNTIME_IDENTIFIERS.has(identifier)) return "TYPESCRIPT_MIGRATION";
  throw new ApplicationDataError(
    "RUNTIME_IDENTITY_NOT_ISOLATED",
    `Refusing to select a schema authority for unexpected runtime identity "${identifier}".`,
  );
}

export interface TauriCompositionDependencies {
  /** Returns an already-open database. Tests inject an isolated fixture. */
  openDatabase?: () => Promise<SqlDatabase>;
  identifyRuntime?: () => Promise<string>;
}

/**
 * Resolves the native runtime identity before opening any database, then lets
 * only explicitly isolated runtimes execute the TypeScript V1..V8 chain. The
 * Production runtime performs no TypeScript DDL; its control is the Rust V8
 * startup gate, which has already verified the terminal, schema and bindings.
 */
async function openRuntimeDatabase(
  dependencies: TauriCompositionDependencies = {},
): Promise<SqlDatabase> {
  const identify = dependencies.identifyRuntime ?? getIdentifier;
  let identifier: string;
  try {
    identifier = await identify();
  } catch (cause) {
    throw new ApplicationDataError(
      "RUNTIME_IDENTITY_UNAVAILABLE",
      "The native runtime identity is unavailable; refusing to choose a schema authority.",
      { cause },
    );
  }
  if (typeof identifier !== "string" || identifier.trim() === "") {
    throw new ApplicationDataError(
      "RUNTIME_IDENTITY_UNAVAILABLE",
      "The native runtime returned an empty identity; refusing to choose a schema authority.",
    );
  }
  const authority = resolveRuntimeSchemaAuthority(identifier);
  const db = dependencies.openDatabase
    ? await dependencies.openDatabase()
    : await (async () => {
        const database = new TauriSqlDatabase();
        await database.open();
        return database;
      })();
  if (authority === "NATIVE_V8_GATE") {
    await requireNativeV8Schema(db);
  } else {
    await migrateDatabase(db);
  }
  return db;
}

/**
 * Read-only defense in depth for the Production composition root. The Rust
 * startup gate remains the authority for the terminal and its bindings; this
 * only ensures a V8-native database is never handed to business services when
 * the gate has not completed, and it never writes schema state.
 */
async function requireNativeV8Schema(db: SqlDatabase): Promise<void> {
  const userVersion = Number(
    (await db.select<{ user_version: number }>("PRAGMA user_version"))[0]?.user_version ?? 0,
  );
  const migrationTable = await db.select<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  );
  const migrationVersion =
    migrationTable.length === 0
      ? 0
      : Number(
          (
            await db.select<{ version: number | null }>(
              "SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations",
            )
          )[0]?.version ?? 0,
        );
  if (userVersion !== 8 || migrationVersion !== 8) {
    throw new ApplicationDataError(
      "PRODUCTION_SCHEMA_NOT_V8",
      `Production requires a V8 database verified by the native gate (user_version=${userVersion}, schema_migrations=${migrationVersion}).`,
    );
  }
}

export async function getWp03PreviewTestDate(): Promise<string | null> {
  if (!__WP03_PREVIEW_BUILD__) return null;
  return invoke<string | null>("wp03_preview_get_test_date");
}

export async function setWp03PreviewTestDate(testDate: string | null): Promise<void> {
  if (!__WP03_PREVIEW_BUILD__) throw new Error("WP-03 验收日期仅在 WP-03 测试版中可用。");
  await invoke("wp03_preview_set_test_date", { testDate });
}

type V2QuickEntryCategory = NonNullable<ExpenseSubmission["category"]>;

interface V2LedgerDefaults {
  profileId: string;
  cashAccountId: string;
  categoryIds: Record<V2QuickEntryCategory, string>;
}

const DEFAULT_CASH_ACCOUNT = { name: "现金", type: "CASH", currency: "CNY" } as const;

/**
 * Fixed V2 quick-entry category table. These six categories map to the V1
 * submission enum by name, intentionally fixed here (never persisted as a
 * database mapping).
 */
const V2_DEFAULT_CATEGORIES: ReadonlyArray<{
  name: string;
  icon: string;
  color: string;
  category: V2QuickEntryCategory;
}> = [
  { name: "餐饮", icon: "Utensils", color: "#F06A58", category: "FOOD" },
  { name: "交通", icon: "Train", color: "#5272D8", category: "TRANSPORT" },
  { name: "购物", icon: "ShoppingBag", color: "#E7AD35", category: "SHOPPING" },
  { name: "娱乐", icon: "Film", color: "#8472C7", category: "ENTERTAINMENT" },
  { name: "家居", icon: "House", color: "#129B84", category: "HOUSEHOLD" },
  { name: "其他", icon: "Shapes", color: "#66717D", category: "OTHER_VARIABLE" },
];

/** Expense categories outside quick entry, used by import classification. */
const V2_EXTRA_CATEGORIES: ReadonlyArray<{ name: string; icon: string; color: string }> = [
  { name: "医疗", icon: "HeartPulse", color: "#F47B68" },
  { name: "居住", icon: "Home", color: "#24B89A" },
  { name: "水电", icon: "Zap", color: "#FFC94A" },
  { name: "保险", icon: "ShieldCheck", color: "#4B8FE8" },
  { name: "教育", icon: "GraduationCap", color: "#8C72D8" },
];

/**
 * Idempotently seeds the default cash account and built-in categories, adding
 * only names that are missing so existing user edits survive repeated startups.
 */
export async function ensureV2LedgerDefaults(db: SqlDatabase): Promise<V2LedgerDefaults> {
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  if (!profile) {
    throw new ApplicationDataError(
      "PROFILE_NOT_FOUND",
      "V2 ledger defaults require a completed onboarding profile.",
    );
  }

  let accounts = await repositories.listAccounts(profile.id);
  if (accounts.length === 0) {
    await repositories.createAccount({
      id: globalThis.crypto.randomUUID(),
      profileId: profile.id,
      name: DEFAULT_CASH_ACCOUNT.name,
      type: DEFAULT_CASH_ACCOUNT.type,
      currency: DEFAULT_CASH_ACCOUNT.currency,
    });
    accounts = await repositories.listAccounts(profile.id);
  }

  let categories = await repositories.listExpenseCategories(profile.id);
  const existingNames = new Set(categories.map((category) => category.name));
  const missingCategories = [...V2_DEFAULT_CATEGORIES, ...V2_EXTRA_CATEGORIES].filter(
    (definition) => !existingNames.has(definition.name),
  );
  if (missingCategories.length > 0) {
    await db.transaction(async (transactionDb) => {
      const transactionRepositories = new Repositories(transactionDb);
      for (const definition of missingCategories) {
        await transactionRepositories.createExpenseCategory({
          id: globalThis.crypto.randomUUID(),
          profileId: profile.id,
          name: definition.name,
          icon: definition.icon,
          color: definition.color,
          monthlyBudget: null,
          overspendingAlert: false,
          savingsRelated: false,
          adjustable: true,
          builtin: true,
        });
      }
    });
    categories = await repositories.listExpenseCategories(profile.id);
  }

  const cashAccount =
    accounts.find((account) => account.active && account.type === "CASH") ??
    accounts.find((account) => account.active) ??
    accounts[0];
  if (!cashAccount) {
    throw new ApplicationDataError("INVALID_ACCOUNT", "No account is available for quick entry.");
  }

  const categoryIdByName = new Map(categories.map((category) => [category.name, category.id]));
  const fallbackCategoryId = categoryIdByName.get("其他") ?? categories[0]?.id;
  if (!fallbackCategoryId) {
    throw new ApplicationDataError(
      "INVALID_CATEGORY",
      "No expense category is available for quick entry.",
    );
  }
  const categoryIds = Object.fromEntries(
    V2_DEFAULT_CATEGORIES.map((definition) => [
      definition.category,
      categoryIdByName.get(definition.name) ?? fallbackCategoryId,
    ]),
  ) as Record<V2QuickEntryCategory, string>;

  return { profileId: profile.id, cashAccountId: cashAccount.id, categoryIds };
}

/**
 * Quick-entry write through the D-01 dual-write service. The V1 mirror keeps the
 * fixed mapping kind=VARIABLE / category=OTHER_VARIABLE for every V2 category.
 * asOfDate is the session business date and doubles as the deduction operation date.
 */
export async function recordV2CashExpenseForDatabase(
  db: SqlDatabase,
  submission: ExpenseSubmission,
  asOfDate: string,
): Promise<{ expenseId: string }> {
  const defaults = await ensureV2LedgerDefaults(db);
  const expenseId = submission.id ?? globalThis.crypto.randomUUID();
  await new V2ExpenseService(new Repositories(db)).recordCashDebitExpense({
    id: expenseId,
    profileId: defaults.profileId,
    amount: submission.amount,
    currency: "CNY",
    occurredOn: submission.businessDate,
    categoryId: defaults.categoryIds[submission.category ?? "OTHER_VARIABLE"],
    description: submission.note ?? "",
    accountId: defaults.cashAccountId,
    ...(submission.deductionAccountId
      ? { deductionAccountId: submission.deductionAccountId, operationDate: asOfDate }
      : {}),
  });
  return { expenseId };
}

/**
 * Import options for the CSV page. The composition root resolves the single
 * profile so the UI never receives a profile id or a repository handle.
 */
export async function getV2ImportOptionsForDatabase(db: SqlDatabase): Promise<V2ImportContext> {
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  if (!profile) {
    throw new ApplicationDataError(
      "PROFILE_NOT_FOUND",
      "V2 import requires a completed onboarding profile.",
    );
  }
  const [categories, accounts, dedupeKeys] = await Promise.all([
    repositories.listExpenseCategories(profile.id),
    repositories.listAccounts(profile.id),
    repositories.listImportedDedupeKeys(profile.id),
  ]);
  return {
    categories: categories
      .filter((category) => category.active)
      .map(({ id, name }) => ({ id, name })),
    accounts: accounts
      .filter((account) => account.active && account.type === "CASH")
      .map(({ id, name }) => ({ id, name })),
    dedupeKeys,
  };
}

/**
 * CSV import write through the D-01 dual-write service. The UI passes the CSV
 * text it read with File.text(); this layer never touches the filesystem.
 */
export async function writeV2ImportForDatabase(
  db: SqlDatabase,
  input: V2ImportWriteInput,
): Promise<V2ImportWriteResult> {
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  if (!profile) {
    throw new ApplicationDataError(
      "PROFILE_NOT_FOUND",
      "V2 import requires a completed onboarding profile.",
    );
  }
  const result = await new V2ImportService(repositories).writeConfirmedImport({
    ...input,
    profileId: profile.id,
  });
  return {
    writtenRows: result.writtenRows,
    skippedRows: result.skippedRows,
    errorRows: result.errorRows,
  };
}

export type ApplicationStartupState =
  | ApplicationInitializationState
  | { status: "ERROR"; message: string };

/**
 * The journal lives in Rust (§5.1.4.1/§5.1.4.3): it must stay writable when the SQLite
 * connection is faulted, so it never goes through `SqlDatabase`.
 */
class TauriRecoveryJournalChannel implements RecoveryJournalChannel {
  async read(profileId: string): Promise<RecoveryJournalDocument | null> {
    return await invoke<RecoveryJournalDocument | null>("recovery_journal_read", { profileId });
  }

  async write(document: RecoveryJournalDocument): Promise<void> {
    await invoke("recovery_journal_write", { document });
  }
}

export function createRecoveryJournal(): RecoveryJournal {
  return new RecoveryJournal(new TauriRecoveryJournalChannel());
}

/** Diagnostics only: what the last startup scan saw. Never used to decide a write. */
let lastRecoveryReport: RecoveryReport | null = null;
let lastRecoveryError: { code: string; message: string } | null = null;

export function getLastTransferRecoveryState(): {
  report: RecoveryReport | null;
  error: { code: string; message: string } | null;
} {
  return { report: lastRecoveryReport, error: lastRecoveryError };
}

/** Exposed for the receipt: every scanned entry, in journal order. */
export function lastRecoveryEntries(): RecoveryEntryReport[] {
  return lastRecoveryReport?.entries ?? [];
}

/**
 * Startup scan (§5.1.4 恢复侧). A journal that cannot be read leaves the profile closed for
 * edit/delete/restore but never prevents the app from opening; a first launch has no profile
 * and therefore nothing to recover.
 */
async function runStartupRecovery(db: SqlDatabase, journal: RecoveryJournal): Promise<void> {
  const profile = await new Repositories(db).getProfile();
  if (!profile) return;
  try {
    lastRecoveryReport = await recoverFromJournal(db, journal, profile.id);
    lastRecoveryError = null;
  } catch (error) {
    lastRecoveryReport = null;
    lastRecoveryError =
      error instanceof ApplicationDataError
        ? { code: error.code, message: error.message }
        : { code: "RECOVERY_JOURNAL_UNREADABLE", message: String(error) };
  }
}

export async function bootstrapTauriApplication(
  dependencies: TauriCompositionDependencies = {},
): Promise<ApplicationStartupState> {
  try {
    const db = await openRuntimeDatabase(dependencies);
    await runStartupRecovery(db, createRecoveryJournal());
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
  recordV2CashExpense(
    submission: ExpenseSubmission,
    asOfDate: string,
  ): Promise<{ expenseId: string }>;
  getV2ImportOptions(): Promise<V2ImportContext>;
  writeV2Import(input: V2ImportWriteInput): Promise<V2ImportWriteResult>;
  getV2DashboardProps(month: string): Promise<V2DashboardProps>;
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
  listLedgerExpenses(month?: string): Promise<uxLedger.LedgerExpenseRow[]>;
  editLedgerExpense(input: uxLedger.ExpenseEditInput): Promise<uxLedger.LedgerMutationResult>;
  deleteLedgerExpense(
    expenseId: string,
    asOfDate: string,
  ): Promise<uxLedger.LedgerMutationResult & { snapshot: uxLedger.DeletedExpenseSnapshot }>;
  restoreLedgerExpense(
    snapshot: uxLedger.DeletedExpenseSnapshot,
    asOfDate: string,
  ): Promise<uxLedger.LedgerMutationResult>;
  listLedgerTransfers(month: string, includeDeleted?: boolean): Promise<TransferListItem[]>;
  createLedgerTransfer(
    input: uxLedger.TransferCreateInput,
    asOfDate: string,
  ): Promise<uxLedger.TransferMutationResult>;
  editLedgerTransfer(
    input: uxLedger.TransferEditInput,
    asOfDate: string,
  ): Promise<uxLedger.TransferMutationResult>;
  deleteLedgerTransfer(
    transferId: string,
    asOfDate: string,
  ): Promise<uxLedger.TransferMutationResult>;
  restoreLedgerTransfer(
    transferId: string,
    asOfDate: string,
  ): Promise<uxLedger.TransferMutationResult>;
  getRecordingStreak(asOfDate: string): Promise<uxLedger.RecordingStreak>;
  listEssentialPaymentItems(
    asOfDate: string,
  ): Promise<Array<{ id: string; name: string; category: string; monthlyAmount: string }>>;
  listEssentialPayments(month?: string): Promise<uxLedger.EssentialPaymentRecord[]>;
  recordEssentialPayment(input: {
    itemId: string;
    amount: string;
    paidOn: string;
    note?: string;
  }): Promise<{
    payment: uxLedger.EssentialPaymentRecord;
    monthTotal: string;
    home: HomeApplicationState;
  }>;
  saveEssentialItems(
    items: uxLedger.EssentialItemPatch[],
    asOfDate: string,
  ): Promise<{ home: HomeApplicationState }>;
  listDebtPaymentLog(): Promise<uxLedger.DebtPaymentRecord[]>;
  recordDebtRepayment(input: {
    debtId: string;
    amount: string;
    paidOn: string;
    note?: string;
    asOfDate: string;
  }): Promise<{
    payment: uxLedger.DebtPaymentRecord;
    home: HomeApplicationState;
    reconciliation: {
      revisionBalance: string | null;
      factBalance: string | null;
      balanced: boolean;
    };
  }>;
  recategorizeLedgerExpenses(
    assignments: uxLedger.RecategorizationAssignment[],
    asOfDate: string,
  ): Promise<uxLedger.RecategorizationResult>;
  readAuditLog(): Promise<Record<string, unknown>[]>;
  exportLedger(asOfDate: string): Promise<{
    jsonPath: string;
    csvPath: string;
    tableCounts: Record<string, number>;
  }>;
  exportDatabaseBackup(): Promise<{ path: string; sha256: string }>;
}

export interface TauriProductServices
  extends Pick<
    TauriApplicationServices,
    | "listLedgerExpenses"
    | "editLedgerExpense"
    | "deleteLedgerExpense"
    | "restoreLedgerExpense"
    | "listLedgerTransfers"
    | "createLedgerTransfer"
    | "editLedgerTransfer"
    | "deleteLedgerTransfer"
    | "restoreLedgerTransfer"
    | "getRecordingStreak"
    | "listEssentialPaymentItems"
    | "listEssentialPayments"
    | "recordEssentialPayment"
    | "saveEssentialItems"
    | "listDebtPaymentLog"
    | "recordDebtRepayment"
    | "recategorizeLedgerExpenses"
    | "readAuditLog"
    | "exportLedger"
    | "exportDatabaseBackup"
  > {
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
  recordV2CashExpense(
    submission: ExpenseSubmission,
    asOfDate: string,
  ): Promise<{ expenseId: string }>;
  getV2ImportOptions(): Promise<V2ImportContext>;
  writeV2Import(input: V2ImportWriteInput): Promise<V2ImportWriteResult>;
  getV2DashboardProps(month: string): Promise<V2DashboardProps>;
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

export async function createTauriApplicationServices(
  dependencies: TauriCompositionDependencies = {},
): Promise<TauriApplicationServices> {
  const db = await openRuntimeDatabase(dependencies);
  const journal = createRecoveryJournal();
  await runStartupRecovery(db, journal);
  const initialization = await getApplicationInitializationState(db);
  if (initialization.status === "READY") await ensureV2LedgerDefaults(db);
  const foundation = new V4FoundationService(db);
  return {
    initialization,
    completeOnboarding: async (submission, asOfDate) => {
      const home = await completeOnboarding(db, submission, asOfDate);
      await ensureV2LedgerDefaults(db);
      // A fresh profile has no journal yet; the scan is what opens the write gate.
      await runStartupRecovery(db, journal);
      return home;
    },
    getHome: (asOfDate) => getHomeApplicationState(db, asOfDate),
    getExpenseRecordById: (expenseId) => getExpenseRecordById(db, expenseId),
    recordExpense: (expense, asOfDate) => recordExpenseAndRecalculate(db, expense, asOfDate),
    recordV2CashExpense: (submission, asOfDate) =>
      recordV2CashExpenseForDatabase(db, submission, asOfDate),
    getV2ImportOptions: () => getV2ImportOptionsForDatabase(db),
    writeV2Import: (input) => writeV2ImportForDatabase(db, input),
    getV2DashboardProps: async (month) => {
      const repositories = new Repositories(db);
      const profile = await repositories.getProfile();
      if (!profile) {
        throw new ApplicationDataError(
          "PROFILE_NOT_FOUND",
          "V2 dashboard requires a completed onboarding profile.",
        );
      }
      return new V2ExpenseService(repositories).getDashboardProps(profile.id, month);
    },
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
    listLedgerExpenses: (month) => uxLedger.listLedgerExpenses(db, month),
    editLedgerExpense: (input) => uxLedger.editLedgerExpense(db, input),
    deleteLedgerExpense: (expenseId, asOfDate) =>
      uxLedger.deleteLedgerExpense(db, expenseId, asOfDate),
    restoreLedgerExpense: (snapshot, asOfDate) =>
      uxLedger.restoreLedgerExpense(db, snapshot, asOfDate),
    listLedgerTransfers: async (month, includeDeleted) => {
      const profile = await new Repositories(db).getProfile();
      if (!profile) {
        throw new ApplicationDataError(
          "PROFILE_NOT_FOUND",
          "Transfers require a completed onboarding profile.",
        );
      }
      return listTransfersWithIntegrity(db, profile.id, month, includeDeleted ?? false);
    },
    createLedgerTransfer: (input, asOfDate) =>
      uxLedger.createLedgerTransfer(db, journal, input, asOfDate),
    editLedgerTransfer: (input, asOfDate) =>
      uxLedger.editLedgerTransfer(db, journal, input, asOfDate),
    deleteLedgerTransfer: (transferId, asOfDate) =>
      uxLedger.deleteLedgerTransfer(db, journal, transferId, asOfDate),
    restoreLedgerTransfer: (transferId, asOfDate) =>
      uxLedger.restoreLedgerTransfer(db, journal, transferId, asOfDate),
    getRecordingStreak: (asOfDate) => uxLedger.getRecordingStreak(db, asOfDate),
    listEssentialPaymentItems: (asOfDate) => uxLedger.listEssentialPaymentItems(db, asOfDate),
    listEssentialPayments: (month) => uxLedger.listEssentialPayments(db, month),
    recordEssentialPayment: (input) => uxLedger.recordEssentialPayment(db, input),
    saveEssentialItems: (items, asOfDate) => uxLedger.saveEssentialItems(db, items, asOfDate),
    listDebtPaymentLog: () => uxLedger.listDebtPaymentLog(db),
    recordDebtRepayment: (input) => uxLedger.recordDebtRepayment(db, input),
    recategorizeLedgerExpenses: (assignments, asOfDate) =>
      uxLedger.recategorizeLedgerExpenses(db, assignments, asOfDate),
    readAuditLog: () => uxLedger.readAuditLog(db),
    exportLedger: async (asOfDate) => {
      const bundle = await uxLedger.buildExportBundle(db, asOfDate);
      const stamp = asOfDate;
      const jsonPath = await saveExportFile(`xiaoqianjia-backup-${stamp}.json`, bundle.json);
      const csvPath = await saveExportFile(`xiaoqianjia-expenses-${stamp}.csv`, bundle.csv);
      return { jsonPath, csvPath, tableCounts: bundle.tableCounts };
    },
    exportDatabaseBackup: () => saveDatabaseBackup(),
  };
}

/** Stable UI API with lazy startup; neither the UI nor its contract receives the database. */
let sharedApplication: Promise<TauriApplicationServices> | undefined;

function openSharedApplication(): Promise<TauriApplicationServices> {
  if (!sharedApplication) {
    sharedApplication = createTauriApplicationServices();
  }
  return sharedApplication;
}

export function getTauriProductServices(): TauriProductServices {
  const open = openSharedApplication;
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
    recordV2CashExpense: async (submission, asOfDate) =>
      (await open()).recordV2CashExpense(submission, asOfDate),
    getV2ImportOptions: async () => (await open()).getV2ImportOptions(),
    writeV2Import: async (input) => (await open()).writeV2Import(input),
    getV2DashboardProps: async (month) => (await open()).getV2DashboardProps(month),
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
    listLedgerExpenses: async (month) => (await open()).listLedgerExpenses(month),
    editLedgerExpense: async (input) => (await open()).editLedgerExpense(input),
    deleteLedgerExpense: async (expenseId, asOfDate) =>
      (await open()).deleteLedgerExpense(expenseId, asOfDate),
    restoreLedgerExpense: async (snapshot, asOfDate) =>
      (await open()).restoreLedgerExpense(snapshot, asOfDate),
    listLedgerTransfers: async (month, includeDeleted) =>
      (await open()).listLedgerTransfers(month, includeDeleted),
    createLedgerTransfer: async (input, asOfDate) =>
      (await open()).createLedgerTransfer(input, asOfDate),
    editLedgerTransfer: async (input, asOfDate) =>
      (await open()).editLedgerTransfer(input, asOfDate),
    deleteLedgerTransfer: async (transferId, asOfDate) =>
      (await open()).deleteLedgerTransfer(transferId, asOfDate),
    restoreLedgerTransfer: async (transferId, asOfDate) =>
      (await open()).restoreLedgerTransfer(transferId, asOfDate),
    getRecordingStreak: async (asOfDate) => (await open()).getRecordingStreak(asOfDate),
    listEssentialPaymentItems: async (asOfDate) =>
      (await open()).listEssentialPaymentItems(asOfDate),
    listEssentialPayments: async (month) => (await open()).listEssentialPayments(month),
    recordEssentialPayment: async (input) => (await open()).recordEssentialPayment(input),
    saveEssentialItems: async (items, asOfDate) =>
      (await open()).saveEssentialItems(items, asOfDate),
    listDebtPaymentLog: async () => (await open()).listDebtPaymentLog(),
    recordDebtRepayment: async (input) => (await open()).recordDebtRepayment(input),
    recategorizeLedgerExpenses: async (assignments, asOfDate) =>
      (await open()).recategorizeLedgerExpenses(assignments, asOfDate),
    readAuditLog: async () => (await open()).readAuditLog(),
    exportLedger: async (asOfDate) => (await open()).exportLedger(asOfDate),
    exportDatabaseBackup: async () => (await open()).exportDatabaseBackup(),
  };
}
