import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { saveCurrentMonthDebtFact } from "../src/application/debt-fact-service.js";
import { updateFinancialDataAndRecalculate } from "../src/application/financial-maintenance-service.js";
import { buildMonthlyModelInput } from "../src/application/monthly-model-service.js";
import { completeOnboarding, getHomeApplicationState } from "../src/application/product-service.js";
import type { SqlDatabase } from "../src/persistence/database.js";
import { migrateDatabase } from "../src/persistence/migrations.js";
import { Repositories } from "../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const openDatabases: NodeSqliteDatabase[] = [];
const tempDirs: string[] = [];

async function database(): Promise<NodeSqliteDatabase> {
  const db = new NodeSqliteDatabase();
  openDatabases.push(db);
  await migrateDatabase(db);
  await completeOnboarding(
    db,
    {
      displayName: "Synthetic",
      stableMonthlyIncome: "13000",
      essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1900" }],
      cashAccounts: [{ name: "Cash", balance: "20000", includeInSafetyResources: true }],
      assets: [],
      debts: [
        {
          name: "Loan A",
          currentBalance: "4000",
          currentMonthDue: "300",
          fixedMonthlyPayment: "300",
        },
      ],
      safetyCoverageTargetMonths: 0,
      minimumCashCoverageMonths: 0,
      desiredMonthlyDiscretionarySpending: "1000",
    },
    "2026-10-03",
  );
  return db;
}

async function addSecondDebt(db: NodeSqliteDatabase): Promise<string> {
  const result = await updateFinancialDataAndRecalculate(
    db,
    {
      debts: [
        {
          name: "Loan B",
          currentBalance: "2500",
          currentMonthDue: "250",
          fixedMonthlyPayment: "250",
        },
      ],
    },
    "2026-10-03",
  );
  const debt = result.state.debts.find((item) => item.name === "Loan B");
  if (!debt) throw new Error("Synthetic second debt was not created.");
  return debt.id;
}

async function stateSnapshot(db: NodeSqliteDatabase) {
  const tables = ["debts", "debt_period_facts", "debt_revisions"];
  const result: Record<string, unknown[]> = {};
  for (const table of tables) result[table] = await db.select(`SELECT * FROM ${table} ORDER BY 1`);
  return result;
}

afterEach(() => {
  for (const db of openDatabases.splice(0)) db.close();
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("single-domain current-month debt fact foundation", () => {
  it("commits one missing debt fact and reports the remaining IDs without a model", async () => {
    const db = await database();
    const secondDebtId = await addSecondDebt(db);
    const prior = await new Repositories(db).debtsAt("2026-10", "2026-10-03");
    const firstDebtId = prior.find((item) => item.name === "Loan A")?.id;
    if (!firstDebtId) throw new Error("Synthetic first debt is missing.");

    const result = await saveCurrentMonthDebtFact(
      db,
      { debtId: firstDebtId, currentBalance: "3900.00", currentMonthDue: "0" },
      "2026-11-03",
    );

    expect(result.status).toBe("SAVED_NEEDS_CURRENT_MONTH_DEBT_FACTS");
    if (result.status !== "SAVED_NEEDS_CURRENT_MONTH_DEBT_FACTS")
      throw new Error("Expected incomplete save.");
    expect(result.unresolvedDebtIds).toEqual([secondDebtId]);
    expect("home" in result).toBe(false);
    expect(
      await db.select(
        "SELECT current_balance,current_month_due FROM debt_revisions WHERE debt_id=? AND period_month='2026-11'",
        [firstDebtId],
      ),
    ).toEqual([{ current_balance: "3900.00", current_month_due: "0" }]);
    expect(
      await db.select("SELECT * FROM debt_revisions WHERE debt_id=? AND period_month='2026-11'", [
        secondDebtId,
      ]),
    ).toHaveLength(0);
    await expect(buildMonthlyModelInput(db, "2026-11", "2026-11-03")).rejects.toMatchObject({
      code: "MISSING_DEBT_SNAPSHOT",
    });
  });

  it("calculates the model normally after the last missing active debt fact is saved", async () => {
    const db = await database();
    const secondDebtId = await addSecondDebt(db);
    const prior = await new Repositories(db).debtsAt("2026-10", "2026-10-03");
    const firstDebtId = prior.find((item) => item.name === "Loan A")?.id;
    if (!firstDebtId) throw new Error("Synthetic first debt is missing.");

    const first = await saveCurrentMonthDebtFact(
      db,
      { debtId: firstDebtId, currentBalance: "3900", currentMonthDue: "300" },
      "2026-11-03",
    );
    expect(first.status).toBe("SAVED_NEEDS_CURRENT_MONTH_DEBT_FACTS");
    const second = await saveCurrentMonthDebtFact(
      db,
      { debtId: secondDebtId, currentBalance: "2400", currentMonthDue: "250" },
      "2026-11-03",
    );

    expect(second.status).toBe("SAVED_MODEL_READY");
    if (second.status !== "SAVED_MODEL_READY") throw new Error("Expected model-ready save.");
    expect(second.home.status).toBe("READY");
    expect(second.home.mandatoryDebtService).toBe("550");
    expect(second.confirmation).toBe("COMMIT_AND_READBACK");
  });

  it("preserves explicit current-month due zero over a positive fixed payment", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    const result = await saveCurrentMonthDebtFact(
      db,
      { debtId, currentBalance: "4000", currentMonthDue: "0" },
      "2026-10-03",
    );
    expect(result.status).toBe("SAVED_MODEL_READY");
    if (result.status !== "SAVED_MODEL_READY") throw new Error("Expected model-ready save.");
    expect(result.home.mandatoryDebtService).toBe("0");
    expect(result.home.debts[0]).toMatchObject({
      countedMonthlyPayment: "0",
      paymentSource: "CURRENT_MONTH_DUE",
    });
  });

  it("rejects unknown IDs without writes", async () => {
    const db = await database();
    const before = await stateSnapshot(db);
    const result = await saveCurrentMonthDebtFact(
      db,
      { debtId: "missing-debt", currentBalance: "10", currentMonthDue: "0" },
      "2026-10-03",
    );
    expect(result.status).toBe("CONFLICT_OR_UNKNOWN_ID");
    expect(await stateSnapshot(db)).toEqual(before);
  });

  it.each([
    [{ debtId: "x", currentBalance: "", currentMonthDue: "0" }, "2026-10-03"],
    [{ debtId: "x", currentBalance: "Infinity", currentMonthDue: "0" }, "2026-10-03"],
    [{ debtId: "x", currentBalance: "10", currentMonthDue: "-1" }, "2026-10-03"],
    [{ debtId: "x", currentBalance: "10", currentMonthDue: "0", active: true }, "2026-10-03"],
    [{ debtId: "x", currentBalance: "10", currentMonthDue: "0" }, "2026-02-30"],
    [null, "2026-10-03"],
  ])("rejects malformed/invalid command %j before writes", async (command, asOfDate) => {
    const db = await database();
    const before = await stateSnapshot(db);
    const result = await saveCurrentMonthDebtFact(db, command, asOfDate);
    expect(result.status).toBe("VALIDATION_FAILED");
    expect(await stateSnapshot(db)).toEqual(before);
  });

  it("reports command validation before beginning a transaction", async () => {
    const db = await database();
    let transactionCalls = 0;
    const guarded: SqlDatabase = {
      execute: (sql, binds) => db.execute(sql, binds),
      select: (sql, binds) => db.select(sql, binds),
      transaction: async (work) => {
        transactionCalls += 1;
        return db.transaction(work);
      },
    };
    const before = await stateSnapshot(db);
    const result = await saveCurrentMonthDebtFact(
      guarded,
      { debtId: "x", currentBalance: "", currentMonthDue: "0" },
      "2026-10-03",
    );
    expect(result.status).toBe("VALIDATION_FAILED");
    expect(transactionCalls).toBe(0);
    expect(await stateSnapshot(db)).toEqual(before);
  });

  it("keeps legal zero explicit", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    const result = await saveCurrentMonthDebtFact(
      db,
      { debtId, currentBalance: "0", currentMonthDue: "0" },
      "2026-10-03",
    );
    expect(result.status).toBe("SAVED_MODEL_READY");
    expect(
      await db.select(
        "SELECT current_balance,current_month_due FROM debt_revisions WHERE debt_id=? AND period_month='2026-10' ORDER BY revision_id DESC LIMIT 1",
        [debtId],
      ),
    ).toEqual([{ current_balance: "0", current_month_due: "0" }]);
  });

  it("rejects duplicate IDs in a batch before any revision writes", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    const before = await stateSnapshot(db);
    await expect(
      updateFinancialDataAndRecalculate(
        db,
        {
          debts: [
            { id: debtId, currentBalance: "10" },
            { id: debtId, currentBalance: "20" },
          ],
        },
        "2026-10-03",
      ),
    ).rejects.toMatchObject({ code: "DUPLICATE_ID" });
    expect(await stateSnapshot(db)).toEqual(before);
  });

  it("treats equivalent money formatting as a no-op without a revision", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    const before = await db.select("SELECT revision_id FROM debt_revisions WHERE debt_id=?", [
      debtId,
    ]);
    const result = await saveCurrentMonthDebtFact(
      db,
      { debtId, currentBalance: "4000.00", currentMonthDue: "300.0" },
      "2026-10-03",
    );
    expect(result.status).toBe("NO_CHANGE");
    expect(
      await db.select("SELECT revision_id FROM debt_revisions WHERE debt_id=?", [debtId]),
    ).toEqual(before);
  });

  it("reports transaction rollback after an inserted row with no partial state", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    const before = await stateSnapshot(db);
    const injected: SqlDatabase = {
      execute: (sql, binds) => db.execute(sql, binds),
      select: (sql, binds) => db.select(sql, binds),
      transaction: (work) =>
        db.transaction(async (tx) => {
          await work({
            execute: (sql, binds) => tx.execute(sql, binds),
            select: (sql, binds) => tx.select(sql, binds),
            transaction: (nested) => tx.transaction(nested),
          });
          throw new Error("injected failure after insert");
        }),
    };
    const result = await saveCurrentMonthDebtFact(
      injected,
      { debtId, currentBalance: "3900", currentMonthDue: "250" },
      "2026-10-03",
    );
    expect(result).toMatchObject({
      status: "SAVE_FAILED",
      persistenceConfirmed: false,
      persistenceOutcome: "CONFIRMED_ROLLED_BACK",
    });
    expect(await stateSnapshot(db)).toEqual(before);
  });

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["false", false],
    ["zero", 0],
  ])("uses rollback evidence when transaction rejects with %s", async (_label, failureValue) => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    const before = await stateSnapshot(db);
    const rejecting: SqlDatabase = {
      execute: (sql, binds) => db.execute(sql, binds),
      select: (sql, binds) => db.select(sql, binds),
      transaction: (work) =>
        db.transaction(async (tx) => {
          await work(tx);
          throw failureValue;
        }),
    };

    const result = await saveCurrentMonthDebtFact(
      rejecting,
      { debtId, currentBalance: "3900", currentMonthDue: "250" },
      "2026-10-03",
    );
    expect(result).toMatchObject({
      status: "SAVE_FAILED",
      persistenceConfirmed: false,
      persistenceOutcome: "CONFIRMED_ROLLED_BACK",
    });
    expect(await stateSnapshot(db)).toEqual(before);
  });

  it("preserves confirmed persistence when post-commit model reconstruction fails", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    let committed = false;
    const modelFailure: SqlDatabase = {
      execute: (sql, binds) => db.execute(sql, binds),
      transaction: async (work) => {
        await db.transaction(work);
        committed = true;
        throw new Error("commit response lost");
      },
      select: async <T extends Record<string, unknown>>(
        sql: string,
        binds?: unknown[],
      ): Promise<T[]> => {
        const rows = await db.select<T>(sql, binds);
        if (committed && /FROM profiles/i.test(sql))
          return rows.map((row) => ({ ...row, id: "" }) as T);
        return rows;
      },
    };

    const result = await saveCurrentMonthDebtFact(
      modelFailure,
      { debtId, currentBalance: "3900", currentMonthDue: "200" },
      "2026-10-03",
    );
    expect(await new Repositories(db).currentDebtFactAt(debtId, "2026-10", "2026-10-03")).toEqual({
      currentBalance: "3900",
      currentMonthDue: "200",
    });
    expect(result).toMatchObject({
      status: "SAVE_FAILED",
      code: "MODEL_REFRESH_FAILED",
      persistenceConfirmed: true,
      persistenceOutcome: "CONFIRMED_PERSISTED",
    });
    if (result.status !== "SAVE_FAILED") throw new Error("Expected explicit post-commit failure.");
    expect(result.message).toMatch(/Debt fact was saved, but Home\/model refresh failed/);
    expect("home" in result).toBe(false);
  });

  it("preserves confirmed persistence when ordinary Home readback fails", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    let committed = false;
    const homeReadFailure: SqlDatabase = {
      execute: (sql, binds) => db.execute(sql, binds),
      transaction: async (work) => {
        const result = await db.transaction(work);
        committed = true;
        return result;
      },
      select: async (sql, binds) => {
        if (committed && /FROM profiles/i.test(sql)) throw new Error("injected Home read failure");
        return db.select(sql, binds);
      },
    };

    const result = await saveCurrentMonthDebtFact(
      homeReadFailure,
      { debtId, currentBalance: "3850", currentMonthDue: "180" },
      "2026-10-03",
    );
    expect(result).toMatchObject({
      status: "SAVE_FAILED",
      persistenceConfirmed: true,
      persistenceOutcome: "CONFIRMED_PERSISTED",
    });
    expect("home" in result).toBe(false);
    expect(await new Repositories(db).currentDebtFactAt(debtId, "2026-10", "2026-10-03")).toEqual({
      currentBalance: "3850",
      currentMonthDue: "180",
    });
  });

  it.each([
    [
      "INVALID_STORED_DATA",
      async (db: NodeSqliteDatabase) => {
        await db.execute("UPDATE profiles SET display_name=x'FF'");
        await new Repositories(db).getProfile();
      },
    ],
    [
      "INVALID_STORED_MONEY",
      async (db: NodeSqliteDatabase) => {
        await db.execute("UPDATE cash_balance_snapshots SET balance='NaN'");
        await new Repositories(db).cashAccountsAt("2026-10-03");
      },
    ],
  ])("preserves committed debt truth when Home decoding fails with %s", async (_code, corrupt) => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    let committed = false;
    let corrupted = false;
    const homeDecodeFailure: SqlDatabase = {
      execute: (sql, binds) => db.execute(sql, binds),
      transaction: async (work) => {
        const result = await db.transaction(work);
        committed = true;
        return result;
      },
      select: async <T extends Record<string, unknown>>(
        sql: string,
        binds?: unknown[],
      ): Promise<T[]> => {
        const rows = await db.select<T>(sql, binds);
        if (committed && !corrupted && /FROM cash_accounts/i.test(sql)) {
          corrupted = true;
          await corrupt(db);
        }
        return rows;
      },
    };
    const result = await saveCurrentMonthDebtFact(
      homeDecodeFailure,
      { debtId, currentBalance: "3900", currentMonthDue: "200" },
      "2026-10-03",
    );
    expect(corrupted).toBe(true);
    expect(result).toMatchObject({
      status: "SAVE_FAILED",
      code: _code,
      persistenceConfirmed: true,
      persistenceOutcome: "CONFIRMED_PERSISTED",
    });
    expect("home" in result).toBe(false);
    expect(
      await db.select("SELECT current_balance FROM debt_revisions WHERE debt_id=?", [debtId]),
    ).toEqual([{ current_balance: "3900" }]);
  });

  it("keeps outcome unknown when authoritative fact decoding fails after an uncertain commit", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    let corrupted = false;
    const uncertainDecodeFailure: SqlDatabase = {
      execute: (sql, binds) => db.execute(sql, binds),
      transaction: async (work) => {
        await db.transaction(work);
        throw new Error("commit response lost");
      },
      select: async (sql, binds) => {
        if (!corrupted && /WHERE revision_id=\?/i.test(sql)) {
          corrupted = true;
          await db.execute("UPDATE debt_revisions SET current_balance='NaN' WHERE debt_id=?", [
            debtId,
          ]);
          // Exercise the current Repository decoder and its actual error type.
          await new Repositories(db).currentDebtFactAt(debtId, "2026-10", "2026-10-03");
        }
        return db.select(sql, binds);
      },
    };
    const result = await saveCurrentMonthDebtFact(
      uncertainDecodeFailure,
      { debtId, currentBalance: "3900", currentMonthDue: "200" },
      "2026-10-03",
    );
    expect(result).toMatchObject({
      status: "SAVE_FAILED",
      code: "INVALID_STORED_MONEY",
      persistenceConfirmed: false,
      persistenceOutcome: "OUTCOME_UNKNOWN",
    });
  });

  it("keeps commit outcome unknown if the committed fact cannot be read back", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    let committed = false;
    const readbackFailure: SqlDatabase = {
      execute: (sql, binds) => db.execute(sql, binds),
      transaction: async (work) => {
        await db.transaction(work);
        committed = true;
        throw new Error("commit response lost");
      },
      select: (sql, binds) => {
        if (committed && /FROM debt_revisions/i.test(sql))
          throw new Error("injected fact readback failure");
        return db.select(sql, binds);
      },
    };

    const result = await saveCurrentMonthDebtFact(
      readbackFailure,
      { debtId, currentBalance: "3800", currentMonthDue: "170" },
      "2026-10-03",
    );
    expect(result).toMatchObject({
      status: "SAVE_FAILED",
      persistenceConfirmed: false,
      persistenceOutcome: "OUTCOME_UNKNOWN",
    });
    expect("home" in result).toBe(false);
  });

  it("confirms committed state through authoritative readback after an uncertain transaction response", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    const uncertain: SqlDatabase = {
      execute: (sql, binds) => db.execute(sql, binds),
      select: (sql, binds) => db.select(sql, binds),
      transaction: async (work) => {
        await db.transaction(work);
        throw new Error("commit response lost");
      },
    };
    const result = await saveCurrentMonthDebtFact(
      uncertain,
      { debtId, currentBalance: "3900", currentMonthDue: "0" },
      "2026-10-03",
    );
    expect(result.status).toBe("SAVED_MODEL_READY");
    if (result.status !== "SAVED_MODEL_READY") throw new Error("Expected readback-confirmed save.");
    expect(result.confirmation).toBe("READBACK_AFTER_COMMIT_ERROR");
    expect(result.home.debts[0]?.countedMonthlyPayment).toBe("0");
  });

  it("does not infer rollback from a latest-value mismatch when the exact receipt is unavailable", async () => {
    const db = await database();
    const debtId = (await new Repositories(db).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    const uncertainWithoutReceipt: SqlDatabase = {
      execute: (sql, binds) => db.execute(sql, binds),
      select: (sql, binds) => db.select(sql, binds),
      transaction: async (work) => {
        await db.transaction(async (tx) =>
          work({
            execute: async (sql, binds) => {
              const result = await tx.execute(sql, binds);
              return { rowsAffected: result.rowsAffected };
            },
            select: (sql, binds) => tx.select(sql, binds),
            transaction: (nested) => tx.transaction(nested),
          }),
        );
        await new Repositories(db).appendDebtRevision(
          "synthetic-profile",
          {
            id: debtId,
            name: "Loan A",
            currentBalance: "10000",
            currentMonthDue: "180",
            fixedMonthlyPayment: "300",
          },
          "2026-10",
          "2026-10-03",
          "2026-10-03T01:00:00.000Z",
          () => "unused",
        );
        throw new Error("commit response lost");
      },
    };
    const result = await saveCurrentMonthDebtFact(
      uncertainWithoutReceipt,
      { debtId, currentBalance: "11000", currentMonthDue: "200" },
      "2026-10-03",
    );
    expect(result).toMatchObject({
      status: "SAVE_FAILED",
      persistenceConfirmed: false,
      persistenceOutcome: "OUTCOME_UNKNOWN",
    });
    expect(result).not.toMatchObject({ persistenceOutcome: "CONFIRMED_ROLLED_BACK" });
    expect(
      await db.select(
        "SELECT current_balance,current_month_due FROM debt_revisions WHERE debt_id=? ORDER BY revision_id",
        [debtId],
      ),
    ).toEqual([
      { current_balance: "11000", current_month_due: "200" },
      { current_balance: "10000", current_month_due: "180" },
    ]);
  });

  it("reads the committed fact after closing and reopening an isolated file database", async () => {
    const directory = mkdtempSync(join(tmpdir(), "f0-debt-reopen-"));
    tempDirs.push(directory);
    const path = join(directory, "f0.sqlite");
    const firstDb = new NodeSqliteDatabase(new DatabaseSync(path));
    openDatabases.push(firstDb);
    await migrateDatabase(firstDb);
    await completeOnboarding(
      firstDb,
      {
        displayName: "Synthetic",
        stableMonthlyIncome: "13000",
        essentialExpenses: [{ category: "HOUSING", monthlyAmount: "1900" }],
        cashAccounts: [{ name: "Cash", balance: "20000", includeInSafetyResources: true }],
        assets: [],
        debts: [
          {
            name: "Loan",
            currentBalance: "4000",
            currentMonthDue: "300",
            fixedMonthlyPayment: "300",
          },
        ],
        safetyCoverageTargetMonths: 0,
        minimumCashCoverageMonths: 0,
        desiredMonthlyDiscretionarySpending: "1000",
      },
      "2026-10-03",
    );
    const debtId = (await new Repositories(firstDb).debtsAt("2026-10", "2026-10-03"))[0]?.id;
    if (!debtId) throw new Error("Synthetic debt is missing.");
    const saved = await saveCurrentMonthDebtFact(
      firstDb,
      { debtId, currentBalance: "3500.00", currentMonthDue: "200.00" },
      "2026-10-03",
    );
    expect(saved.status).toBe("SAVED_MODEL_READY");
    firstDb.close();
    openDatabases.splice(openDatabases.indexOf(firstDb), 1);

    const reopened = new NodeSqliteDatabase(new DatabaseSync(path));
    openDatabases.push(reopened);
    const state = await new Repositories(reopened).currentDebtFactAt(
      debtId,
      "2026-10",
      "2026-10-03",
    );
    expect(state).toEqual({ currentBalance: "3500.00", currentMonthDue: "200.00" });
    expect((await getHomeApplicationState(reopened, "2026-10-03")).mandatoryDebtService).toBe(
      "200",
    );
  });
});
