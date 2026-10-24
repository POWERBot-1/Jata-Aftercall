/**
 * The cinematic band at the top of the four public demo pages.
 *
 * Scope boundary — this module only ever answers for the four documented demo slugs (the exact
 * slugs in `lib/demoData.ts`). It is never consulted for a customer's own page, so no customer
 * ever inherits demo copy, demo imagery or another tenant's content.
 *
 * Honesty rules:
 *   • Every photograph is labelled illustrative, in the alt text and in a visible note.
 *   • The services and prices shown come from the demo page's own rows; nothing is invented here.
 *   • The band links to the existing on-page anchors (`#services`, `#quote`), so every interaction
 *     is a real action that already existed. No new payment or checkout path is introduced.
 */

import { DEMO_SLUGS } from "./demoData";

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
    kicker: "In the kitchen",
    headline: "Slow-cooked pilau. Ready when you are.",
    lede: "The day's menu, the price of each plate and a one-tap WhatsApp to reserve — the same page a hungry customer sees after they call.",
    image: "/landing/nyumbani-kitchen",
    imageAlt: "A plate of Kenyan pilau with beef, kachumbari and chapati on a wooden table. Illustrative photograph, not the restaurant's own.",
    motion: "steam",
    detail: "Scroll to Services & prices to see each dish with the price the page displays, or use WhatsApp to ask about today's offer.",
  },
  "marys-beauty-studio": {
    slug: "marys-beauty-studio",
    kicker: "In the studio",
    headline: "Braids, nails, makeup — priced before you sit down.",
    lede: "A client in the chair, the services on offer and the price of each one, so the next client already knows what she is booking.",
    image: "/landing/marys-beauty-studio",
    imageAlt: "A stylist braiding a seated client's hair in a bright salon. Illustrative photograph, not the studio's own.",
    motion: "salon",
    detail: "Braiding, nails and makeup each carry their own price and description further down this page — open Services & prices to compare them.",
  },
  "kamau-auto-care": {
    slug: "kamau-auto-care",
    kicker: "On the road",
    headline: "Diagnosed, priced, agreed. Then the spanner comes out.",
    lede: "Diagnostics, oil and brakes with honest fundi pricing, written down before the car goes on the lift.",
    image: "/landing/kamau-auto-care",
    imageAlt: "A silver sedan on a Nairobi road at dusk with headlights on. Illustrative photograph, not the garage's own.",
    motion: "drive",
    detail: "Every service below shows its price range. Call or WhatsApp from the roadside and the garage can quote before you arrive.",
  },
  "john-kamau-properties": {
    slug: "john-kamau-properties",
    kicker: "On the ground",
    headline: "From the gate to the sitting room.",
    lede: "Rentals and plots presented properly — the area, the price range and a direct line to the person who can show you around.",
    image: "/landing/john-kamau-properties",
    secondaryImage: "/landing/john-kamau-properties-interior",
    imageAlt: "A modern apartment building in Kiambu at golden hour. Illustrative photograph, not a listing.",
    secondaryImageAlt: "A bright furnished one-bedroom sitting room opening onto a balcony. Illustrative photograph, not a listing.",
    motion: "tour",
    detail: "The price ranges below come from this example page's own listings. Request a viewing by WhatsApp or call — no payment is taken here.",
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
 * Requires all three: a documented demo slug, a public (published, non-draft) page decision, and
 * at least one service row. The service requirement is deliberate — an empty demo page keeps
 * showing its honest "No services listed yet" state instead of a band that implies listings exist.
 */
export function buildDemoShowcase(input: {
  slug: string;
  decision: string;
  business: { name: string; category: string; location?: string | null };
  services: readonly DemoShowcaseService[];
  offerTitle?: string | null;
}): DemoShowcaseProps | null {
  const config = demoShowcaseForSlug(input.slug);
  if (!config) return null;
  if (input.decision !== "public") return null;
  const services = input.services.filter((service) => service.title);
  if (services.length === 0) return null;
  return {
    ...config,
    businessName: input.business.name,
    category: input.business.category,
    location: input.business.location ?? null,
    services: services.slice(0, 4),
    offerTitle: input.offerTitle ?? null,
  };
}
