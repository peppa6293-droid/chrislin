import { describe, expect, it } from "vitest";
import {
  isRecordTask,
  selectTodayTask,
  TASK_COPY,
  type TaskContext,
} from "../../src/model/v2-task-selector.js";

const base: TaskContext = {
  hasStructuralDeficit: false,
  belowCashFloor: false,
  consumptionIsPrimaryDrag: false,
  hasMissingDebtFact: false,
  hasSafetyGap: false,
  monthExpenseCount: 3,
};

describe("U-05 deterministic task selector", () => {
  it("selects each single rule with the expected priority", () => {
    expect(selectTodayTask({ ...base, hasStructuralDeficit: true })).toBe("CLARIFY_GAP");
    expect(selectTodayTask({ ...base, belowCashFloor: true })).toBe("SECURE_CASH");
    expect(selectTodayTask({ ...base, consumptionIsPrimaryDrag: true })).toBe("RECORD_EXPENSE");
    expect(selectTodayTask({ ...base, consumptionIsPrimaryDrag: true, monthExpenseCount: 0 })).toBe(
      "DEFAULT_RECORD",
    );
    expect(selectTodayTask({ ...base, hasMissingDebtFact: true })).toBe("CONFIRM_DEBT");
    expect(selectTodayTask({ ...base, hasSafetyGap: true })).toBe("CHECK_SAFETY");
  });

  it("enforces adjacent suppression relationships", () => {
    expect(selectTodayTask({ ...base, hasStructuralDeficit: true, belowCashFloor: true })).toBe(
      "CLARIFY_GAP",
    );
    expect(selectTodayTask({ ...base, belowCashFloor: true, consumptionIsPrimaryDrag: true })).toBe(
      "SECURE_CASH",
    );
    expect(
      selectTodayTask({ ...base, consumptionIsPrimaryDrag: true, hasMissingDebtFact: true }),
    ).toBe("RECORD_EXPENSE");
    expect(selectTodayTask({ ...base, hasMissingDebtFact: true, hasSafetyGap: true })).toBe(
      "CONFIRM_DEBT",
    );
    expect(
      selectTodayTask({
        hasStructuralDeficit: true,
        belowCashFloor: true,
        consumptionIsPrimaryDrag: true,
        hasMissingDebtFact: true,
        hasSafetyGap: true,
        monthExpenseCount: 3,
      }),
    ).toBe("CLARIFY_GAP");
  });

  it("returns the record task for a clean context based on expense count", () => {
    expect(selectTodayTask({ ...base, monthExpenseCount: 0 })).toBe("DEFAULT_RECORD");
    expect(selectTodayTask(base)).toBe("RECORD_EXPENSE");
  });

  it("classifies record tasks correctly", () => {
    expect(isRecordTask("RECORD_EXPENSE")).toBe(true);
    expect(isRecordTask("DEFAULT_RECORD")).toBe(true);
    for (const taskId of ["CLARIFY_GAP", "SECURE_CASH", "CONFIRM_DEBT", "CHECK_SAFETY"] as const) {
      expect(isRecordTask(taskId)).toBe(false);
    }
  });

  it("keeps the copy table complete without duplicate navigation CTA", () => {
    const expectedKeys = new Set([
      "CLARIFY_GAP",
      "SECURE_CASH",
      "CONFIRM_DEBT",
      "CHECK_SAFETY",
      "RECORD_EXPENSE",
      "DEFAULT_RECORD",
    ]);
    expect(new Set(Object.keys(TASK_COPY))).toEqual(expectedKeys);
    for (const copy of Object.values(TASK_COPY)) {
      expect(copy.title.trim()).not.toBe("");
      expect(copy.reason.trim()).not.toBe("");
      expect(copy.duration.trim()).not.toBe("");
      expect(copy.action.trim()).not.toBe("");
      expect(copy.action).not.toBe("记一笔");
    }
  });
});
