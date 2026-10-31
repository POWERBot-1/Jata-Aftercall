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
      posCreditEntry: { findMany: vi.fn().mockResolvedValue(Array.from({ length: 5001 }, () => ({ partyId: "other", createdAt: new Date() }))) },
    };
    await expect(store.partiesWithBalances("tenant", "CUSTOMER", client, { requireComplete: true })).rejects.toBeInstanceOf(ReportLimitError);
  });

  it("reconciles complete party ledgers and returns separate FIFO lots", async () => {
    const first = new Date("2020-01-01T00:00:00Z"), last = new Date("2021-01-01T00:00:00Z");
    const findMany = vi.fn().mockResolvedValue([
      { partyId: "customer", direction: "DEBIT", amountKES: 100, createdAt: first },
      { partyId: "customer", direction: "CREDIT", amountKES: 60, createdAt: first },
      { partyId: "customer", direction: "DEBIT", amountKES: 50, createdAt: last },
    ]);
    const client = { posCustomer: { findMany: vi.fn().mockResolvedValue([{ id: "customer", balanceKES: 90 }]) }, posCreditEntry: { findMany } };
    const [party] = await store.partiesWithBalances("tenant", "CUSTOMER", client, { requireComplete: true });
    expect(party.oldestEntryAt).toEqual(first);
    expect(party.unpaidLots).toEqual([{ createdAt: first, amountKES: 40 }, { createdAt: last, amountKES: 50 }]);
    expect(findMany.mock.calls[0][0].where).toEqual({ businessId: "tenant", partyType: "CUSTOMER" });
    expect(client.posCustomer.findMany.mock.calls[0][0].where.OR).toContainEqual({ balanceKES: { gt: 0 } });
    client.posCustomer.findMany.mockResolvedValue([{ id: "customer", balanceKES: 89 }]);
    await expect(store.partiesWithBalances("tenant", "CUSTOMER", client, { requireComplete: true })).rejects.toThrow(/does not reconcile/);
  });

  it("continues to calculate closing when all inputs are below the cap", async () => {
    vi.spyOn(store, "salesForReport").mockResolvedValue([]);
    vi.spyOn(store, "expensesForReport").mockResolvedValue([]);
    vi.spyOn(store, "paymentsForReport").mockResolvedValue([]);
    const closing = await runDailyClosing("tenant", baselineConfiguration());
    expect(closing.expectedCashKES).toBe(0);
    expect(closing.netCashMovementKES).toBe(0);
    expect(closing.cashMovementNotice).toContain("not an expected drawer balance");
    expect(closing.summary).toEqual(expect.arrayContaining([{ label: "Net settled cash movement (not drawer balance)", value: "KES 0" }]));
  });
});
