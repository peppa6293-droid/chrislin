import { beforeEach, describe, expect, it } from "vitest";
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

describe("EXEC-L-06 category CRUD", () => {
  it("creates, reads, updates, lists, and soft-deletes a custom category", async () => {
    await repositories.createExpenseCategory({
      id: "cat-coffee",
      profileId: "profile-v2",
      name: "咖啡",
      icon: "Coffee",
      color: "#8B5E3C",
      monthlyBudget: "500.00",
      overspendingAlert: true,
      savingsRelated: false,
      adjustable: true,
      builtin: false,
    });
    await expect(repositories.getExpenseCategoryById("cat-coffee")).resolves.toMatchObject({
      name: "咖啡",
      monthlyBudget: "500.00",
      overspendingAlert: true,
    });
    await repositories.updateExpenseCategory({
      id: "cat-coffee",
      profileId: "profile-v2",
      name: "咖啡和茶",
      icon: "Coffee",
      color: "#8B5E3C",
      monthlyBudget: "600.00",
      overspendingAlert: true,
      savingsRelated: false,
      adjustable: true,
      builtin: false,
      active: true,
    });
    expect((await repositories.listExpenseCategories("profile-v2"))[0]?.name).toBe("咖啡和茶");
    await repositories.deleteExpenseCategory("profile-v2", "cat-coffee");
    expect(await repositories.listExpenseCategories("profile-v2")).toEqual([]);
  });

  it("keeps built-in categories undeletable by the custom delete operation", async () => {
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
    await expect(
      repositories.deleteExpenseCategory("profile-v2", "cat-food"),
    ).rejects.toMatchObject({
      code: "CATEGORY_NOT_FOUND_OR_BUILTIN",
    });
  });
});
