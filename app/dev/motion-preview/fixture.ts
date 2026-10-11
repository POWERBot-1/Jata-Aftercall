/** Synthetic renderer fixture only — no database, tenant authorization, payment or provider proof. */
import { createExperienceDocument } from "@/lib/experience/document";
import { getExperienceProfile } from "@/lib/experience/categories";
import { resolveExperienceTheme } from "@/lib/experience/themes";
import type { RenderPreference } from "@/lib/experience/renderMode";
import type { StorefrontData, StorefrontItem } from "@/lib/experience/storefront";

export function motionFixture(preference: RenderPreference = "motion", noMotion = false): StorefrontData {
  const document = createExperienceDocument({ categoryKey: "food", businessName: "Website Studio verification fixture", phone: "0700000000" });
  document.renderPreference = preference;
  document.brand.heroImageUrl = "/dev/motion-asset.svg";
  document.settings.whatsapp = "0700000000";
  document.settings.location = "Nairobi — synthetic verification fixture";
  document.sections = [
    { id: "hero-fixture", type: "hero", visible: true, title: "Fresh coastal dishes", subtitle: "Synthetic browser test — not a live business.", cta: { label: "View menu", href: "/b/motion-fixture/shop" } },
    { id: "menu-fixture", type: "menu", visible: true, title: "A server-rendered menu", limit: 6 },
    { id: "gallery-fixture", type: "gallery", visible: true, title: "A visible gallery", images: [{ url: "/dev/motion-asset.svg", alt: "Synthetic decorative image" }] },
    { id: "about-fixture", type: "about", visible: true, title: "About this fixture", body: "This uses the actual storefront renderer and actual lazy motion library, with fixed synthetic catalogue inputs. It does not prove a live payment, persistent upload or physical Android device." },
    { id: "faq-fixture", type: "faq", visible: true, title: "Useful information", items: [{ question: "Is this a live business?", answer: "No. This is a development-only verification fixture." }] },
    { id: "contact-fixture", type: "contact", visible: true, title: "Contact actions remain links" },
  ];
  let theme = resolveExperienceTheme("food-grill");
  if (noMotion) theme = { ...theme, treatment: { ...theme.treatment, motion: "none" } };
  const product: StorefrontItem = {
    id: "fixture-product", kind: "product", name: "Coastal lunch (fixture)", description: "A fixed synthetic menu item.",
    price: 149, wasPrice: null, priceLabel: null, pricingType: "FIXED", imageUrl: "/dev/motion-asset.svg", images: [],
    category: "Lunch", tags: [], brand: null, portionSize: null, ingredients: null, prepMinutes: null,
    durationMinutes: null, depositKES: null, staffName: null, availability: null, bookingEnabled: false,
    stockStatus: "IN_STOCK", isFeatured: true, variants: [], variantOptions: {}, addOns: [],
  };
  return {
    business: { id: "motion-fixture", slug: "motion-fixture", name: "Website Studio verification fixture", category: "food",
      phone: "0700000000", whatsapp: "0700000000", location: document.settings.location || null,
      lat: null, lng: null, description: "Development-only verification fixture.", logoUrl: null, isPublished: true, status: "ACTIVE" },
    document, theme, profile: getExperienceProfile("food"), items: [product], services: [], offer: null,
    categories: ["Lunch"], isPreview: true, publishedVersion: 0,
  };
}
