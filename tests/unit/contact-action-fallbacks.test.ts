/**
 * Owner directive 2026-10-27 Phase 3C — customer contact actions must genuinely work and must
 * never render dead controls. The persistent storefront ActionBar only offers WhatsApp/Call when
 * the stored number normalises to a valid Kenyan mobile (lib/phone), and Directions only when a
 * location or coordinate pair exists. When nothing actionable exists the whole bar disappears.
 * Directions URL fallback ordering itself is pinned in location-payment.test.ts.
 */
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/components/storefront/CartProvider", () => ({ useCart: () => ({ count: 0, setOpen: vi.fn() }) }));
vi.mock("@/components/storefront/Track", () => ({ trackEvent: vi.fn() }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));
import { ActionBar } from "@/components/storefront/ActionBar";

const base = {
  businessId: "biz-1",
  slug: "nyumbani-kitchen",
  shopHref: "/b/nyumbani-kitchen/shop",
  bookHref: "",
  location: null,
  lat: null,
  lng: null,
  primaryLabel: "Order",
  primaryHref: null,
  showCart: false,
};

function render(props: Record<string, unknown>) {
  return renderToStaticMarkup(createElement(ActionBar as any, { ...base, ...props } as any));
}

describe("ActionBar honest contact fallbacks", () => {
  it("renders no WhatsApp or Call control for unparseable numbers", () => {
    const html = render({ whatsapp: "call-me-maybe", phone: "123" });
    expect(html).not.toContain("wa.me");
    expect(html).not.toContain("tel:");
    expect(html).not.toContain("WhatsApp");
    expect(html).not.toContain(">Call<");
  });

  it("builds real wa.me and tel destinations from a valid Kenyan number", () => {
    const html = render({ whatsapp: "0724317010", phone: "0724317010" });
    expect(html).toContain("https://wa.me/254724317010");
    expect(html).toContain("tel:+254724317010");
    expect(html).toContain("WhatsApp");
    expect(html).toContain("Call");
  });

  it("accepts spaced and +254 display formats and normalises them in the href", () => {
    const html = render({ whatsapp: "+254 724 317 010", phone: "0724 317 010" });
    expect(html).toContain("https://wa.me/254724317010");
    expect(html).toContain("tel:+254724317010");
  });

  it("offers Directions only when location data exists, using the encoded address", () => {
    const without = render({ location: null });
    expect(without).not.toContain("Directions");
    expect(without).not.toContain("google.com/maps");

    const withAddress = render({ location: "Kitengela, Kajiado" });
    expect(withAddress).toContain("Directions");
    expect(withAddress).toContain("https://www.google.com/maps/dir/?api=1&amp;destination=Kitengela%2C%20Kajiado");
  });

  it("prefers coordinates for Directions when a complete pair is present", () => {
    const html = render({ location: "Kitengela, Kajiado", lat: -1.451, lng: 36.953 });
    expect(html).toContain("destination=-1.451%2C36.953");
  });

  it("renders nothing at all when the business has no actionable contact or primary target", () => {
    const html = renderToStaticMarkup(
      createElement(ActionBar as any, {
        businessId: "biz-2",
        slug: "empty-studio",
        shopHref: "",
        bookHref: "",
        whatsapp: null,
        phone: null,
        location: null,
        lat: null,
        lng: null,
        primaryLabel: "Order",
        primaryHref: null,
        showCart: false,
      }),
    );
    expect(html).toBe("");
  });
});
