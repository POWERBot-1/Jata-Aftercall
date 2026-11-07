/**
 * The catalogue a customer may request from.
 *
 * The public page lists a business's `Service` rows under "Services and products", and that — not
 * the `Product` catalogue — is what most Business Page owners have. Order requests were wired to
 * products alone, which left the capability absent on every page that only has services (all four
 * demo pages included). These tests pin the merged catalogue and its prices.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: null as any }));

vi.mock("@/lib/db", async () => {
  const { createBusinessHubFakeDb, businessHubSeed } = await import("@/tests/helpers/businessHubFakeDb");
  const fake = createBusinessHubFakeDb(businessHubSeed());
  (globalThis as any).__hubFake = fake;
  return { default: fake.db };
});

import { loadCatalogueForPricing, loadRequestableCatalogue, priceLabelToKES } from "@/lib/business-hub/catalogue";

type FakeDb = import("@/tests/helpers/posFakeDb").FakeDb;
const fake = () => (globalThis as any).__hubFake as FakeDb;

beforeEach(() => {
  fake().reset();
});

describe("priceLabelToKES", () => {
  it("reads the amount the page already shows", () => {
    expect(priceLabelToKES("KES 650")).toBe(650);
    expect(priceLabelToKES("From KES 1,500")).toBe(1500);
    expect(priceLabelToKES("From KES 4,500 per hour")).toBe(4500);
  });

  it("returns null rather than guessing when no amount is written", () => {
    expect(priceLabelToKES(null)).toBeNull();
    expect(priceLabelToKES("Price on request")).toBeNull();
    expect(priceLabelToKES(650)).toBeNull();
  });
});

describe("loadRequestableCatalogue", () => {
  it("gives a services-only business a catalogue anyway — the page's own list", async () => {
    const items = await loadRequestableCatalogue("bizC");

    expect(items.map((item) => item.name)).toEqual(["Haircut", "Beard trim"]);
    expect(items.every((item) => item.kind === "SERVICE")).toBe(true);
    expect(items[0].priceKES).toBe(300);
    expect(items[1].priceKES).toBe(200); // parsed from "From KES 200"
  });

  it("puts catalogue products first, then services, featured ahead of the rest", async () => {
    const items = await loadRequestableCatalogue("bizA");
    const names = items.map((item) => item.name);

    expect(names).toEqual(["Chapati", "Pilau Combo", "Pilau", "Event catering"]);
    // Chapati is a featured product, Pilau Combo a featured service, then the ordinary rows.
    expect(items[0].kind).toBe("PRODUCT");
    expect(items[1].kind).toBe("SERVICE");
  });

  it("never lists an inactive row — a withdrawn service is not requestable", async () => {
    const items = await loadRequestableCatalogue("bizA");
    expect(items.some((item) => item.name === "Closed Sunday special")).toBe(false);
    expect(items.some((item) => item.name === "Secret Recipe")).toBe(false);
  });

  it("prices products with the platform's own rule, including a live sale", async () => {
    const items = await loadRequestableCatalogue("bizA");
    const pilau = items.find((item) => item.name === "Pilau");
    const chapati = items.find((item) => item.name === "Chapati");

    expect(chapati?.priceKES).toBe(100);
    expect(pilau?.priceKES).toBe(250); // sale price, not the 300 list price
    expect(pilau?.wasPriceKES).toBe(300);
  });

  it("leaves a quote-only service without a price instead of inventing one", async () => {
    const items = await loadRequestableCatalogue("bizA");
    const catering = items.find((item) => item.name === "Event catering");

    expect(catering?.priceKES).toBeNull();
    expect(catering?.stockStatus).toBe("AVAILABLE_ON_REQUEST");
  });
});

describe("loadCatalogueForPricing", () => {
  it("returns both kinds, so validation and the page cannot disagree", async () => {
    const rows = await loadCatalogueForPricing("bizA");
    const byName = new Map(rows.map((row: any) => [row.name, row]));

    expect(byName.get("Chapati")?.kind).toBe("PRODUCT");
    expect(byName.get("Chapati")?.basePriceKES).toBe(100);
    expect(byName.get("Pilau Combo")?.kind).toBe("SERVICE");
    expect(byName.get("Pilau Combo")?.unitPriceKES).toBe(650);
    expect(byName.get("Event catering")?.unitPriceKES).toBeNull();
  });

  it("stays inside one business", async () => {
    const rows = await loadCatalogueForPricing("bizC");
    expect(rows.every((row: any) => row.kind === "SERVICE")).toBe(true);
    expect(rows).toHaveLength(2);
  });
});
