/**
 * Owner directive 2026-10-27 Phase 3 — regression contract for the four visible demo contact
 * actions. These tests intentionally render the REAL components (no component mocks) so that a
 * future change that removes an icon, a label or an href fails here.
 */
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: any) => createElement("a", { href, ...rest }, children),
}));
vi.mock("@/components/storefront/CartProvider", () => ({ useCart: () => ({ count: 0, setOpen: vi.fn() }) }));
vi.mock("@/components/storefront/Track", () => ({ trackEvent: vi.fn() }));
vi.mock("@/app/api/analytics/event/route", () => ({}));

import { buildContactActions, shareBusinessPage, shareUrlFor } from "@/lib/contactActions";
import { resolveDemoContacts, isPublicDemoRow, OFFICIAL_DEMO_CONTACT } from "@/lib/demoContact";
import { ContactActions } from "@/components/storefront/ContactActions";
import { ActionBar } from "@/components/storefront/ActionBar";
import BusinessPage from "@/components/BusinessPage";
import { resolveTheme } from "@/lib/themes";

const demo = {
  slug: "nyumbani-kitchen",
  name: "Nyumbani Kitchen",
  category: "Restaurant",
  whatsapp: OFFICIAL_DEMO_CONTACT,
  phone: OFFICIAL_DEMO_CONTACT,
  location: "Kilimani, Nairobi",
  lat: null,
  lng: null,
};
const demoIdentity = { slug: demo.slug, name: demo.name, ownerEmail: "demo@jata.link", paymentReferences: [] };

function renderContact(props: Record<string, unknown> = {}) {
  return renderToStaticMarkup(createElement(ContactActions as any, { business: demo, businessId: "biz-demo", ...props } as any));
}

describe("pure destination builder", () => {
  it("normalises every supported Kenyan format to one wa.me and tel destination", () => {
    for (const value of ["0724317010", "254724317010", "+254724317010", "+254 724 317 010", "724317010"]) {
      const plan = buildContactActions({ ...demo, whatsapp: value, phone: value });
      expect(plan.whatsappHref).toContain("https://wa.me/254724317010?text=");
      expect(plan.callHref).toBe("tel:+254724317010");
    }
  });

  it("uses a prefilled message naming the actual business", () => {
    const plan = buildContactActions(demo);
    expect(decodeURIComponent(plan.whatsappHref || "")).toContain("Hi Nyumbani Kitchen");
  });

  it("builds Directions from configured coordinates first, then the stored address", () => {
    expect(buildContactActions({ ...demo, lat: -1.2921, lng: 36.8219 }).directionsHref).toContain("destination=-1.2921%2C36.8219");
    expect(buildContactActions(demo).directionsHref).toContain("destination=Kilimani%2C%20Nairobi");
  });

  it("never invents a destination for missing or malformed data", () => {
    const plan = buildContactActions({ ...demo, whatsapp: "call-me", phone: null, location: null, lat: null, lng: null });
    expect(plan.whatsappHref).toBeNull();
    expect(plan.callHref).toBeNull();
    expect(plan.directionsHref).toBeNull();
    expect(plan.unavailable.whatsapp).toMatch(/unavailable/);
    expect(plan.unavailable.directions).toMatch(/no address or map coordinates/);
  });

  it("shares the canonical public business URL, not a tracking/preview URL", () => {
    const plan = buildContactActions(demo);
    expect(shareUrlFor(plan, "https://jata-aftercall.vercel.app")).toBe("https://jata-aftercall.vercel.app/b/nyumbani-kitchen");
  });
});

describe("share behaviour", () => {
  const plan = buildContactActions(demo);

  it("uses native share with business details when available", async () => {
    const share = vi.fn(async () => {});
    const result = await shareBusinessPage(plan, { origin: "https://jata-aftercall.vercel.app", share, clipboard: { writeText: vi.fn() } });
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ title: "Nyumbani Kitchen", url: expect.stringContaining("/b/nyumbani-kitchen") }));
    expect(result.ok).toBe(true);
  });

  it("falls back to the clipboard when there is no native share", async () => {
    const writeText = vi.fn(async () => {});
    const result = await shareBusinessPage(plan, { origin: "https://jata-aftercall.vercel.app", clipboard: { writeText } });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("https://jata-aftercall.vercel.app/b/nyumbani-kitchen"));
    expect(result.message).toMatch(/Link copied/);
  });

  it("falls back to the clipboard when native share rejects", async () => {
    const writeText = vi.fn(async () => {});
    const result = await shareBusinessPage(plan, {
      origin: "https://jata-aftercall.vercel.app",
      share: async () => { throw new Error("NotAllowedError"); },
      clipboard: { writeText },
    });
    expect(writeText).toHaveBeenCalled();
    expect(result.ok).toBe(true);
  });

  it("uses the legacy textarea copy when the async clipboard API rejects", async () => {
    const legacyCopy = vi.fn(() => true);
    const result = await shareBusinessPage(plan, {
      origin: "https://jata-aftercall.vercel.app",
      clipboard: { writeText: async () => { throw new Error("denied"); } },
      legacyCopy,
    });
    expect(legacyCopy).toHaveBeenCalledWith(expect.stringContaining("/b/nyumbani-kitchen"));
    expect(result.ok).toBe(true);
    expect(result.message).toMatch(/Link copied/);
  });

  it("shows an honest manual-copy message when neither mechanism works", async () => {
    const result = await shareBusinessPage(plan, {
      origin: "https://jata-aftercall.vercel.app",
      clipboard: { writeText: async () => { throw new Error("denied"); } },
      legacyCopy: () => false,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("Copy this link to share:");
  });

  it("treats a cancelled native share as a cancellation, not an error", async () => {
    const abort = Object.assign(new Error("cancelled"), { name: "AbortError" });
    const result = await shareBusinessPage(plan, { origin: "https://jata-aftercall.vercel.app", share: async () => { throw abort; } });
    expect(result.message).toMatch(/cancelled/i);
  });
});

describe("all four icons are visibly rendered", () => {
  it("renders four labelled, icon-bearing controls on the classic component", () => {
    const html = renderContact();
    for (const key of ["whatsapp", "call", "directions", "share"]) {
      expect(html).toContain(`data-contact-action="${key}"`);
    }
    for (const label of ["WhatsApp", "Call", "Directions", "Share"]) {
      expect(html).toContain(label);
    }
    expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(4);
    expect(html).toContain("wa.me/254724317010");
    expect(html).toContain("tel:+254724317010");
    expect(html).toContain("google.com/maps/dir/");
    expect(html).toContain("jata-contact-action__label");
  });

  it("renders honest disabled states instead of dead links when data is missing", () => {
    const html = renderToStaticMarkup(createElement(ContactActions as any, {
      business: { slug: "empty", name: "Empty Shop", whatsapp: null, phone: "123", location: null },
      group: "primary",
    } as any));
    for (const key of ["whatsapp", "call", "directions", "share"]) {
      expect(html).toContain(`data-contact-action="${key}"`);
    }
    expect(html).toContain('data-contact-state="unavailable"');
    expect(html).not.toContain("wa.me/");
    expect(html).not.toContain("tel:");
    expect(html).toContain('aria-disabled="true"');
    expect(html).toContain('aria-label="Directions — unavailable"');
  });

  it("renders all four controls on the experience ActionBar (mobile)", () => {
    const html = renderToStaticMarkup(createElement(ActionBar as any, {
      businessId: "biz-demo",
      slug: demo.slug,
      shopHref: `/b/${demo.slug}/shop`,
      bookHref: "",
      whatsapp: demo.whatsapp,
      phone: demo.phone,
      location: demo.location,
      lat: null,
      lng: null,
      primaryLabel: "Order",
      primaryHref: null,
      showCart: false,
      businessName: demo.name,
    } as any));
    for (const key of ["whatsapp", "call", "directions", "share"]) {
      expect(html).toContain(`data-contact-action="${key}"`);
    }
    expect(html).toContain("wa.me/254724317010");
    expect(html).toContain("tel:+254724317010");
    expect(html).toContain("<svg");
  });

  it("renders both the above-the-fold and sticky sets on a real BusinessPage", () => {
    const html = renderToStaticMarkup(createElement(BusinessPage as any, {
      business: { ...demo, id: "biz-demo", theme: "warm" },
      services: [],
      offer: null,
      theme: resolveTheme("warm"),
      demoPage: true,
    } as any));
    const groups = html.match(/data-contact-group="[^"]+"/g) || [];
    expect(groups).toContain('data-contact-group="primary"');
    expect(groups).toContain('data-contact-group="sticky"');
    for (const key of ["whatsapp", "call", "directions", "share"]) {
      expect(html).toContain(`data-contact-action="${key}"`);
    }
    expect(html.match(/<svg/g)?.length).toBeGreaterThanOrEqual(8);
  });
});

describe("verified demo contact resolution (read-only)", () => {
  it("uses the official demo line for a verified fictional row still holding a placeholder", () => {
    const result = resolveDemoContacts(demoIdentity, { phone: "0700000001", whatsapp: "254700000001" });
    expect(result).toEqual({ phone: OFFICIAL_DEMO_CONTACT, whatsapp: OFFICIAL_DEMO_CONTACT, usedOfficialDemoContact: true });
    const plan = buildContactActions({ ...demo, whatsapp: result.whatsapp, phone: result.phone });
    expect(plan.whatsappHref).toContain("wa.me/254724317010");
  });

  it("keeps a real number configured on a verified demo row", () => {
    const result = resolveDemoContacts(demoIdentity, { phone: "0721359955", whatsapp: null });
    expect(result.phone).toBe("0721359955");
    expect(result.whatsapp).toBe(OFFICIAL_DEMO_CONTACT);
  });

  it("never touches a row that is not a verified fictional demo", () => {
    for (const identity of [
      { ...demoIdentity, name: "A Real Customer Business" },
      { ...demoIdentity, slug: "real-customer-biz" },
      { ...demoIdentity, paymentReferences: ["PAYSTACK-abc123"] },
    ]) {
      const result = resolveDemoContacts(identity, { phone: "0700000001", whatsapp: "0700000001" });
      expect(result.phone).toBe("0700000001");
      expect(result.usedOfficialDemoContact).toBe(false);
    }
  });

  it("applies to all four mandated demo slugs", async () => {
    const { DEMO_BUSINESSES } = await import("@/lib/demoData");
    for (const fixture of DEMO_BUSINESSES) {
      const result = resolveDemoContacts({ slug: fixture.slug, name: fixture.name, ownerEmail: "demo@jata.link", paymentReferences: [] }, { phone: "0700000001", whatsapp: "0700000001" });
      expect(result.whatsapp).toBe(OFFICIAL_DEMO_CONTACT);
      const plan = buildContactActions({ slug: fixture.slug, name: fixture.name, whatsapp: result.whatsapp, phone: result.phone, location: fixture.location });
      expect(plan.whatsappHref).toContain("wa.me/254724317010");
      expect(plan.callHref).toBe("tel:+254724317010");
      expect(plan.directionsHref).toContain("google.com/maps/dir/");
    }
  });
});


describe("verified browser-console defect fix", () => {
  it("uses the React 18 camelCase fetchPriority attribute on every priority image", async () => {
    const { readFileSync } = await import("node:fs");
    const files = [
      "components/landing/DemoShowcase.tsx",
      "components/landing/Hero.tsx",
      "components/storefront/DemoShowcaseBand.tsx",
    ];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      expect(source, file).not.toContain("fetchpriority");
      expect(source, file).toContain('fetchPriority: "high"');
    }
  });
});


describe("public demo row identity (homepage links and demo labelling)", () => {
  it("recognises all four seeded fictional rows even when the owner identity no longer matches", async () => {
    const { DEMO_BUSINESSES } = await import("@/lib/demoData");
    for (const fixture of DEMO_BUSINESSES) {
      expect(isPublicDemoRow({
        slug: fixture.slug,
        name: fixture.name,
        ownerEmail: "someone@example.com",
        paymentReferences: [],
      }), fixture.slug).toBe(true);
    }
  });

  it("accepts harmless name whitespace/casing and the seed's demo- payment namespace", () => {
    expect(isPublicDemoRow({ ...demoIdentity, name: "  nyumbani kitchen  ", paymentReferences: ["demo-nyumbani-kitchen"] })).toBe(true);
  });

  it("excludes a paying customer, a different name, a missing name or an unknown slug", () => {
    expect(isPublicDemoRow({ ...demoIdentity, name: "A Real Restaurant", paymentReferences: [] })).toBe(false);
    expect(isPublicDemoRow({ ...demoIdentity, name: null, paymentReferences: [] })).toBe(false);
    expect(isPublicDemoRow({ ...demoIdentity, slug: "real-restaurant", paymentReferences: [] })).toBe(false);
    expect(isPublicDemoRow({ ...demoIdentity, paymentReferences: ["PSK_real_payment"] })).toBe(false);
    expect(isPublicDemoRow({ ...demoIdentity, paymentReferences: ["demo-row", "PSK_real_payment"] })).toBe(false);
  });

  it("still keeps the owner-bound verifier strict for write paths", async () => {
    const { isVerifiedDemoRecord } = await import("@/lib/demoContent");
    expect(isVerifiedDemoRecord({ slug: demo.slug, ownerEmail: "someone@example.com", paymentReferences: [] })).toBe(false);
    expect(isVerifiedDemoRecord({ slug: demo.slug, ownerEmail: "demo@jata.link", paymentReferences: [] })).toBe(true);
  });
});
