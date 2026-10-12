import { describe, expect, it } from "vitest";
import {
  applyQuantityRule,
  businessDateOnly,
  chargeableUnitPrice,
  effectiveUnitPrice,
  formatBusinessDateTime,
  parseBusinessDateTime,
  saleStateAt,
  toBusinessLocalInput,
  validateSaleWrite,
} from "@/lib/sale-pricing";

// Africa/Nairobi is UTC+03:00 all year. 2026-10-10 10:00 Nairobi = 07:00 UTC.
const START = new Date("2026-10-10T07:00:00.000Z"); // 10:00 Nairobi
const END = new Date("2026-10-12T07:00:00.000Z"); // 10:00 Nairobi, two days later
const product = { basePriceKES: 1000, salePriceKES: 800, salePriceStartsAt: START, salePriceEndsAt: END };

describe("sale window boundaries (start-inclusive, end-exclusive)", () => {
  it("is not running one millisecond before the start", () => {
    expect(saleStateAt(product, new Date(START.getTime() - 1))).toBe("SCHEDULED");
    expect(effectiveUnitPrice(product, new Date(START.getTime() - 1)).unitPriceKES).toBe(1000);
  });

  it("starts exactly at the start instant", () => {
    expect(saleStateAt(product, START)).toBe("ACTIVE");
    expect(effectiveUnitPrice(product, START).unitPriceKES).toBe(800);
  });

  it("is still running one millisecond before the end", () => {
    expect(effectiveUnitPrice(product, new Date(END.getTime() - 1)).unitPriceKES).toBe(800);
  });

  it("has ended exactly at the end instant, and the base price applies", () => {
    expect(saleStateAt(product, END)).toBe("EXPIRED");
    const after = effectiveUnitPrice(product, END);
    expect(after.unitPriceKES).toBe(1000);
    expect(after.source).toBe("BASE");
  });

  it("never extends an expired sale: a month later the base price still applies", () => {
    const later = new Date(END.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect(effectiveUnitPrice(product, later).unitPriceKES).toBe(1000);
  });
});

describe("sale prices that do not discount anything", () => {
  it("a sale with no dates is not running (no indefinite discounts)", () => {
    expect(saleStateAt({ basePriceKES: 1000, salePriceKES: 800 }, START)).toBe("NO_WINDOW");
    expect(effectiveUnitPrice({ basePriceKES: 1000, salePriceKES: 800 }, START).unitPriceKES).toBe(1000);
  });

  it("a sale with only one date is not running", () => {
    expect(saleStateAt({ ...product, salePriceEndsAt: null }, START)).toBe("INVALID_WINDOW");
  });

  it("an inverted or empty window is not running", () => {
    expect(saleStateAt({ ...product, salePriceStartsAt: END, salePriceEndsAt: START }, START)).toBe("INVALID_WINDOW");
    expect(saleStateAt({ ...product, salePriceStartsAt: START, salePriceEndsAt: START }, START)).toBe("INVALID_WINDOW");
  });

  it("a sale price at or above the base price is not a discount", () => {
    expect(saleStateAt({ ...product, salePriceKES: 1000 }, START)).toBe("NOT_A_DISCOUNT");
    expect(saleStateAt({ ...product, salePriceKES: 1200 }, START)).toBe("NOT_A_DISCOUNT");
  });

  it("no sale price means the base price", () => {
    expect(saleStateAt({ basePriceKES: 1000, salePriceKES: null }, START)).toBe("NONE");
  });
});

describe("variant and list price", () => {
  it("a variant with its own price keeps it; the product sale does not discount it", () => {
    const priced = effectiveUnitPrice(product, START, { priceKES: 1200 });
    expect(priced.unitPriceKES).toBe(1200);
    expect(priced.source).toBe("VARIANT");
  });

  it("falls back to the product-level variant price when there is no base price", () => {
    expect(effectiveUnitPrice({ basePriceKES: null, variantPriceKES: 700 }, START).unitPriceKES).toBe(700);
  });

  it("a product with no price at all reads as 0 (callers refuse it)", () => {
    expect(effectiveUnitPrice({ basePriceKES: null }, START).unitPriceKES).toBe(0);
  });
});

describe("quantity rule (bulk pricing)", () => {
  const rules = [{ productName: "Chicken", minQuantity: 10, unitPriceKES: 750 }];

  it("applies to the effective price, after the sale is applied", () => {
    // Sale active: effective 800. Rule 750 is lower, so it applies once.
    const result = chargeableUnitPrice({ product, productName: "Chicken", quantity: 10, now: START, rules });
    expect(result.unitPriceKES).toBe(750);
    expect(result.bulkApplied).toBe(true);
  });

  it("never raises a price: a rule above the effective price is ignored", () => {
    const result = applyQuantityRule("Chicken", 700, 10, [{ productName: "Chicken", minQuantity: 10, unitPriceKES: 900 }]);
    expect(result).toEqual({ unitPriceKES: 700, bulkApplied: false });
  });

  it("does not stack: with the sale expired the rule still applies once, to the base price", () => {
    const later = new Date(END.getTime() + 1000);
    const result = chargeableUnitPrice({ product, productName: "Chicken", quantity: 10, now: later, rules });
    expect(result.unitPriceKES).toBe(750);
  });

  it("does not apply below the minimum quantity", () => {
    const result = chargeableUnitPrice({ product, productName: "Chicken", quantity: 9, now: START, rules });
    expect(result.unitPriceKES).toBe(800);
    expect(result.bulkApplied).toBe(false);
  });

  it("matches the product name case-insensitively", () => {
    expect(applyQuantityRule("chicken", 800, 10, rules).unitPriceKES).toBe(750);
  });
});

describe("timezone: owner input is Africa/Nairobi, storage is UTC", () => {
  it("reads a zoneless local time as Nairobi time", () => {
    expect(parseBusinessDateTime("2026-10-10T10:00")?.toISOString()).toBe("2026-10-10T07:00:00.000Z");
  });

  it("takes an explicit zone as written", () => {
    expect(parseBusinessDateTime("2026-10-10T07:00:00Z")?.toISOString()).toBe("2026-10-10T07:00:00.000Z");
    expect(parseBusinessDateTime("2026-10-10T13:00:00+06:00")?.toISOString()).toBe("2026-10-10T07:00:00.000Z");
  });

  it("rejects rolled-over and malformed dates", () => {
    expect(parseBusinessDateTime("2026-02-31T10:00")).toBeNull();
    expect(parseBusinessDateTime("2026-13-01T10:00")).toBeNull();
    expect(parseBusinessDateTime("tomorrow")).toBeNull();
    expect(parseBusinessDateTime("")).toBeNull();
  });

  it("crosses midnight correctly: 00:30 Nairobi is the previous day in UTC", () => {
    expect(parseBusinessDateTime("2026-10-10T00:30")?.toISOString()).toBe("2026-10-09T21:30:00.000Z");
    expect(businessDateOnly(new Date("2026-10-09T21:30:00.000Z"))).toBe("2026-10-10");
  });

  it("round-trips to the datetime-local input and to a readable label", () => {
    expect(toBusinessLocalInput(START)).toBe("2026-10-10T10:00");
    expect(formatBusinessDateTime(START)).toMatch(/10 Oct 2026/);
  });
});

describe("validateSaleWrite", () => {
  it("clears the sale when no price is sent", () => {
    expect(validateSaleWrite({ basePriceKES: 1000, salePriceKES: null })).toEqual({
      ok: true,
      salePriceKES: null,
      salePriceStartsAt: null,
      salePriceEndsAt: null,
    });
  });

  it("requires a window for a new or changed sale", () => {
    const result = validateSaleWrite({ basePriceKES: 1000, salePriceKES: 800 });
    expect(result.ok).toBe(false);
  });

  it("accepts a valid window and stores it as UTC", () => {
    const result = validateSaleWrite({ basePriceKES: 1000, salePriceKES: 800, startsAt: "2026-10-10T10:00", endsAt: "2026-10-12T10:00" });
    expect(result).toMatchObject({ ok: true, salePriceStartsAt: START, salePriceEndsAt: END });
  });

  it("refuses an end before the start, and equal times", () => {
    expect(validateSaleWrite({ basePriceKES: 1000, salePriceKES: 800, startsAt: "2026-10-12T10:00", endsAt: "2026-10-10T10:00" }).ok).toBe(false);
    expect(validateSaleWrite({ basePriceKES: 1000, salePriceKES: 800, startsAt: "2026-10-10T10:00", endsAt: "2026-10-10T10:00" }).ok).toBe(false);
  });

  it("refuses a sale price that is not a whole positive amount below the base price", () => {
    expect(validateSaleWrite({ basePriceKES: 1000, salePriceKES: 0, startsAt: "x" }).ok).toBe(true); // 0 clears
    expect(validateSaleWrite({ basePriceKES: 1000, salePriceKES: -5, startsAt: "2026-10-10T10:00", endsAt: "2026-10-12T10:00" }).ok).toBe(false);
    expect(validateSaleWrite({ basePriceKES: 1000, salePriceKES: 12.5, startsAt: "2026-10-10T10:00", endsAt: "2026-10-12T10:00" }).ok).toBe(false);
    expect(validateSaleWrite({ basePriceKES: 1000, salePriceKES: 1000, startsAt: "2026-10-10T10:00", endsAt: "2026-10-12T10:00" }).ok).toBe(false);
  });

  it("keeps the stored window when an unchanged sale price is re-saved without dates", () => {
    const result = validateSaleWrite({
      basePriceKES: 1000,
      salePriceKES: 800,
      stored: { salePriceKES: 800, salePriceStartsAt: START, salePriceEndsAt: END },
    });
    expect(result).toMatchObject({ ok: true, salePriceStartsAt: START, salePriceEndsAt: END });
  });

  it("does not keep a stored window when the sale price changes", () => {
    const result = validateSaleWrite({
      basePriceKES: 1000,
      salePriceKES: 700,
      stored: { salePriceKES: 800, salePriceStartsAt: START, salePriceEndsAt: END },
    });
    expect(result.ok).toBe(false);
  });
});
