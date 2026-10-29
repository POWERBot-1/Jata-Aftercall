import { describe, expect, it } from "vitest";
import { fromCents, parseKesToCents, roundHalfUp, toCents } from "@/lib/erp/money";
import { computeTax, DEFAULT_KENYA_TAX_RULES, etimsTaxTypeCode, priceInvoiceLines, resolveTaxRule } from "@/lib/erp/tax";

describe("money", () => {
  it("rounds half away from zero", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
  });

  it("converts shillings to integer cents and back", () => {
    expect(toCents(1)).toBe(100);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(fromCents(1999)).toBe(19.99);
  });

  it("parses what a shopkeeper types", () => {
    expect(parseKesToCents("KES 1,250.50")).toBe(125050);
    expect(parseKesToCents("300")).toBe(30000);
    expect(parseKesToCents("")).toBe(0);
    expect(parseKesToCents("abc")).toBe(0);
    expect(parseKesToCents("-5")).toBe(0); // amounts are never negative at the edge of the system
  });
});

describe("tax engine", () => {
  it("uses the rule in force on the invoice date, including the old 14% key", () => {
    expect(resolveTaxRule(DEFAULT_KENYA_TAX_RULES, "VAT_STANDARD_14", "2020-06-15")?.rateBps).toBe(1400);
    expect(resolveTaxRule(DEFAULT_KENYA_TAX_RULES, "VAT_STANDARD", "2020-06-15")).toBeNull();
    expect(resolveTaxRule(DEFAULT_KENYA_TAX_RULES, "VAT_STANDARD", "2026-10-27")?.rateBps).toBe(1600);
  });

  it("returns null rather than guessing when no rule was in force", () => {
    expect(resolveTaxRule(DEFAULT_KENYA_TAX_RULES, "VAT_STANDARD", "2019-01-01")).toBeNull();
  });

  it("extracts tax from an inclusive price without losing a cent", () => {
    const result = computeTax({ quantity: 1, unitAmountCents: 11600, rule: { rateBps: 1600, treatment: "STANDARD", inclusive: true } });
    expect(result.netCents).toBe(10000);
    expect(result.taxCents).toBe(1600);
    expect(result.grossCents).toBe(11600);
  });

  it("adds tax to an exclusive price", () => {
    const result = computeTax({ quantity: 3, unitAmountCents: 1000, rule: { rateBps: 1600, treatment: "STANDARD", inclusive: false } });
    expect(result.netCents).toBe(3000);
    expect(result.taxCents).toBe(480);
    expect(result.grossCents).toBe(3480);
  });

  it("never taxes zero-rated or exempt lines", () => {
    const zero = computeTax({ quantity: 1, unitAmountCents: 5000, rule: { rateBps: 0, treatment: "ZERO_RATED", inclusive: false } });
    const exempt = computeTax({ quantity: 1, unitAmountCents: 5000, rule: { rateBps: 0, treatment: "EXEMPT", inclusive: false } });
    expect(zero.taxCents).toBe(0);
    expect(exempt.taxCents).toBe(0);
  });

  it("maps treatments to the eTIMS tax type codes", () => {
    expect(etimsTaxTypeCode("EXEMPT", 0)).toBe("A");
    expect(etimsTaxTypeCode("STANDARD", 1600)).toBe("B");
    expect(etimsTaxTypeCode("ZERO_RATED", 0)).toBe("C");
    expect(etimsTaxTypeCode("OUT_OF_SCOPE", 0)).toBe("D");
  });

  it("prices a whole invoice and totals each column", () => {
    const priced = priceInvoiceLines(
      [
        { description: "Chapati", quantity: 2, unitAmountCents: 5000, taxKey: "VAT_STANDARD" },
        { description: "Water", quantity: 1, unitAmountCents: 2000, taxKey: "VAT_ZERO" },
      ],
      DEFAULT_KENYA_TAX_RULES,
      "2026-10-27",
    );
    expect(priced.ok).toBe(true);
    if (priced.ok) {
      expect(priced.totals.subtotalCents).toBe(12000);
      expect(priced.totals.taxCents).toBe(1600);
      expect(priced.totals.totalCents).toBe(13600);
    }
  });
});
