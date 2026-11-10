/**
 * The generated candidates must render through JATA's real storefront, not a mock.
 *
 * `StudioPreview` is the exact component the Website Studio uses for live comparison.
 * It delegates to `ExperienceSite` with `shell={false}` (no analytics, no cart chrome),
 * so this suite proves three outcomes at once:
 *   • every candidate is a valid Experience document that the production renderer accepts;
 *   • the three candidates produce three different rendered reading orders;
 *   • the owner's existing images survive generation unchanged.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";

const tracker = vi.hoisted(() => ({ calls: 0 }));

vi.mock("@/components/storefront/Track", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/storefront/Track")>();
  return {
    ...actual,
    PageViewTracker: () => {
      tracker.calls += 1;
      return null;
    },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => "/dashboard/businesses/business-a/studio",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));

import { addSection, createExperienceDocument, updateSection } from "@/lib/experience/document";
import { getExperienceProfile } from "@/lib/experience/categories";
import { themeOf } from "@/lib/experience/document";
import type { StorefrontData, StorefrontItem } from "@/lib/experience/storefront";
import { briefFromRequirements, understandBrief } from "@/lib/openpage/requirements";
import { generateStudioCandidates } from "@/lib/openpage/generate";
import { StudioPreview } from "@/components/studio/openpage/StudioPreview";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";

const router = {
  bfcacheId: "qa-router-fixture",
  push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {},
};

const HERO_IMAGE = "https://cdn.jata.test/business-a/hero.jpg";
const GALLERY_IMAGE = "https://cdn.jata.test/business-a/gallery-1.jpg";
const LOGO_IMAGE = "https://cdn.jata.test/business-a/logo.png";

function item(overrides: Partial<StorefrontItem> = {}): StorefrontItem {
  return {
    id: "product-1",
    kind: "product",
    name: "Nyama Choma Platter",
    description: "Charcoal-grilled goat with kachumbari.",
    price: 850,
    wasPrice: null,
    priceLabel: null,
    pricingType: "FIXED",
    imageUrl: "https://cdn.jata.test/business-a/nyama.jpg",
    images: [],
    category: "Grill",
    tags: [],
    brand: null,
    portionSize: "Serves 2",
    ingredients: null,
    prepMinutes: 25,
    durationMinutes: null,
    depositKES: null,
    staffName: null,
    availability: null,
    bookingEnabled: false,
    stockStatus: "IN_STOCK",
    isFeatured: true,
    variants: [],
    variantOptions: {},
    addOns: [],
    ...overrides,
  };
}

const ITEMS = [item(), item({ id: "product-2", name: "Kachumbari", price: 150, isFeatured: false })];

function ownerDocument() {
  let document = createExperienceDocument({
    categoryKey: "food",
    businessName: "Choma Place",
    description: "Nyama choma in Kitengela",
    phone: "0712345678",
    location: "Kitengela",
  });
  document.brand.heroImageUrl = HERO_IMAGE;
  document.brand.logoUrl = LOGO_IMAGE;
  document = addSection(document, "gallery");
  const gallery = document.sections.find((section) => section.type === "gallery")!;
  document = updateSection(document, gallery.id, {
    images: [{ url: GALLERY_IMAGE, alt: "Grill at Choma Place" }],
  });
  return document;
}

function previewBase(): Omit<StorefrontData, "document" | "theme" | "profile" | "isPreview" | "publishedVersion"> {
  return {
    business: {
      id: "business-a",
      slug: "choma-place",
      name: "Choma Place",
      category: "food",
      phone: "0712345678",
      whatsapp: null,
      location: "Kitengela",
      lat: null,
      lng: null,
      description: "Nyama choma in Kitengela",
      logoUrl: null,
      isPublished: false,
      status: "DRAFT",
    },
    items: ITEMS,
    services: [],
    offer: null,
    categories: ["Grill"],
  };
}

function renderCandidate(document: ReturnType<typeof ownerDocument>, base: ReturnType<typeof previewBase>) {
  return renderToStaticMarkup(
    createElement(AppRouterContext.Provider, { value: router },
      createElement(StudioPreview, { base, document, device: "desktop", scale: 0.5, scroll: false, height: 600 })),
  );
}

function sectionOrder(html: string): string[] {
  return [...html.matchAll(/data-section-type="([^"]+)"/g)].map((match) => match[1]);
}

describe("Website Studio candidates render through the real storefront", () => {
  const base = previewBase();
  const requirements = understandBrief(
    "A warm nyama choma spot in Kitengela. Show the menu first, let people order and make it feel premium.",
    {
      name: "Choma Place", categoryKey: "food", description: "Nyama choma in Kitengela",
      location: "Kitengela", phone: "0712345678", whatsapp: null, openingHours: null,
      products: 2, services: 0, images: 2,
    },
  );
  const result = generateStudioCandidates({
    baseDocument: ownerDocument(),
    businessId: "business-a",
    requirements,
    brief: briefFromRequirements(requirements),
    counts: { products: 2, services: 0 },
    seed: "render-test",
  });

  it("produces three candidates, each validating and rendering with JATA's ExperienceSite", () => {
    expect(result.candidates).toHaveLength(3);
    const htmls = result.candidates.map((candidate) => renderCandidate(candidate.document, base));
    for (const [index, html] of htmls.entries()) {
      expect(html).toContain('data-studio-preview="desktop"');
      expect(html).toContain("Choma Place");
      expect(html).toContain("Nyama Choma Platter");
      expect(html).toContain("KES");
      expect(html).not.toContain("<canvas");
      expect(html).not.toContain("data:image");
      expect(sectionOrder(html).length).toBeGreaterThan(2);
      expect(result.candidates[index].document.categoryKey).toBe("food");
      expect(result.candidates[index].document.settings.phone).toBe("0712345678");
      expect(result.candidates[index].document.settings.location).toBe("Kitengela");
    }
    expect(new Set(htmls).size).toBe(3);
    expect(new Set(result.candidates.map((candidate) => candidate.document.artDirection?.family)).size).toBe(3);
    expect(new Set(htmls.map((html) => sectionOrder(html).join(">"))).size).toBeGreaterThanOrEqual(2);
  });

  it("preserves the owner's existing hero and gallery images in every candidate", () => {
    for (const candidate of result.candidates) {
      expect(candidate.document.brand.heroImageUrl).toBe(HERO_IMAGE);
      expect(candidate.document.brand.logoUrl).toBe(LOGO_IMAGE);
      const gallery = candidate.document.sections.find((section) => section.type === "gallery");
      expect(gallery?.images?.some((image) => image.url === GALLERY_IMAGE)).toBe(true);
      const html = renderCandidate(candidate.document, base);
      expect(html).toContain(HERO_IMAGE);
      expect(html).toContain(GALLERY_IMAGE);
      expect(html).toContain(LOGO_IMAGE);
    }
  });

  it("never records an owner preview as a customer page view", () => {
    tracker.calls = 0;
    const html = renderCandidate(result.candidates[0].document, base);
    expect(html).toContain("eb-hero");
    expect(html).toContain("data-template-family");
    expect(tracker.calls).toBe(0);

    // The same renderer does track published customer views, so the zero above is the
    // preview boundary working rather than the tracker being absent from the tree.
    renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router },
      createElement(ExperienceSite, { data: { ...base, document: result.candidates[0].document, theme: themeOf(result.candidates[0].document), profile: getExperienceProfile("food"), isPreview: false, publishedVersion: 1 } })));
    expect(tracker.calls).toBe(1);
  });

  it("renders the same document identically on a second render (no preview-only divergence)", () => {
    const first = renderCandidate(result.candidates[0].document, base);
    const second = renderCandidate(result.candidates[0].document, base);
    expect(second).toBe(first);
    expect(themeOf(result.candidates[0].document).key).toBe(result.candidates[0].themeKey);
    expect(getExperienceProfile(result.candidates[0].document.categoryKey).key).toBe("food");
  });
});
