/**
 * The cinematic band at the top of the four public demo pages.
 *
 * Scope boundary — this module only ever answers for the four documented demo slugs (the exact
 * slugs in `lib/demoData.ts`) and the builder additionally requires a verified seed-demo owner
 * with no non-demo payment references. A slug collision alone never labels an authorized business
 * as fictional or adds demo imagery.
 *
 * Honesty rules:
 *   • Every photograph is labelled illustrative, in the alt text and in a visible note.
 *   • Only active service rows and current offers are considered; all shown demo values are labeled fictional.
 *   • The band links to existing on-page anchors (`#services`, `#quote`) and adds no payment path.
 */

import { DEMO_BUSINESSES, DEMO_SLUGS } from "./demoData";
import { activePublicServices, isCurrentPublicOffer, type OfferStatus } from "./demoContent";

export type DemoShowcaseMotion = "steam" | "salon" | "drive" | "tour";

export type DemoShowcaseConfig = {
  slug: string;
  kicker: string;
  headline: string;
  lede: string;
  /** Image path without an extension; the component serves .webp with a .jpg fallback. */
  image: string;
  /** Second frame used by the property story crossfade. */
  secondaryImage?: string;
  imageAlt: string;
  secondaryImageAlt?: string;
  motion: DemoShowcaseMotion;
  /** One short sentence revealing what the example page demonstrates. */
  detail: string;
};

export const DEMO_SHOWCASES: Readonly<Record<string, DemoShowcaseConfig>> = {
  "nyumbani-kitchen": {
    slug: "nyumbani-kitchen",
    kicker: "Restaurant page example",
    headline: "A sample food page, from menu to contact.",
    lede: "Illustrative food photography alongside fictional sample services and prices; this is not today's menu or a current offer.",
    image: "/landing/nyumbani-kitchen",
    imageAlt: "A plate of Kenyan pilau with beef, kachumbari and chapati on a wooden table. Illustrative photograph, not the restaurant's own.",
    motion: "steam",
    detail: "This fictional page demonstrates a services-and-prices layout. Menu details and values are examples, not current business information.",
  },
  "marys-beauty-studio": {
    slug: "marys-beauty-studio",
    kicker: "Beauty page example",
    headline: "A beauty page with sample services and prices.",
    lede: "Illustrative salon photography alongside fictional braiding, nail and makeup entries; details and prices are examples only.",
    image: "/landing/marys-beauty-studio",
    imageAlt: "A stylist braiding a seated client's hair in a bright salon. Illustrative photograph, not the studio's own.",
    motion: "salon",
    detail: "The page shows example service entries and sample values. It does not describe a current promotion or confirm appointment availability.",
  },
  "kamau-auto-care": {
    slug: "kamau-auto-care",
    kicker: "Auto-care page example",
    headline: "An example auto-care page layout.",
    lede: "Sample diagnostics, oil-change and brake entries with illustrative photography; these details are not a current quote.",
    image: "/landing/kamau-auto-care",
    imageAlt: "A silver sedan on a Nairobi road at dusk with headlights on. Illustrative photograph, not the garage's own.",
    motion: "drive",
    detail: "The service entries and values are fictional samples, not an estimate or confirmation that work is available.",
  },
  "john-kamau-properties": {
    slug: "john-kamau-properties",
    kicker: "Property page example",
    headline: "A fictional property-page layout.",
    lede: "Sample rental and land categories only. They are not property listings, availability statements or viewing details.",
    image: "/landing/john-kamau-properties",
    secondaryImage: "/landing/john-kamau-properties-interior",
    imageAlt: "A modern apartment building in Kiambu at golden hour. Illustrative photograph, not a listing.",
    secondaryImageAlt: "A bright furnished one-bedroom sitting room opening onto a balcony. Illustrative photograph, not a listing.",
    motion: "tour",
    detail: "The categories and prices are fictional examples. No property, rental, viewing date or availability has been verified.",
  },
};

export function demoShowcaseForSlug(slug: string): DemoShowcaseConfig | null {
  if (!DEMO_SLUGS.includes(slug)) return null;
  return DEMO_SHOWCASES[slug] ?? null;
}

export type DemoShowcaseService = {
  id: string;
  title: string;
  description?: string | null;
  priceLabel?: string | null;
  priceFrom?: number | null;
  isActive: boolean;
};

export type DemoShowcaseProps = DemoShowcaseConfig & {
  businessName: string;
  category: string;
  location: string | null;
  services: DemoShowcaseService[];
  offerTitle: string | null;
};

/**
 * Builds the band's props, or `null` when it must not render.
 *
 * Requires a verified seeded-demo identity (not just a matching slug), a public (published,
 * non-draft) page decision, and at least one active service row. Offers use the persisted
 * active/expiry fields, while visible offer text remains a fictional sample. An empty page keeps
 * its honest empty state.
 */
export function buildDemoShowcase(
  input: {
    slug: string;
    decision: string;
    isVerifiedDemo: boolean;
    business: { name: string; category: string; location?: string | null };
    services: readonly DemoShowcaseService[];
    offer?: OfferStatus | null;
  },
  now: Date = new Date(),
): DemoShowcaseProps | null {
  const config = demoShowcaseForSlug(input.slug);
  if (!config || !input.isVerifiedDemo) return null;
  if (input.decision !== "public") return null;
  const services = activePublicServices(input.services);
  if (services.length === 0) return null;
  const fixture = DEMO_BUSINESSES.find((demo) => demo.slug === input.slug);
  const offerTitle =
    input.slug !== "john-kamau-properties" && isCurrentPublicOffer(input.offer, now) ? fixture?.offer.title ?? null : null;
  return {
    ...config,
    businessName: input.business.name,
    category: input.business.category,
    location: input.business.location ?? null,
    services: services.slice(0, 4),
    offerTitle,
  };
}
