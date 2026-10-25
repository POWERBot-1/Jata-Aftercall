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
 *   • No testimonials, ratings, customer counts, revenue, outcome or universal analytics claims.
 *   • Plan prices come from the database (`lib/pricing.ts`); demo prices are visibly labelled as
 *     fictional examples and never presented as current listings, quotes or promotions.
 *   • Imagery is illustrative and labelled as such everywhere it appears.
 */

import { DEMO_BUSINESSES, type DemoBusiness } from "./demoData";
import { activePublicServices, isCurrentPublicOffer } from "./demoContent";
import { formatKES } from "./format";

/* ── Benefit storytelling ────────────────────────────────────────────────── */

export type LandingStoryAct = { step: string; title: string; body: string };

/** The "moment after" narrative. No metrics — only what the product actually does. */
export const LANDING_STORY: readonly LandingStoryAct[] = [
  {
    step: "01",
    title: "A customer reaches out",
    body: "They call, send a WhatsApp or visit. A simple page can put your business details, services and contact options in one place.",
  },
  {
    step: "02",
    title: "Share one page",
    body: "Share a mobile-friendly link with your business details, services, prices, directions and WhatsApp and Call actions.",
  },
  {
    step: "03",
    title: "Check selected activity",
    body: "Your dashboard can show page views and selected actions such as WhatsApp, Call, Directions, Share and service clicks. Some events may not be recorded, so not every tap is guaranteed to appear.",
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
  | "bolt"
  | "calendar"
  | "bot"
  | "wand"
  | "store";

export const LANDING_BENEFITS: readonly LandingBenefit[] = [
  { icon: "phone", title: "WhatsApp & Call in one tap", body: "Large, thumb-sized contact buttons above the fold. Customers can reach you without filling in a form." },
  { icon: "tag", title: "Highlight an offer", body: "Add an offer to your page and update or deactivate it when its details change." },
  { icon: "cart", title: "Services and prices", body: "List your services and the prices you choose to share." },
  { icon: "map", title: "Directions that open Maps", body: "Share a location on your page so customers can open directions in Maps." },
  { icon: "chart", title: "Selected activity in your dashboard", body: "See recorded page views and selected WhatsApp, Call, Directions, Share and service-click events. Some events may not be recorded; not every tap is guaranteed to appear." },
  { icon: "bolt", title: "Built for Kenyan phones", body: "A mobile-friendly page customers can open in their browser without installing an app." },
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
    "Recorded page views and selected action counts in your dashboard",
  ],
  ANNUAL: [
    "Everything in the monthly plan",
    "One payment for a full year",
    "The same dashboard and public page",
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

/**
 * One recognisable icon per advertised plan, keyed by the stable plan key.
 *
 * The glyphs mirror the workspace rail (`components/DashboardNav.tsx`): the page plans keep the
 * phone/calendar story, the AI Business Front Desk is the bot, Website Studio is the wand, the
 * Business POS is the storefront and JATA Autopilot is the spark — the same mark the dashboard
 * and the Autopilot Command Center already use for that product. Every card renders its icon, so
 * the shared card rows stay aligned; the icon is decorative (`aria-hidden`) because the plan name
 * beside it is the accessible label. The two owner-only cards carry their icon in their own card
 * copy below, next to the rest of their wording.
 */
export const PLAN_ICONS: Record<string, LandingIconKey> = {
  MONTHLY: "phone",
  ANNUAL: "calendar",
  AI_BUSINESS_FRONT_DESK: "bot",
  INTERACTIVE_BUSINESS: "wand",
};

/**
 * The Business POS card — copy only, deliberately outside `PLAN_INCLUDES`/`PLAN_BADGES`.
 *
 * Those two maps describe the four page plans, and a page plan must never read as including the
 * POS. The POS is the owner's operating system: a separate, per-business product whose card sits
 * in the same pricing grid (owner request, 2026-10-25) but whose call to action leads into the
 * authenticated `/dashboard/pos` flow. Its price and billing period come from `PlanConfig`.
 */
export const POS_PLAN_CARD = {
  icon: "store" as LandingIconKey,
  badge: "Owner-only",
  blurb:
    "A point-of-sale for your counter — sales, stock, credit and reports. Per business, separate from your page plan. It is owner-only.",
  includes: [
    "Sales, stock, credit and reports",
    "Configured around how your business works",
    "Per business, opened from your own dashboard",
  ],
  cta: "Open Business POS",
  fine: "Sign in from your dashboard. It switches on only once Paystack confirms the payment.",
} as const;

/**
 * The JATA Autopilot card — copy only, deliberately outside `PLAN_INCLUDES`/`PLAN_BADGES`, for
 * exactly the reason the POS card is: those maps describe the four page plans, and a page plan
 * must never read as including Autopilot.
 *
 * JATA Autopilot is a separate, per-business owner product. This card advertises only the
 * standard package (`JATA_AUTOPILOT` in `AUTOPILOT_PLAN_CATALOG`): its price and billing period
 * come from `PlanConfig`, never from this copy, and its call to action leads into the
 * authenticated `/dashboard/autopilot` flow, where the free preview, the Command Center and the
 * existing Paystack checkout already live. The wording stays inside what the product verifiably
 * does today — business health diagnosis with the 15 industry packs, draft offer/FAQ actions in
 * an approval queue where nothing runs without the owner's approval, and a free preview before
 * paying. It does not promise live customer messaging: outbound sending stays behind consent,
 * spend and provider controls inside the product.
 */
export const AUTOPILOT_PLAN_CARD = {
  icon: "spark" as LandingIconKey,
  badge: "Owner-only add-on",
  blurb:
    "A supervised assistant that checks your business health and drafts actions for your approval. Per business, separate from your page plan. It is owner-only.",
  includes: [
    "Business health diagnosis with 15 industry packs",
    "Draft offer and FAQ actions in an approval queue",
    "Nothing runs without your approval",
    "Preview it free in your dashboard before you pay",
  ],
  cta: "Open JATA Autopilot",
  fine: "Sign in from your dashboard. The preview is free; live actions switch on only once Paystack confirms the payment.",
} as const;

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
      "No. The Business POS is a separate owner-only point-of-sale that is configured and paid for inside your dashboard, per business. It is not included in, and not required for, the four page plans.",
  },
  {
    question: "Is JATA Autopilot part of these plans?",
    answer:
      "No. JATA Autopilot is a separate owner-only add-on that checks your business health and drafts actions for your approval. You can preview it free inside your dashboard; it is paid for per business and live actions start only after Paystack confirms the payment. It is not included in, and not required for, the four page plans.",
  },
  {
    question: "How do I pay for a plan?",
    answer:
      "Through Paystack, with M-Pesa or a card. Your card details are never stored by JATA AFTERCALL, and your plan starts only after the payment is confirmed.",
  },
  {
    question: "What does analytics show?",
    answer:
      "Your dashboard can show recorded page views and selected WhatsApp, Call, Directions, Share and service-click events. Some events may not be recorded, so not every tap is guaranteed to appear. No customer accounts or third-party tracking pixels are used on your page.",
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
  /** Active service rows or visibly labelled fictional sample entries. */
  services: { title: string; priceLabel: string }[];
  offer: { title: string; subtitle: string } | null;
  /** "live" means values came from an eligible published demo row; the business remains fictional. */
  source: "live" | "example";
  /** True only for the verified seed demo with a published ACTIVE route and active services. */
  routeAvailable: boolean;
  /** Optional second frame (used by the property story to move from the building to the home). */
  inset?: { image: string; alt: string };
};

const DEMO_PRESENTATION: Record<
  string,
  { image: string; kicker: string; headline: string; story: string; motion: LandingDemoCard["motion"]; altScene: string }
> = {
  "nyumbani-kitchen": {
    image: "/landing/nyumbani-kitchen",
    kicker: "Restaurant page example",
    headline: "A sample food page, from menu to contact.",
    story:
      "Illustrative food photography alongside sample menu entries and prices. This fictional example is not today's menu or a live offer.",
    motion: "steam",
    altScene: "A plate of Kenyan pilau with beef, kachumbari and folded chapati on a wooden table",
  },
  "marys-beauty-studio": {
    image: "/landing/marys-beauty-studio",
    kicker: "Beauty page example",
    headline: "A beauty page with sample services and prices.",
    story:
      "Illustrative salon photography alongside fictional braiding, nail and makeup entries; the details and prices are examples only.",
    motion: "salon",
    altScene: "A stylist braiding a seated client's hair in a bright salon",
  },
  "kamau-auto-care": {
    image: "/landing/kamau-auto-care",
    kicker: "Auto-care page example",
    headline: "An example auto-care page layout.",
    story:
      "Sample diagnostics, oil-change and brake entries with illustrative photography; these details are not a current quote.",
    motion: "drive",
    altScene: "A silver sedan on a Nairobi road at dusk with headlights on",
  },
  "john-kamau-properties": {
    image: "/landing/john-kamau-properties",
    kicker: "Property page example",
    headline: "A fictional property-page layout.",
    story:
      "Sample rental and land categories only. They are not property listings, availability statements or viewing details.",
    motion: "tour",
    altScene: "A modern apartment building in Kiambu at golden hour",
  },
};

/** The illustrative interior photograph used as the second frame of the property story. */
export const PROPERTY_INTERIOR_IMAGE = "/landing/john-kamau-properties-interior";

function priceLabelOf(service: DemoBusiness["services"][number]): string {
  return service.priceLabel || `From ${formatKES(service.priceFrom)}`;
}

function cardFromDemo(demo: DemoBusiness, source: LandingDemoCard["source"], routeAvailable = false): LandingDemoCard {
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
    offer: demo.slug === "john-kamau-properties" ? null : demo.offer,
    source,
    routeAvailable,
    inset,
  };
}

export type LandingDemoRow = {
  slug: string;
  name: string;
  category: string | null;
  location: string | null;
  isPublished: boolean;
  status: string;
  /** Verified from the dedicated demo owner's identity and absence of real payment references. */
  isVerifiedDemo: boolean;
  services: { title: string; priceLabel: string | null; priceFrom: number | null; isActive: boolean }[];
  offer: { title: string; subtitle: string | null; isActive: boolean; validUntil: Date | null } | null;
};

/**
 * Builds the four fictional demo cards in their fixed order.
 *
 * A route is linked only when the row is verified as a seeded demo, published, ACTIVE and has at
 * least one active service. A matching slug alone is not sufficient: other cards use labelled
 * fixtures and never link to a real owner's page. Offer visibility uses the authoritative
 * `isActive` and `validUntil` fields; displayed offer copy comes from the fictional fixture.
 */
export function buildLandingDemoCards(
  rows: readonly LandingDemoRow[] | null | undefined,
  now: Date = new Date(),
): LandingDemoCard[] {
  const bySlug = new Map((rows ?? []).map((row) => [row.slug, row]));
  return DEMO_BUSINESSES.map((demo) => {
    const row = bySlug.get(demo.slug);
    const services = activePublicServices(row?.services);
    const routeAvailable = Boolean(row?.isVerifiedDemo && row.isPublished && row.status === "ACTIVE" && services.length > 0);
    if (!row || !routeAvailable) return cardFromDemo(demo, "example");

    const offerIsCurrent = demo.slug !== "john-kamau-properties" && isCurrentPublicOffer(row.offer, now);
    return {
      ...cardFromDemo(demo, "live", true),
      name: row.name || demo.name,
      category: row.category || demo.category,
      location: row.location || demo.location,
      services: services.slice(0, 3).map((service) => ({
        title: service.title,
        priceLabel: service.priceLabel || (service.priceFrom ? `From ${formatKES(service.priceFrom)}` : "Ask for a price"),
      })),
      offer: offerIsCurrent ? demo.offer : null,
    };
  });
}

/** Fixed demo order, used by the homepage, the demo pages and the tests. */
export const LANDING_DEMO_SLUGS: readonly string[] = DEMO_BUSINESSES.map((demo) => demo.slug);
