import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyCandidateEdits,
  confirmImportBatch,
  dedupeImportCandidates,
  parseImportFile,
} from "../../src/model/v2-import.js";

const alipayContent = readFileSync("tests/fixtures/v2-import/sample-alipay-export.csv", "utf8");
const wechatContent = readFileSync("tests/fixtures/v2-import/sample-wechat-export.csv", "utf8");

describe("EXEC-I-03 official CSV import parse, preview, and dedupe", () => {
  it("parses the Alipay sample into two exact expense candidates", () => {
    const candidates = parseImportFile(alipayContent, "ALIPAY_CSV", "batch-alipay");
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.amount)).toEqual(["35.00", "12.50"]);
    expect(candidates.map((candidate) => candidate.businessDate)).toEqual([
      "2026-10-01",
      "2026-10-02",
    ]);
    expect(candidates.every((candidate) => candidate.direction === "EXPENSE")).toBe(true);
    expect(candidates.every((candidate) => candidate.reviewStatus === "PENDING")).toBe(true);
    expect(candidates[0]?.dedupeKey).toBe("ALIPAY_CSV:synthetic-alipay-001:35.00:2026-10-01");
    expect(candidates[1]?.dedupeKey).toBe("ALIPAY_CSV:synthetic-alipay-002:12.50:2026-10-02");
  });

  it("parses the WeChat sample into two exact expense candidates", () => {
    const candidates = parseImportFile(wechatContent, "WECHAT_CSV", "batch-wechat");
    expect(candidates).toHaveLength(2);
    expect(candidates.map((candidate) => candidate.amount)).toEqual(["48.00", "80.00"]);
    expect(candidates.map((candidate) => candidate.businessDate)).toEqual([
      "2026-10-03",
      "2026-10-04",
    ]);
    expect(candidates[0]?.dedupeKey).toBe("WECHAT_CSV:synthetic-wechat-001:48.00:2026-10-03");
    expect(candidates[1]?.dedupeKey).toBe("WECHAT_CSV:synthetic-wechat-002:80.00:2026-10-04");
  });

  it("marks income as INCOME and keeps it available for preview without treating it as an expense", () => {
    const content = [
      "交易号,交易时间,交易对方,金额,收支,备注",
      "income-001,2026-10-05T10:00:00+08:00,合成收入,100.00,收入,工资",
    ].join("\n");
    const candidates = parseImportFile(content, "ALIPAY_CSV", "batch-income");
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.direction).toBe("INCOME");
    expect(candidates[0]?.reviewStatus).toBe("PENDING");
    expect(candidates[0]?.validationErrors).toEqual([]);
  });

  it("deduplicates an identical file completely against existing keys", () => {
    const first = parseImportFile(alipayContent, "ALIPAY_CSV", "batch-first");
    const firstKeys = new Set(first.map((candidate) => candidate.dedupeKey));
    const second = parseImportFile(alipayContent, "ALIPAY_CSV", "batch-second");
    const result = dedupeImportCandidates(second, firstKeys);
    expect(result.skipped).toHaveLength(second.length);
    expect(result.toImport).toHaveLength(0);
    expect(result.skipped.every((candidate) => candidate.reviewStatus === "SKIPPED")).toBe(true);
  });

  it("edits candidates immutably and updates review status and dedupe key", () => {
    const [candidate] = parseImportFile(alipayContent, "ALIPAY_CSV", "batch-edit");
    if (!candidate) throw new Error("candidate missing");
    const edited = applyCandidateEdits(candidate, {
      category: "cat-food",
      accountId: "cash-1",
      note: "用户修改备注",
      businessDate: "2026-10-03",
    });
    expect(Object.is(candidate, edited)).toBe(false);
    expect(edited.category).toBe("cat-food");
    expect(edited.accountId).toBe("cash-1");
    expect(edited.note).toBe("用户修改备注");
    expect(edited.businessDate).toBe("2026-10-03");
    expect(edited.reviewStatus).toBe("EDITED");
    expect(edited.dedupeKey).toBe("ALIPAY_CSV:synthetic-alipay-001:35.00:2026-10-03");
    expect(candidate.category).toBeNull();
    expect(candidate.accountId).toBeNull();
    expect(candidate.note).toBe("合成样例");
    expect(candidate.businessDate).toBe("2026-10-01");
  });

  it("does not crash on unknown columns, empty lines, malformed rows, or invalid money", () => {
    const content = [
      "交易号,交易时间,交易对方,金额,收支,备注,未知列",
      "bad-001,2026-10-06T10:00:00+08:00,商户,¥3.5,支出,备注,unknown",
      "bad-002,invalid-time,商户,-1.00,支出,备注",
      "bad-003,2026-10-07T10:00:00+08:00,商户,1.234,其他",
    ].join("\n\n");
    const candidates = parseImportFile(content, "ALIPAY_CSV", "batch-errors");
    expect(candidates).toHaveLength(3);
    expect(candidates.every((candidate) => candidate.reviewStatus === "ERROR")).toBe(true);
    expect(candidates.every((candidate) => candidate.validationErrors.length > 0)).toBe(true);
    expect(candidates[0]?.validationErrors.join(" ")).toContain("Unknown columns: 未知列.");
    expect(candidates[1]?.validationErrors.join(" ")).toContain("Invalid transaction time");
    expect(candidates[2]?.validationErrors.join(" ")).toContain("Invalid amount");
  });

  it("confirms pending and edited rows while skipping error rows", () => {
    const candidates = parseImportFile(alipayContent, "ALIPAY_CSV", "batch-confirm");
    const first = candidates[0];
    const second = candidates[1];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    if (!first || !second) throw new Error("expected two parsed candidates");
    const edited = applyCandidateEdits(first, { note: "edited" });
    const errorCandidate = { ...second, reviewStatus: "ERROR" as const };
    const result = confirmImportBatch([edited, errorCandidate]);
    expect(result.confirmed).toHaveLength(1);
    expect(result.skipped).toHaveLength(1);
    expect(result.confirmed[0]?.reviewStatus).toBe("CONFIRMED");
    expect(result.skipped[0]?.reviewStatus).toBe("ERROR");
  });

  it("uses Decimal validation without floating-point loss", () => {
    const content = [
      "交易号,交易时间,交易对方,金额,收支,备注",
      "precision-001,2026-10-08T10:00:00+08:00,精度商户,¥999999999999.99,支出,精度",
    ].join("\n");
    const [candidate] = parseImportFile(content, "ALIPAY_CSV", "batch-precision");
    expect(candidate?.amount).toBe("999999999999.99");
    expect(candidate?.validationErrors).toEqual([]);
  });
});
