/**
 * Money and tax behaviour (POS / ERP - PRO).
 *
 * These tests are about the two places a Kenyan SME loses money silently: rounding and tax
 * effective dating. Everything is in integer cents, and a tax rule that was not in force must never
 * be applied "because it is close enough".
 */
import { describe, expect, it } from "vitest";
import { fromCents, MAX_CENTS, parseKesToCents, roundHalfUp, sumCents, toCents } from "@/lib/erp/money";
import { computeTax, DEFAULT_KENYA_TAX_RULES, etimsTaxTypeCode, priceInvoiceLines, resolveTaxRule } from "@/lib/erp/tax";

describe("money", () => {
  it("parses shilling input without ever returning NaN", () => {
    expect(parseKesToCents("1,250.50")).toBe(125050);
    expect(parseKesToCents("KES 300")).toBe(30000);
    expect(parseKesToCents("")).toBe(0);
    expect(parseKesToCents("not a number")).toBe(0);
    expect(parseKesToCents(19.99)).toBe(1999);
  });

  it("clamps absurd values instead of storing them", () => {
    expect(toCents(-5)).toBe(0);
    expect(toCents(Number.MAX_SAFE_INTEGER)).toBe(MAX_CENTS);
    expect(fromCents(MAX_CENTS)).toBe(100_000_000);
  });

  it("rounds halves away from zero, the tax convention used here", () => {
    expect(roundHalfUp(0.5)).toBe(1);
    expect(roundHalfUp(2.5)).toBe(3);
    expect(roundHalfUp(-2.5)).toBe(-3);
  });

  it("sums only finite integer cents", () => {
    expect(sumCents([100, null, undefined, 250])).toBe(350);
  });
});

describe("tax effective dating", () => {
  const rules = DEFAULT_KENYA_TAX_RULES;

  it("resolves the rule in force on the invoice date, not today's rate", () => {
    const before = resolveTaxRule(rules, "VAT_STANDARD", "2020-06-30");
    const after = resolveTaxRule(rules, "VAT_STANDARD", "2021-01-01");
    expect(before).toBeNull();
    expect(after?.rateBps).toBe(1600);
  });

  it("does not apply a superseded rule after its window closes", () => {
    const historical = resolveTaxRule(rules, "VAT_STANDARD_14", "2020-12-31");
    const later = resolveTaxRule(rules, "VAT_STANDARD_14", "2021-02-01");
    expect(historical?.rateBps).toBe(1400);
    expect(later).toBeNull();
  });

  it("rejects an invoice line whose tax key had no rule in force", () => {
    const priced = priceInvoiceLines([{ description: "Old sale", quantity: 1, unitAmountCents: 1000, taxKey: "VAT_STANDARD" }], rules, "2020-05-01");
    expect(priced.ok).toBe(false);
    if (priced.ok === false) expect(priced.error).toMatch(/No tax rule/);
  });
});

describe("computeTax", () => {
  const standard = { rateBps: 1600, treatment: "STANDARD" as const, inclusive: true };
  const exclusive = { rateBps: 1600, treatment: "STANDARD" as const, inclusive: false };

  it("extracts VAT from an inclusive price and rounds once", () => {
    const result = computeTax({ quantity: 1, unitAmountCents: 11600, rule: standard });
    expect(result.netCents).toBe(10000);
    expect(result.taxCents).toBe(1600);
    expect(result.grossCents).toBe(11600);
  });

  it("adds VAT to an exclusive price", () => {
    const result = computeTax({ quantity: 2, unitAmountCents: 10000, rule: exclusive });
    expect(result.netCents).toBe(20000);
    expect(result.taxCents).toBe(3200);
    expect(result.grossCents).toBe(23200);
  });

  it("never taxes zero-rated, exempt or out-of-scope lines", () => {
    for (const treatment of ["ZERO_RATED", "EXEMPT", "OUT_OF_SCOPE"] as const) {
      const result = computeTax({ quantity: 1, unitAmountCents: 5000, rule: { rateBps: 0, treatment, inclusive: false } });
      expect(result.taxCents).toBe(0);
      expect(result.netCents).toBe(5000);
    }
  });

  it("caps a discount at the line value instead of producing a negative total", () => {
    const result = computeTax({ quantity: 1, unitAmountCents: 1000, discountCents: 5000, rule: exclusive });
    expect(result.grossCents).toBe(0);
    expect(result.taxCents).toBe(0);
  });

  it("maps treatments to the eTIMS tax type codes used by the specification", () => {
    expect(etimsTaxTypeCode("EXEMPT", 0)).toBe("A");
    expect(etimsTaxTypeCode("STANDARD", 1600)).toBe("B");
    expect(etimsTaxTypeCode("ZERO_RATED", 0)).toBe("C");
    expect(etimsTaxTypeCode("OUT_OF_SCOPE", 0)).toBe("D");
  });
});
