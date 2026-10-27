import { assertUserInputMoney, money } from "../model/money.js";
import type { ExpenseCategory } from "../model/types.js";
import { ApplicationDataError, type SqlDatabase } from "../persistence/database.js";
import { Repositories } from "../persistence/repositories.js";
import { getHomeApplicationState, type HomeApplicationState } from "./product-service.js";

/**
 * UX-revamp ledger operations.
 *
 * Every write stays inside the D-01 dual-ledger contract:
 *  - V2 `expenses` rows written as CASH_DEBIT keep a V1 `expense_records` mirror
 *    with the same id, mirrored in the same transaction;
 *  - edits/deletes touch both ledgers in one transaction and are verified by a
 *    read-back reconciliation before the transaction commits.
 *
 * No schema is created here. Audit trails live in `app_metadata` JSON values
 * because the frozen schema has no dedicated audit table.
 */

const DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

const AUDIT_KEY = "ux.audit.v1";
const DEBT_PAYMENT_KEY = "ux.debt-payments.v1";
const ESSENTIAL_PAYMENT_KEY = "ux.essential-payments.v1";
const AUDIT_LIMIT = 300;

const ESSENTIAL_CATEGORIES: ReadonlySet<ExpenseCategory> = new Set<ExpenseCategory>([
  "HOUSING",
  "BASIC_FOOD",
  "TRANSPORT",
  "UTILITIES_COMMUNICATIONS",
  "INSURANCE",
  "FAMILY_FIXED_RESPONSIBILITY",
  "OTHER_ESSENTIAL",
]);

export interface LedgerExpenseRow {
  id: string;
  kind: string;
  amount: string;
  businessDate: string;
  categoryId: string;
  categoryName: string;
  categoryColor: string;
  description: string;
  accountId: string | null;
  /** True when this row has a V1 mirror that must move together with V2. */
  mirrored: boolean;
}

export interface LedgerReconciliation {
  expenseId: string;
  /** `null` when the row no longer exists in that ledger. */
  v2Amount: string | null;
  v1Amount: string | null;
  /** CASH_DEBIT rows must appear in both ledgers with equal amounts. */
  mirrored: boolean;
  balanced: boolean;
}

export interface LedgerMutationResult {
  home: HomeApplicationState;
  reconciliation: LedgerReconciliation;
}

export interface DeletedExpenseSnapshot {
  id: string;
  profileId: string;
  kind: string;
  amount: string;
  currency: string;
  occurredOn: string;
  categoryId: string;
  description: string;
  accountId: string | null;
  creditCardId: string | null;
  createdAt: string;
  mirror: {
    amount: string;
    occurredAt: string;
    businessDate: string;
    note: string | null;
    createdAt: string;
  } | null;
}

export interface ExpenseEditInput {
  id: string;
  amount: string;
  businessDate: string;
  categoryId: string;
  description: string;
  asOfDate: string;
}

export interface EssentialPaymentRecord {
  id: string;
  itemId: string;
  itemName: string;
  category: ExpenseCategory;
  amount: string;
  paidOn: string;
  note: string | null;
  recordedAt: string;
}

export interface DebtPaymentRecord {
  id: string;
  debtId: string;
  debtName: string;
  amount: string;
  paidOn: string;
  note: string | null;
  balanceBefore: string;
  balanceAfter: string;
  recordedAt: string;
}

export interface RecategorizationAssignment {
  expenseId: string;
  categoryId: string;
}

export interface RecategorizationResult {
  updated: number;
  skipped: number;
  totalBefore: string;
  totalAfter: string;
  countBefore: number;
  countAfter: number;
  home: HomeApplicationState;
}

export interface ExportBundle {
  json: string;
  csv: string;
  tableCounts: Record<string, number>;
}

export interface RecordingStreak {
  consecutiveDays: number;
  recordedToday: boolean;
  lastRecordedDate: string | null;
}

function validDate(value: string, field: string): string {
  if (!DATE_PATTERN.test(value)) {
    throw new ApplicationDataError("INVALID_DATE", `${field} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new ApplicationDataError("INVALID_DATE", `${field} must be a calendar date.`);
  }
  return value;
}

function positiveAmount(value: string, code: string): string {
  let normalized: string;
  try {
    normalized = assertUserInputMoney(value, "amount");
  } catch (error) {
    throw new ApplicationDataError(code, "Amount must be a valid positive number.", {
      cause: error,
    });
  }
  if (!money(normalized).gt(0)) {
    throw new ApplicationDataError(code, "Amount must be greater than zero.");
  }
  return normalized;
}

function text(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  return typeof value === "string"
    ? value
    : value === null || value === undefined
      ? ""
      : String(value);
}

function nullableText(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : null;
}

async function appendMetadataEntry(
  db: SqlDatabase,
  key: string,
  entry: Record<string, unknown>,
  limit = AUDIT_LIMIT,
): Promise<void> {
  const repository = new Repositories(db);
  const existing = await repository.getMeta(key);
  let entries: unknown[] = [];
  if (existing) {
    try {
      const parsed: unknown = JSON.parse(existing);
      if (Array.isArray(parsed)) entries = parsed;
    } catch {
      entries = [];
    }
  }
  entries.push(entry);
  const trimmed = entries.slice(Math.max(0, entries.length - limit));
  await repository.setMeta(key, JSON.stringify(trimmed));
}

export async function readAuditLog(db: SqlDatabase): Promise<Record<string, unknown>[]> {
  const raw = await new Repositories(db).getMeta(AUDIT_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

async function readMetadataEntries(
  db: SqlDatabase,
  key: string,
): Promise<Record<string, unknown>[]> {
  const raw = await new Repositories(db).getMeta(key);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [];
  } catch {
    return [];
  }
}

export async function listLedgerExpenses(
  db: SqlDatabase,
  month?: string,
): Promise<LedgerExpenseRow[]> {
  if (month !== undefined && !MONTH_PATTERN.test(month)) {
    throw new ApplicationDataError("INVALID_MONTH", "month must use YYYY-MM format.");
  }
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  if (!profile) throw new ApplicationDataError("INITIALIZATION_REQUIRED", "Profile is required.");
  const expenses = await repositories.listV2Expenses(profile.id, month);
  const categories = await repositories.listExpenseCategories(profile.id);
  const byId = new Map(categories.map((category) => [category.id, category]));
  const mirrored = new Set(
    (await db.select<{ id: string }>("SELECT id FROM expense_records")).map((row) =>
      text(row, "id"),
    ),
  );
  return expenses.map((expense) => {
    const category = byId.get(expense.categoryId);
    return {
      id: expense.id,
      kind: expense.kind,
      amount: String(expense.amount),
      businessDate: expense.occurredOn,
      categoryId: expense.categoryId,
      categoryName: category?.name ?? "未分类",
      categoryColor: category?.color ?? "#94a3b8",
      description: expense.description,
      accountId: "accountId" in expense ? expense.accountId : null,
      mirrored: mirrored.has(expense.id),
    };
  });
}

export async function readLedgerReconciliation(
  db: SqlDatabase,
  expenseId: string,
): Promise<LedgerReconciliation> {
  const v2 = (await db.select("SELECT amount FROM expenses WHERE id=?", [expenseId]))[0];
  const v1 = (await db.select("SELECT amount FROM expense_records WHERE id=?", [expenseId]))[0];
  const v2Amount = v2 ? text(v2, "amount") : null;
  const v1Amount = v1 ? text(v1, "amount") : null;
  const kind = v2 ? text(v2, "kind") : "CASH_DEBIT";
  const mirrored = kind === "CASH_DEBIT";
  const balanced = mirrored
    ? v2Amount === null
      ? v1Amount === null
      : v1Amount !== null && money(v2Amount).eq(money(v1Amount))
    : v2Amount !== null || v1Amount === null;
  return { expenseId, v2Amount, v1Amount, mirrored, balanced };
}

async function assertBalanced(db: SqlDatabase, expenseId: string): Promise<LedgerReconciliation> {
  const reconciliation = await readLedgerReconciliation(db, expenseId);
  if (!reconciliation.balanced) {
    throw new ApplicationDataError(
      "LEDGER_RECONCILIATION_FAILED",
      `V2/V1 ledger mismatch after write for expense ${expenseId}.`,
    );
  }
  return reconciliation;
}

export async function editLedgerExpense(
  db: SqlDatabase,
  input: ExpenseEditInput,
): Promise<LedgerMutationResult> {
  const amount = positiveAmount(input.amount, "INVALID_EXPENSE_AMOUNT");
  validDate(input.businessDate, "businessDate");
  const profile = await new Repositories(db).getProfile();
  if (!profile) throw new ApplicationDataError("INITIALIZATION_REQUIRED", "Profile is required.");
  const category = await new Repositories(db).getExpenseCategoryById(input.categoryId);
  if (!category || category.profileId !== profile.id || !category.active) {
    throw new ApplicationDataError("INVALID_CATEGORY", "Category does not exist.");
  }
  const now = new Date().toISOString();
  const reconciliation = await db.transaction(async (tx) => {
    const existing = (await tx.select("SELECT * FROM expenses WHERE id=?", [input.id]))[0];
    if (!existing) throw new ApplicationDataError("EXPENSE_NOT_FOUND", "Expense does not exist.");
    const kind = text(existing, "kind");
    await tx.execute(
      "UPDATE expenses SET amount=?,occurred_on=?,category_id=?,description=? WHERE id=?",
      [amount, input.businessDate, input.categoryId, input.description, input.id],
    );
    if (kind === "CASH_DEBIT") {
      const mirror = (await tx.select("SELECT * FROM expense_records WHERE id=?", [input.id]))[0];
      if (mirror) {
        // D-01: the mirror category stays `OTHER_VARIABLE`; only mirrored facts move.
        await tx.execute(
          "UPDATE expense_records SET amount=?,occurred_at=?,business_date=?,note=? WHERE id=?",
          [
            money(amount).toString(),
            `${input.businessDate}T00:00:00.000Z`,
            input.businessDate,
            input.description,
            input.id,
          ],
        );
      } else {
        await tx.execute(
          `INSERT INTO expense_records(id,profile_id,amount,occurred_at,kind,category,note,created_at,business_date)
           VALUES(?,?,?,?,?,?,?,?,?)`,
          [
            input.id,
            profile.id,
            money(amount).toString(),
            `${input.businessDate}T00:00:00.000Z`,
            "VARIABLE",
            "OTHER_VARIABLE",
            input.description,
            now,
            input.businessDate,
          ],
        );
      }
    }
    await appendMetadataEntry(tx, AUDIT_KEY, {
      at: now,
      action: "EDIT_EXPENSE",
      expenseId: input.id,
      amountBefore: text(existing, "amount"),
      amountAfter: amount,
      businessDateBefore: text(existing, "occurred_on"),
      businessDateAfter: input.businessDate,
      categoryIdBefore: text(existing, "category_id"),
      categoryIdAfter: input.categoryId,
      descriptionBefore: text(existing, "description"),
      descriptionAfter: input.description,
    });
    return assertBalanced(tx, input.id);
  });
  return {
    home: await getHomeApplicationState(db, input.asOfDate),
    reconciliation,
  };
}

export async function deleteLedgerExpense(
  db: SqlDatabase,
  expenseId: string,
  asOfDate: string,
): Promise<LedgerMutationResult & { snapshot: DeletedExpenseSnapshot }> {
  validDate(asOfDate, "asOfDate");
  const now = new Date().toISOString();
  const snapshot = await db.transaction(async (tx) => {
    const existing = (await tx.select("SELECT * FROM expenses WHERE id=?", [expenseId]))[0];
    if (!existing) throw new ApplicationDataError("EXPENSE_NOT_FOUND", "Expense does not exist.");
    const mirror = (await tx.select("SELECT * FROM expense_records WHERE id=?", [expenseId]))[0];
    const captured: DeletedExpenseSnapshot = {
      id: text(existing, "id"),
      profileId: text(existing, "profile_id"),
      kind: text(existing, "kind"),
      amount: text(existing, "amount"),
      currency: text(existing, "currency"),
      occurredOn: text(existing, "occurred_on"),
      categoryId: text(existing, "category_id"),
      description: text(existing, "description"),
      accountId: nullableText(existing, "account_id"),
      creditCardId: nullableText(existing, "credit_card_id"),
      createdAt: text(existing, "created_at"),
      mirror: mirror
        ? {
            amount: text(mirror, "amount"),
            occurredAt: text(mirror, "occurred_at"),
            businessDate: text(mirror, "business_date"),
            note: nullableText(mirror, "note"),
            createdAt: text(mirror, "created_at"),
          }
        : null,
    };
    await tx.execute("DELETE FROM expenses WHERE id=?", [expenseId]);
    await tx.execute("DELETE FROM expense_records WHERE id=?", [expenseId]);
    await appendMetadataEntry(tx, AUDIT_KEY, {
      at: now,
      action: "DELETE_EXPENSE",
      expenseId,
      amount: captured.amount,
      businessDate: captured.occurredOn,
      categoryId: captured.categoryId,
      description: captured.description,
      snapshot: captured,
    });
    return captured;
  });
  return {
    home: await getHomeApplicationState(db, asOfDate),
    reconciliation: await readLedgerReconciliation(db, expenseId),
    snapshot,
  };
}

export async function restoreLedgerExpense(
  db: SqlDatabase,
  snapshot: DeletedExpenseSnapshot,
  asOfDate: string,
): Promise<LedgerMutationResult> {
  validDate(asOfDate, "asOfDate");
  const now = new Date().toISOString();
  const reconciliation = await db.transaction(async (tx) => {
    const existing = (await tx.select("SELECT id FROM expenses WHERE id=?", [snapshot.id]))[0];
    if (existing) {
      throw new ApplicationDataError("EXPENSE_ALREADY_EXISTS", "Expense already exists.");
    }
    await tx.execute(
      `INSERT INTO expenses(id,profile_id,kind,amount,currency,occurred_on,category_id,description,account_id,credit_card_id,created_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
      [
        snapshot.id,
        snapshot.profileId,
        snapshot.kind,
        snapshot.amount,
        snapshot.currency,
        snapshot.occurredOn,
        snapshot.categoryId,
        snapshot.description,
        snapshot.accountId,
        snapshot.creditCardId,
        snapshot.createdAt,
      ],
    );
    if (snapshot.mirror) {
      await tx.execute(
        `INSERT INTO expense_records(id,profile_id,amount,occurred_at,kind,category,note,created_at,business_date)
         VALUES(?,?,?,?,?,?,?,?,?)`,
        [
          snapshot.id,
          snapshot.profileId,
          snapshot.mirror.amount,
          snapshot.mirror.occurredAt,
          "VARIABLE",
          "OTHER_VARIABLE",
          snapshot.mirror.note,
          snapshot.mirror.createdAt,
          snapshot.mirror.businessDate,
        ],
      );
    }
    await appendMetadataEntry(tx, AUDIT_KEY, {
      at: now,
      action: "RESTORE_EXPENSE",
      expenseId: snapshot.id,
      amount: snapshot.amount,
      businessDate: snapshot.occurredOn,
    });
    return assertBalanced(tx, snapshot.id);
  });
  return { home: await getHomeApplicationState(db, asOfDate), reconciliation };
}

export async function listEssentialPaymentItems(
  db: SqlDatabase,
  asOfDate: string,
): Promise<Array<{ id: string; name: string; category: ExpenseCategory; monthlyAmount: string }>> {
  validDate(asOfDate, "asOfDate");
  return new Repositories(db).listEssentialExpensesAt(asOfDate);
}

export async function recordEssentialPayment(
  db: SqlDatabase,
  input: { itemId: string; amount: string; paidOn: string; note?: string },
): Promise<{ home: HomeApplicationState; payment: EssentialPaymentRecord; monthTotal: string }> {
  const amount = positiveAmount(input.amount, "INVALID_PAYMENT_AMOUNT");
  validDate(input.paidOn, "paidOn");
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  if (!profile) throw new ApplicationDataError("INITIALIZATION_REQUIRED", "Profile is required.");
  const items = await repositories.listEssentialExpensesAt(input.paidOn);
  const item = items.find((row) => row.id === input.itemId);
  if (!item) throw new ApplicationDataError("ESSENTIAL_ITEM_NOT_FOUND", "Item does not exist.");
  if (!ESSENTIAL_CATEGORIES.has(item.category)) {
    throw new ApplicationDataError("INVALID_ESSENTIAL_CATEGORY", "Category is not essential.");
  }
  const now = new Date().toISOString();
  const payment: EssentialPaymentRecord = {
    id: globalThis.crypto.randomUUID(),
    itemId: item.id,
    itemName: item.name,
    category: item.category,
    amount: money(amount).toString(),
    paidOn: input.paidOn,
    note: input.note?.trim() ? input.note.trim() : null,
    recordedAt: now,
  };
  await db.transaction(async (tx) => {
    // Essential payments live only in the fixed-expense ledger (`expense_records`
    // kind='ESSENTIAL'). They never enter the variable ledger, so the monthly
    // model (which sums VARIABLE rows only) cannot double count them.
    await tx.execute(
      `INSERT INTO expense_records(id,profile_id,amount,occurred_at,kind,category,note,created_at,business_date)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      [
        payment.id,
        profile.id,
        payment.amount,
        `${input.paidOn}T00:00:00.000Z`,
        "ESSENTIAL",
        item.category,
        payment.note,
        now,
        input.paidOn,
      ],
    );
    await appendMetadataEntry(tx, ESSENTIAL_PAYMENT_KEY, { ...payment });
  });
  const monthRows = await db.select<{ total: number | null }>(
    "SELECT SUM(CAST(amount AS REAL)) AS total FROM expense_records WHERE kind='ESSENTIAL' AND business_date LIKE ?",
    [`${input.paidOn.slice(0, 7)}%`],
  );
  const monthTotal = String(monthRows[0]?.total ?? 0);
  return {
    home: await getHomeApplicationState(db, input.paidOn),
    payment,
    monthTotal,
  };
}

export async function listEssentialPayments(
  db: SqlDatabase,
  month?: string,
): Promise<EssentialPaymentRecord[]> {
  const rows = await db.select(
    `SELECT id,amount,occurred_at,category,note,created_at FROM expense_records
     WHERE kind='ESSENTIAL'${month ? " AND business_date LIKE ?" : ""} ORDER BY business_date DESC,created_at DESC`,
    month === undefined ? [] : [`${month}%`],
  );
  if (rows.length === 0) return [];
  const items = await new Repositories(db).listEssentialExpenses();
  const logged = new Map(
    (await readMetadataEntries(db, ESSENTIAL_PAYMENT_KEY)).map((entry) => [
      String(entry.id),
      entry,
    ]),
  );
  return rows.map((row) => {
    const category = text(row, "category") as ExpenseCategory;
    const record = logged.get(text(row, "id"));
    const loggedName = record && typeof record.itemName === "string" ? record.itemName : "";
    return {
      id: text(row, "id"),
      itemId: record && typeof record.itemId === "string" ? record.itemId : "",
      itemName: loggedName || items.find((item) => item.category === category)?.name || "固定支出",
      category,
      amount: text(row, "amount"),
      paidOn: text(row, "occurred_at").slice(0, 10),
      note: nullableText(row, "note"),
      recordedAt: text(row, "created_at"),
    };
  });
}

export async function listDebtPaymentLog(db: SqlDatabase): Promise<DebtPaymentRecord[]> {
  const raw = await new Repositories(db).getMeta(DEBT_PAYMENT_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DebtPaymentRecord[]) : [];
  } catch {
    return [];
  }
}

export async function recordDebtRepayment(
  db: SqlDatabase,
  input: { debtId: string; amount: string; paidOn: string; note?: string; asOfDate: string },
): Promise<{
  home: HomeApplicationState;
  payment: DebtPaymentRecord;
  reconciliation: { revisionBalance: string | null; factBalance: string | null; balanced: boolean };
}> {
  const amount = positiveAmount(input.amount, "INVALID_REPAYMENT_AMOUNT");
  validDate(input.paidOn, "paidOn");
  validDate(input.asOfDate, "asOfDate");
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  if (!profile) throw new ApplicationDataError("INITIALIZATION_REQUIRED", "Profile is required.");
  const periodMonth = input.paidOn.slice(0, 7);
  const debt = (await repositories.debtsAt(periodMonth, input.paidOn, false, profile.id)).find(
    (row) => row.id === input.debtId,
  );
  if (!debt) throw new ApplicationDataError("DEBT_NOT_FOUND", "Debt does not exist.");
  const balanceBefore = money(debt.currentBalance);
  if (money(amount).gt(balanceBefore)) {
    throw new ApplicationDataError(
      "REPAYMENT_EXCEEDS_BALANCE",
      "Repayment cannot exceed the current balance.",
    );
  }
  const balanceAfter = balanceBefore.minus(money(amount)).toDecimalPlaces(2).toString();
  const currentMonthDue = debt.currentMonthDue == null ? null : String(debt.currentMonthDue);
  const fixedMonthlyPayment =
    debt.fixedMonthlyPayment == null ? null : String(debt.fixedMonthlyPayment);
  const now = new Date().toISOString();
  const payment: DebtPaymentRecord = {
    id: globalThis.crypto.randomUUID(),
    debtId: debt.id,
    debtName: debt.name,
    amount: money(amount).toString(),
    paidOn: input.paidOn,
    note: input.note?.trim() ? input.note.trim() : null,
    balanceBefore: balanceBefore.toDecimalPlaces(2).toString(),
    balanceAfter,
    recordedAt: now,
  };
  const reconciliation = await db.transaction(async (tx) => {
    const txRepositories = new Repositories(tx);
    // V2 side: append-only debt revision carrying the reduced balance.
    await txRepositories.appendDebtRevision(
      profile.id,
      {
        id: debt.id,
        name: debt.name,
        currentBalance: balanceAfter,
        currentMonthDue,
        fixedMonthlyPayment,
      },
      periodMonth,
      input.paidOn,
      now,
      () => globalThis.crypto.randomUUID(),
    );
    // V1 side: the month fact for the same debt moves with it.
    await txRepositories.saveDebtPeriodFact(
      {
        id: `${debt.id}:${periodMonth}`,
        debtId: debt.id,
        periodMonth,
        asOfDate: input.paidOn,
        currentBalance: balanceAfter,
        currentMonthDue,
      },
      now,
    );
    await appendMetadataEntry(tx, DEBT_PAYMENT_KEY, { ...payment });
    const revision = (
      await tx.select(
        "SELECT current_balance FROM debt_revisions WHERE debt_id=? AND period_month=? ORDER BY as_of_date DESC,revision_id DESC LIMIT 1",
        [debt.id, periodMonth],
      )
    )[0];
    const fact = (
      await tx.select(
        "SELECT current_balance FROM debt_period_facts WHERE debt_id=? AND period_month=?",
        [debt.id, periodMonth],
      )
    )[0];
    const revisionBalance = revision ? text(revision, "current_balance") : null;
    const factBalance = fact ? text(fact, "current_balance") : null;
    const balanced =
      revisionBalance !== null &&
      factBalance !== null &&
      money(revisionBalance).eq(money(factBalance));
    if (!balanced) {
      throw new ApplicationDataError(
        "LEDGER_RECONCILIATION_FAILED",
        "V2/V1 debt ledgers disagree after repayment.",
      );
    }
    return { revisionBalance, factBalance, balanced };
  });
  return {
    home: await getHomeApplicationState(db, input.asOfDate),
    payment,
    reconciliation,
  };
}

export async function recategorizeLedgerExpenses(
  db: SqlDatabase,
  assignments: RecategorizationAssignment[],
  asOfDate: string,
): Promise<RecategorizationResult> {
  validDate(asOfDate, "asOfDate");
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  if (!profile) throw new ApplicationDataError("INITIALIZATION_REQUIRED", "Profile is required.");
  const categories = await repositories.listExpenseCategories(profile.id);
  const known = new Set(categories.map((category) => category.id));
  const beforeRows = await db.select<{ total: number; count: number }>(
    "SELECT COALESCE(SUM(CAST(amount AS REAL)),0) AS total, COUNT(*) AS count FROM expenses",
  );
  let updated = 0;
  let skipped = 0;
  await db.transaction(async (tx) => {
    for (const assignment of assignments) {
      if (!known.has(assignment.categoryId)) {
        skipped += 1;
        continue;
      }
      const result = await tx.execute(
        "UPDATE expenses SET category_id=? WHERE id=? AND category_id<>?",
        [assignment.categoryId, assignment.expenseId, assignment.categoryId],
      );
      if (result.rowsAffected > 0) updated += 1;
      else skipped += 1;
    }
    await appendMetadataEntry(tx, AUDIT_KEY, {
      at: new Date().toISOString(),
      action: "RECATEGORIZE",
      assignments: assignments.length,
      updated,
    });
  });
  // D-01 keeps the V1 mirror category pinned to OTHER_VARIABLE, so the mirror
  // ledger is untouched by design. Only the display layer changes.
  const afterRows = await db.select<{ total: number; count: number }>(
    "SELECT COALESCE(SUM(CAST(amount AS REAL)),0) AS total, COUNT(*) AS count FROM expenses",
  );
  const totalBefore = String(beforeRows[0]?.total ?? 0);
  const totalAfter = String(afterRows[0]?.total ?? 0);
  const countBefore = Number(beforeRows[0]?.count ?? 0);
  const countAfter = Number(afterRows[0]?.count ?? 0);
  if (
    countBefore !== countAfter ||
    money(totalBefore).toNumber() !== money(totalAfter).toNumber()
  ) {
    throw new ApplicationDataError(
      "RECATEGORIZE_ANCHOR_BROKEN",
      "Re-categorization changed the ledger total or row count.",
    );
  }
  return {
    updated,
    skipped,
    totalBefore,
    totalAfter,
    countBefore,
    countAfter,
    home: await getHomeApplicationState(db, asOfDate),
  };
}

const EXPORT_TABLES = [
  "profiles",
  "financial_settings",
  "settings_revisions",
  "income_records",
  "actual_income_revisions",
  "planning_income_revisions",
  "planning_income_month_revisions",
  "essential_expense_items",
  "essential_expense_revisions",
  "essential_expense_snapshots",
  "cash_accounts",
  "cash_account_revisions",
  "cash_account_lifecycle_revisions",
  "cash_balance_snapshots",
  "assets",
  "asset_revisions",
  "asset_value_snapshots",
  "debts",
  "debt_revisions",
  "debt_period_facts",
  "expense_categories",
  "expense_records",
  "expenses",
  "accounts",
  "income_entries",
  "fixed_expense_plans",
  "import_batches",
  "app_metadata",
] as const;

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const textValue = String(value);
  return /[",\n]/.test(textValue) ? `"${textValue.replace(/"/g, '""')}"` : textValue;
}

export async function buildExportBundle(db: SqlDatabase, asOfDate: string): Promise<ExportBundle> {
  const tables: Record<string, Record<string, unknown>[]> = {};
  const tableCounts: Record<string, number> = {};
  for (const table of EXPORT_TABLES) {
    const rows = await db.select(`SELECT * FROM ${table}`);
    tables[table] = rows;
    tableCounts[table] = rows.length;
  }
  const expenseRows = tables.expenses ?? [];
  const categoryNames = new Map(
    (tables.expense_categories ?? []).map((row) => [String(row.id), String(row.name)]),
  );
  const accountNames = new Map(
    (tables.accounts ?? []).map((row) => [String(row.id), String(row.name)]),
  );
  const csvHeader = ["id", "日期", "金额", "分类", "说明", "账户", "类型"];
  const csvLines = [csvHeader.join(",")];
  for (const row of expenseRows) {
    csvLines.push(
      [
        csvCell(row.id),
        csvCell(row.occurred_on),
        csvCell(row.amount),
        csvCell(categoryNames.get(String(row.category_id)) ?? ""),
        csvCell(row.description),
        csvCell(accountNames.get(String(row.account_id)) ?? ""),
        csvCell(row.kind),
      ].join(","),
    );
  }
  const payload = {
    format: "xiaohqianjia-backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    asOfDate,
    tableCounts,
    tables,
  };
  return {
    json: JSON.stringify(payload, null, 2),
    csv: `${csvLines.join("\n")}\n`,
    tableCounts,
  };
}

export async function getRecordingStreak(
  db: SqlDatabase,
  asOfDate: string,
): Promise<RecordingStreak> {
  validDate(asOfDate, "asOfDate");
  const rows = await db.select<{ business_date: string }>(
    `SELECT DISTINCT business_date FROM expense_records
     WHERE kind='VARIABLE' AND business_date IS NOT NULL AND business_date<=?
     ORDER BY business_date DESC LIMIT 120`,
    [asOfDate],
  );
  const dates = new Set(rows.map((row) => text(row, "business_date")));
  const recordedToday = dates.has(asOfDate);
  let cursor = new Date(`${asOfDate}T00:00:00.000Z`);
  if (!recordedToday) cursor = new Date(cursor.getTime() - 86_400_000);
  let consecutiveDays = 0;
  while (dates.has(cursor.toISOString().slice(0, 10))) {
    consecutiveDays += 1;
    cursor = new Date(cursor.getTime() - 86_400_000);
  }
  return {
    consecutiveDays,
    recordedToday,
    lastRecordedDate: rows[0] ? text(rows[0], "business_date") : null,
  };
}

export interface EssentialItemPatch {
  id?: string;
  name: string;
  category: ExpenseCategory;
  monthlyAmount: string;
  active?: boolean;
}

export async function saveEssentialItems(
  db: SqlDatabase,
  items: EssentialItemPatch[],
  asOfDate: string,
): Promise<{ home: HomeApplicationState }> {
  validDate(asOfDate, "asOfDate");
  const repositories = new Repositories(db);
  const profile = await repositories.getProfile();
  if (!profile) throw new ApplicationDataError("INITIALIZATION_REQUIRED", "Profile is required.");
  const now = new Date().toISOString();
  await db.transaction(async (tx) => {
    const txRepositories = new Repositories(tx);
    for (const item of items) {
      if (!ESSENTIAL_CATEGORIES.has(item.category)) {
        throw new ApplicationDataError(
          "INVALID_ESSENTIAL_CATEGORY",
          "Only essential categories can be maintained here.",
        );
      }
      if (item.active === false) {
        if (!item.id) continue;
        await tx.execute("UPDATE essential_expense_items SET active=0,updated_at=? WHERE id=?", [
          now,
          item.id,
        ]);
        await tx.execute(
          "INSERT INTO essential_expense_revisions(item_id,as_of_date,name,category,monthly_amount,active,created_at) VALUES(?,?,?,?,?,0,?)",
          [
            item.id,
            asOfDate,
            item.name,
            item.category,
            money(assertUserInputMoney(item.monthlyAmount, "monthlyAmount")).toString(),
            now,
          ],
        );
        continue;
      }
      await txRepositories.appendEssentialRevision(
        profile.id,
        {
          ...(item.id ? { id: item.id } : {}),
          name: item.name,
          category: item.category,
          monthlyAmount: assertUserInputMoney(item.monthlyAmount, "monthlyAmount"),
        },
        asOfDate,
        now,
        () => globalThis.crypto.randomUUID(),
      );
    }
  });
  return { home: await getHomeApplicationState(db, asOfDate) };
}
