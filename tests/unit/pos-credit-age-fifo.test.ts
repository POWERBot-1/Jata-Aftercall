import { describe, expect, it } from "vitest";
import { CreditAgeError, oldestUnpaidDebit } from "@/lib/pos/credit-age";

const row = (direction: string, amountKES: number, createdAt: string) => ({ direction, amountKES, createdAt });
const old = "2026-01-01T00:00:00.000Z", recent = "2026-10-01T00:00:00.000Z";

describe("credit ageing FIFO policy", () => {
  it("does not age a new balance from an old debit that was paid in full", () => {
    const entries = [row("DEBIT", 100, old), row("CREDIT", 100, "2026-02-01T00:00:00Z"), row("DEBIT", 50, recent)];
    expect(oldestUnpaidDebit(entries, 50)?.toISOString()).toBe(recent);
    expect(oldestUnpaidDebit([...entries, row("CREDIT", 50, "2026-10-02T00:00:00Z")], 0)).toBeNull();
  });
  it("retains the oldest date for a partially settled debit", () => {
    const entries = [row("DEBIT", 100, old), row("CREDIT", 60, "2026-02-01T00:00:00Z"), row("DEBIT", 50, recent)];
    expect(oldestUnpaidDebit(entries, 90)?.toISOString()).toBe(old);
  });
  it("refuses mismatched balances and invalid amounts rather than inventing an age", () => {
    expect(() => oldestUnpaidDebit([row("DEBIT", 100, old)], 99)).toThrow(CreditAgeError);
    expect(() => oldestUnpaidDebit([row("DEBIT", 1.2, old)], 1)).toThrow(CreditAgeError);
    expect(() => oldestUnpaidDebit([row("OTHER", 1, old)], 1)).toThrow(CreditAgeError);
    expect(() => oldestUnpaidDebit([row("DEBIT", 100, old), { ...row("CREDIT", 50, recent), saleId: "sale" }], 50)).toThrow(CreditAgeError);
  });
});
