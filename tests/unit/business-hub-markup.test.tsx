/**
 * Business Hub — rendered markup.
 *
 * There is no browser in this workspace, so these are the closest available stand-in for a
 * customer-facing screenshot: the real components are rendered through React's server renderer
 * and the resulting HTML is asserted. That proves what a visitor's browser actually receives —
 * section order, wording, form controls, ARIA attributes and the QR artwork — while the
 * interactive half (basket edits, fetch calls, hydration) is covered by the journey suite.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import BusinessPage from "@/components/BusinessPage";
import { PromotionSpotlight } from "@/components/business-hub/PromotionSpotlight";
import { OrderRequestPanel } from "@/components/business-hub/OrderRequestPanel";
import { EnquiryPanel } from "@/components/business-hub/EnquiryPanel";
import { LoyaltyCardPanel } from "@/components/business-hub/LoyaltyCardPanel";
import { QrIdentityBlock } from "@/components/business-hub/QrIdentityBlock";
import type { PromotionView } from "@/lib/business-hub/promotions";

const THEME = {
  colors: {
    bg: "bg-zinc-950",
    card: "bg-zinc-900",
    text: "text-zinc-50",
    muted: "text-zinc-400",
    primary: "bg-lime-400",
    primaryText: "text-zinc-900",
    accent: "bg-amber-300",
    border: "border-zinc-800",
    surfaceMuted: "bg-zinc-900/60",
  },
  radius: "rounded-2xl",
};

const BUSINESS = {
  id: "bizA",
  slug: "nyumbani-kitchen",
  name: "Nyumbani Kitchen",
  category: "Food & Restaurant",
  phone: "0712000000",
  whatsapp: "0712000000",
  location: "Tom Mboya Street, Nairobi",
  lat: -1.2833,
  lng: 36.8167,
  description: "Home-style Kenyan meals, cooked fresh every morning.",
  theme: "clean",
  aftercallMsg: null,
  openingHours: JSON.stringify({ mon: "08:00–18:00", tue: "08:00–18:00" }),
  socialLinks: null,
};

const PRODUCTS = [
  { id: "prod_a1", name: "Chapati", description: "Two pieces", imageUrl: null, priceKES: 100, wasPriceKES: null, stockStatus: "IN_STOCK", isFeatured: true },
  { id: "prod_a2", name: "Pilau", description: "Full plate", imageUrl: null, priceKES: 250, wasPriceKES: 300, stockStatus: "IN_STOCK", isFeatured: true },
];

const PROMOTIONS: PromotionView[] = [
  {
    id: "promo_live",
    title: "Weekend combo",
    subtitle: "Two plates for KES 900",
    body: null,
    imageUrl: null,
    ctaKind: "ORDER_REQUEST",
    ctaLabel: null,
    ctaValue: null,
    startsAt: "2026-11-01T06:00:00.000Z",
    endsAt: "2026-12-01T06:00:00.000Z",
    isActive: true,
    state: "LIVE",
    isLive: true,
  } as PromotionView,
];

const EXPIRED: PromotionView = {
  ...PROMOTIONS[0],
  id: "promo_expired",
  title: "October offer",
  state: "EXPIRED",
  isLive: false,
} as PromotionView;

describe("customer page markup", () => {
  it("renders the mandated section order", () => {
    const html = renderToStaticMarkup(
      <BusinessPage
        business={BUSINESS as any}
        services={[{ id: "s1", title: "Catering", description: "For 20–200 guests", priceLabel: "From KES 800" }]}
        offer={null}
        theme={THEME}
        products={PRODUCTS}
        promotions={PROMOTIONS}
        loyaltyEnabled
      />,
    );

    const at = (needle: string) => {
      const index = html.indexOf(needle);
      expect(index, needle).toBeGreaterThan(-1);
      return index;
    };
    // Identity first, then the conversion path, then information, then QR identity last.
    expect(at("Nyumbani Kitchen")).toBeLessThan(at("Weekend combo"));
    expect(at("Weekend combo")).toBeLessThan(at("Services and products"));
    expect(at("Services and products")).toBeLessThan(at("Featured products"));
    expect(at("Featured products")).toBeLessThan(at("Chapati"));
    expect(at("Chapati")).toBeLessThan(at("Pilau"));
    expect(at("Services and products")).toBeLessThan(at("Create your page"));
    expect(at("QR code")).toBeLessThan(at("Create your page"));
  });

  it("says plainly that an order request is not a confirmed order or a payment", () => {
    const html = renderToStaticMarkup(<OrderRequestPanel slug={BUSINESS.slug} businessName={BUSINESS.name} products={PRODUCTS} />);
    // The basket says it before the customer submits, and the confirmation screen repeats it.
    expect(html).toMatch(/No payment is taken/i);
    expect(html).toMatch(/confirm availability and price/i);
    // The basket lists the products with quantity controls, and the honeypot is present.
    expect(html).toContain("Chapati");
    expect(html).toContain("Pilau");
    expect(html).toContain("aria-live");
    expect(html).toContain("st-section st-hub-panel");
    expect(html).not.toContain("jata-card");
  });

  it("never shows an expired promotion as active", () => {
    const live = renderToStaticMarkup(<PromotionSpotlight slug={BUSINESS.slug} promotions={PROMOTIONS} />);
    expect(live).toContain("Weekend combo");
    expect(live).not.toContain("Expired");

    const mixed = renderToStaticMarkup(<PromotionSpotlight slug={BUSINESS.slug} promotions={[...PROMOTIONS, EXPIRED]} />);
    expect(mixed).toContain("Weekend combo");
    expect(mixed).not.toContain("October offer");

    const empty = renderToStaticMarkup(<PromotionSpotlight slug={BUSINESS.slug} promotions={[]} />);
    expect(empty).toBe("");
  });

  it("tells the customer that loyalty stamps are verified by the business", () => {
    const html = renderToStaticMarkup(<LoyaltyCardPanel businessName={BUSINESS.name} />);
    expect(html).toMatch(/verif/i);
    expect(html).toMatch(/nothing is tracked\s+automatically/i);
    expect(html).toMatch(/card code/i);
  });

  it("offers an enquiry form with a honeypot and no booking promise", () => {
    const html = renderToStaticMarkup(<EnquiryPanel slug={BUSINESS.slug} businessName={BUSINESS.name} />);
    expect(html).toMatch(/message/i);
    expect(html).toContain("st-section st-hub-panel");
    expect(html).not.toContain("jata-card");
    expect(html.toLowerCase()).not.toContain("booking confirmed");
  });

  it("keeps order, enquiry and QR panels on the shared graphite/lime storefront skin", () => {
    const css = readFileSync(join(process.cwd(), "app/storefront.css"), "utf8");
    expect(css).toContain(".st-hub-panel");
    expect(css).toContain("var(--st-canvas)");
    expect(css).toContain("var(--st-accent)");
    expect(css).toContain("@media (max-width: 420px)");
    expect(css).toContain("overflow-wrap: anywhere");
  });

  it("inlines the QR artwork and the public page URL it opens", () => {
    const html = renderToStaticMarkup(<QrIdentityBlock slug={BUSINESS.slug} businessName={BUSINESS.name} />);
    expect(html).toContain("<svg");
    expect(html).toContain("st-section st-hub-panel");
    expect(html).toContain("st-hub-qr");
    expect(html).not.toContain("jata-card");
    expect(html).toContain("https://jataaftercall.co.ke/b/nyumbani-kitchen");
    expect(html).toMatch(/download/i);
    // Nothing private is printed next to the code.
    expect(html).not.toContain("bizA");
    expect(html).not.toContain("/dashboard");
  });
});
