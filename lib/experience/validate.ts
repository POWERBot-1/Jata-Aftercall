/**
 * Publish validation (§58)
 *
 * A website does not go live because payment succeeded. It goes live when the business
 * itself is genuinely ready: real contact details, a primary visual, valid catalogue data,
 * a valid slug, verified payment and an active entitlement.
 *
 * Every check is a named, fixable item the owner can act on — never a generic "something
 * went wrong".
 */

import { validateSlug } from "../slug";
import { getExperienceProfile } from "./categories";
import { isValidThemeKey } from "./themes";
import { safeUrl } from "./document";
import type { EntitlementState } from "./entitlement";
import type { ExperienceDocument } from "./types";

export type PublishCheckId =
  | "business-name"
  | "business-category"
  | "contact"
  | "primary-visual"
  | "hero"
  | "sections"
  | "catalogue"
  | "prices"
  | "slug"
  | "payment"
  | "subscription"
  | "entitlement"
  | "references";

export type PublishCheck = {
  id: PublishCheckId;
  label: string;
  status: "pass" | "fail";
  hint?: string;
  href?: string;
};

export type PublishValidation = {
  ready: boolean;
  checks: PublishCheck[];
  failedCount: number;
};

export type PublishValidationInput = {
  document: ExperienceDocument;
  business: {
    name?: string | null;
    slug?: string | null;
    category?: string | null;
    phone?: string | null;
    whatsapp?: string | null;
    logoUrl?: string | null;
    isPublished?: boolean;
  };
  productCount: number;
  serviceCount: number;
  /** Catalogue rows that would be visible but are unusable (bad price, missing name). */
  invalidItems?: Array<{ id: string; name?: string | null; reason: string }>;
  entitlement: EntitlementState;
  paidPayment?: { status?: string | null } | null;
  subscription?: { status?: string | null } | null;
};

export function validateForPublication(input: PublishValidationInput): PublishValidation {
  const { document, business } = input;
  const profile = getExperienceProfile(document.categoryKey);
  const checks: PublishCheck[] = [];

  const add = (id: PublishCheckId, label: string, passed: boolean, hint?: string, href?: string) => {
    checks.push({ id, label, status: passed ? "pass" : "fail", hint: passed ? undefined : hint, href: passed ? undefined : href });
  };

  add(
    "business-name",
    "Business name",
    Boolean(business.name && business.name.trim().length >= 2),
    "Add your business name in Settings.",
    "/dashboard/settings",
  );

  add(
    "business-category",
    "Business category",
    Boolean(document.categoryKey && document.categoryKey !== "other") || Boolean(business.category),
    "Choose what kind of business you run so your website behaves correctly.",
    "/dashboard/settings",
  );

  add(
    "contact",
    "Contact details",
    Boolean(document.settings.phone || document.settings.whatsapp || business.phone || business.whatsapp),
    "Add a phone or WhatsApp number so customers can reach you.",
    "/dashboard/settings",
  );

  const heroSection = document.sections.find((section) => section.type === "hero" && section.visible);
  const heroImage = heroSection?.imageUrl || document.brand.heroImageUrl;
  add(
    "primary-visual",
    "Primary visual",
    Boolean(heroImage || business.logoUrl || document.brand.logoUrl),
    "Upload a hero photo or a logo — your website needs a strong first impression.",
    "/dashboard/website",
  );

  add(
    "hero",
    "Hero section visible",
    Boolean(heroSection),
    "Re-enable your hero section.",
    "/dashboard/website",
  );

  add(
    "sections",
    "Website sections",
    document.sections.filter((section) => section.visible && section.type !== "navigation").length >= 2,
    "Add at least two visible sections to your website.",
    "/dashboard/website",
  );

  const needsCatalogue = profile.capabilities.includes("commerce") || profile.capabilities.includes("catalogue");
  const needsServices = profile.capabilities.includes("booking");
  if (needsCatalogue) {
    add(
      "catalogue",
      `${profile.itemNounPlural} added`,
      input.productCount > 0,
      `Add your first ${profile.itemNoun.toLowerCase()} so customers have something to browse.`,
      "/dashboard/products",
    );
  }
  if (needsServices) {
    add(
      "catalogue",
      "Services added",
      input.serviceCount > 0,
      "Add your services with prices or durations so customers can book.",
      "/dashboard/services",
    );
  }

  const invalidItems = input.invalidItems || [];
  add(
    "prices",
    "Valid prices",
    invalidItems.length === 0,
    invalidItems[0]?.reason || "Check your prices — every priced item needs a valid amount.",
    "/dashboard/products",
  );

  const slugCheck = validateSlug(business.slug || "");
  add(
    "slug",
    "Valid website address",
    slugCheck.valid,
    slugCheck.reason || "Your website address is not valid.",
    "/dashboard/settings",
  );

  add(
    "payment",
    "Payment verified",
    input.paidPayment?.status === "PAID",
    "Complete your KES 999 payment to publish.",
    "/dashboard/subscription",
  );

  add(
    "subscription",
    "Active subscription",
    input.subscription?.status === "ACTIVE" || input.subscription?.status === "EXPIRING",
    "Your subscription is not active. Renew to publish.",
    "/dashboard/subscription",
  );

  add(
    "entitlement",
    "Interactive Business entitlement",
    input.entitlement.entitled,
    input.entitlement.reason,
    "/dashboard/subscription",
  );

  const broken = document.sections.some((section) => {
    if (section.imageUrl && !safeUrl(section.imageUrl)) return true;
    if (section.cta?.href && !safeUrl(section.cta.href) && !section.cta.href.startsWith("#")) return true;
    return (section.images || []).some((image) => !safeUrl(image.url));
  });
  add(
    "references",
    "No broken references",
    !broken && isValidThemeKey(document.themeKey),
    "One of your images or links could not be read. Re-upload it in the editor.",
    "/dashboard/website",
  );

  const failedCount = checks.filter((check) => check.status === "fail").length;
  return { ready: failedCount === 0, checks, failedCount };
}

/** Catalogue rows that cannot be shown to customers (bad price or missing name). */
export function findInvalidCatalogueItems(items: Array<{ id: string; name?: string | null; basePriceKES?: number | null; salePriceKES?: number | null }>) {
  const invalid: Array<{ id: string; name?: string | null; reason: string }> = [];
  for (const item of items) {
    if (!item.name || item.name.trim().length < 2) {
      invalid.push({ id: item.id, name: item.name, reason: "Every item needs a name." });
      continue;
    }
    const price = item.salePriceKES ?? item.basePriceKES ?? null;
    if (price === null) continue;
    if (!Number.isSafeInteger(Number(price)) || Number(price) < 0) {
      invalid.push({ id: item.id, name: item.name, reason: `${item.name} has an invalid price.` });
    }
  }
  return invalid;
}
