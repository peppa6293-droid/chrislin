import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { V2ImportService } from "../../src/application/v2-import-service.js";
import {
  applyCandidateEdits,
  confirmImportBatch,
  type ImportedExpenseCandidate,
  parseImportFile,
} from "../../src/model/v2-import.js";
import { ApplicationDataError } from "../../src/persistence/database.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

let db: NodeSqliteDatabase;
let repositories: Repositories;
let service: V2ImportService;
const alipayContent = readFileSync("tests/fixtures/v2-import/sample-alipay-export.csv", "utf8");
const expectedHash = createHash("sha256").update(alipayContent).digest("hex");

beforeEach(async () => {
  db = new NodeSqliteDatabase();
  repositories = new Repositories(db);
  service = new V2ImportService(repositories);
  await migrateDatabase(db, "2026-10-19T00:00:00.000Z");
  await repositories.createProfile({ id: "profile-v2", displayName: "V2 import" });
  await repositories.createAccount({
    id: "cash-1",
    profileId: "profile-v2",
    name: "现金",
    type: "CASH",
    currency: "CNY",
  });
  await repositories.createExpenseCategory({
    id: "cat-food",
    profileId: "profile-v2",
    name: "餐饮",
    icon: "Utensils",
    color: "#E07A5F",
    monthlyBudget: null,
    overspendingAlert: false,
    savingsRelated: false,
    adjustable: true,
    builtin: true,
  });
});

afterEach(() => db.close());

function confirmedAlipayCandidates(batchId: string): ImportedExpenseCandidate[] {
  const parsed = parseImportFile(alipayContent, "ALIPAY_CSV", batchId);
  const edited = parsed.map((candidate) =>
    applyCandidateEdits(candidate, { category: "cat-food", accountId: "cash-1" }),
  );
  return confirmImportBatch(edited).confirmed;
}

describe("EXEC-I-04 official CSV import write, readback, and feedback", () => {
  it("migrates fresh V0 to V10 and supports V6 to V10 incrementally", async () => {
    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 10 }]);
    expect(await db.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
    ]);
    const expenseColumns = await db.select<{ name: string }>("PRAGMA table_info(expenses)");
    expect(expenseColumns.map((column) => column.name)).toContain("dedupe_key");
    expect(
      await db.select(
        "SELECT name FROM sqlite_master WHERE type='index' AND name='expenses_dedupe_unique'",
      ),
    ).toEqual([{ name: "expenses_dedupe_unique" }]);

    await db.connection.exec("PRAGMA user_version = 6");
    await db.connection.exec("DROP INDEX expenses_dedupe_unique");
    await db.connection.exec("ALTER TABLE expenses DROP COLUMN dedupe_key");
    await db.connection.exec("ALTER TABLE cash_accounts DROP COLUMN reserved_amount");
    await db.connection.exec("ALTER TABLE cash_account_revisions DROP COLUMN source_payment_id");
    await db.connection.exec("ALTER TABLE debt_revisions DROP COLUMN source_payment_id");
    await db.connection.exec("ALTER TABLE debts DROP COLUMN daily_spending_mode");
    await db.connection.exec("ALTER TABLE expenses DROP COLUMN deleted_at");
    await db.connection.exec("ALTER TABLE expenses DROP COLUMN deduction_account_id");
    await db.connection.exec("ALTER TABLE expenses DROP COLUMN deduction_applied_on");
    await db.connection.exec("ALTER TABLE expense_records DROP COLUMN deleted_at");
    await db.connection.exec("DROP TABLE IF EXISTS income_entries");
    await db.connection.exec("DROP TABLE IF EXISTS fixed_expense_plans");
    await db.connection.exec("DELETE FROM schema_migrations WHERE version IN (7,8,9,10)");
    await migrateDatabase(db, "2026-10-19T01:00:00.000Z");
    expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 10 }]);
    expect(
      await db.select(
        "SELECT COUNT(*) AS count FROM schema_migrations WHERE version IN (6,7,8,9,10)",
      ),
    ).toEqual([{ count: 5 }]);
  });

  it("writes a fully successful batch and verifies every row and counter", async () => {
    const candidates = confirmedAlipayCandidates("batch-success");
    const result = await service.writeConfirmedImport({
      importBatchId: "batch-success",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates,
    });

    expect(result).toMatchObject({
      batchId: "batch-success",
      provider: "ALIPAY_CSV",
      sourceFileSha256: expectedHash,
      totalRows: 2,
      validRows: 2,
      writtenRows: 2,
      skippedRows: 0,
      errorRows: 0,
    });
    const expenses = await repositories.listV2Expenses("profile-v2", "2026-10");
    expect(
      expenses.map((expense) => [expense.amount, expense.occurredOn, expense.categoryId]),
    ).toEqual([
      ["35.00", "2026-10-01", "cat-food"],
      ["12.50", "2026-10-02", "cat-food"],
    ]);
    expect(expenses.every((expense) => expense.kind === "CASH_DEBIT")).toBe(true);
    expect((expenses[0] as { accountId: string }).accountId).toBe("cash-1");
    const storedBatch = await repositories.getImportBatchById("batch-success");
    expect(storedBatch).toMatchObject({
      sourceFileSha256: expectedHash,
      totalRows: 2,
      validRows: 2,
      writtenRows: 2,
      skippedRows: 0,
      errorRows: 0,
    });
    expect(await repositories.listImportedDedupeKeys("profile-v2")).toHaveLength(2);
    expect(result.auditEvents).toContain("batch committed: written=2 skipped=0 error=0");
  });

  it("mirrors every written cash expense into the V1 ledger with identical id and amount", async () => {
    const candidates = confirmedAlipayCandidates("batch-mirror");
    const result = await service.writeConfirmedImport({
      importBatchId: "batch-mirror",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates,
    });
    expect(result.writtenRows).toBe(2);

    const mirrorRows = await db.select<{
      id: string;
      amount: string;
      kind: string;
      category: string;
      business_date: string;
    }>(
      "SELECT id,amount,kind,category,business_date FROM expense_records WHERE profile_id=? ORDER BY business_date,id",
      ["profile-v2"],
    );
    expect(mirrorRows).toHaveLength(result.writtenRows);
    const expenses = await repositories.listV2Expenses("profile-v2", "2026-10");
    expect(mirrorRows).toEqual(
      expenses.map((expense) => ({
        id: expense.id,
        amount: expense.amount,
        kind: "VARIABLE",
        category: "OTHER_VARIABLE",
        business_date: expense.occurredOn,
      })),
    );
  });

  it("does not grow the ledger mirror when a repeated import is fully deduplicated", async () => {
    const firstCandidates = confirmedAlipayCandidates("batch-mirror-first");
    const first = await service.writeConfirmedImport({
      importBatchId: "batch-mirror-first",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates: firstCandidates,
    });
    expect(first.writtenRows).toBe(2);
    const mirrorsAfterFirst = await db.select(
      "SELECT COUNT(*) AS count FROM expense_records WHERE profile_id=?",
      ["profile-v2"],
    );
    expect(mirrorsAfterFirst).toEqual([{ count: 2 }]);

    const secondCandidates = confirmedAlipayCandidates("batch-mirror-second").map((candidate) => ({
      ...candidate,
      importBatchId: "batch-mirror-second",
    }));
    const second = await service.writeConfirmedImport({
      importBatchId: "batch-mirror-second",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates: secondCandidates,
    });
    expect(second.writtenRows).toBe(0);
    expect(
      await db.select("SELECT COUNT(*) AS count FROM expense_records WHERE profile_id=?", [
        "profile-v2",
      ]),
    ).toEqual(mirrorsAfterFirst);
  });

  it("rolls back the whole batch when a second expense insert fails", async () => {
    const candidates = confirmedAlipayCandidates("batch-rollback");
    class ForcedSecondInsertFailureDatabase extends NodeSqliteDatabase {
      private insertCount = 0;
      constructor(private readonly base: NodeSqliteDatabase) {
        super(base.connection);
      }
      override async execute(sql: string, bindValues: unknown[] = []) {
        if (sql.trim().startsWith("INSERT INTO expenses")) {
          this.insertCount += 1;
          if (this.insertCount === 2) throw new Error("forced second insert failure");
        }
        return this.base.execute(sql, bindValues);
      }
    }
    const wrapped = new ForcedSecondInsertFailureDatabase(db);
    const failingService = new V2ImportService(new Repositories(wrapped));
    await expect(
      failingService.writeConfirmedImport({
        importBatchId: "batch-rollback",
        profileId: "profile-v2",
        provider: "ALIPAY_CSV",
        sourceFileContent: alipayContent,
        candidates,
      }),
    ).rejects.toThrow("forced second insert failure");
    expect(await repositories.listV2Expenses("profile-v2")).toEqual([]);
    expect(await repositories.getImportBatchById("batch-rollback")).toBeNull();
  });

  it("reports partial success, filters income explicitly, and writes only valid expenses", async () => {
    const parsed = parseImportFile(alipayContent, "ALIPAY_CSV", "batch-partial");
    const edited = parsed
      .map((candidate) =>
        applyCandidateEdits(candidate, { category: "cat-food", accountId: "cash-1" }),
      )
      .map((candidate) => ({ ...candidate, reviewStatus: "CONFIRMED" as const }));
    const firstEdited = edited[0];
    const secondEdited = edited[1];
    expect(firstEdited).toBeDefined();
    expect(secondEdited).toBeDefined();
    if (!firstEdited || !secondEdited) throw new Error("expected two edited candidates");
    const income: ImportedExpenseCandidate = {
      ...firstEdited,
      importBatchId: "batch-partial",
      provider: "ALIPAY_CSV",
      sourceRowKey: "income-001",
      direction: "INCOME",
      dedupeKey: "ALIPAY_CSV:income-001:35.00:2026-10-01",
    };
    const invalidCategory: ImportedExpenseCandidate = {
      ...secondEdited,
      sourceRowKey: "bad-category",
      dedupeKey: "ALIPAY_CSV:bad-category:12.50:2026-10-02",
      category: "missing-category",
    };
    const result = await service.writeConfirmedImport({
      importBatchId: "batch-partial",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates: [...edited, income, invalidCategory],
    });

    expect(result).toMatchObject({
      totalRows: 4,
      validRows: 2,
      writtenRows: 2,
      skippedRows: 1,
      errorRows: 1,
    });
    expect(result.auditEvents).toContain("skipped income-001: direction is INCOME");
    expect(result.auditEvents).toContain("error bad-category: category missing or invalid");
    expect(await repositories.listV2Expenses("profile-v2", "2026-10")).toHaveLength(2);
    expect(
      await db.select("SELECT COUNT(*) AS count FROM expenses WHERE description='合成早餐店'"),
    ).toEqual([{ count: 1 }]);
  });

  it("deduplicates a second import completely and enforces the partial unique index", async () => {
    const firstCandidates = confirmedAlipayCandidates("batch-first");
    const first = await service.writeConfirmedImport({
      importBatchId: "batch-first",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates: firstCandidates,
    });
    expect(first.writtenRows).toBe(2);

    const secondCandidates = confirmedAlipayCandidates("batch-second").map((candidate) => ({
      ...candidate,
      importBatchId: "batch-second",
    }));
    const second = await service.writeConfirmedImport({
      importBatchId: "batch-second",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates: secondCandidates,
    });
    expect(second).toMatchObject({
      totalRows: 2,
      validRows: 0,
      writtenRows: 0,
      skippedRows: 2,
      errorRows: 0,
    });
    expect(second.auditEvents.filter((event) => event.endsWith(": duplicate"))).toHaveLength(2);
    expect(await repositories.listV2Expenses("profile-v2", "2026-10")).toHaveLength(2);

    const storedExpenses = await repositories.listV2Expenses("profile-v2", "2026-10");
    const storedFirst = storedExpenses[0];
    expect(storedFirst).toBeDefined();
    if (!storedFirst) throw new Error("expected a stored expense");
    const duplicateKey = await db.select<{ dedupe_key: string }>(
      "SELECT dedupe_key FROM expenses WHERE id=?",
      [storedFirst.id],
    );
    await expect(
      db.execute(
        `INSERT INTO expenses(id,profile_id,kind,amount,currency,occurred_on,category_id,description,account_id,created_at,dedupe_key)
         VALUES('duplicate','profile-v2','CASH_DEBIT','1.00','CNY','2026-10-01','cat-food','duplicate','cash-1','2026-10-19T00:00:00.000Z',?)`,
        [duplicateKey[0]?.dedupe_key ?? ""],
      ),
    ).rejects.toThrow();
  });

  it("skips every PENDING and EDITED candidate because only CONFIRMED may write", async () => {
    const parsed = parseImportFile(alipayContent, "ALIPAY_CSV", "batch-unconfirmed");
    const edited = parsed.map((candidate) =>
      applyCandidateEdits(candidate, { category: "cat-food", accountId: "cash-1" }),
    );
    const pending = edited.map((candidate) => ({ ...candidate, reviewStatus: "PENDING" as const }));
    const result = await service.writeConfirmedImport({
      importBatchId: "batch-unconfirmed",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates: [...pending, ...edited],
    });

    expect(result).toMatchObject({
      totalRows: 4,
      validRows: 0,
      writtenRows: 0,
      skippedRows: 4,
      errorRows: 0,
    });
    expect(result.auditEvents.filter((event) => event.endsWith(": not confirmed"))).toHaveLength(4);
    expect(await repositories.listV2Expenses("profile-v2")).toEqual([]);
    expect(await repositories.getImportBatchById("batch-unconfirmed")).toMatchObject({
      totalRows: 4,
      validRows: 0,
      writtenRows: 0,
      skippedRows: 4,
      errorRows: 0,
    });
  });

  it("deduplicates the same candidate within one batch without hitting SQLite", async () => {
    const [candidate] = confirmedAlipayCandidates("batch-internal");
    if (!candidate) throw new Error("candidate missing");
    const duplicate = { ...candidate };
    const result = await service.writeConfirmedImport({
      importBatchId: "batch-internal",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates: [candidate, duplicate],
    });

    expect(result).toMatchObject({
      totalRows: 2,
      validRows: 1,
      writtenRows: 1,
      skippedRows: 1,
      errorRows: 0,
    });
    expect(result.auditEvents).toContain("skipped synthetic-alipay-001: duplicate");
    expect(await repositories.listV2Expenses("profile-v2", "2026-10")).toHaveLength(1);
  });

  it("records an invalid amount as a row error while writing the valid row", async () => {
    const candidates = confirmedAlipayCandidates("batch-invalid-amount");
    const firstCandidate = candidates[0];
    const secondCandidate = candidates[1];
    expect(firstCandidate).toBeDefined();
    expect(secondCandidate).toBeDefined();
    if (!firstCandidate || !secondCandidate) throw new Error("expected two confirmed candidates");
    const invalidAmount: ImportedExpenseCandidate = {
      ...secondCandidate,
      amount: "1.234",
      dedupeKey: "ALIPAY_CSV:synthetic-alipay-002:1.234:2026-10-02",
    };
    const result = await service.writeConfirmedImport({
      importBatchId: "batch-invalid-amount",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates: [firstCandidate, invalidAmount],
    });

    expect(result).toMatchObject({
      totalRows: 2,
      validRows: 1,
      writtenRows: 1,
      skippedRows: 0,
      errorRows: 1,
    });
    expect(result.auditEvents).toContain("error synthetic-alipay-002: invalid amount");
    const expenses = await repositories.listV2Expenses("profile-v2", "2026-10");
    expect(expenses).toHaveLength(1);
    expect(expenses[0]?.amount).toBe("35.00");
  });

  it("rejects a committed row when its readback amount differs", async () => {
    const candidates = confirmedAlipayCandidates("batch-amount-readback");
    class AmountMismatchReadbackDatabase extends NodeSqliteDatabase {
      constructor(private readonly base: NodeSqliteDatabase) {
        super(base.connection);
      }
      override async select<T extends Record<string, unknown>>(
        sql: string,
        bindValues: unknown[] = [],
      ) {
        const rows = await this.base.select<T>(sql, bindValues);
        if (sql.startsWith("SELECT * FROM expenses WHERE id=?") && rows[0]) {
          return [
            { ...(rows[0] as unknown as { amount: string }), amount: "999.99" },
          ] as unknown as T[];
        }
        return rows;
      }
    }
    const wrapped = new AmountMismatchReadbackDatabase(db);
    const readbackService = new V2ImportService(new Repositories(wrapped));
    await expect(
      readbackService.writeConfirmedImport({
        importBatchId: "batch-amount-readback",
        profileId: "profile-v2",
        provider: "ALIPAY_CSV",
        sourceFileContent: alipayContent,
        candidates,
      }),
    ).rejects.toMatchObject({ code: "IMPORT_READBACK_FAILED" });
  });

  it("records a stopped account as a row error", async () => {
    await repositories.createAccount({
      id: "cash-stopped",
      profileId: "profile-v2",
      name: "停用账户",
      type: "CASH",
      currency: "CNY",
      active: false,
    });
    const stoppedCandidates = confirmedAlipayCandidates("batch-stopped-account");
    const firstStopped = stoppedCandidates[0];
    const secondStopped = stoppedCandidates[1];
    expect(firstStopped).toBeDefined();
    expect(secondStopped).toBeDefined();
    if (!firstStopped || !secondStopped) throw new Error("expected two confirmed candidates");
    const stoppedAccount: ImportedExpenseCandidate = {
      ...secondStopped,
      accountId: "cash-stopped",
    };
    const result = await service.writeConfirmedImport({
      importBatchId: "batch-stopped-account",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates: [firstStopped, stoppedAccount],
    });

    expect(result).toMatchObject({
      totalRows: 2,
      validRows: 1,
      writtenRows: 1,
      skippedRows: 0,
      errorRows: 1,
    });
    expect(result.auditEvents).toContain("error synthetic-alipay-002: account missing or invalid");
    expect(await repositories.listV2Expenses("profile-v2", "2026-10")).toHaveLength(1);
  });

  it("persists an empty candidate batch with all-zero counters", async () => {
    const result = await service.writeConfirmedImport({
      importBatchId: "batch-empty",
      profileId: "profile-v2",
      provider: "ALIPAY_CSV",
      sourceFileContent: alipayContent,
      candidates: [],
    });
    expect(result).toMatchObject({
      totalRows: 0,
      validRows: 0,
      writtenRows: 0,
      skippedRows: 0,
      errorRows: 0,
    });
    expect(await repositories.getImportBatchById("batch-empty")).toMatchObject({
      totalRows: 0,
      validRows: 0,
      writtenRows: 0,
      skippedRows: 0,
      errorRows: 0,
    });
    expect(await repositories.listV2Expenses("profile-v2")).toEqual([]);
  });

  it("throws a typed readback error if committed data no longer matches", async () => {
    const candidates = confirmedAlipayCandidates("batch-readback");
    class EmptyExpenseReadbackDatabase extends NodeSqliteDatabase {
      constructor(private readonly base: NodeSqliteDatabase) {
        super(base.connection);
      }
      override async select<T extends Record<string, unknown>>(
        sql: string,
        bindValues: unknown[] = [],
      ) {
        if (sql.startsWith("SELECT * FROM expenses WHERE id=?")) return [] as T[];
        return this.base.select<T>(sql, bindValues);
      }
    }
    const wrapped = new EmptyExpenseReadbackDatabase(db);
    const readbackService = new V2ImportService(new Repositories(wrapped));
    await expect(
      readbackService.writeConfirmedImport({
        importBatchId: "batch-readback",
        profileId: "profile-v2",
        provider: "ALIPAY_CSV",
        sourceFileContent: alipayContent,
        candidates,
      }),
    ).rejects.toBeInstanceOf(ApplicationDataError);
  });
});
