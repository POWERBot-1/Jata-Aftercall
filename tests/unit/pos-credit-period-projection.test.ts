import { describe, expect, it } from "vitest";
import { CreditPeriodError, projectCreditPeriod } from "@/lib/pos/credit-period";

const row = (partyType: string, partyId: string, direction: string, amountKES: number) => ({ partyType, partyId, direction, amountKES });

describe("recorded credit period projection", () => {
  it("separates receivable and payable opening, movements and closing", () => {
    const accounts = projectCreditPeriod(
      [row("CUSTOMER", "a", "DEBIT", 100), row("SUPPLIER", "a", "DEBIT", 80)],
      [row("CUSTOMER", "a", "CREDIT", 30), row("CUSTOMER", "a", "DEBIT", 40), row("SUPPLIER", "a", "CREDIT", 20)],
    );
    expect(accounts).toEqual([
      { partyType: "CUSTOMER", partyId: "a", openingKES: 100, debitsKES: 40, creditsKES: 30, closingKES: 110 },
      { partyType: "SUPPLIER", partyId: "a", openingKES: 80, debitsKES: 0, creditsKES: 20, closingKES: 60 },
    ]);
  });
  it("refuses invalid amounts, identities and overflow", () => {
    expect(() => projectCreditPeriod([], [row("CUSTOMER", "a", "UNKNOWN", 1)])).toThrow(CreditPeriodError);
    expect(() => projectCreditPeriod([], [row("OTHER", "a", "DEBIT", 1)])).toThrow(CreditPeriodError);
    expect(() => projectCreditPeriod([], [row("CUSTOMER", "", "DEBIT", 1)])).toThrow(CreditPeriodError);
    expect(() => projectCreditPeriod([], [row("CUSTOMER", "a", "DEBIT", 1.1)])).toThrow(CreditPeriodError);
    expect(() => projectCreditPeriod([], [row("CUSTOMER", "a", "DEBIT", Number.MAX_SAFE_INTEGER), row("CUSTOMER", "a", "DEBIT", 1)])).toThrow(CreditPeriodError);
  });
});
