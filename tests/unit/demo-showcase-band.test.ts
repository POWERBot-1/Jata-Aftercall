/**
 * The motion-led band on the four public demo pages.
 *
 * It must appear only on the documented demo businesses, only when the page is public and only
 * when it actually lists services — a customer's own page never inherits demo copy or demo
 * imagery, and an empty demo page still shows its honest empty state.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

type Row = Record<string, any>;
const h = vi.hoisted(() => {
  const tables: Record<string, Row[]> = { business: [], service: [], offer: [], businessMember: [], subscription: [] };
  return { tables };
});

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));
vi.mock("@/lib/db", () => ({
  default: {
    business: {
      findUnique: async ({ where }: any) => {
        const b = h.tables.business.find((row) => row.slug === where.slug);
        if (!b) return null;
        return {
          ...structuredClone(b),
          services: h.tables.service.filter((s) => s.businessId === b.id).sort((a, c) => a.sortOrder - c.sortOrder),
          offer: h.tables.offer.find((o) => o.businessId === b.id) ?? null,
          subscription: h.tables.subscription.find((s) => s.businessId === b.id) ?? null,
          members: h.tables.businessMember.filter((m) => m.businessId === b.id),
        };
      },
    },
    businessExperience: { findUnique: async () => null },
  },
}));
vi.mock("@/lib/auth", () => ({ getSession: async () => null }));
vi.mock("@/lib/referral", () => ({ ensureReferralCode: async () => null, referralPath: () => "/r/x" }));
vi.mock("@/lib/ai-entitlement", () => ({ getAIPackageStatus: async () => ({ entitled: false }) }));

import PublicBusinessPage from "@/app/b/[slug]/page";
import { DEMO_BUSINESSES, DEMO_SLUGS } from "@/lib/demoData";
import { DEMO_SHOWCASES, buildDemoShowcase, demoShowcaseForSlug } from "@/lib/demoShowcase";

const BASE = { phone: null, whatsapp: null, location: null, description: null, theme: "clean", aftercallMsg: null, openingHours: null };
const reset = () => { for (const key of Object.keys(h.tables)) h.tables[key].length = 0; };

const seedDemo = (slug: string, options: { published?: boolean; services?: boolean } = {}) => {
  const demo = DEMO_BUSINESSES.find((entry) => entry.slug === slug)!;
  h.tables.business.push({
    id: `biz-${slug}`,
    slug,
    name: demo.name,
    category: demo.category,
    location: demo.location,
    ownerId: "owner-1",
    isPublished: options.published ?? true,
    status: "ACTIVE",
    ...BASE,
  });
  if (options.services !== false) {
    demo.services.forEach((service, index) => {
      h.tables.service.push({ id: `${slug}-s${index}`, businessId: `biz-${slug}`, title: service.title, priceLabel: service.priceLabel, priceFrom: service.priceFrom, sortOrder: index, isActive: true });
    });
  }
  h.tables.offer.push({ id: `${slug}-offer`, businessId: `biz-${slug}`, title: demo.offer.title, subtitle: demo.offer.subtitle, validFrom: null, validUntil: null, isActive: true });
};

const render = async (slug: string) =>
  renderToStaticMarkup(await PublicBusinessPage({ params: Promise.resolve({ slug }), searchParams: Promise.resolve({}) }));

beforeEach(() => { reset(); seedDemo("nyumbani-kitchen"); });

describe("demo showcase configuration", () => {
  it("answers for exactly the four demo slugs and nothing else", () => {
    for (const slug of DEMO_SLUGS) expect(demoShowcaseForSlug(slug), slug).toBeTruthy();
    for (const other of ["real-salon", "acme", "", "nyumbani"]) expect(demoShowcaseForSlug(other), other).toBeNull();
  });

  it("uses a distinct motion treatment per business", () => {
    expect(DEMO_SHOWCASES["nyumbani-kitchen"].motion).toBe("steam");
    expect(DEMO_SHOWCASES["marys-beauty-studio"].motion).toBe("salon");
    expect(DEMO_SHOWCASES["kamau-auto-care"].motion).toBe("drive");
    expect(DEMO_SHOWCASES["john-kamau-properties"].motion).toBe("tour");
    // The property story moves from the building to the home with a second frame.
    expect(DEMO_SHOWCASES["john-kamau-properties"].secondaryImage).toContain("interior");
  });

  it("labels its photography as illustrative in the alt text", () => {
    for (const config of Object.values(DEMO_SHOWCASES)) {
      expect(config.imageAlt).toContain("Illustrative");
      expect(config.imageAlt).toMatch(/not (the|a) /);
    }
  });

  it("builds nothing for a draft preview, an empty page or another tenant", () => {
    const services = [{ id: "s1", title: "Pilau", priceLabel: "KES 650" }];
    expect(buildDemoShowcase({ slug: "nyumbani-kitchen", decision: "preview", business: { name: "N", category: "Restaurant" }, services })).toBeNull();
    expect(buildDemoShowcase({ slug: "nyumbani-kitchen", decision: "public", business: { name: "N", category: "Restaurant" }, services: [] })).toBeNull();
    expect(buildDemoShowcase({ slug: "real-salon", decision: "public", business: { name: "R", category: "Beauty" }, services })).toBeNull();
  });

  it("caps the service list and keeps the page's own prices", () => {
    const services = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, title: `Service ${index}`, priceLabel: `KES ${100 + index}` }));
    const built = buildDemoShowcase({ slug: "nyumbani-kitchen", decision: "public", business: { name: "Nyumbani Kitchen", category: "Restaurant" }, services })!;
    expect(built.services).toHaveLength(4);
    expect(built.services.map((service) => service.priceLabel)).toEqual(["KES 100", "KES 101", "KES 102", "KES 103"]);
  });
});

describe("the band on a public demo page", () => {
  it("renders the story, the real services and the existing on-page actions", async () => {
    const html = await render("nyumbani-kitchen");
    const config = DEMO_SHOWCASES["nyumbani-kitchen"];

    expect(html).toContain('class="jata-showcase"');
    expect(html).toContain('data-motion="steam"');
    expect(html).toContain(config.headline);
    expect(html).toContain("Illustrative demo");
    expect(html).toContain("Illustrative photograph");
    // Real services with the page's own price labels.
    for (const service of DEMO_BUSINESSES[0].services) {
      expect(html).toContain(service.title);
      expect(html).toContain(service.priceLabel);
    }
    // Only in-page anchors: the band starts nothing new.
    expect(html).toContain('href="#services"');
    expect(html).toContain('href="#quote"');
    // React 18's server renderer emits the camelCase attribute name; browsers parse attribute
    // names case-insensitively, so the responsive source list is what matters here.
    expect(html).toMatch(/srcset="\/landing\/nyumbani-kitchen-720\.webp 720w, \/landing\/nyumbani-kitchen\.webp 1100w"/i);
    expect(html).toMatch(/srcset="\/landing\/nyumbani-kitchen-720\.jpg 720w, \/landing\/nyumbani-kitchen\.jpg 1100w"/i);
    expect(html).toContain('decoding="async"');
    expect(html).not.toContain("autoplay");
  });

  it("gives the vehicle story its motion treatment and the property story its second frame", async () => {
    seedDemo("kamau-auto-care");
    seedDemo("john-kamau-properties");
    expect(await render("kamau-auto-care")).toContain('data-motion="drive"');
    const property = await render("john-kamau-properties");
    expect(property).toContain('data-motion="tour"');
    expect(property).toContain("/landing/john-kamau-properties-interior");
  });

  it("never appears on a customer's own business page", async () => {
    h.tables.business.push({ id: "biz-real", slug: "real-salon", name: "Real Salon", category: "Beauty", ownerId: "cust-1", isPublished: true, status: "ACTIVE", ...BASE });
    h.tables.service.push({ id: "real-s1", businessId: "biz-real", title: "Braiding", priceLabel: "KES 9,999", sortOrder: 0, isActive: true });
    const html = await render("real-salon");
    expect(html).toContain("Real Salon");
    expect(html).not.toContain("jata-showcase");
    expect(html).not.toContain("Illustrative");
  });

  it("does not appear on an empty demo page, which keeps its honest empty state", async () => {
    reset();
    seedDemo("kamau-auto-care", { services: false });
    h.tables.offer.length = 0;
    const html = await render("kamau-auto-care");
    expect(html).not.toContain("jata-showcase");
    expect(html).toContain("No services listed yet");
  });

  it("does not appear on an unpublished demo page (404 instead)", async () => {
    reset();
    seedDemo("kamau-auto-care", { published: false });
    await expect(render("kamau-auto-care")).rejects.toThrow("NOT_FOUND");
  });
});
