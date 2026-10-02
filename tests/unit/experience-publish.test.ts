/**
 * Publish checklist (§58, §3)
 *
 * Publication is a decision the server makes: payment verified, entitlement active, and a
 * website that will not embarrass the owner. Nothing here can be satisfied by the browser.
 */

import { describe, expect, it } from "vitest";
import { createExperienceDocument } from "@/lib/experience/document";
import { findInvalidCatalogueItems, validateForPublication } from "@/lib/experience/validate";
import { deriveEntitlement, INTERACTIVE_PLAN_KEY } from "@/lib/experience/entitlement";

const future = new Date(Date.now() + 10 * 86_400_000);

function baseInput(overrides: Record<string, unknown> = {}) {
  const document = createExperienceDocument({ categoryKey: "food", businessName: "Choma Place" });
  return {
    document,
    business: { name: "Choma Place", slug: "choma-place", category: "Food & Restaurant", phone: "0722000000", whatsapp: null, logoUrl: "/logo.png" },
    productCount: 3,
    serviceCount: 0,
    entitlement: deriveEntitlement({
      subscription: { status: "ACTIVE", plan: { key: INTERACTIVE_PLAN_KEY }, expiresAt: future },
      paidPayment: { status: "PAID" },
    }),
    paidPayment: { status: "PAID" },
    subscription: { status: "ACTIVE", expiresAt: future },
    ...overrides,
  } as never;
}

function failingIds(result: ReturnType<typeof validateForPublication>) {
  return result.checks.filter((check) => check.status === "fail").map((check) => check.id);
}

describe("publish validation", () => {
  it("passes a complete, paid, entitled website", () => {
    const result = validateForPublication(baseInput());
    expect(result.ready).toBe(true);
    expect(result.failedCount).toBe(0);
  });

  it("never publishes an unpaid website", () => {
    const unpaid = validateForPublication(baseInput({ paidPayment: null, subscription: { status: "PENDING" }, entitlement: deriveEntitlement({ subscription: { status: "PENDING", plan: { key: INTERACTIVE_PLAN_KEY }, expiresAt: future } }) }));
    expect(unpaid.ready).toBe(false);
    expect(failingIds(unpaid)).toEqual(expect.arrayContaining(["payment", "subscription", "entitlement"]));
  });

  it("never publishes once the entitlement has expired", () => {
    const expired = validateForPublication(baseInput({
      subscription: { status: "ACTIVE", expiresAt: new Date(Date.now() - 86_400_000) },
      entitlement: deriveEntitlement({ subscription: { status: "ACTIVE", plan: { key: INTERACTIVE_PLAN_KEY }, expiresAt: new Date(Date.now() - 86_400_000) }, paidPayment: { status: "PAID" } }),
    }));
    expect(expired.ready).toBe(false);
    expect(failingIds(expired)).toContain("entitlement");
  });

  it("requires a name, contact details and something to sell", () => {
    const nameless = validateForPublication(baseInput({
      business: { name: "", slug: "choma-place", phone: "0722000000", logoUrl: "/logo.png" },
    }));
    expect(failingIds(nameless)).toContain("business-name");

    const unreachable = validateForPublication(baseInput({
      business: { name: "Choma Place", slug: "choma-place", logoUrl: "/logo.png" },
      document: { ...createExperienceDocument({ categoryKey: "food", businessName: "Choma Place" }), settings: {} },
    }));
    expect(failingIds(unreachable)).toContain("contact");

    const emptyShop = validateForPublication(baseInput({ productCount: 0 }));
    expect(failingIds(emptyShop)).toContain("catalogue");
  });

  it("requires a bookable business to publish at least one service", () => {
    const salon = createExperienceDocument({ categoryKey: "salon", businessName: "Fade Lounge" });
    const input = baseInput({ document: salon, productCount: 0, serviceCount: 0 }) as Record<string, unknown>;
    input.business = { name: "Fade Lounge", slug: "fade-lounge", phone: "0722000000", logoUrl: "/logo.png" };
    const result = validateForPublication(input as never);
    expect(failingIds(result)).toContain("catalogue");
  });

  it("blocks publishing when a section links somewhere unsafe", () => {
    const document = createExperienceDocument({ categoryKey: "food", businessName: "Choma Place" });
    document.sections.push({ id: "broken", type: "gallery", visible: true, images: [{ url: "javascript:alert(1)" }] } as never);
    const result = validateForPublication(baseInput({ document }));
    expect(failingIds(result)).toContain("references");
  });

  it("flags catalogue rows customers could not buy", () => {
    expect(findInvalidCatalogueItems([{ id: "a", name: "Chicken", basePriceKES: 900 }])).toHaveLength(0);
    const invalid = findInvalidCatalogueItems([
      { id: "b", name: "Mystery", basePriceKES: -5 },
      { id: "c", name: "  ", basePriceKES: 100 },
      { id: "d", name: "Free", basePriceKES: null, salePriceKES: null },
    ]);
    expect(invalid.map((row) => row.id)).toEqual(["b", "c"]);
    expect(invalid[0].reason).toMatch(/price/i);
  });
});
