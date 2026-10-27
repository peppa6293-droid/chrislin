// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { V2ImportService } from "../../src/application/v2-import-service.js";
import { migrateDatabase } from "../../src/persistence/migrations.js";
import { Repositories } from "../../src/persistence/repositories.js";
import type {
  V2ImportContext,
  V2ImportWriteInput,
  V2ImportWriteResult,
} from "../../src/ui/contracts.js";
import { V2Import } from "../../src/ui/v2-import.js";
import { NodeSqliteDatabase } from "../helpers/node-sqlite.js";

let db: NodeSqliteDatabase;
let repositories: Repositories;
let importService: V2ImportService;
const alipayContent = readFileSync("tests/fixtures/v2-import/sample-alipay-export.csv", "utf8");

beforeEach(async () => {
  db = new NodeSqliteDatabase();
  repositories = new Repositories(db);
  importService = new V2ImportService(repositories);
  await migrateDatabase(db, "2026-10-20T00:00:00.000Z");
  await repositories.createProfile({ id: "profile-v2", displayName: "V2 import UI" });
  await repositories.createAccount({
    id: "cash-1",
    profileId: "profile-v2",
    name: "现金",
    type: "CASH",
    currency: "CNY",
  });
  await repositories.createAccount({
    id: "credit-1",
    profileId: "profile-v2",
    name: "信用卡",
    type: "CREDIT_CARD",
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

afterEach(async () => {
  cleanup();
  vi.clearAllMocks();
  db.close();
});

async function loadImportContext(): Promise<V2ImportContext> {
  const [categories, accounts, dedupeKeys] = await Promise.all([
    repositories.listExpenseCategories("profile-v2"),
    repositories.listAccounts("profile-v2"),
    repositories.listImportedDedupeKeys("profile-v2"),
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

async function writeImport(input: V2ImportWriteInput): Promise<V2ImportWriteResult> {
  const result = await importService.writeConfirmedImport({ ...input, profileId: "profile-v2" });
  return {
    writtenRows: result.writtenRows,
    skippedRows: result.skippedRows,
    errorRows: result.errorRows,
  };
}

function renderImport() {
  return render(<V2Import loadImportContext={loadImportContext} writeImport={writeImport} />);
}

async function uploadAlipay() {
  const input = screen.getByLabelText("选择 CSV 文件");
  await userEvent.upload(input, new File([alipayContent], "alipay.csv", { type: "text/csv" }));
}

describe("EXEC-U-06 CSV import flow", () => {
  it("previews two parseable Alipay candidates with counts from the model result", async () => {
    renderImport();
    await uploadAlipay();
    expect((await screen.findByRole("status")).textContent?.replace(/\s+/g, "")).toContain(
      "共2条｜可导入2｜重复跳过0｜异常0",
    );
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("2026-10-01")).toBeTruthy();
    expect(screen.getByText("2026-10-02")).toBeTruthy();
    expect(screen.getByText("¥35.00")).toBeTruthy();
    expect(screen.getByText("¥12.50")).toBeTruthy();
    expect(screen.getAllByText("可导入")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "确认导入" }).disabled).toBe(false);
  });

  it("writes a successful batch and reads back the two stored rows", async () => {
    renderImport();
    await uploadAlipay();
    await userEvent.click(await screen.findByRole("button", { name: "确认导入" }));
    const result = await screen.findByRole("status", { name: undefined });
    expect(result.textContent).toContain("已写入 2 条，跳过 0 条，失败 0 条");
    const expenses = await repositories.listV2Expenses("profile-v2", "2026-10");
    expect(
      expenses.map((expense) => [expense.amount, expense.occurredOn, expense.categoryId]),
    ).toEqual([
      ["35.00", "2026-10-01", "cat-food"],
      ["12.50", "2026-10-02", "cat-food"],
    ]);
    expect(expenses.every((expense) => expense.kind === "CASH_DEBIT")).toBe(true);
    expect((expenses[0] as { accountId: string }).accountId).toBe("cash-1");
    expect((expenses[1] as { accountId: string }).accountId).toBe("cash-1");
  });

  it("suggests categories with local rules and flags only the rows it is unsure about", async () => {
    renderImport();
    await uploadAlipay();
    expect((await screen.findByRole("status")).textContent).toContain(
      "其中 1 条已按本地规则分好，1 条等你确认",
    );
    const [first, second] = screen.getAllByRole("combobox", { name: /第 \d+ 条的分类/ });
    expect((first as HTMLSelectElement).value).toBe("cat-food");
    expect((second as HTMLSelectElement).value).toBe("cat-food");
    expect(screen.getByText(/按「餐」建议 · 95%/)).toBeTruthy();
    expect(screen.getByText("没匹配到规则，先用默认分类")).toBeTruthy();
  });

  it("writes the category chosen on an individual row", async () => {
    await repositories.createExpenseCategory({
      id: "cat-transport",
      profileId: "profile-v2",
      name: "交通",
      icon: "Bus",
      color: "#457B9D",
      monthlyBudget: null,
      overspendingAlert: false,
      savingsRelated: false,
      adjustable: true,
      builtin: true,
    });
    renderImport();
    await uploadAlipay();
    const second = (await screen.findAllByRole("combobox", { name: /第 \d+ 条的分类/ }))[1];
    await userEvent.selectOptions(second as HTMLSelectElement, "cat-transport");
    expect(screen.getByText("已按你的选择")).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "确认导入" }));
    await screen.findByText("已写入 2 条，跳过 0 条，失败 0 条");
    const expenses = await repositories.listV2Expenses("profile-v2", "2026-10");
    expect(
      expenses.map((expense) => [expense.amount, expense.occurredOn, expense.categoryId]),
    ).toEqual([
      ["35.00", "2026-10-01", "cat-food"],
      ["12.50", "2026-10-02", "cat-transport"],
    ]);
  });

  it("deduplicates an identical second import completely", async () => {
    renderImport();
    await uploadAlipay();
    await userEvent.click(await screen.findByRole("button", { name: "确认导入" }));
    await screen.findByText("已写入 2 条，跳过 0 条，失败 0 条");
    await userEvent.click(screen.getByRole("button", { name: "再导入一份" }));
    await uploadAlipay();
    await userEvent.click(await screen.findByRole("button", { name: "确认导入" }));
    const result = await screen.findByText(/已写入 0 条，跳过 2 条，失败 0 条/);
    expect(result.textContent?.replace(/\s+/g, "")).toContain("已写入0条，跳过2条，失败0条");
    expect(await repositories.listV2Expenses("profile-v2", "2026-10")).toHaveLength(2);
  });

  it("guides users when no active category or cash account exists", async () => {
    await db.execute("DELETE FROM expense_categories");
    renderImport();
    await uploadAlipay();
    expect((await screen.findAllByText("请先在记录页准备好分类和现金账户")).length).toBeGreaterThan(
      0,
    );
    expect((screen.getByRole("button", { name: "确认导入" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it("keeps candidates and shows an alert when writing fails", async () => {
    const spy = vi
      .spyOn(importService, "writeConfirmedImport")
      .mockRejectedValue(new Error("forced failure"));
    renderImport();
    await uploadAlipay();
    await userEvent.click(await screen.findByRole("button", { name: "确认导入" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("forced failure");
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.queryByText("已写入 2 条，跳过 0 条，失败 0 条")).toBeNull();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("shows a friendly empty message for an empty CSV", async () => {
    renderImport();
    const input = screen.getByLabelText("选择 CSV 文件");
    await userEvent.upload(input, new File([""], "empty.csv", { type: "text/csv" }));
    expect(await screen.findByText("没有识别到可导入的记录")).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });
});
