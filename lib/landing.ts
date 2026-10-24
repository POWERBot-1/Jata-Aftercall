/**
 * Public landing page content — the single source of marketing copy, demo-card data and the
 * benefit notes shown on the plan cards.
 *
 * Why a module instead of JSX literals: the page is server-rendered from data, so the copy can be
 * tested for accuracy (no invented numbers, testimonials, listings or prices) without rendering
 * React, and the four demo cards can be assembled from the *same* demo content the demo pages are
 * seeded from (`lib/demoData.ts`).
 *
 * Accuracy rules followed here:
 *   • No testimonials, ratings, customer counts, revenue or "X× more sales" claims — the product
 *     has no such verified data, so none is shown.
 *   • No invented prices. Plan prices come from the database (`lib/pricing.ts`); demo prices come
 *     from the demo business rows or, when those cannot be read, from the documented demo seed.
 *   • Imagery is illustrative and labelled as such everywhere it appears.
 */

import { DEMO_BUSINESSES, type DemoBusiness } from "./demoData";
import { formatKES } from "./format";

/* ── Benefit storytelling ────────────────────────────────────────────────── */

export type LandingStoryAct = { step: string; title: string; body: string };

/** The "moment after" narrative. No metrics — only what the product actually does. */
export const LANDING_STORY: readonly LandingStoryAct[] = [
  {
    step: "01",
    title: "A customer reaches out",
    body: "They call, WhatsApp or walk past. Most small businesses lose that moment because there is nothing to send them next.",
  },
  {
    step: "02",
    title: "Your page answers instantly",
    body: "Send one link. It opens fast on any Android phone with your offer, services, prices, directions and one-tap WhatsApp and Call.",
  },
  {
    step: "03",
    title: "You keep the sale",
    body: "Every tap is counted for you in the dashboard, so you can see what customers actually look at — and adjust your offer.",
  },
];

export type LandingBenefit = { icon: LandingIconKey; title: string; body: string };

export type LandingIconKey =
  | "phone"
  | "tag"
  | "map"
  | "cart"
  | "spark"
  | "chart"
  | "shield"
  | "bolt";

export const LANDING_BENEFITS: readonly LandingBenefit[] = [
  { icon: "phone", title: "WhatsApp & Call in one tap", body: "Large, thumb-sized buttons above the fold. No forms, no menus, no waiting for a reply." },
  { icon: "tag", title: "Today's offer, always visible", body: "Put the deal you are running today at the top of the page and change it whenever you like." },
  { icon: "cart", title: "Services and prices", body: "A clean list of what you sell with the price you charge, so customers arrive already knowing." },
  { icon: "map", title: "Directions that open Maps", body: "One tap to the map pin — useful for shops, salons, garages and viewings." },
  { icon: "chart", title: "Simple, private analytics", body: "Page views and taps on WhatsApp, Call, Directions, Share and services. No customer accounts, no tracking pixels." },
  { icon: "bolt", title: "Built for Kenyan phones", body: "Mobile-first, light on data and usable without installing an app." },
];

/* ── How it works ────────────────────────────────────────────────────────── */

export const LANDING_STEPS: readonly string[] = [
  "Business name & phone",
  "Category & location",
  "Choose a style",
  "Add services & offer",
  "Publish → share your link",
];

/* ── Plan notes ──────────────────────────────────────────────────────────── */

/**
 * What each advertised plan includes, keyed by the stable plan key.
 *
 * These describe shipped capability, not promises: the page, the contact actions, the analytics,
 * the AI front desk, and the Website Studio catalogue/booking/checkout surfaces that exist under
 * `/b/[slug]/shop` and `/b/[slug]/book`.
 */
export const PLAN_INCLUDES: Record<string, readonly string[]> = {
  MONTHLY: [
    "Your public page at /b/your-business",
    "WhatsApp, Call, Directions & Share",
    "Services, offer and opening hours",
    "Views and tap analytics in your dashboard",
  ],
  ANNUAL: [
    "Everything in the monthly plan",
    "One payment for a full year",
    "Same dashboard, same page, same support",
  ],
  AI_BUSINESS_FRONT_DESK: [
    "An AI front desk for your business page",
    "Answers customer questions from your own services and offer",
    "Sees the questions it could not answer, so you can improve the page",
  ],
  INTERACTIVE_BUSINESS: [
    "Website Studio: sections, theme and live preview",
    "Catalogue with prices, stock and orders",
    "Bookings and enquiries",
    "Checkout and order tracking on your own page",
  ],
};

/** Short factual badge per plan key. Nothing here is a popularity or performance claim. */
export const PLAN_BADGES: Record<string, string> = {
  ANNUAL: "One payment a year",
  AI_BUSINESS_FRONT_DESK: "Adds AI answers",
  INTERACTIVE_BUSINESS: "Full website",
};

/* ── FAQ ─────────────────────────────────────────────────────────────────── */

export type LandingFaq = { question: string; answer: string };

export const LANDING_FAQ: readonly LandingFaq[] = [
  {
    question: "Do I need a website already?",
    answer:
      "No. Your JATA AFTERCALL page is its own link. Put it in your WhatsApp Business profile, your Instagram or TikTok bio, your Google Business Profile, a poster or a receipt.",
  },
  {
    question: "How do my customers pay me?",
    answer:
      "The same way they do today — cash or M-Pesa, in your shop or on your till. The page takes no payments from your customers; it sends them to your WhatsApp, your phone or your directions.",
  },
  {
    question: "When does my page go public?",
    answer:
      "Once your subscription payment is confirmed by Paystack. Until then you can build, preview and edit the page as often as you like — only you can see the draft.",
  },
  {
    question: "What happens when my plan ends?",
    answer:
      "Your page is kept, but it shows that the subscription has expired until you renew from your dashboard. Nothing is deleted and your services and prices stay as you left them.",
  },
  {
    question: "Can I change my prices and offers?",
    answer:
      "Yes, from your dashboard at any time. Changes appear on the live page as soon as you save them.",
  },
  {
    question: "Is the Business POS part of these plans?",
    answer:
      "No. The Business POS is a separate owner-only point-of-sale that is configured and paid for inside your dashboard, per business. It is not included in, and not required for, the four page plans above.",
  },
  {
    question: "How do I pay for a plan?",
    answer:
      "Through Paystack, with M-Pesa or a card. Your card details are never stored by JATA AFTERCALL, and your plan starts only after the payment is confirmed.",
  },
  {
    question: "What does the analytics show?",
    answer:
      "Page views and taps on WhatsApp, Call, Directions, Share and services, counted per business in your own dashboard. There are no customer accounts and no third-party tracking pixels on your page.",
  },
];

/* ── Demo businesses ─────────────────────────────────────────────────────── */

export type LandingDemoCard = {
  slug: string;
  name: string;
  category: string;
  location: string;
  /** Image path (webp, with a jpg fallback handled by the component). */
  image: string;
  /** Describes the photograph and states plainly that it is illustrative. */
  imageAlt: string;
  kicker: string;
  headline: string;
  story: string;
  /** Motion style applied to the panel media. */
  motion: "steam" | "salon" | "drive" | "tour";
  /** Real, currently-listed services (name + the exact price label shown on the page). */
  services: { title: string; priceLabel: string }[];
  offer: { title: string; subtitle: string } | null;
  /** "live" when the rows came from the published demo page; "example" for documented seed copy. */
  source: "live" | "example";
  /** Optional second frame (used by the property story to move from the building to the home). */
  inset?: { image: string; alt: string };
};

const DEMO_PRESENTATION: Record<
  string,
  { image: string; kicker: string; headline: string; story: string; motion: LandingDemoCard["motion"]; altScene: string }
> = {
  "nyumbani-kitchen": {
    image: "/landing/nyumbani-kitchen",
    kicker: "Restaurant · Kilimani",
    headline: "Smell the pilau before you arrive.",
    story:
      "Preparation, plated dishes and the menu in one page: what is cooking today, what it costs, and a one-tap WhatsApp to reserve a plate.",
    motion: "steam",
    altScene: "A plate of Kenyan pilau with beef, kachumbari and folded chapati on a wooden table",
  },
  "marys-beauty-studio": {
    image: "/landing/marys-beauty-studio",
    kicker: "Beauty · Kitengela",
    headline: "The chair is warm. The price is clear.",
    story:
      "A stylist at work, the services on offer and what each one costs — so a client books the braids, nails or makeup they actually want.",
    motion: "salon",
    altScene: "A stylist braiding a seated client's hair in a bright salon",
  },
  "kamau-auto-care": {
    image: "/landing/kamau-auto-care",
    kicker: "Mechanic · Westlands",
    headline: "Back on the road, with the price agreed first.",
    story:
      "Diagnostics, oil and brakes listed with honest fundi pricing. Call or WhatsApp from the roadside and know the cost before the car is lifted.",
    motion: "drive",
    altScene: "A silver sedan on a Nairobi road at dusk with headlights on",
  },
  "john-kamau-properties": {
    image: "/landing/john-kamau-properties",
    kicker: "Real estate · Kiambu",
    headline: "See the home before the viewing.",
    story:
      "Rentals and plots presented properly, with the area, the price range and a direct line to the person who can actually show you around.",
    motion: "tour",
    altScene: "A modern apartment building in Kiambu at golden hour",
  },
};

/** The illustrative interior photograph used as the second frame of the property story. */
export const PROPERTY_INTERIOR_IMAGE = "/landing/john-kamau-properties-interior";

function priceLabelOf(service: DemoBusiness["services"][number]): string {
  return service.priceLabel || `From ${formatKES(service.priceFrom)}`;
}

function cardFromDemo(demo: DemoBusiness, source: LandingDemoCard["source"]): LandingDemoCard {
  const presentation = DEMO_PRESENTATION[demo.slug];
  const inset =
    demo.slug === "john-kamau-properties"
      ? {
          image: PROPERTY_INTERIOR_IMAGE,
          alt: "A bright furnished sitting room opening onto a balcony. Illustrative photograph, not a listing.",
        }
      : undefined;
  return {
    slug: demo.slug,
    name: demo.name,
    category: demo.category,
    location: demo.location,
    image: presentation.image,
    imageAlt: `${presentation.altScene}. Illustrative photograph for the ${demo.name} example page — not a photo of the business.`,
    kicker: presentation.kicker,
    headline: presentation.headline,
    story: presentation.story,
    motion: presentation.motion,
    services: demo.services.map((service) => ({ title: service.title, priceLabel: priceLabelOf(service) })),
    offer: demo.offer,
    source,
    inset,
  };
}

export type LandingDemoRow = {
  slug: string;
  name: string;
  category: string | null;
  location: string | null;
  services: { title: string; priceLabel: string | null; priceFrom: number | null; isActive?: boolean | null }[];
  offer: { title: string; subtitle: string | null } | null;
};

/**
 * Builds the four demo cards.
 *
 * A published demo row that still lists services is shown as `live`, using the price labels that
 * the demo page itself renders. When the row is missing, unpublished, has no services, or the read
 * failed, the documented demo content is shown instead and marked `example` — never a made-up
 * price. The order is always the fixed demo order.
 */
export function buildLandingDemoCards(rows: readonly LandingDemoRow[] | null | undefined): LandingDemoCard[] {
  const bySlug = new Map((rows ?? []).map((row) => [row.slug, row]));
  return DEMO_BUSINESSES.map((demo) => {
    const row = bySlug.get(demo.slug);
    const services = (row?.services ?? []).filter((service) => service.isActive !== false);
    if (!row || services.length === 0) return cardFromDemo(demo, "example");
    return {
      ...cardFromDemo(demo, "live"),
      name: row.name || demo.name,
      category: row.category || demo.category,
      location: row.location || demo.location,
      services: services.slice(0, 3).map((service) => ({
        title: service.title,
        priceLabel: service.priceLabel || (service.priceFrom ? `From ${formatKES(service.priceFrom)}` : "Ask for a price"),
      })),
      offer: row.offer ? { title: row.offer.title, subtitle: row.offer.subtitle ?? "" } : null,
    };
  });
}

/** Fixed demo order, used by the homepage, the demo pages and the tests. */
export const LANDING_DEMO_SLUGS: readonly string[] = DEMO_BUSINESSES.map((demo) => demo.slug);
