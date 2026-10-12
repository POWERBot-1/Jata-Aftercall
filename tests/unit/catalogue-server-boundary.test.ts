import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { priceBandsFor } from "@/lib/experience/catalogue";
import type { StorefrontItem } from "@/lib/experience/storefront";
const items = (prices: (number | null)[]) => prices.map((price, index) => ({ id: String(index), price })) as StorefrontItem[];

describe("catalogue server boundary", () => {
  it("computes server price bands outside the use-client component boundary", () => {
    const page = readFileSync("app/b/[slug]/shop/page.tsx", "utf8");
    expect(page).toContain('from "@/lib/experience/catalogue"');
    expect(page).toContain('data={itemCardDataFor(data)}');
    expect(readFileSync('components/storefront/CatalogueClient.tsx', 'utf8')).not.toContain('data as never');
    expect(page).not.toMatch(/import\s*\{[^}]*priceBandsFor[^}]*\}\s*from\s*["']@\/components/);
  });
  it("does not invent price bands for sparse/equal/unpriced catalogues", () => {
    expect(priceBandsFor(items([null, 0, 0, null]))).toEqual([]);
    expect(priceBandsFor(items([100, 200, 300]))).toEqual([]);
    expect(priceBandsFor(items([100, 100, 100, 100]))).toEqual([]);
  });
  it("preserves exact existing tenant-derived arithmetic and labels", () => {
    expect(priceBandsFor(items([400, 100, 200, 300]))).toEqual([
      { label: "Under KES 200", min: 0, max: 200 },
      { label: "KES 200 – KES 300", min: 200, max: 300 },
      { label: "Over KES 300", min: 300, max: Number.MAX_SAFE_INTEGER },
    ]);
  });
  it("never sorts or mutates the catalogue input", () => {
    const input = items([400, 100, 200, 300]); const before = JSON.stringify(input);
    priceBandsFor(input); expect(JSON.stringify(input)).toBe(before);
  });
});
