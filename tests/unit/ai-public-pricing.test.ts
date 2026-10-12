/**
 * Price presentation on AI-facing and customer-facing surfaces (customer AI page, AI brain API, AI dashboard API).
 * Base price, active sale and expired sale must each be shown correctly, and no sale window or raw sale
 * price may leave the server through these views.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { publicProductPrice, withPublicPricing } from "@/lib/ai-public-products";

const root = path.resolve(__dirname, "../..");
const START = new Date("2026-10-10T00:00:00Z");
const END = new Date("2026-10-20T00:00:00Z");
const DURING = new Date("2026-10-15T12:00:00Z");
const BEFORE = new Date("2026-10-09T12:00:00Z");
const AFTER = new Date("2026-10-21T12:00:00Z");

const product = {
  id: "p1",
  name: "Chicken",
  description: "Grilled",
  stockStatus: "IN_STOCK",
  preOrderAllowed: false,
  basePriceKES: 1000,
  variantPriceKES: null,
  salePriceKES: 800,
  salePriceStartsAt: START,
  salePriceEndsAt: END,
};

describe("public price presentation", () => {
  it("shows the base price, with no original, before the sale window opens", () => {
    expect(publicProductPrice(product, BEFORE)).toEqual({ priceKES: 1000, wasPriceKES: null });
  });

  it("shows the sale price with the original struck through while the sale runs", () => {
    expect(publicProductPrice(product, DURING)).toEqual({ priceKES: 800, wasPriceKES: 1000 });
  });

  it("returns to the base price once the sale has expired, with no manual clean-up", () => {
    expect(publicProductPrice(product, AFTER)).toEqual({ priceKES: 1000, wasPriceKES: null });
  });

  it("treats a sale with no window as not running (never an indefinite discount)", () => {
    expect(publicProductPrice({ ...product, salePriceStartsAt: null, salePriceEndsAt: null }, DURING)).toEqual({
      priceKES: 1000,
      wasPriceKES: null,
    });
  });

  it("returns no price for a product without a base price", () => {
    expect(publicProductPrice({ ...product, basePriceKES: null }, DURING)).toEqual({ priceKES: null, wasPriceKES: null });
  });

  it("strips the sale window and raw sale price from a full product row", () => {
    const view = withPublicPricing(product, DURING);
    expect(view).not.toHaveProperty("salePriceKES");
    expect(view).not.toHaveProperty("salePriceStartsAt");
    expect(view).not.toHaveProperty("salePriceEndsAt");
    expect(view).toMatchObject({ id: "p1", name: "Chicken", priceKES: 800, wasPriceKES: 1000 });
  });

  it("keeps the customer-facing AI page from receiving window fields or raw sale data", () => {
    const page = readFileSync(path.join(root, "app/b/[slug]/ai/page.tsx"), "utf8");
    expect(page).toContain("publicProductPrice(p)");
    expect(page).not.toMatch(/salePriceStartsAt|salePriceEndsAt|salePriceKES/);
  });

  it("keeps the customer client on the effective price, not the base price", () => {
    const client = readFileSync(path.join(root, "components/AIFrontDeskCustomerClient.tsx"), "utf8");
    expect(client).not.toMatch(/p\.basePriceKES/);
    expect(client).toContain("p.priceKES");
  });
});
