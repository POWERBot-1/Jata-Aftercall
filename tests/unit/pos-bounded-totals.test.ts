import { describe, expect, it, vi } from "vitest";
import { expenseTotals, topItems } from "@/lib/pos/store";

describe("bounded POS summaries", () => {
  it("aggregates expense categories in the database with tenant, branch and date scope", async () => {
    const groupBy = vi.fn().mockResolvedValue([{ categoryKey: "rent", _sum: { amountKES: 12345 } }, { categoryKey: "other", _sum: { amountKES: 100 } }]);
    const from = new Date("2026-01-01T00:00:00Z");
    const to = new Date("2026-01-31T23:59:59Z");
    const result = await expenseTotals("business-a", { from, to }, { posExpense: { groupBy } }, { branchId: "branch-a" });
    expect(result.amountKES).toBe(12445);
    expect(groupBy).toHaveBeenCalledWith({ by: ["categoryKey"], where: { businessId: "business-a", branchId: "branch-a", occurredAt: { gte: from, lte: to } }, _sum: { amountKES: true } });
  });

  it("refuses to rank top items after exceeding the sale sample limit", async () => {
    const findMany = vi.fn().mockResolvedValue(Array.from({ length: 2001 }, (_, i) => ({ id: `${i}` })));
    const items = vi.fn();
    const result = await topItems("business-a", {}, 8, { posSale: { findMany }, posSaleItem: { findMany: items } });
    expect(result).toBeNull();
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { businessId: "business-a" }, take: 2001 }));
    expect(items).not.toHaveBeenCalled();
  });
});
