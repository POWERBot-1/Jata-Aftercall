import { afterEach, describe, expect, it, vi } from "vitest";
import { baselineConfiguration } from "@/lib/pos/configuration";
import { ReportLimitError, runDailyClosing, runReport } from "@/lib/pos/reporting";
import * as store from "@/lib/pos/store";

afterEach(() => vi.restoreAllMocks());

describe("report safety limits", () => {
  it("refuses sales cohort totals at the ambiguous cap instead of silently omitting later sales", async () => {
    vi.spyOn(store, "salesForReport").mockResolvedValue(Array.from({ length: 5000 }, () => ({})));
    const config = baselineConfiguration();
    config.capabilities.push("daily_sales");
    await expect(runReport("tenant", config, "daily_sales")).rejects.toBeInstanceOf(ReportLimitError);
  });

  it("refuses a drawer closing when the payment ledger reaches its cap", async () => {
    vi.spyOn(store, "salesForReport").mockResolvedValue([]);
    vi.spyOn(store, "expensesForReport").mockResolvedValue([]);
    vi.spyOn(store, "paymentsForReport").mockResolvedValue(Array.from({ length: 5000 }, () => ({})));
    await expect(runDailyClosing("tenant", baselineConfiguration())).rejects.toThrow(/5,000-record safety limit/);
  });

  it("refuses credit ageing when capped entries could leave accounts with unknown ages", async () => {
    const client = {
      posCustomer: { findMany: vi.fn().mockResolvedValue([{ id: "customer", balanceKES: 1 }]) },
      posCreditEntry: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 5000 }, () => ({ partyId: "other", createdAt: new Date() }))) },
    };
    await expect(store.partiesWithBalances("tenant", "CUSTOMER", client, { requireComplete: true })).rejects.toBeInstanceOf(ReportLimitError);
  });

  it("continues to calculate closing when all inputs are below the cap", async () => {
    vi.spyOn(store, "salesForReport").mockResolvedValue([]);
    vi.spyOn(store, "expensesForReport").mockResolvedValue([]);
    vi.spyOn(store, "paymentsForReport").mockResolvedValue([]);
    const closing = await runDailyClosing("tenant", baselineConfiguration());
    expect(closing.expectedCashKES).toBe(0);
  });
});
