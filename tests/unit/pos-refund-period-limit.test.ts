import { afterEach, describe, expect, it, vi } from "vitest";
import { baselineConfiguration } from "@/lib/pos/configuration";
import { runReport } from "@/lib/pos/reporting";
import * as store from "@/lib/pos/store";

const from = new Date("2026-10-29T00:00:00Z");
const to = new Date("2026-10-29T23:59:59.999Z");

afterEach(() => vi.restoreAllMocks());

describe("period refund payout report", () => {
  it("filters tenant, branch, period and refund purpose before applying a deterministic limit", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await store.refundPayoutsForReport("business-a", { from, to }, { posPayment: { findMany } }, { branchId: "branch-a" });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { businessId: "business-a", branchId: "branch-a", status: "SETTLED", direction: "OUT", purpose: "REFUND", createdAt: { gte: from, lte: to } },
      take: 5001,
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }));
  });

  it("explicitly warns and sums only displayed rows when payout rows exceed the limit", async () => {
    const row = { id: "p", saleId: "s", createdAt: from, method: "cash", amountKES: 2 };
    vi.spyOn(store, "refundPayoutsForReport").mockResolvedValue(Array.from({ length: 5001 }, (_, i) => ({ ...row, id: `p${i}` })));
    const config = baselineConfiguration();
    config.capabilities.push("refunds");
    const report = await runReport("business-a", config, "refunds", { from, to });
    expect(report.partial).toBe(true);
    expect(report.rows).toHaveLength(5000);
    expect(report.summary).toEqual(expect.arrayContaining([{ label: "Settled refund payouts", value: "KES 10,000" }]));
    expect(report.notice).toContain("More than 5,000 refund payouts match");
    expect(report.notice).toContain("only the first 5,000 are shown and summed");
  });
});
