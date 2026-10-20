// @vitest-environment happy-dom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { V2ExpenseService } from "../../src/application/v2-expense-service.js";
import type { V2ImportService } from "../../src/application/v2-import-service.js";
import type { Repositories } from "../../src/persistence/repositories.js";
import { V2Surface } from "../../src/ui/v2-surface.js";

const repositories = {
  listExpenseCategories: vi.fn().mockResolvedValue([]),
  listAccounts: vi.fn().mockResolvedValue([]),
  listV2Expenses: vi.fn().mockResolvedValue([]),
} as unknown as Repositories;

const importService = {} as unknown as V2ImportService;
const expenseService = {
  recordCashDebitExpense: vi.fn(),
  getMonthSummary: vi.fn().mockResolvedValue({ dailyExpenseTotal: "0.00", billStatuses: [] }),
} as unknown as V2ExpenseService;

function renderSurface() {
  return render(
    <V2Surface
      expenseService={expenseService}
      importService={importService}
      repositories={repositories}
      profileId="profile-v2"
    />,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EXEC-U-02 isolated V2 navigation surface", () => {
  it("renders the four navigation tabs with today active by default", async () => {
    renderSurface();
    for (const label of ["今天", "记录", "进展", "我的"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "今天" }).className).toContain("is-active");
    expect(await screen.findByText("记下第一笔花销")).toBeTruthy();
    expect(await screen.findByText("这个月")).toBeTruthy();
    expect(screen.queryByLabelText("快速记账")).toBeNull();
    expect(screen.queryByText("导入功能即将开放")).toBeNull();
  });

  it("switches to the quick entry page when Record is selected", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "记录" }));
    expect(await screen.findByLabelText("快速记账")).toBeTruthy();
    expect(screen.getByLabelText("金额")).toBeTruthy();
    expect(screen.queryByText("这个月")).toBeNull();
  });

  it("shows the import entry on Mine", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "我的" }));
    expect(await screen.findByLabelText("选择 CSV 文件")).toBeTruthy();
    expect(screen.queryByText("导入功能即将开放")).toBeNull();
    expect(screen.queryByText("这个月")).toBeNull();
  });

  it("opens the record page from the top record button", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "记一笔" }));
    expect(await screen.findByLabelText("快速记账")).toBeTruthy();
    expect(screen.getByRole("button", { name: "记录" }).className).toContain("is-active");
    expect(screen.getByLabelText("金额")).toBeTruthy();
  });

  it("routes the today task CTA to the record page and focuses amount", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(await screen.findByRole("button", { name: "去记录" }));
    expect(await screen.findByLabelText("快速记账")).toBeTruthy();
    expect(screen.getByRole("button", { name: "记录" }).className).toContain("is-active");
    await waitFor(() => expect(document.activeElement).toBe(screen.getByLabelText("金额")));
  });

  it("shows the progress path on Progress", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "进展" }));
    expect(await screen.findByText("看清消费")).toBeTruthy();
    expect(screen.getByText("本月已花 ¥0.00")).toBeTruthy();
    expect(screen.getAllByText("即将开放")).toHaveLength(3);
  });
});
