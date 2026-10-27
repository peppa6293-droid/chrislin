import { describe, expect, it } from "vitest";
import {
  detectImportProvider,
  LOW_CONFIDENCE_THRESHOLD,
  needsReview,
  suggestAccount,
  suggestCategory,
} from "../../src/model/import-rules.js";

const categories = [
  { id: "cat-food", name: "餐饮" },
  { id: "cat-transport", name: "交通" },
  { id: "cat-household", name: "日用" },
];
const accounts = [
  { id: "acc-alipay", name: "支付宝" },
  { id: "acc-cash", name: "现金" },
];

describe("import-rules (local only)", () => {
  it("resolves a merchant keyword to the user's own category with its confidence", () => {
    expect(suggestCategory("美团外卖", categories)).toEqual({
      categoryId: "cat-food",
      categoryName: "餐饮",
      confidence: 0.95,
      matched: "美团",
    });
  });

  it("resolves partial matches in the settled confidence band", () => {
    const suggestion = suggestCategory("盒马鲜生", categories);
    expect(suggestion?.categoryId).toBe("cat-household");
    expect(suggestion?.confidence).toBe(0.85);
    expect(needsReview(suggestion)).toBe(false);
  });

  it("returns null when no keyword or no matching category exists", () => {
    expect(suggestCategory("合成交通服务", categories)).toBeNull();
    expect(suggestCategory("美团外卖", [])).toBeNull();
    expect(suggestCategory("美团外卖", [{ id: "x", name: "完全无关" }])).toBeNull();
    expect(needsReview(null)).toBe(true);
  });

  it("treats confidence at or above the threshold as settled", () => {
    expect(
      needsReview({
        categoryId: "a",
        categoryName: "a",
        confidence: LOW_CONFIDENCE_THRESHOLD,
        matched: "k",
      }),
    ).toBe(false);
  });

  it("picks the account that the row text mentions", () => {
    expect(suggestAccount("支付宝快捷支付", accounts)).toBe("acc-alipay");
    expect(suggestAccount("微信支付", accounts)).toBeNull();
  });

  it("detects the provider from the CSV header", () => {
    expect(detectImportProvider("交易号,交易时间,交易对方\n1,2026-10-01,店")).toBe("ALIPAY_CSV");
    expect(detectImportProvider("交易单号,交易时间,金额(元)\n1,2026-10-01,35")).toBe("WECHAT_CSV");
    expect(detectImportProvider("foo,bar\n1,2")).toBeNull();
  });
});
