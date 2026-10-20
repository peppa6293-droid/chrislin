import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { completeOnboarding } from "../../src/application/product-service.js";
import {
  applyCandidateEdits,
  confirmImportBatch,
  parseImportFile,
} from "../../src/model/v2-import.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import {
  ensureV2LedgerDefaults,
  getV2ImportOptionsForDatabase,
  writeV2ImportForDatabase,
} from "../../src/runtime/tauri-bootstrap.js";
import { localDate } from "../../src/ui/date.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

const alipayContent = readFileSync("tests/fixtures/v2-import/sample-alipay-export.csv", "utf8");

interface SeededDatabase {
  db: NodeSqliteDatabase;
  repositories: Repositories;
  asOfDate: string;
}

async function seedDatabase(connection = new DatabaseSync(":memory:")): Promise<SeededDatabase> {
  const asOfDate = localDate(new Date());
  const db = new NodeSqliteDatabase(connection);
  await migrateDatabase(db, `${asOfDate}T00:00:00.000Z`);
  await completeOnboarding(
    db,
    {
      stableMonthlyIncome: "10000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1000" }],
      cashAccounts: [{ name: "Checking", balance: "5000", includeInSafetyResources: true }],
      assets: [],
      debts: [],
      safetyCoverageTargetMonths: 1,
      minimumCashCoverageMonths: 1,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    asOfDate,
  );
  await ensureV2LedgerDefaults(db);
  return { db, repositories: new Repositories(db), asOfDate };
}

async function importFixture(
  db: NodeSqliteDatabase,
  importBatchId: string,
): Promise<{ writtenRows: number; skippedRows: number; errorRows: number }> {
  const context = await getV2ImportOptionsForDatabase(db);
  const categoryId = context.categories[0]?.id;
  const accountId = context.accounts[0]?.id;
  if (!categoryId || !accountId) throw new Error("seeded defaults are missing");
  const parsed = parseImportFile(alipayContent, "ALIPAY_CSV", importBatchId);
  const edited = parsed.map((candidate) =>
    applyCandidateEdits(candidate, { category: categoryId, accountId }),
  );
  const { confirmed, skipped } = confirmImportBatch(edited);
  return writeV2ImportForDatabase(db, {
    importBatchId,
    provider: "ALIPAY_CSV",
    sourceFileContent: alipayContent,
    candidates: [...confirmed, ...skipped],
  });
}

async function mirrorCount(db: NodeSqliteDatabase): Promise<number> {
  const rows = await db.select<{ count: number }>("SELECT COUNT(*) AS count FROM expense_records");
  return rows[0]?.count ?? 0;
}

describe("EXEC-LANDING L-02 CSV import through the production services", () => {
  it("writes the fixture batch and mirrors every written row into expense_records", async () => {
    const seed = await seedDatabase();
    try {
      const result = await importFixture(seed.db, "landing-import-batch-1");

      expect(result.writtenRows).toBe(2);
      expect(result.skippedRows).toBe(0);
      expect(result.errorRows).toBe(0);
      expect(result.writtenRows).toBeGreaterThan(0);
      expect(await mirrorCount(seed.db)).toBe(result.writtenRows);

      const mirror = await seed.db.select<{
        id: string;
        amount: string;
        occurred_at: string;
        business_date: string;
        kind: string;
        category: string;
        note: string;
      }>(
        "SELECT id,amount,occurred_at,business_date,kind,category,note FROM expense_records ORDER BY business_date",
      );
      expect(mirror).toHaveLength(result.writtenRows);
      expect(mirror[0]).toEqual({
        id: expect.any(String),
        amount: "35.00",
        occurred_at: "2026-10-01T00:00:00.000Z",
        business_date: "2026-10-01",
        kind: "VARIABLE",
        category: "OTHER_VARIABLE",
        note: "合成早餐店",
      });

      const ledger = await seed.db.select<{
        id: string;
        amount: string;
        occurred_on: string;
        description: string;
      }>("SELECT id,amount,occurred_on,description FROM expenses ORDER BY occurred_on");
      expect(ledger).toHaveLength(result.writtenRows);
      expect(ledger[0]).toMatchObject({
        id: mirror[0]?.id,
        amount: "35.00",
        occurred_on: "2026-10-01",
        description: "合成早餐店",
      });
    } finally {
      seed.db.close();
    }
  });

  it("deduplicates a second import of the same file without adding mirror rows", async () => {
    const seed = await seedDatabase();
    try {
      const first = await importFixture(seed.db, "landing-import-batch-1");
      expect(first.writtenRows).toBe(2);
      const countAfterFirst = await mirrorCount(seed.db);

      const second = await importFixture(seed.db, "landing-import-batch-2");
      expect(second.writtenRows).toBe(0);
      expect(second.skippedRows).toBe(first.writtenRows);
      expect(second.errorRows).toBe(0);
      expect(await mirrorCount(seed.db)).toBe(countAfterFirst);
    } finally {
      seed.db.close();
    }
  });

  it("keeps mirror rows after the database file is closed and reopened", async () => {
    const dir = mkdtempSync(join(tmpdir(), "landing-import-"));
    const path = join(dir, "personal-finance-console.sqlite3");
    try {
      const firstRun = await seedDatabase(new DatabaseSync(path));
      let writtenRows = 0;
      try {
        const result = await importFixture(firstRun.db, "landing-import-batch-file");
        writtenRows = result.writtenRows;
        expect(writtenRows).toBe(2);
        expect(await mirrorCount(firstRun.db)).toBe(writtenRows);
      } finally {
        firstRun.db.close();
      }

      const reopened = new NodeSqliteDatabase(new DatabaseSync(path));
      try {
        expect(await mirrorCount(reopened)).toBe(writtenRows);
        const mirror = await reopened.select<{ amount: string; business_date: string }>(
          "SELECT amount,business_date FROM expense_records ORDER BY business_date",
        );
        expect(mirror).toEqual([
          { amount: "35.00", business_date: "2026-10-01" },
          { amount: "12.50", business_date: "2026-10-02" },
        ]);
      } finally {
        reopened.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
