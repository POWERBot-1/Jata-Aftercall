/**
 * Website health, readiness score and conversion recommendations (§24, §25, §36, §46)
 *
 * One pure function decides what is missing from a website and what it would take to fix it.
 * It is not an engagement device: every point in the score corresponds to something a customer
 * would notice, the factors are weighted by how much they matter to a real visitor, and a check
 * only passes when the storefront genuinely renders better because of it.
 *
 * "Fix with JATA" is a *proposal*, never a silent edit: each fixable check names the exact draft
 * change it would make, and the owner confirms it (§5, §36).
 */

import { getExperienceProfile } from "../experience/categories";
import { navigationFor } from "../experience/document";
import type { ExperienceDocument, ExperienceProfile } from "../experience/types";

export type HealthGroup = "business" | "catalogue" | "photos" | "conversion" | "seo" | "mobile";

export type HealthFix =
  | { kind: "apply"; id: StudioFixId; label: string; description: string }
  | { kind: "link"; href: string; label: string }
  | { kind: "photo-lab"; label: string; subjectType: "PRODUCT" | "SERVICE" | "BUSINESS"; subjectId: string | null; subjectName: string };

export type StudioFixId =
  | "hero-copy"
  | "add-primary-cta"
  | "show-contact"
  | "feature-items"
  | "compact-mobile"
  | "seo-copy"
  | "hours-section"
  | "whatsapp-number";

export type HealthCheck = {
  id: string;
  group: HealthGroup;
  label: string;
  /** What the owner should do, in plain language. */
  detail: string;
  status: "pass" | "attention";
  /** Points this check contributes when it passes. */
  weight: number;
  fix?: HealthFix;
};

export type HealthReport = {
  score: number;
  band: "excellent" | "good" | "needs-work" | "starting";
  bandLabel: string;
  summary: string;
  passing: HealthCheck[];
  attention: HealthCheck[];
  /** The three things worth doing first. */
  topActions: HealthCheck[];
  /** Conversion-specific suggestions, phrased the way an owner thinks (§25). */
  recommendations: string[];
};

export type HealthInput = {
  document: ExperienceDocument;
  business: {
    name?: string | null;
    category?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    location?: string | null;
    logoUrl?: string | null;
    description?: string | null;
    openingHours?: string | null;
  };
  counts: {
    products: number;
    services: number;
    media: number;
    /** Catalogue rows that have no image at all. */
    itemsWithoutPhotos?: number;
    /** Library images too small to look good on a website. */
    lowResolutionImages?: number;
  };
  items?: Array<{ id: string; name: string; imageUrl: string | null; isFeatured?: boolean; priceKes?: number | null }>;
  published?: boolean;
  /** True when the last generation used a photographic provider. */
  photographicProvider?: boolean;
};

const WEIGHTS = {
  name: 6,
  category: 4,
  contact: 10,
  whatsapp: 4,
  location: 4,
  hours: 5,
  description: 5,
  heroVisible: 8,
  heroImage: 12,
  catalogue: 12,
  featured: 6,
  photos: 14,
  cta: 10,
  seo: 8,
  mobile: 6,
} as const;

function hasVisible(document: ExperienceDocument, type: string): boolean {
  return document.sections.some((section) => section.type === type && section.visible);
}

function section(document: ExperienceDocument, type: string) {
  return document.sections.find((entry) => entry.type === type && entry.visible) || null;
}

function heroImageOf(document: ExperienceDocument): string {
  const hero = section(document, "hero");
  return hero?.imageUrl || document.brand.heroImageUrl || "";
}

export function buildHealthReport(input: HealthInput): HealthReport {
  const { document, business, counts } = input;
  const profile: ExperienceProfile = getExperienceProfile(document.categoryKey);
  const checks: HealthCheck[] = [];

  const add = (check: Omit<HealthCheck, "status"> & { passed: boolean }) => {
    const { passed, ...rest } = check;
    checks.push({ ...rest, status: passed ? "pass" : "attention" });
  };

  // ── The business's own facts ────────────────────────────────────────────────
  add({
    id: "business-name",
    group: "business",
    label: "Business name",
    detail: "Your site shows your business name at the top.",
    weight: WEIGHTS.name,
    passed: Boolean((business.name || document.brand.businessName || "").trim().length >= 2),
    fix: { kind: "link", href: "settings", label: "Add your business name" },
  });

  add({
    id: "business-category",
    group: "business",
    label: "Business type set",
    detail: "JATA shapes sections, wording and CTAs around what you sell.",
    weight: WEIGHTS.category,
    passed: document.categoryKey !== "other" || Boolean(business.category),
    fix: { kind: "link", href: "settings", label: "Choose your business type" },
  });

  add({
    id: "contact",
    group: "business",
    label: "Phone or WhatsApp reachable",
    detail: "Customers need one tap to call or message you.",
    weight: WEIGHTS.contact,
    passed: Boolean(document.settings.phone || document.settings.whatsapp || business.phone || business.whatsapp),
    fix: { kind: "link", href: "settings", label: "Add a phone number" },
  });

  add({
    id: "whatsapp",
    group: "conversion",
    label: "WhatsApp button",
    detail: "Most Kenyan customers prefer WhatsApp to a phone call.",
    weight: WEIGHTS.whatsapp,
    passed: Boolean(document.settings.whatsapp || business.whatsapp),
    fix: { kind: "apply", id: "whatsapp-number", label: "Use my phone number for WhatsApp", description: "JATA will use the same number you already entered for the WhatsApp button." },
  });

  add({
    id: "location",
    group: "business",
    label: "Location shown",
    detail: "Customers can find you and open directions.",
    weight: WEIGHTS.location,
    passed: Boolean(document.settings.location || business.location),
    fix: { kind: "link", href: "settings", label: "Add your location" },
  });

  add({
    id: "hours",
    group: "business",
    label: "Opening hours",
    detail: "Answers the first question every customer asks.",
    weight: WEIGHTS.hours,
    passed: Boolean(business.openingHours || (document.settings.openingHours && Object.keys(document.settings.openingHours).length > 0)),
    // Hours are a business fact: JATA will add the section, never invent the times (§55).
    fix: { kind: "link", href: "settings", label: "Add your opening hours" },
  });

  add({
    id: "description",
    group: "business",
    label: "Short business description",
    detail: "One line telling customers what you do.",
    weight: WEIGHTS.description,
    passed: Boolean((document.brand.description || business.description || "").trim().length > 20),
    fix: { kind: "link", href: "design", label: "Write a description with JATA" },
  });

  // ── The homepage ────────────────────────────────────────────────────────────
  const hero = section(document, "hero");
  add({
    id: "hero-visible",
    group: "conversion",
    label: "Homepage opening section",
    detail: "The first thing a customer sees.",
    weight: WEIGHTS.heroVisible,
    passed: Boolean(hero),
    fix: { kind: "apply", id: "hero-copy", label: "Rebuild my opening section", description: "JATA will restore the hero using your business name and description." },
  });

  const heroCopy = `${hero?.title || ""} ${hero?.subtitle || ""} ${document.brand.tagline || ""}`.trim();
  add({
    id: "hero-copy",
    group: "conversion",
    label: "Clear headline",
    detail: "Says who you are and what you offer in one line.",
    weight: 6,
    passed: heroCopy.length >= 12,
    fix: { kind: "apply", id: "hero-copy", label: "Write my headline with JATA", description: "JATA will fill the headline from your business name, type and description." },
  });

  add({
    id: "hero-image",
    group: "photos",
    label: "Opening image",
    detail: "A strong first image makes the site feel real.",
    weight: WEIGHTS.heroImage,
    passed: Boolean(heroImageOf(document) || business.logoUrl || document.brand.logoUrl),
    fix: {
      kind: "photo-lab",
      label: "Create an opening image",
      subjectType: "BUSINESS",
      subjectId: null,
      subjectName: business.name || document.brand.businessName || "",
    },
  });

  const primaryCta = document.sections
    .filter((entry) => entry.visible)
    .map((entry) => entry.cta?.label || (entry.type === "hero" ? entry.cta?.label : ""))
    .filter((label): label is string => Boolean(label && label.trim()));
  add({
    id: "primary-action",
    group: "conversion",
    label: "One clear action",
    detail: `A “${profile.cta.primary}” button customers cannot miss.`,
    weight: WEIGHTS.cta,
    passed: primaryCta.length > 0,
    fix: { kind: "apply", id: "add-primary-cta", label: `Add a “${profile.cta.primary}” button`, description: "JATA will add one clear call-to-action section with your main action." },
  });

  add({
    id: "contact-section",
    group: "conversion",
    label: "Contact section",
    detail: "Call, WhatsApp, email and directions in one place.",
    weight: 5,
    passed: hasVisible(document, "contact"),
    fix: { kind: "apply", id: "show-contact", label: "Show my contact section", description: "JATA will re-enable the contact section with your saved details." },
  });

  // ── Catalogue ───────────────────────────────────────────────────────────────
  const needsCatalogue = profile.capabilities.includes("commerce") || profile.capabilities.includes("catalogue");
  const needsServices = profile.capabilities.includes("booking");
  const catalogueCount = counts.products + counts.services;
  add({
    id: "catalogue",
    group: "catalogue",
    label: `${profile.itemNounPlural} added`,
    detail: `Customers can see what you sell.`,
    weight: WEIGHTS.catalogue,
    passed: needsCatalogue || needsServices ? catalogueCount > 0 : true,
    fix: { kind: "link", href: "items", label: `Add your first ${profile.itemNoun.toLowerCase()}` },
  });

  const showFeatured = needsCatalogue || needsServices;
  add({
    id: "featured",
    group: "catalogue",
    label: "Popular items on the homepage",
    detail: "Three to six of your best sellers, featured where customers land.",
    weight: WEIGHTS.featured,
    passed: !showFeatured || (hasVisible(document, "featured") && catalogueCount > 0),
    fix: { kind: "apply", id: "feature-items", label: "Show my popular items", description: "JATA will add a featured section showing your latest items with prices you set." },
  });

  const itemsWithoutPhotos = counts.itemsWithoutPhotos ?? 0;
  add({
    id: "item-photos",
    group: "photos",
    label: "Photos on every item",
    detail: itemsWithoutPhotos > 0 ? `${itemsWithoutPhotos} ${itemsWithoutPhotos === 1 ? "item has" : "items have"} no photo yet.` : "Every item has a photo.",
    weight: WEIGHTS.photos,
    passed: itemsWithoutPhotos === 0,
    fix:
      itemsWithoutPhotos > 0
        ? {
            kind: "photo-lab",
            label: "Create item photos",
            subjectType: "PRODUCT",
            subjectId: input.items?.find((item) => !item.imageUrl)?.id ?? null,
            subjectName: input.items?.find((item) => !item.imageUrl)?.name ?? profile.itemNoun,
          }
        : undefined,
  });

  const lowRes = counts.lowResolutionImages ?? 0;
  add({
    id: "image-quality",
    group: "photos",
    label: "Sharp, well-sized images",
    detail: lowRes > 0 ? `${lowRes} image${lowRes === 1 ? " is" : "s are"} small enough to look soft on a phone.` : "Images are large enough to look sharp.",
    weight: 6,
    passed: lowRes === 0,
    fix: { kind: "link", href: "photos", label: "Review my images" },
  });

  // ── SEO ─────────────────────────────────────────────────────────────────────
  add({
    id: "seo-title",
    group: "seo",
    label: "Search title",
    detail: "What people see in Google results.",
    weight: 4,
    passed: Boolean(document.seo?.title && document.seo.title.trim().length > 6),
    fix: { kind: "apply", id: "seo-copy", label: "Write my search title", description: "JATA will use your business name, type and location — nothing invented." },
  });

  add({
    id: "seo-description",
    group: "seo",
    label: "Search description",
    detail: "The line under your name in Google.",
    weight: 4,
    passed: Boolean(document.seo?.description && document.seo.description.trim().length > 20),
    fix: { kind: "apply", id: "seo-copy", label: "Write my search description", description: "JATA will describe what you offer using your own business details." },
  });

  // ── Mobile ──────────────────────────────────────────────────────────────────
  const heavySections = document.sections.filter(
    (entry) => entry.visible && (entry.type === "menu" || entry.type === "services" || entry.type === "properties") && (entry.layout === "grid" || (!entry.layout && (entry.limit ?? 0) > 9)),
  );
  add({
    id: "mobile-layout",
    group: "mobile",
    label: "Comfortable on a phone",
    detail: heavySections.length > 0 ? "Long grids make customers scroll a lot on a phone." : "Sections are sized for a phone screen.",
    weight: WEIGHTS.mobile,
    passed: heavySections.length === 0,
    fix: { kind: "apply", id: "compact-mobile", label: "Make my lists phone-friendly", description: "JATA will shorten long lists and use the compact layout. Your items stay exactly as they are." },
  });

  const nav = navigationFor(document);
  add({
    id: "navigation",
    group: "mobile",
    label: "Easy navigation",
    detail: "Customers can jump straight to what they came for.",
    weight: 4,
    passed: nav.length >= 2,
    fix: { kind: "link", href: "sections", label: "Add another section" },
  });

  const passing = checks.filter((check) => check.status === "pass");
  const attention = checks.filter((check) => check.status === "attention");
  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0) || 1;
  const earned = passing.reduce((sum, check) => sum + check.weight, 0);
  const score = Math.max(0, Math.min(100, Math.round((earned / totalWeight) * 100)));

  const band: HealthReport["band"] = score >= 90 ? "excellent" : score >= 70 ? "good" : score >= 45 ? "needs-work" : "starting";
  const bandLabel = band === "excellent" ? "Excellent" : band === "good" ? "Good" : band === "needs-work" ? "Needs work" : "Just started";

  const topActions = [...attention].sort((a, b) => b.weight - a.weight).slice(0, 3);

  return {
    score,
    band,
    bandLabel,
    summary:
      attention.length === 0
        ? "Everything a customer needs is in place."
        : `${passing.length} of ${checks.length} checks pass. ${topActions.length} thing${topActions.length === 1 ? "" : "s"} worth fixing first.`,
    passing,
    attention,
    topActions,
    recommendations: recommendationsFor({ document, profile, attention, counts, items: input.items || [] }),
  };
}

/** §25 — conversion suggestions in the owner's own language. */
function recommendationsFor(input: {
  document: ExperienceDocument;
  profile: ExperienceProfile;
  attention: HealthCheck[];
  counts: HealthInput["counts"];
  items: NonNullable<HealthInput["items"]>;
}): string[] {
  const { document, profile, attention, counts, items } = input;
  const lines: string[] = [];
  const attentionIds = new Set(attention.map((check) => check.id));

  if (attentionIds.has("primary-action")) lines.push("Your homepage has no clear ordering button.");
  if ((profile.capabilities.includes("commerce") || profile.capabilities.includes("catalogue")) && counts.products > 0 && attentionIds.has("featured")) {
    lines.push(`You have ${counts.products} ${counts.products === 1 ? profile.itemNoun.toLowerCase() : profile.itemNounPlural.toLowerCase()} but nothing featured on the homepage.`);
  }
  if (attentionIds.has("hours")) lines.push("Your business has no opening hours.");
  if (attentionIds.has("whatsapp")) lines.push("Your contact section does not include WhatsApp.");
  if (attentionIds.has("hero-image")) lines.push("Your homepage has no opening image.");
  if (attentionIds.has("item-photos") && (counts.itemsWithoutPhotos ?? 0) > 0) {
    lines.push(`${counts.itemsWithoutPhotos} ${counts.itemsWithoutPhotos === 1 ? "item has" : "items have"} no photo.`);
  }
  if (attentionIds.has("image-quality") && (counts.lowResolutionImages ?? 0) > 0) lines.push("Some images are low quality and will look soft.");
  if (attentionIds.has("seo-description")) lines.push("Your search description is missing, so Google shows a guess.");
  if (attentionIds.has("mobile-layout")) lines.push("Your long lists are heavy on a phone — a compact layout scrolls better.");
  if (attentionIds.has("contact")) lines.push("Customers cannot call or message you in one tap yet.");
  if (items.some((item) => item.priceKes === null || item.priceKes === undefined) && profile.capabilities.includes("commerce")) {
    lines.push("Some items have no price — customers may leave instead of asking.");
  }
  if (document.settings.deliveryEnabled === false && profile.capabilities.includes("delivery")) {
    lines.push("Delivery is switched off — turn it on if you deliver.");
  }
  return lines.slice(0, 6);
}

/** One-line status for the Studio home tile. */
export function healthSummaryLine(report: HealthReport): string {
  return `Website readiness: ${report.score}% · ${report.bandLabel}`;
}
