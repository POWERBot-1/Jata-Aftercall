import { addSection, createExperienceDocument, themeOf, updateSection } from "@/lib/experience/document";
import { getExperienceProfile } from "@/lib/experience/categories";
import { validateForPublication } from "@/lib/experience/validate";
import type { EntitlementState } from "@/lib/experience/entitlement";
import type { StorefrontData, StorefrontItem } from "@/lib/experience/storefront";
import { briefFromRequirements, understandBrief } from "@/lib/openpage/requirements";
import { generateStudioCandidates } from "@/lib/openpage/generate";
import type { StudioPreviewBase } from "@/lib/openpage/previewData";

const HERO = "/category/grocery-1200.webp";
const GALLERY = "/category/grocery-720.jpg";

function item(overrides: Partial<StorefrontItem>): StorefrontItem {
  return {
    id: "product-1", kind: "product", name: "Nyama Choma Platter",
    description: "Charcoal-grilled goat with kachumbari.", price: 850, wasPrice: null,
    priceLabel: null, pricingType: "FIXED", imageUrl: "/category/grocery-720.jpg", images: [],
    category: "Grill", tags: [], brand: null, portionSize: "Serves 2", ingredients: null,
    prepMinutes: 25, durationMinutes: null, depositKES: null, staffName: null, availability: null,
    bookingEnabled: false, stockStatus: "IN_STOCK", isFeatured: true, variants: [], variantOptions: {}, addOns: [],
    ...overrides,
  };
}

export function websiteStudioFixture() {
  let document = createExperienceDocument({
    categoryKey: "food",
    businessName: "Choma Place",
    description: "Charcoal-grilled nyama choma in Kitengela, open late.",
    phone: "0712345678",
    location: "Kitengela",
  });
  document.brand.heroImageUrl = HERO;
  document.brand.tagline = "Grilled fresh, served warm";
  document = addSection(document, "gallery");
  const gallery = document.sections.find((section) => section.type === "gallery")!;
  document = updateSection(document, gallery.id, {
    images: [{ url: GALLERY, alt: "The grill at Choma Place" }],
  });

  const items = [
    item({}),
    item({ id: "product-2", name: "Kachumbari", price: 150, isFeatured: false, imageUrl: null }),
    item({ id: "product-3", name: "Ugali & Sukuma", price: 220, isFeatured: false, imageUrl: null }),
  ];

  const business = {
    id: "business-a", slug: "choma-place", name: "Choma Place", category: "food",
    phone: "0712345678", whatsapp: "0712345678", location: "Kitengela", lat: null, lng: null,
    description: "Charcoal-grilled nyama choma in Kitengela, open late.", logoUrl: null,
    isPublished: false, status: "DRAFT",
  };

  const base: StudioPreviewBase = {
    business,
    items,
    services: [],
    offer: null,
    categories: ["Grill"],
  };

  const requirements = understandBrief(
    "A warm nyama choma spot in Kitengela. Show the menu first, let people order on WhatsApp and make it feel premium.",
    {
      name: business.name, categoryKey: "food", description: business.description, location: "Kitengela",
      phone: business.phone, whatsapp: business.whatsapp, openingHours: null,
      products: items.length, services: 0, images: 2,
    },
  );

  const generated = generateStudioCandidates({
    baseDocument: document,
    businessId: business.id,
    requirements,
    brief: briefFromRequirements(requirements),
    counts: { products: items.length, services: 0 },
    seed: "dev-website-studio",
  });

  const entitlement: EntitlementState = {
    entitled: true,
    status: "ACTIVE",
    planKey: "INTERACTIVE_BUSINESS",
    expiresAt: null,
    reason: "Website Studio is active.",
  };

  const validation = validateForPublication({
    document: generated.candidates[0]?.document || document,
    business,
    productCount: items.length,
    serviceCount: 0,
    entitlement,
    paidPayment: { status: "PAID" },
    subscription: { status: "ACTIVE" },
  });

  return {
    business,
    document,
    base,
    generated,
    requirements,
    entitlement,
    validation,
    publicUrl: "/b/choma-place",
    examples: [
      "A warm nyama choma spot in Kitengela. Menu first, order on WhatsApp.",
      "A premium grill house for families and weekend crowds.",
      "A late-night street food spot with bold colours and quick ordering.",
    ],
  };
}

export type WebsiteStudioFixture = ReturnType<typeof websiteStudioFixture>;

export function previewDataFor(fixture: WebsiteStudioFixture, document: WebsiteStudioFixture["document"]): StorefrontData {
  return {
    ...fixture.base,
    document,
    theme: themeOf(document),
    profile: getExperienceProfile(document.categoryKey),
    isPreview: true,
    publishedVersion: 0,
  };
}
