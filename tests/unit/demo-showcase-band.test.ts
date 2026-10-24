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
          owner: { email: b.ownerEmail },
          payments: structuredClone(b.payments ?? []),
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
import { DEMO_BUSINESSES, DEMO_OWNER_EMAIL, DEMO_SLUGS } from "@/lib/demoData";
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
    ownerEmail: DEMO_OWNER_EMAIL,
    payments: [{ reference: `demo-${slug}` }],
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
    const services = [{ id: "s1", title: "Pilau", priceLabel: "KES 650", isActive: true }];
    expect(buildDemoShowcase({ slug: "nyumbani-kitchen", decision: "preview", isVerifiedDemo: true, business: { name: "N", category: "Restaurant" }, services })).toBeNull();
    expect(buildDemoShowcase({ slug: "nyumbani-kitchen", decision: "public", isVerifiedDemo: true, business: { name: "N", category: "Restaurant" }, services: [] })).toBeNull();
    expect(buildDemoShowcase({ slug: "real-salon", decision: "public", isVerifiedDemo: true, business: { name: "R", category: "Beauty" }, services })).toBeNull();
    expect(buildDemoShowcase({ slug: "nyumbani-kitchen", decision: "public", isVerifiedDemo: false, business: { name: "Real Kitchen", category: "Restaurant" }, services })).toBeNull();
  });

  it("caps active services and keeps the page's own sample prices", () => {
    const services = Array.from({ length: 7 }, (_, index) => ({ id: `s${index}`, title: `Service ${index}`, priceLabel: `KES ${100 + index}`, isActive: true }));
    const built = buildDemoShowcase({ slug: "nyumbani-kitchen", decision: "public", isVerifiedDemo: true, business: { name: "Nyumbani Kitchen", category: "Restaurant" }, services })!;
    expect(built.services).toHaveLength(4);
    expect(built.services.map((service) => service.priceLabel)).toEqual(["KES 100", "KES 101", "KES 102", "KES 103"]);
  });

  it("excludes inactive services and hides inactive or expired offers using Offer schema fields", () => {
    const now = new Date("2026-10-24T12:00:00.000Z");
    const services = [
      { id: "active", title: "Active service", isActive: true },
      { id: "inactive", title: "Inactive service", isActive: false },
    ];
    const offer = { title: "Stale database wording", isActive: true, validUntil: new Date("2026-10-23T23:59:59.000Z") };
    const built = buildDemoShowcase({
      slug: "nyumbani-kitchen",
      decision: "public",
      isVerifiedDemo: true,
      business: { name: "Nyumbani Kitchen", category: "Restaurant" },
      services,
      offer,
    }, now)!;
    expect(built.services.map((service) => service.title)).toEqual(["Active service"]);
    expect(built.offerTitle).toBeNull();

    const current = buildDemoShowcase({
      slug: "nyumbani-kitchen",
      decision: "public",
      isVerifiedDemo: true,
      business: { name: "Nyumbani Kitchen", category: "Restaurant" },
      services,
      offer: { title: "Untrusted current text", isActive: true, validUntil: new Date("2026-10-25T00:00:00.000Z") },
    }, now)!;
    expect(current.offerTitle).toBe(DEMO_BUSINESSES[0].offer.title);
    expect(current.offerTitle).not.toBe("Untrusted current text");
  });

  it("never shows a property offer as if it were a current listing", () => {
    const built = buildDemoShowcase({
      slug: "john-kamau-properties",
      decision: "public",
      isVerifiedDemo: true,
      business: { name: "John Kamau Properties", category: "Real Estate" },
      services: [{ id: "sample-rental", title: "1BR Rentals", isActive: true }],
      offer: { title: "Viewing this weekend", isActive: true, validUntil: null },
    })!;
    expect(built.offerTitle).toBeNull();
    expect(built.lede).not.toMatch(/viewing this weekend|this weekend/i);
  });
});

describe("the band on a public demo page", () => {
  it("renders the fictional story, active sample services and existing on-page actions", async () => {
    const html = await render("nyumbani-kitchen");
    const config = DEMO_SHOWCASES["nyumbani-kitchen"];

    expect(html).toContain('class="jata-showcase"');
    expect(html).toContain('data-motion="steam"');
    expect(html).toContain(config.headline);
    expect(html).toContain("Illustrative demo");
    expect(html).toContain("Fictional demo only");
    expect(html).toContain("Fictional demo page");
    expect(html).toContain("Illustrative photograph");
    // Active sample services with their fixture price labels.
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
    expect(property).toContain("Fictional property-page demonstration");
    expect(property).not.toMatch(/verified listings|no brokers|viewing this weekend/i);
    expect(property).not.toContain(DEMO_BUSINESSES.find((demo) => demo.slug === "john-kamau-properties")!.offer.title);
  });

  it("filters inactive demo services and an inactive or expired demo offer from the public route", async () => {
    const inactiveServices = h.tables.service.filter((row) => row.businessId === "biz-nyumbani-kitchen");
    inactiveServices.forEach((service) => { service.isActive = false; });
    const offer = h.tables.offer.find((row) => row.businessId === "biz-nyumbani-kitchen")!;
    offer.isActive = false;
    offer.title = "Stale inactive offer";
    const html = await render("nyumbani-kitchen");
    for (const service of inactiveServices) expect(html).not.toContain(service.title);
    expect(html).not.toContain("Stale inactive offer");
    expect(html).toContain("No services listed yet");
    expect(html).not.toContain("jata-showcase");

    offer.isActive = true;
    offer.validUntil = new Date(Date.now() - 1000);
    offer.title = "Stale expired offer";
    const expired = await render("nyumbani-kitchen");
    expect(expired).not.toContain("Stale expired offer");
  });

  it("never appears on a customer's own business page", async () => {
    h.tables.business.push({ id: "biz-real", slug: "real-salon", name: "Real Salon", category: "Beauty", ownerId: "cust-1", isPublished: true, status: "ACTIVE", ...BASE });
    h.tables.service.push({ id: "real-s1", businessId: "biz-real", title: "Braiding", priceLabel: "KES 9,999", sortOrder: 0, isActive: true });
    const html = await render("real-salon");
    expect(html).toContain("Real Salon");
    expect(html).not.toContain("jata-showcase");
    expect(html).not.toContain("Illustrative");
  });

  it("does not mark an authorized real owner as fictional when its slug matches a showcase slug", async () => {
    const business = h.tables.business.find((row) => row.slug === "nyumbani-kitchen")!;
    Object.assign(business, {
      name: "Authorized Kitchen",
      ownerEmail: "real-owner@example.com",
      payments: [{ reference: "PSK_real_payment" }],
    });
    h.tables.service[0].title = "Owner menu item";
    h.tables.service[0].priceLabel = "KES 999";
    const html = await render("nyumbani-kitchen");
    expect(html).toContain("Authorized Kitchen");
    expect(html).toContain("Owner menu item");
    expect(html).not.toContain("Fictional demo page");
    expect(html).not.toContain("Illustrative demo");
    expect(html).not.toContain("Sample offer · fictional");
  });

  it("filters inactive services and inactive or expired offers on a real business page", async () => {
    h.tables.business.push({ id: "biz-real", slug: "real-salon", name: "Real Salon", category: "Beauty", ownerId: "owner-real", isPublished: true, status: "ACTIVE", ...BASE });
    h.tables.service.push(
      { id: "real-active", businessId: "biz-real", title: "Visible service", sortOrder: 0, isActive: true },
      { id: "real-inactive", businessId: "biz-real", title: "Hidden service", sortOrder: 1, isActive: false },
    );
    h.tables.offer.push({ id: "real-offer", businessId: "biz-real", title: "Inactive offer", subtitle: null, isActive: false, validUntil: null });
    const inactive = await render("real-salon");
    expect(inactive).toContain("Visible service");
    expect(inactive).not.toContain("Hidden service");
    expect(inactive).not.toContain("Inactive offer");

    const offer = h.tables.offer.find((row) => row.businessId === "biz-real")!;
    offer.isActive = true;
    offer.validUntil = new Date(Date.now() - 1000);
    offer.title = "Expired offer";
    const expired = await render("real-salon");
    expect(expired).not.toContain("Expired offer");
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
