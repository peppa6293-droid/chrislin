import { describe, expect, it, vi } from "vitest";
import {
  applyTemplate,
  repeatLastEntry,
  resolveQuickEntryPermission,
  submitQuickEntry,
} from "../../src/model/v2-quick-entry.js";

describe("isolated V2 quick entry", () => {
  it("saves through mock IPC within the 3-5 second target", async () => {
    const saveExpense = vi.fn().mockResolvedValue(undefined);
    const result = await submitQuickEntry(
      { saveExpense },
      { amount: "20.00", categoryId: "food", accountId: "cash" },
      1000,
      4200,
    );
    expect(saveExpense).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ feedback: "saved", elapsedMs: 3200 });
  });
  it("falls back inline when permission is denied or unsupported", () => {
    expect(resolveQuickEntryPermission("denied")).toEqual({
      canOpen: true,
      message: expect.stringContaining("应用内"),
    });
    expect(resolveQuickEntryPermission("unsupported")).toEqual({
      canOpen: true,
      message: expect.stringContaining("应用内"),
    });
  });
  it("supports repeat-last and templates without mutating source", () => {
    const draft = { amount: "8.00", categoryId: "coffee", accountId: "cash" };
    const repeated = repeatLastEntry(draft);
    const templated = applyTemplate({ id: "t1", name: "早餐", draft });
    expect(repeated).toEqual(draft);
    expect(templated).toEqual(draft);
    expect(repeated).not.toBe(draft);
  });
  it("returns clear failure feedback", async () => {
    const result = await submitQuickEntry(
      { saveExpense: vi.fn().mockRejectedValue(new Error("synthetic")) },
      { amount: "1.00", categoryId: "x", accountId: "cash" },
      0,
      100,
    );
    expect(result).toMatchObject({
      feedback: "failed",
      inlineMessage: expect.stringContaining("保存失败"),
    });
  });
});
