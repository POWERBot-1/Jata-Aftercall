import { describe, expect, it, vi } from "vitest";
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

  it("marks profit partial when any sale lacks cost, even if other sales have costs", () => {
    const base: SaleRecord = { id: "a", createdAt: new Date(), subtotalKES: 100, discountKES: 0, taxKES: 0, totalKES: 100, paidKES: 100, balanceKES: 0, costKES: 20 };
    expect(profitability([base, { ...base, id: "b", costKES: undefined, items: [{ name: "unknown", quantity: 1, totalKES: 100, costKES: null }] }], []).partial).toBe(true);
    expect(profitability([{ ...base, refundedKES: 10 }], []).partial).toBe(true);
  });
});
