import { describe, expect, it } from "vitest";
import { summarizeSales, paymentBreakdown, dailyClosing, type SaleRecord } from "@/lib/pos/reports";

const now = new Date("2026-10-29T10:00:00Z");
const sale = (overrides: Partial<SaleRecord> = {}): SaleRecord => ({ id:"s", createdAt:now, subtotalKES:1000, discountKES:0, taxKES:0, totalKES:1000, paidKES:1000, balanceKES:0, ...overrides });

describe("sale-cohort refund snapshots", () => {
  it("deducts partial and full refunds exactly once and excludes voids", () => {
    const summary = summarizeSales([
      sale({ id:"partial", refundedKES:300 }),
      sale({ id:"full", status:"REFUNDED", refundedKES:1000 }),
      sale({ id:"void", status:"VOIDED", refundedKES:1000 }),
    ]);
    expect(summary).toMatchObject({ count:2, grossKES:2000, refundedKES:1300, netKES:700, paidKES:700, outstandingKES:0 });
  });
  it("separates credit reversals from cash returned", () => {
    const summary = summarizeSales([sale({ paidKES:400, balanceKES:600, refundedKES:500, creditRefundedKES:100 })]);
    expect(summary).toMatchObject({ refundedKES:500, netKES:500, paidKES:0, outstandingKES:500 });
  });
  it("nets settled outflows by original tender without changing drawer ledger", () => {
    const rows = [sale({ refundedKES:300, payments:[{ method:"cash", amountKES:400 }, { method:"mpesa", amountKES:600 }, { method:"cash", amountKES:300, direction:"OUT" }] })];
    expect(paymentBreakdown(rows)).toEqual([{ method:"mpesa", amountKES:600, count:1 }, { method:"cash", amountKES:100, count:2 }]);
    const closing = dailyClosing(rows, [], [
      { id:"1", createdAt:now, direction:"IN", purpose:"SALE", method:"cash", amountKES:400 },
      { id:"2", createdAt:now, direction:"OUT", purpose:"REFUND", method:"cash", amountKES:300 },
    ], now);
    expect(closing).toMatchObject({ cashInKES:400, cashOutKES:300, expectedCashKES:100 });
  });
});
