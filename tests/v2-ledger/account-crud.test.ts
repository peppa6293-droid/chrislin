import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

let db: NodeSqliteDatabase;
let repositories: Repositories;

beforeEach(async () => {
  db = new NodeSqliteDatabase();
  repositories = new Repositories(db);
  await migrateDatabase(db);
  await repositories.createProfile({ id: "profile-v2", displayName: "V2 test" });
});

afterEach(() => db.close());

describe("EXEC-L-01 account CRUD", () => {
  it("creates and reads all four account types", async () => {
    const accounts = [
      { id: "cash-1", name: "现金账户", type: "CASH" as const, currency: "CNY" },
      { id: "debit-1", name: "借记卡", type: "DEBIT_CARD" as const, currency: "CNY" },
      { id: "credit-1", name: "信用卡", type: "CREDIT_CARD" as const, currency: "CNY" },
      { id: "other-1", name: "其他账户", type: "OTHER" as const, currency: "CNY" },
    ];
    for (const account of accounts)
      await repositories.createAccount({ ...account, profileId: "profile-v2" });

    expect(await repositories.listAccounts("profile-v2")).toHaveLength(4);
    await expect(repositories.getAccountById("credit-1")).resolves.toMatchObject({
      id: "credit-1",
      type: "CREDIT_CARD",
      currency: "CNY",
      active: true,
    });
  });

  it("keeps account lists isolated by profile", async () => {
    await repositories.createAccount({
      id: "cash-1",
      profileId: "profile-v2",
      name: "现金账户",
      type: "CASH",
      currency: "CNY",
    });
    expect(await repositories.listAccounts("other-profile")).toEqual([]);
  });
});

// V1.0 formula files under src/model/ were not modified by this task.
// All persistence uses the synthetic in-memory SQLite database above.
