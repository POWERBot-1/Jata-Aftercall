import { describe, expect, it, vi } from "vitest";
import { verifiedStatement, RECEIVABLE, PAYABLE } from "@/lib/pos/credit";
import { oldestCreditDebit } from "@/lib/pos/store";
import { profitability, type SaleRecord } from "@/lib/pos/reports";

describe("credit and profit completeness", () => {
  it("asks for the earliest debit within the correct tenant and party, not the newest page", async () => {
    const findFirst = vi.fn().mockResolvedValue({ createdAt: new Date("2020-01-01T00:00:00Z") });
    await oldestCreditDebit("tenant", "CUSTOMER", "customer", { posCreditEntry: { findFirst } });
    expect(findFirst).toHaveBeenCalledWith({
      where: { businessId: "tenant", partyType: "CUSTOMER", partyId: "customer", direction: "DEBIT" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { createdAt: true },
    });
  });

  it("refuses inconsistent, invalid, or incomplete statements instead of inventing balances", () => {
    const entries = [
      { id: "a", partyId: "one", direction: "DEBIT", amountKES: 100, createdAt: new Date("2025-01-01Z") },
      { id: "b", partyId: "one", direction: "CREDIT", amountKES: 40, createdAt: new Date("2025-02-01Z") },
    ];
    for (const type of [RECEIVABLE, PAYABLE]) {
      expect(verifiedStatement(entries, type, 60).statement?.closingBalanceKES).toBe(60);
      expect(verifiedStatement(entries, type, 59).notice).toContain("does not reconcile");
      expect(verifiedStatement([{ ...entries[0], direction: "UNKNOWN" }], type, 100).statement).toBeNull();
      expect(verifiedStatement([{ ...entries[0], amountKES: 1.5 }], type, 1).statement).toBeNull();
      expect(verifiedStatement(Array.from({ length: 201 }, () => entries[0]), type, 20100).notice).toContain("more than 200");
    }
  });

  it("marks profit partial when any sale lacks cost, even if other sales have costs", () => {
    const base: SaleRecord = { id: "a", createdAt: new Date(), subtotalKES: 100, discountKES: 0, taxKES: 0, totalKES: 100, paidKES: 100, balanceKES: 0, costKES: 20 };
    expect(profitability([base, { ...base, id: "b", costKES: undefined, items: [{ name: "unknown", quantity: 1, totalKES: 100, costKES: null }] }], []).partial).toBe(true);
    expect(profitability([{ ...base, refundedKES: 10 }], []).partial).toBe(true);
  });
});
