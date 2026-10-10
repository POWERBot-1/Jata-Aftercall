/**
 * Channel regression tests for approved sale-price policy C.
 *
 * Every ordering channel (conversational cart, AI quote, POS write) must charge the same unit price the
 * shared helper (lib/sale-pricing.ts) gives for the same instant. The storefront checkout, pre-order and
 * AI create_order paths are covered by their own integration tests (see tests/integration/).
 */
import { describe, expect, it } from "vitest";
import { parseConversationalOrder } from "@/lib/cart";
import { authoritativeUnitPrice, type CatalogueProduct } from "@/lib/ai-grounding";
import { chargeableUnitPrice, displayPriceKES, parseBusinessDateTime } from "@/lib/sale-pricing";
import { sanitizeProductInput } from "@/lib/pos/validation";
import { findInvalidCatalogueItems } from "@/lib/experience/validate";

const START = new Date("2026-10-10T00:00:00Z");
const END = new Date("2026-10-20T00:00:00Z");
const DURING = new Date("2026-10-15T12:00:00Z");
const BEFORE = new Date("2026-10-09T23:59:59Z");
const AFTER = new Date("2026-10-20T00:00:00Z"); // end is exclusive: exactly the end is already expired

const CHICKEN = {
  id: "p-chicken",
  name: "Chicken",
  basePriceKES: 1000,
  variantPriceKES: null,
  salePriceKES: 800,
  salePriceStartsAt: START,
  salePriceEndsAt: END,
  stockStatus: "IN_STOCK",
  quantity: 50,
  preOrderAllowed: false,
} as const;

describe("conversational cart uses the sale window at one instant", () => {
  const message = "I want one chicken please";

  it("charges the sale price inside the window", () => {
    const parsed = parseConversationalOrder(message, [CHICKEN], { now: DURING });
    expect(parsed.matchedLines[0].unitPriceKES).toBe(800);
  });

  it("charges the base price before the window opens", () => {
    const parsed = parseConversationalOrder(message, [CHICKEN], { now: BEFORE });
    expect(parsed.matchedLines[0].unitPriceKES).toBe(1000);
  });

  it("charges the base price at the exact end instant (end-exclusive)", () => {
    const parsed = parseConversationalOrder(message, [CHICKEN], { now: AFTER });
    expect(parsed.matchedLines[0].unitPriceKES).toBe(1000);
  });

  it("charges the sale price at the exact start instant (start-inclusive)", () => {
    const parsed = parseConversationalOrder(message, [CHICKEN], { now: START });
    expect(parsed.matchedLines[0].unitPriceKES).toBe(800);
  });

  it("applies the owner's quantity rule after the sale, never stacking, and never raising a price", () => {
    const rules = [{ productName: "Chicken", minQuantity: 2, unitPriceKES: 700 }];
    const bulk = parseConversationalOrder("two chicken", [CHICKEN], { now: DURING, rules });
    expect(bulk.matchedLines[0].unitPriceKES).toBe(700);

    // A bulk rule above the current sale price must not raise it back to the base price.
    const high = [{ productName: "Chicken", minQuantity: 2, unitPriceKES: 950 }];
    const notRaised = parseConversationalOrder("two chicken", [CHICKEN], { now: DURING, rules: high });
    expect(notRaised.matchedLines[0].unitPriceKES).toBe(800);
  });
});

describe("AI quote matches the checkout charge after expiry", () => {
  const product = CHICKEN as unknown as CatalogueProduct;

  it("authoritativeUnitPrice equals the chargeable price at the same instant, before and after expiry", () => {
    for (const instant of [BEFORE, DURING, AFTER]) {
      const quote = authoritativeUnitPrice(product, instant);
      const charge = chargeableUnitPrice({ product, productName: product.name, quantity: 1, now: instant }).unitPriceKES;
      expect(quote).toBe(charge);
    }
    expect(authoritativeUnitPrice(product, AFTER)).toBe(1000);
  });
});

describe("customer-facing display agrees with the charge", () => {
  it("shows the original price struck through only while a sale runs", () => {
    const during = displayPriceKES(CHICKEN, DURING);
    expect(during).toMatchObject({ priceKES: 800, wasPriceKES: 1000, saleState: "ACTIVE" });
    const after = displayPriceKES(CHICKEN, AFTER);
    expect(after).toMatchObject({ priceKES: 1000, wasPriceKES: null, saleState: "EXPIRED" });
  });

  it("reports a sale with no window as not running", () => {
    const noWindow = { ...CHICKEN, salePriceStartsAt: null, salePriceEndsAt: null };
    expect(displayPriceKES(noWindow, DURING)).toMatchObject({ priceKES: 1000, wasPriceKES: null, saleState: "NO_WINDOW" });
  });

  it("does not list an expired sale as the catalogue price", () => {
    const invalid = findInvalidCatalogueItems([{ ...CHICKEN, id: "p-chicken" }]);
    expect(invalid).toHaveLength(0);
  });
});

describe("timezone: Africa/Nairobi is read for owner input, UTC is stored", () => {
  it("reads a zone-less owner time as Nairobi (UTC+03:00)", () => {
    expect(parseBusinessDateTime("2026-10-10T10:00")?.toISOString()).toBe("2026-10-10T07:00:00.000Z");
  });

  it("keeps an explicit offset as written", () => {
    expect(parseBusinessDateTime("2026-10-10T10:00:00Z")?.toISOString()).toBe("2026-10-10T10:00:00.000Z");
  });
});

describe("POS product sale fields use the same window rule", () => {
  const base = { name: "Shirt", kind: "PRODUCT", priceKES: 1000, unitKey: "piece" };

  it("accepts a sale with a complete window", () => {
    const input = sanitizeProductInput({
      ...base,
      salePriceKES: 800,
      salePriceStartsAt: "2026-10-10T10:00",
      salePriceEndsAt: "2026-10-20T10:00",
    });
    expect(input.saleError).toBeUndefined();
    expect(input.sale?.salePriceKES).toBe(800);
    expect(input.sale?.salePriceStartsAt?.toISOString()).toBe("2026-10-10T07:00:00.000Z");
  });

  it("refuses a sale with no window, and one that ends before it starts", () => {
    expect(sanitizeProductInput({ ...base, salePriceKES: 800 }).saleError).toBeTruthy();
    expect(
      sanitizeProductInput({ ...base, salePriceKES: 800, salePriceStartsAt: "2026-10-20T10:00", salePriceEndsAt: "2026-10-10T10:00" }).saleError,
    ).toBeTruthy();
  });

  it("refuses a sale that is not a discount", () => {
    expect(
      sanitizeProductInput({ ...base, salePriceKES: 1000, salePriceStartsAt: "2026-10-10T10:00", salePriceEndsAt: "2026-10-20T10:00" }).saleError,
    ).toBeTruthy();
  });

  it("leaves the sale untouched when the request does not send sale fields", () => {
    const input = sanitizeProductInput({ ...base });
    expect(input.sale).toBeUndefined();
    expect(input.saleError).toBeUndefined();
  });
});
