import { Decimal } from "decimal.js";

export type ImportProvider = "ALIPAY_CSV" | "WECHAT_CSV" | "FUTURE_PROVIDER";
export type ImportReviewStatus = "PENDING" | "EDITED" | "CONFIRMED" | "SKIPPED" | "ERROR";

export interface ImportedExpenseCandidate {
  importBatchId: string;
  provider: ImportProvider;
  sourceRowKey: string;
  occurredAt: string;
  businessDate: string;
  amount: string;
  direction: "EXPENSE" | "INCOME" | "UNKNOWN";
  merchant: string | null;
  category: string | null;
  accountId: string | null;
  note: string | null;
  dedupeKey: string;
  reviewStatus: ImportReviewStatus;
  validationErrors: string[];
}

const ALIPAY_COLUMNS = ["交易号", "交易时间", "交易对方", "金额", "收支", "备注"] as const;
const WECHAT_COLUMNS = ["交易单号", "交易时间", "交易对方", "金额(元)", "收/支", "备注"] as const;
const AMOUNT_MONEY_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;
const ISO_DATE_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T\d{2}:\d{2}:\d{2}(?:Z|[+-]\d{2}:\d{2})$/;

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === "," && !quoted) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values;
}

function amountKey(provider: ImportProvider): string {
  return provider === "WECHAT_CSV" ? "金额(元)" : "金额";
}

function directionKey(provider: ImportProvider): string {
  return provider === "WECHAT_CSV" ? "收/支" : "收支";
}

function sourceKeyColumn(provider: ImportProvider): string {
  return provider === "WECHAT_CSV" ? "交易单号" : "交易号";
}

function normalizeAmount(raw: string): string | null {
  const value = raw.trim().replace(/^¥/, "").trim();
  if (!AMOUNT_MONEY_PATTERN.test(value)) return null;
  try {
    const parsed = new Decimal(value);
    if (!parsed.isFinite() || parsed.isNegative()) return null;
  } catch {
    return null;
  }
  return value;
}

function normalizeDirection(raw: string): "EXPENSE" | "INCOME" | "UNKNOWN" {
  const value = raw.trim();
  if (value === "支出") return "EXPENSE";
  if (value === "收入") return "INCOME";
  return "UNKNOWN";
}

function businessDateFrom(raw: string): string | null {
  if (!ISO_DATE_PATTERN.test(raw)) return null;
  return raw.slice(0, 10);
}

export function parseImportFile(
  content: string,
  provider: ImportProvider,
  importBatchId: string,
): ImportedExpenseCandidate[] {
  const expectedColumns = provider === "WECHAT_CSV" ? WECHAT_COLUMNS : ALIPAY_COLUMNS;
  const lines = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];

  const header = parseCsvLine(lines[0] ?? "").map((value) => value.trim());
  const missingColumns = expectedColumns.filter((column) => !header.includes(column));
  if (missingColumns.length > 0) {
    return [
      {
        importBatchId,
        provider,
        sourceRowKey: "header",
        occurredAt: "",
        businessDate: "",
        amount: "0.00",
        direction: "UNKNOWN",
        merchant: null,
        category: null,
        accountId: null,
        note: `missing columns: ${missingColumns.join(", ")}`,
        dedupeKey: `${provider}:header:0.00:`,
        reviewStatus: "ERROR",
        validationErrors: [
          `Unknown or missing CSV header for provider ${provider}: missing ${missingColumns.join(", ")}.`,
        ],
      },
    ];
  }

  const results: ImportedExpenseCandidate[] = [];
  for (let index = 1; index < lines.length; index += 1) {
    const rawLine = lines[index] ?? "";
    const row = parseCsvLine(rawLine);
    const values = new Map(header.map((column, columnIndex) => [column, (row[columnIndex] ?? "").trim()]));
    const validationErrors: string[] = [];
    const unknownColumns = header.filter((column) => !expectedColumns.includes(column as never));
    if (unknownColumns.length > 0)
      validationErrors.push(`Unknown columns: ${unknownColumns.join(", ")}.`);
    if (row.length !== header.length)
      validationErrors.push(`Row has ${row.length} fields; expected ${header.length}.`);

    const sourceRowKey = values.get(sourceKeyColumn(provider)) ?? "";
    if (!sourceRowKey) validationErrors.push("Missing source row key.");
    const occurredAt = values.get("交易时间") ?? "";
    const businessDate = businessDateFrom(occurredAt);
    if (!businessDate) validationErrors.push("Invalid transaction time; expected ISO 8601 date.");
    const amount = normalizeAmount(values.get(amountKey(provider)) ?? "");
    if (!amount) validationErrors.push("Invalid amount; expected a non-negative decimal with at most 2 places.");
    const direction = normalizeDirection(values.get(directionKey(provider)) ?? "");
    if (direction === "UNKNOWN") validationErrors.push("Unknown direction.");
    if (values.get("备注") === undefined) validationErrors.push("Missing note column.");

    const finalAmount = amount ?? "0.00";
    const finalDate = businessDate ?? "";
    results.push({
      importBatchId,
      provider,
      sourceRowKey,
      occurredAt,
      businessDate: finalDate,
      amount: finalAmount,
      direction,
      merchant: values.get("交易对方") || null,
      category: null,
      accountId: null,
      note: values.get("备注") || null,
      dedupeKey: `${provider}:${sourceRowKey}:${finalAmount}:${finalDate}`,
      reviewStatus: validationErrors.length > 0 ? "ERROR" : "PENDING",
      validationErrors,
    });
  }
  return results;
}

export function dedupeImportCandidates(
  candidates: ImportedExpenseCandidate[],
  existingDedupeKeys: Set<string>,
): { toImport: ImportedExpenseCandidate[]; skipped: ImportedExpenseCandidate[] } {
  const toImport: ImportedExpenseCandidate[] = [];
  const skipped: ImportedExpenseCandidate[] = [];
  for (const candidate of candidates) {
    if (existingDedupeKeys.has(candidate.dedupeKey)) {
      skipped.push({ ...candidate, reviewStatus: "SKIPPED" });
    } else {
      toImport.push(candidate);
    }
  }
  return { toImport, skipped };
}

export function applyCandidateEdits(
  candidate: ImportedExpenseCandidate,
  edits: Partial<Pick<ImportedExpenseCandidate, "category" | "accountId" | "note" | "businessDate">>,
): ImportedExpenseCandidate {
  return {
    ...candidate,
    ...edits,
    dedupeKey: `${candidate.provider}:${candidate.sourceRowKey}:${candidate.amount}:${
      edits.businessDate ?? candidate.businessDate
    }`,
    reviewStatus: "EDITED",
  };
}

export function confirmImportBatch(candidates: ImportedExpenseCandidate[]): {
  confirmed: ImportedExpenseCandidate[];
  skipped: ImportedExpenseCandidate[];
} {
  const confirmed: ImportedExpenseCandidate[] = [];
  const skipped: ImportedExpenseCandidate[] = [];
  for (const candidate of candidates) {
    if (candidate.reviewStatus === "PENDING" || candidate.reviewStatus === "EDITED") {
      confirmed.push({ ...candidate, reviewStatus: "CONFIRMED" });
    } else {
      skipped.push(candidate);
    }
  }
  return { confirmed, skipped };
}
