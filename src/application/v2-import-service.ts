import { Decimal } from "decimal.js";
import type { ImportedExpenseCandidate, ImportProvider } from "../model/v2-import.js";
import { ApplicationDataError } from "../persistence/database.js";
import type { Repositories } from "../persistence/repositories.js";

export interface ImportBatchResult {
  batchId: string;
  provider: ImportProvider;
  sourceFileSha256: string;
  totalRows: number;
  validRows: number;
  writtenRows: number;
  skippedRows: number;
  errorRows: number;
  auditEvents: string[];
}

export interface ConfirmedImportInput {
  importBatchId: string;
  profileId: string;
  provider: ImportProvider;
  sourceFileContent: string;
  candidates: ImportedExpenseCandidate[];
}

interface ValidatedImportRow {
  candidate: ImportedExpenseCandidate;
  expense: {
    id: string;
    profileId: string;
    kind: "CASH_DEBIT";
    amount: string;
    currency: string;
    occurredOn: string;
    categoryId: string;
    description: string;
    accountId: string;
  };
  dedupeKey: string;
}

function assertRequiredText(value: string, code: string, message: string): string {
  if (!value.trim()) throw new ApplicationDataError(code, message);
  return value;
}

function moneyText(value: string, code: string, message: string): string {
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite() || parsed.isNegative()) throw new Error("invalid money");
    const normalized = parsed.toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
    const supported =
      /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(value) &&
      new Decimal(normalized).abs().lte(new Decimal("999999999999.99"));
    if (!supported) throw new Error("unsupported money contract");
    return normalized;
  } catch (error) {
    throw new ApplicationDataError(code, message, { cause: error });
  }
}

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(value)) return false;
  const [yearText = "0", monthText = "0", dayText = "0"] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() + 1 === month && date.getUTCDate() === day
  );
}

function errorSummary(candidate: ImportedExpenseCandidate): string {
  return candidate.validationErrors.length > 0
    ? candidate.validationErrors.join("; ")
    : "validation failed";
}

function sumMoney(values: string[]): string {
  return values
    .reduce((total, value) => total.plus(new Decimal(value)), new Decimal(0))
    .toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
    .toFixed(2);
}

export class V2ImportService {
  constructor(private readonly repositories: Repositories) {}

  async writeConfirmedImport(input: ConfirmedImportInput): Promise<ImportBatchResult> {
    assertRequiredText(input.importBatchId, "INVALID_IMPORT_BATCH", "Import batch id is required.");
    assertRequiredText(input.profileId, "INVALID_PROFILE", "Profile id is required.");
    assertRequiredText(input.provider, "INVALID_IMPORT_PROVIDER", "Import provider is required.");

    const auditEvents: string[] = [];
    const totalRows = input.candidates.length;
    let validRows = 0;
    let skippedRows = 0;
    let errorRows = 0;

    const existingDedupeKeys = new Set(
      await this.repositories.listImportedDedupeKeys(input.profileId),
    );
    const categories = await this.repositories.listExpenseCategories(input.profileId);
    const categoryIds = new Set(
      categories.filter((category) => category.active).map((category) => category.id),
    );
    const accounts = await this.repositories.listAccounts(input.profileId);
    const accountIds = new Set(
      accounts.filter((account) => account.active).map((account) => account.id),
    );

    const rows: ValidatedImportRow[] = [];
    const writtenCandidateIds: string[] = [];
    for (const candidate of input.candidates) {
      if (candidate.reviewStatus === "SKIPPED") {
        skippedRows += 1;
        auditEvents.push(`skipped ${candidate.sourceRowKey}: marked SKIPPED`);
        continue;
      }
      if (candidate.reviewStatus === "ERROR") {
        errorRows += 1;
        auditEvents.push(`error ${candidate.sourceRowKey}: ${errorSummary(candidate)}`);
        continue;
      }
      if (candidate.reviewStatus !== "CONFIRMED") {
        skippedRows += 1;
        auditEvents.push(`skipped ${candidate.sourceRowKey}: not confirmed`);
        continue;
      }
      if (existingDedupeKeys.has(candidate.dedupeKey)) {
        skippedRows += 1;
        auditEvents.push(`skipped ${candidate.sourceRowKey}: duplicate`);
        continue;
      }
      if (candidate.direction !== "EXPENSE") {
        skippedRows += 1;
        auditEvents.push(`skipped ${candidate.sourceRowKey}: direction is ${candidate.direction}`);
        continue;
      }
      if (!candidate.category || !categoryIds.has(candidate.category)) {
        errorRows += 1;
        auditEvents.push(`error ${candidate.sourceRowKey}: category missing or invalid`);
        continue;
      }
      if (!candidate.accountId || !accountIds.has(candidate.accountId)) {
        errorRows += 1;
        auditEvents.push(`error ${candidate.sourceRowKey}: account missing or invalid`);
        continue;
      }
      if (!validCalendarDate(candidate.businessDate)) {
        errorRows += 1;
        auditEvents.push(`error ${candidate.sourceRowKey}: invalid businessDate`);
        continue;
      }
      let amount: string;
      try {
        amount = moneyText(
          candidate.amount,
          "INVALID_IMPORT_AMOUNT",
          `Candidate ${candidate.sourceRowKey} has an invalid amount.`,
        );
      } catch {
        errorRows += 1;
        auditEvents.push(`error ${candidate.sourceRowKey}: invalid amount`);
        continue;
      }
      const expense = {
        id: globalThis.crypto.randomUUID(),
        profileId: input.profileId,
        kind: "CASH_DEBIT" as const,
        amount,
        currency: "CNY",
        occurredOn: candidate.businessDate,
        categoryId: candidate.category,
        description: candidate.merchant ?? candidate.note ?? "",
        accountId: candidate.accountId,
      };
      existingDedupeKeys.add(candidate.dedupeKey);
      rows.push({ candidate, expense, dedupeKey: candidate.dedupeKey });
      writtenCandidateIds.push(candidate.sourceRowKey);
      validRows += 1;
      auditEvents.push(
        `validated ${candidate.sourceRowKey}: amount=${amount} date=${candidate.businessDate}`,
      );
    }

    const batch = {
      id: input.importBatchId,
      profileId: input.profileId,
      provider: input.provider,
      sourceFileSha256: await sha256Hex(input.sourceFileContent),
      totalRows,
      validRows,
      writtenRows: rows.length,
      skippedRows,
      errorRows,
      createdAt: new Date().toISOString(),
    };
    await this.repositories.writeImportBatchAtomically(
      batch,
      rows.map(({ expense, dedupeKey }) => ({ expense, dedupeKey })),
    );

    for (const [index, row] of rows.entries()) {
      const stored = await this.repositories.getV2ExpenseById(row.expense.id);
      if (!stored) {
        throw new ApplicationDataError(
          "IMPORT_READBACK_FAILED",
          `Imported expense ${row.expense.id} was not found after commit.`,
        );
      }
      const expectedAmount = sumMoney([row.expense.amount]);
      const storedAmount = sumMoney([stored.amount]);
      if (
        storedAmount !== expectedAmount ||
        stored.occurredOn !== row.expense.occurredOn ||
        stored.categoryId !== row.expense.categoryId ||
        stored.kind !== "CASH_DEBIT" ||
        stored.accountId !== row.expense.accountId
      ) {
        throw new ApplicationDataError(
          "IMPORT_READBACK_FAILED",
          `Imported expense ${row.expense.id} did not match after commit.`,
        );
      }
      auditEvents.push(
        `readback verified ${writtenCandidateIds[index]}: amount=${storedAmount} date=${stored.occurredOn}`,
      );
    }

    const storedBatch = await this.repositories.getImportBatchById(input.importBatchId);
    if (
      !storedBatch ||
      storedBatch.sourceFileSha256 !== batch.sourceFileSha256 ||
      storedBatch.totalRows !== totalRows ||
      storedBatch.validRows !== validRows ||
      storedBatch.writtenRows !== rows.length ||
      storedBatch.skippedRows !== skippedRows ||
      storedBatch.errorRows !== errorRows
    ) {
      throw new ApplicationDataError(
        "IMPORT_READBACK_FAILED",
        "Import batch counters did not match after commit.",
      );
    }

    auditEvents.push(`readback verified: ${rows.length} rows`);
    auditEvents.push(
      `batch committed: written=${rows.length} skipped=${skippedRows} error=${errorRows}`,
    );

    return {
      batchId: input.importBatchId,
      provider: input.provider,
      sourceFileSha256: batch.sourceFileSha256,
      totalRows,
      validRows,
      writtenRows: rows.length,
      skippedRows,
      errorRows,
      auditEvents,
    };
  }
}

async function sha256Hex(content: string): Promise<string> {
  const data = new TextEncoder().encode(content);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
