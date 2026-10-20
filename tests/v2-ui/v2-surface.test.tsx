// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { V2ExpenseService } from "../../src/application/v2-expense-service.js";
import type { Repositories } from "../../src/persistence/repositories.js";
import { V2Surface } from "../../src/ui/v2-surface.js";

const repositories = {
  listExpenseCategories: vi.fn().mockResolvedValue([]),
  listAccounts: vi.fn().mockResolvedValue([]),
} as unknown as Repositories;

const expenseService = {
  recordCashDebitExpense: vi.fn(),
} as unknown as V2ExpenseService;

function renderSurface() {
  return render(
    <V2Surface
      expenseService={expenseService}
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
  it("renders the four navigation tabs with today active by default", () => {
    renderSurface();
    for (const label of ["今天", "记录", "进展", "我的"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "今天" }).className).toContain("is-active");
    expect(screen.getByTestId("v2-dashboard")).toBeTruthy();
    expect(screen.queryByLabelText("快速记账")).toBeNull();
    expect(screen.queryByText("导入功能即将开放")).toBeNull();
  });

  it("switches to the quick entry page when Record is selected", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "记录" }));
    expect(await screen.findByLabelText("快速记账")).toBeTruthy();
    expect(screen.getByLabelText("金额")).toBeTruthy();
    expect(screen.queryByTestId("v2-dashboard")).toBeNull();
  });

  it("shows the import placeholder on Mine", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "我的" }));
    expect(await screen.findByText("导入功能即将开放")).toBeTruthy();
    expect(screen.queryByTestId("v2-dashboard")).toBeNull();
  });

  it("opens the record page from the top record button", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "记一笔" }));
    expect(await screen.findByLabelText("快速记账")).toBeTruthy();
    expect(screen.getByRole("button", { name: "记录" }).className).toContain("is-active");
    expect(screen.getByLabelText("金额")).toBeTruthy();
  });

  it("shows the synthetic trend baseline on Progress", async () => {
    const user = userEvent.setup();
    renderSurface();
    await user.click(screen.getByRole("button", { name: "进展" }));
    expect(await screen.findByTestId("v2-trend-panel")).toBeTruthy();
    expect(screen.getByText("还没有可展示的收支记录。")).toBeTruthy();
  });
});
