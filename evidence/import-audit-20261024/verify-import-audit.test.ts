import { describe, expect, it } from "vitest";
import { parseImportFile, dedupeImportCandidates, confirmImportBatch } from "../src/model/v2-import.js";

// Real Alipay export header (from data/consumption-exports-20261021/parse_alipay.py)
const REAL_ALIPAY_UTF8 = [
  "支付宝交易记录明细查询",
  "账号:[zhi***@lkcoffee.com]",
  "交易时间,分类,交易对方,对方账号,商品说明,收支,金额,收/付款方式,交易状态,交易单号,商家订单号",
  "2026-10-21 14:08:38,餐饮美食,luckincoffee,zhi***@lkcoffee.com,订单付款,支出,9.90,余额宝,交易成功,2026102123001465291441834603,10120296861092269057",
].join("\n");

// Same rows but with the app's self-invented columns, real date format
const APP_COLS_REAL_DATE = [
  "交易号,交易时间,交易对方,金额,收支,备注",
  "2026102123001465291441834603,2026-10-21 14:08:38,luckincoffee,9.90,支出,订单付款",
].join("\n");

// App columns + ISO date + a transfer row and a credit-card repayment row
const APP_COLS_TRANSFER = [
  "交易号,交易时间,交易对方,金额,收支,备注",
  "t1,2026-10-01T10:00:00+08:00,张三（转账红包）,500.00,支出,转账",
  "t2,2026-10-02T10:00:00+08:00,招商银行信用卡还款,3000.00,支出,还款",
  "t3,2026-10-03T10:00:00+08:00,退款商户,9.90,收入,退款",
].join("\n");

describe("import-audit runtime verification", () => {
  it("REAL bill export with vendor header is rejected (missing columns)", () => {
    const rows = parseImportFile(REAL_ALIPAY_UTF8, "ALIPAY_CSV", "b1");
    expect(rows).toHaveLength(1);
    expect(rows[0].reviewStatus).toBe("ERROR");
    expect(rows[0].validationErrors[0]).toMatch(/missing/i);
  });

  it("gb18030 real bill decoded as UTF-8 produces mojibake header and is rejected", () => {
    // encode the real header as gb18030 bytes, then UTF-8 decode like File.text() does
    const gbBytes = new Uint8Array([0xb6, 0xa9, 0xd6, 0xa7, 0xb1, 0xa6]); // 支付宝 in gb18030-ish
    const mojibake = new TextDecoder("utf-8").decode(gbBytes);
    const rows = parseImportFile(`${mojibake},分类,交易对方\nx,y,z`, "ALIPAY_CSV", "b2");
    expect(rows[0].reviewStatus).toBe("ERROR");
  });

  it("real date format YYYY-MM-DD HH:MM:SS is rejected even with app columns", () => {
    const rows = parseImportFile(APP_COLS_REAL_DATE, "ALIPAY_CSV", "b3");
    expect(rows[0].reviewStatus).toBe("ERROR");
    expect(rows[0].validationErrors.join(" ")).toMatch(/Invalid transaction time/);
  });

  it("transfer and credit-card-repayment rows pass as ordinary EXPENSE consumption", () => {
    const rows = parseImportFile(APP_COLS_TRANSFER, "ALIPAY_CSV", "b4");
    const transfer = rows[0];
    const repayment = rows[1];
    expect(transfer.reviewStatus).toBe("PENDING");
    expect(transfer.direction).toBe("EXPENSE");
    expect(repayment.reviewStatus).toBe("PENDING");
    expect(repayment.direction).toBe("EXPENSE");
    const { confirmed } = confirmImportBatch([transfer, repayment]);
    expect(confirmed).toHaveLength(2); // both would be written as consumption
  });

  it("refund row (direction=收入) cannot be imported as income at all", () => {
    const rows = parseImportFile(APP_COLS_TRANSFER, "ALIPAY_CSV", "b5");
    const refund = rows[2];
    expect(refund.direction).toBe("INCOME");
  });

  it("cross-channel same payment is NOT deduplicated", () => {
    const alipay = parseImportFile(
      "交易号,交易时间,交易对方,金额,收支,备注\nsame-pay,2026-10-01T10:00:00+08:00,星巴克,38.00,支出,咖啡",
      "ALIPAY_CSV", "b6",
    );
    const wechat = parseImportFile(
      "交易单号,交易时间,交易对方,金额(元),收/支,备注\nwx-other-id,2026-10-01T10:00:00+08:00,星巴克,38.00,支出,咖啡",
      "WECHAT_CSV", "b7",
    );
    const keys = new Set(alipay.map((r) => r.dedupeKey));
    const { toImport, skipped } = dedupeImportCandidates(wechat, keys);
    expect(toImport).toHaveLength(1); // NOT treated as duplicate of the same payment
    expect(skipped).toHaveLength(0);
  });
});
