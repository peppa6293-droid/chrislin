// @vitest-environment happy-dom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { V2ExpenseService } from "../../src/application/v2-expense-service.js";
import { V2Progress } from "../../src/ui/v2-progress.js";

function makeService(result: Promise<{ dailyExpenseTotal: string }>): V2ExpenseService {
  return { getMonthSummary: vi.fn(() => result) } as unknown as V2ExpenseService;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EXEC-U-04 V2 progress path", () => {
  it("shows the real monthly amount on the first node", async () => {
    render(<V2Progress expenseService={makeService(Promise.resolve({ dailyExpenseTotal: "500.00" }))} profileId="profile-v2" />);
    expect(await screen.findByText("本月已花 ¥500.00")).toBeTruthy();
    expect(screen.getByText("暂无上月数据")).toBeTruthy();
  });

  it("renders three placeholder nodes without crashing", async () => {
    render(<V2Progress expenseService={makeService(Promise.resolve({ dailyExpenseTotal: "0.00" }))} profileId="profile-v2" />);
    await screen.findByText("本月已花 ¥0.00");
    expect(screen.getAllByText("即将开放")).toHaveLength(3);
    for (const title of ["稳住现金", "理清责任", "建立余地"]) {
      expect(screen.getByRole("heading", { name: title })).toBeTruthy();
    }
  });

  it("does not show danger or score-based status", async () => {
    const { container } = render(
      <V2Progress expenseService={makeService(Promise.resolve({ dailyExpenseTotal: "500.00" }))} profileId="profile-v2" />,
    );
    await screen.findByText("本月已花 ¥500.00");
    expect(container.className).not.toContain("danger");
    expect(container.textContent).not.toContain("/100");
    expect(container.textContent).not.toContain("分");
  });

  it("shows loading while data is pending", () => {
    render(
      <V2Progress
        expenseService={makeService(new Promise(() => {}))}
        profileId="profile-v2"
      />,
    );
    expect(screen.getByText("加载中…")).toBeTruthy();
  });

  it("shows the error state when loading fails", async () => {
    render(<V2Progress expenseService={makeService(Promise.reject(new Error("load failed")))} profileId="profile-v2" />);
    expect(await screen.findByText("数据加载失败，请重试。")).toBeTruthy();
  });
});
