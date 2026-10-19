import { describe, expect, it } from "vitest";
import {
  ACCEPTANCE_ACTUAL_IDS,
  ACCEPTANCE_AS_OF,
  ACCEPTANCE_CASH_NAME,
  ACCEPTANCE_MONTH,
  type AcceptanceRuntimeInfo,
  V4AcceptanceSandboxService,
} from "../src/application/v4-acceptance-sandbox-service.js";
import { NodeSqliteDatabase } from "./helpers/node-sqlite.js";

const runtime: AcceptanceRuntimeInfo = {
  identifier: "com.personalfinance.console.v4acceptance",
  appDataDir: "/Users/tester/Library/Application Support/com.personalfinance.console.v4acceptance",
  databasePath:
    "/Users/tester/Library/Application Support/com.personalfinance.console.v4acceptance/personal-finance-console-v4-acceptance.sqlite3",
};

describe("V4 owner acceptance sandbox service", () => {
  it("creates only synthetic V4 seed data once and resolves the expected initial scenarios", async () => {
    const db = new NodeSqliteDatabase();
    try {
      const service = new V4AcceptanceSandboxService(
        db,
        () => `${ACCEPTANCE_AS_OF}T12:00:00.000Z`,
        async () => runtime,
      );
      await service.initialize();
      expect(await db.select("PRAGMA user_version")).toEqual([{ user_version: 6 }]);
      expect(await db.select("SELECT version FROM schema_migrations ORDER BY version")).toEqual([
        { version: 1 },
        { version: 2 },
        { version: 3 },
        { version: 4 },
        { version: 5 },
        { version: 6 },
      ]);
      expect((await service.read(ACCEPTANCE_MONTH, ACCEPTANCE_AS_OF)).planningIncome).toMatchObject(
        {
          amount: "13000",
          source: "STABLE_BASELINE",
        },
      );
      expect((await service.read(ACCEPTANCE_MONTH, "2026-10-03")).actualIncome).toHaveLength(4);
      expect((await service.read(ACCEPTANCE_MONTH, "2026-10-14")).cashAccounts).toMatchObject([
        { name: ACCEPTANCE_CASH_NAME, balance: "4805.61" },
      ]);
      expect(
        await db.select("SELECT id,created_at FROM income_records WHERE id=?", [
          ACCEPTANCE_ACTUAL_IDS[3],
        ]),
      ).toEqual([{ id: ACCEPTANCE_ACTUAL_IDS[3], created_at: "2026-10-07T12:00:00.000Z" }]);
      await service.savePlanning(ACCEPTANCE_MONTH, "2026-10-08", "15500");
      await service.initialize();
      expect(
        await db.select("SELECT COUNT(*) AS count FROM income_records WHERE kind='ACTUAL'"),
      ).toEqual([{ count: 4 }]);
      expect(
        await db.select("SELECT COUNT(*) AS count FROM planning_income_month_revisions"),
      ).toEqual([{ count: 1 }]);
    } finally {
      db.close();
    }
  });

  it("routes all Owner acceptance scenarios through the accepted V4 service", async () => {
    const db = new NodeSqliteDatabase();
    try {
      const service = new V4AcceptanceSandboxService(
        db,
        () => `${ACCEPTANCE_AS_OF}T12:00:00.000Z`,
        async () => runtime,
      );
      await service.initialize();

      await service.savePlanning(ACCEPTANCE_MONTH, "2026-10-08", "15500");
      expect((await service.read(ACCEPTANCE_MONTH, "2026-10-08")).planningIncome).toMatchObject({
        amount: "15500",
        source: "MONTH_OVERRIDE",
      });
      expect((await service.read("2026-11", "2026-11-01")).planningIncome).toMatchObject({
        amount: "13000",
        source: "STABLE_BASELINE",
      });
      await service.updateStableIncome("14000", "2026-10-09");
      expect((await service.read(ACCEPTANCE_MONTH, "2026-10-09")).planningIncome.amount).toBe(
        "15500",
      );
      expect((await service.read("2026-11", "2026-11-01")).planningIncome.amount).toBe("14000");
      await service.savePlanning(ACCEPTANCE_MONTH, "2026-10-10", null);
      expect((await service.read(ACCEPTANCE_MONTH, "2026-10-10")).planningIncome).toMatchObject({
        amount: "14000",
        source: "MONTH_INHERIT",
      });

      await service.reviseActual({
        incomeId: ACCEPTANCE_ACTUAL_IDS[0],
        asOfDate: "2026-10-04",
        date: "2026-10-02",
        amount: "950",
        status: "PENDING",
      });
      expect(
        (await service.read(ACCEPTANCE_MONTH, "2026-10-03")).actualIncome.find(
          (row) => row.id === ACCEPTANCE_ACTUAL_IDS[0],
        ),
      ).toMatchObject({ amount: "800", status: "RECEIVED" });
      expect(
        (await service.read(ACCEPTANCE_MONTH, "2026-10-05")).actualIncome.find(
          (row) => row.id === ACCEPTANCE_ACTUAL_IDS[0],
        ),
      ).toMatchObject({ amount: "950", status: "PENDING" });

      await service.reviseActual({
        incomeId: ACCEPTANCE_ACTUAL_IDS[1],
        asOfDate: "2026-10-04",
        date: "2026-10-20",
        amount: "950",
        status: "PENDING",
      });
      expect(
        (await service.read(ACCEPTANCE_MONTH, "2026-10-05")).actualIncome.some(
          (row) => row.id === ACCEPTANCE_ACTUAL_IDS[1],
        ),
      ).toBe(false);
      expect(
        (await service.read(ACCEPTANCE_MONTH, "2026-10-20")).actualIncome.find(
          (row) => row.id === ACCEPTANCE_ACTUAL_IDS[1],
        ),
      ).toMatchObject({ amount: "950", status: "PENDING" });

      await service.reviseActual({
        incomeId: ACCEPTANCE_ACTUAL_IDS[2],
        asOfDate: "2026-10-06",
        date: "2026-10-02",
        amount: "800",
        status: "RECEIVED",
        void: true,
      });
      expect(
        (await service.read(ACCEPTANCE_MONTH, "2026-10-05")).actualIncome.some(
          (row) => row.id === ACCEPTANCE_ACTUAL_IDS[2],
        ),
      ).toBe(true);
      expect(
        (await service.read(ACCEPTANCE_MONTH, "2026-10-07")).actualIncome.some(
          (row) => row.id === ACCEPTANCE_ACTUAL_IDS[2],
        ),
      ).toBe(false);

      await service.reviseActual({
        incomeId: ACCEPTANCE_ACTUAL_IDS[3],
        asOfDate: "2026-10-04",
        date: "2026-10-02",
        amount: "950",
        status: "PENDING",
      });
      expect(
        (await service.read(ACCEPTANCE_MONTH, "2026-10-03")).actualIncome.find(
          (row) => row.id === ACCEPTANCE_ACTUAL_IDS[3],
        ),
      ).toMatchObject({ amount: "800", status: "RECEIVED" });
      expect(
        (await service.read(ACCEPTANCE_MONTH, "2026-10-25")).actualIncome.find(
          (row) => row.id === ACCEPTANCE_ACTUAL_IDS[3],
        ),
      ).toMatchObject({ amount: "950", status: "PENDING" });

      await service.deactivateCash("2026-10-15");
      expect((await service.read(ACCEPTANCE_MONTH, "2026-10-14")).cashAccounts).toMatchObject([
        { name: ACCEPTANCE_CASH_NAME, balance: "4805.61" },
      ]);
      expect(
        (await service.read(ACCEPTANCE_MONTH, "2026-10-15")).cashAccounts.some(
          (row) => row.name === ACCEPTANCE_CASH_NAME,
        ),
      ).toBe(false);
      expect((await service.histories()).cash).toMatchObject([
        { as_of_date: "2026-10-15", active: 0 },
      ]);
    } finally {
      db.close();
    }
  });

  it("refuses to open or reset when runtime identity/path is outside acceptance", async () => {
    const db = new NodeSqliteDatabase();
    const badRuntime = { ...runtime, identifier: "com.personalfinance.console" };
    const nativeReset = async () => {
      throw new Error("must not invoke reset");
    };
    try {
      const service = new V4AcceptanceSandboxService(
        db,
        undefined,
        async () => badRuntime,
        nativeReset,
      );
      await expect(service.initialize()).rejects.toThrow("身份或数据库路径校验失败");
      await expect(service.reset()).rejects.toThrow("身份或数据库路径校验失败");
      expect(await db.select("SELECT name FROM sqlite_master WHERE type='table'")).toEqual([]);
    } finally {
      db.close();
    }
  });
});
