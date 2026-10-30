import { afterEach, describe, expect, it, vi } from "vitest";
import { baselineConfiguration } from "@/lib/pos/configuration";
import { buildDashboardCards, loadCardSources } from "@/lib/pos/dashboard";
import * as store from "@/lib/pos/store";

afterEach(() => vi.restoreAllMocks());

describe("dashboard capped inputs and tender labels", () => {
  it("hides affected capped cards without hiding unrelated balances", async () => {
    vi.spyOn(store, "salesForReport").mockResolvedValue(Array.from({ length: 5000 }, () => ({})));
    vi.spyOn(store, "partiesWithBalances").mockResolvedValue([{ balanceKES: 100 }]);
    const config = baselineConfiguration();
    const keys = ["today_sales", "cash", "credit_owed"] as const;
    const sources = await loadCardSources("tenant-a", config, [...keys]);
    const cards = buildDashboardCards(config, "/pos", [...keys], sources);
    expect(cards.slice(0, 2).every((card) => card.value === "Unavailable" && card.hint.includes("5,000-record"))).toBe(true);
    expect(cards[2].value).toBe("KES 100");
  });

  it("shows current sale-cohort tender amounts, net of settled refunds, and does not call them a drawer balance", async () => {
    vi.spyOn(store, "salesForReport").mockResolvedValue([{
      id: "sale", createdAt: new Date(), status: "PARTIALLY_REFUNDED", totalKES: 100, paidKES: 100, refundedKES: 40,
      payments: [{ method: "cash", amountKES: 40, direction: "IN", status: "SETTLED" }, { method: "mpesa", amountKES: 60, direction: "IN", status: "SETTLED" }, { method: "cash", amountKES: 40, direction: "OUT", status: "SETTLED" }, { method: "mpesa", amountKES: 20, direction: "OUT", status: "PENDING" }], items: [],
    }]);
    const config = baselineConfiguration();
    const keys = ["cash", "mpesa"] as const;
    const sources = await loadCardSources("tenant-a", config, [...keys]);
    const [cash, mpesa] = buildDashboardCards(config, "/pos", [...keys], sources);
    expect(cash.value).toBe("KES 0");
    expect(cash.hint).toContain("not the drawer balance");
    expect(mpesa.value).toBe("KES 60");
    expect(mpesa.hint).toContain("not a settlement statement");
  });
});
