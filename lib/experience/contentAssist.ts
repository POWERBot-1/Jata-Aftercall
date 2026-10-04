/**
 * AI content assistance (§44)
 *
 * Architecture first: suggestions are produced by a pluggable provider so a real model can
 * be swapped in later without touching the editor, the API or the database.
 *
 * Hard rules, enforced here and in the UI:
 *   • AI never silently changes prices, stock, availability or any other commercial fact.
 *   • Every suggestion is returned as *text for a field* and must be approved or edited by
 *     the owner before it is saved, and can only become public after publishing. (§44, §45)
 */

import { getExperienceProfile } from "./categories";
import type { CategoryKey } from "./types";

export type AssistKind =
  | "PRODUCT_DESCRIPTION"
  | "SERVICE_DESCRIPTION"
  | "TAGLINE"
  | "SEO_DESCRIPTION"
  | "SEO_TITLE"
  | "OFFER_COPY"
  | "IMAGE_ALT"
  | "HERO_HEADLINE"
  | "HERO_SUBTITLE"
  | "ABOUT"
  | "FAQ_ANSWER"
  | "CTA_LABEL";

export type AssistRequest = {
  kind: AssistKind;
  categoryKey?: CategoryKey | string | null;
  name?: string;
  /** Free-form facts supplied by the owner, e.g. "chicken, rice, special spices". */
  notes?: string;
  attributes?: string[];
  priceKES?: number | null;
  durationMinutes?: number | null;
  location?: string | null;
  businessName?: string | null;
  /** A customer question, for FAQ_ANSWER. Owner-supplied. */
  question?: string | null;
  /** Opening hours the owner configured, used only so AI never guesses them. */
  openingHours?: string | null;
};

export type AssistSuggestion = {
  id: string;
  text: string;
  /** Always true: commercial content is published only after the owner approves it. */
  requiresApproval: true;
};

export const ASSIST_LABELS: Record<AssistKind, string> = {
  PRODUCT_DESCRIPTION: "Product description",
  SERVICE_DESCRIPTION: "Service description",
  TAGLINE: "Tagline",
  SEO_DESCRIPTION: "SEO description",
  SEO_TITLE: "Search title",
  OFFER_COPY: "Offer copy",
  IMAGE_ALT: "Image description",
  HERO_HEADLINE: "Homepage headline",
  HERO_SUBTITLE: "Homepage supporting line",
  ABOUT: "About section",
  FAQ_ANSWER: "Answer to a customer question",
  CTA_LABEL: "Button label",
};

/** Kinds that are copy for a *field*, i.e. safe for the assistant to propose (§44). */
export const ASSIST_KINDS = Object.keys(ASSIST_LABELS) as AssistKind[];

/** Fields AI is never allowed to write. Enforced by never generating them (§44, §45). */
export const ASSIST_FORBIDDEN_FIELDS = ["price", "basePriceKES", "salePriceKES", "stockStatus", "quantity", "isActive", "availability", "depositKES"] as const;

type CategoryCopy = {
  productIntro: string[];
  serviceIntro: string[];
  taglines: string[];
  benefit: string;
};

const COPY: Record<CategoryKey, CategoryCopy> = {
  food: {
    productIntro: [
      "Served hot and packed with flavour.",
      "A house favourite, cooked fresh to order.",
      "Comfort food done properly — generous portions, no shortcuts.",
    ],
    serviceIntro: ["Freshly prepared and ready when you are.", "Order ahead and skip the queue."],
    taglines: ["Good food, made fresh daily", "Taste that brings people back", "Fresh, fast and full of flavour"],
    benefit: "freshly made",
  },
  beauty: {
    productIntro: [
      "Formulated to feel as good as it looks.",
      "A everyday essential with a finish that lasts.",
      "Gentle, effective and made for real skin.",
    ],
    serviceIntro: ["A personalised treatment, tailored to you.", "Relax while we take care of the details."],
    taglines: ["Beauty that feels like you", "Your best skin, every day", "Effortless, everyday beauty"],
    benefit: "skin-loving",
  },
  salon: {
    productIntro: ["Salon-grade care you can use at home.", "Keeps your look fresh between visits."],
    serviceIntro: ["Done by professionals who listen first.", "Walk in, sit back, leave looking sharp."],
    taglines: ["Look good, feel better", "Style that suits you", "Your chair is waiting"],
    benefit: "expertly styled",
  },
  fashion: {
    productIntro: [
      "Cut for comfort, made to be worn on repeat.",
      "An easy piece that works from day to night.",
      "Considered detailing with a clean, modern fit.",
    ],
    serviceIntro: ["Tailored to your measurements.", "Fitted properly, finished properly."],
    taglines: ["Wear it your way", "Style with substance", "Made for everyday confidence"],
    benefit: "effortlessly styled",
  },
  retail: {
    productIntro: ["In stock and ready to go.", "Everyday value, without the fuss.", "A reliable pick for daily use."],
    serviceIntro: ["Quick, friendly and fair.", "We will help you find exactly what you need."],
    taglines: ["Everything you need, nearby", "Daily essentials, honestly priced", "Your neighbourhood shop"],
    benefit: "reliable",
  },
  electronics: {
    productIntro: [
      "Built to perform, with the specs to prove it.",
      "Reliable hardware backed by a local warranty.",
      "Genuine product, tested before it reaches you.",
    ],
    serviceIntro: ["Diagnosed properly and repaired fast.", "Expert help with a clear quote first."],
    taglines: ["Tech you can trust", "Genuine gear, local support", "Powering your everyday"],
    benefit: "dependable",
  },
  automotive: {
    productIntro: ["Quality parts fitted by people who know cars.", "Built to last on Kenyan roads."],
    serviceIntro: ["Honest diagnostics and work you can trust.", " serviced properly, with a clear quote before we start."],
    taglines: ["Service you can trust", "Back on the road, faster", "Experts under the bonnet"],
    benefit: "road-ready",
  },
  realestate: {
    productIntro: [
      "A well-kept home in a convenient location.",
      "Bright, spacious and ready to move into.",
      "Verified listing — no brokers, no surprises.",
    ],
    serviceIntro: ["Viewings arranged around your schedule.", "We handle the paperwork properly."],
    taglines: ["Find a place to call home", "Verified homes, honest advice", "Property, handled properly"],
    benefit: "verified",
  },
  furniture: {
    productIntro: [
      "Made with care, built to last for years.",
      "Solid materials and a finish you can feel.",
      "Designed for real homes and real living.",
    ],
    serviceIntro: ["Made to measure, fitted by our own team.", "Crafted to your space and your budget."],
    taglines: ["Furniture made to last", "Craft for your home", "Built for everyday living"],
    benefit: "handcrafted",
  },
  fitness: {
    productIntro: ["Built to support your training.", "Comfortable, durable and made to move."],
    serviceIntro: ["Coached sessions with measurable progress.", "Train with people who keep you accountable."],
    taglines: ["Stronger every week", "Train with purpose", "Your goals, our coaching"],
    benefit: "results-driven",
  },
  creative: {
    productIntro: ["Crafted with an eye for detail.", "Made to be seen and remembered."],
    serviceIntro: ["A considered process and images you will keep.", "Directed, shot and edited with care."],
    taglines: ["Work worth remembering", "Stories, beautifully told", "Crafted frame by frame"],
    benefit: "crafted",
  },
  professional: {
    productIntro: ["Clear, practical and built on experience.", "Everything you need, explained properly."],
    serviceIntro: ["Senior attention on every engagement.", "Clear scope, clear fees, clear outcomes."],
    taglines: ["Advice you can act on", "Clarity, delivered", "Professional, without the jargon"],
    benefit: "expert",
  },
  hospitality: {
    productIntro: ["Comfortable, calm and quietly considered.", "Everything you need for a proper rest."],
    serviceIntro: ["Warm hospitality from the moment you arrive.", "Book direct for the best rates and flexibility."],
    taglines: ["Stay somewhere special", "Comfort, hosted well", "Your home away from home"],
    benefit: "restful",
  },
  education: {
    productIntro: [" structured learning with practical outcomes."],
    serviceIntro: ["Small groups, experienced tutors, clear outcomes.", "Learn by doing, with support at every step."],
    taglines: ["Learn something that lasts", "Skills for what's next", "Taught properly"],
    benefit: "practical",
  },
  technical: {
    productIntro: ["Fit-and-forget reliability.", "Genuine parts, fitted properly."],
    serviceIntro: ["Fast call-outs and work that lasts.", "Diagnosed properly the first time."],
    taglines: ["Fixed right, first time", "Here when you need us", "Reliable hands, honest prices"],
    benefit: "reliable",
  },
  other: {
    productIntro: ["Made with care and attention to detail.", "A solid choice, ready when you are."],
    serviceIntro: ["Friendly, reliable and fairly priced.", "Tell us what you need — we will handle it."],
    taglines: ["Quality you can count on", "Done properly, every time", "Serving you better"],
    benefit: "reliable",
  },
};

function clean(value: unknown, max = 240): string {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, max);
}

function listFacts(input: AssistRequest): string {
  const parts = [input.notes, ...(input.attributes || [])]
    .map((part) => clean(part, 120))
    .filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function suggestion(index: number, text: string): AssistSuggestion {
  return { id: `s${index + 1}`, text: text.trim().replace(/\s+/g, " "), requiresApproval: true };
}

export function requestTouchesCommercialData(request: AssistRequest): boolean {
  const forbidden = ASSIST_FORBIDDEN_FIELDS as readonly string[];
  return Object.keys(request).some((key) => forbidden.includes(key)) || request.priceKES !== undefined;
}

/** Deterministic provider. Returns 2–3 alternatives so the owner always has a choice. */
export function suggestContent(request: AssistRequest): AssistSuggestion[] {
  const profile = getExperienceProfile(request.categoryKey);
  const copy = COPY[profile.key] || COPY.other;
  const name = clean(request.name, 80) || `this ${profile.itemNoun.toLowerCase()}`;
  const facts = listFacts(request);
  const location = clean(request.location, 60);

  switch (request.kind) {
    case "PRODUCT_DESCRIPTION": {
      const variants = copy.productIntro.map((intro, index) => {
        const base = facts ? `${name} — ${facts}. ${intro}` : `${name}. ${intro}`;
        return suggestion(index, base);
      });
      if (request.durationMinutes && profile.key === "food") {
        variants.push(suggestion(variants.length, `${name}. Ready in about ${request.durationMinutes} minutes.`));
      }
      return variants.slice(0, 3);
    }
    case "SERVICE_DESCRIPTION": {
      const variants = copy.serviceIntro.map((intro, index) => suggestion(index, facts ? `${intro} ${facts}.` : intro));
      if (request.durationMinutes) {
        variants.push(suggestion(variants.length, `Typically takes about ${request.durationMinutes} minutes.`));
      }
      return variants.slice(0, 3);
    }
    case "TAGLINE":
      return copy.taglines.map((tagline, index) => suggestion(index, tagline)).slice(0, 3);
    case "SEO_DESCRIPTION": {
      const where = location ? ` in ${location}` : "";
      return [
        suggestion(0, `${clean(request.businessName || name, 60)}${where} — browse, order and book directly. ${copy.benefit} ${profile.itemNounPlural.toLowerCase()}, fair prices, fast response.`),
        suggestion(1, `${profile.label}${where}. See what we offer, check prices and place an order or booking in a few taps.`),
      ];
    }
    case "OFFER_COPY":
      return [
        suggestion(0, `${name} — now on offer${location ? ` at our ${location} location` : ""}. While stocks last.`),
        suggestion(1, `Save on ${name} this week. Order early to avoid missing out.`),
      ];
    case "IMAGE_ALT":
      return [suggestion(0, `${name}${facts ? ` — ${facts}` : ""}${location ? ` at ${location}` : ""}`)];
    case "SEO_TITLE": {
      const business = clean(request.businessName || "", 40) || name;
      const where = location ? ` in ${location}` : "";
      return [
        suggestion(0, `${business} — ${profile.label}${where}`.slice(0, 70)),
        suggestion(1, `${business}${where} | ${profile.catalogueLabel}`.slice(0, 70)),
      ];
    }
    case "HERO_HEADLINE": {
      const business = clean(request.businessName || "", 40) || name;
      return [
        suggestion(0, `${business}${location ? `, ${location}` : ""}`.slice(0, 80)),
        suggestion(1, copy.taglines[0] || `${business}`),
        suggestion(2, facts ? `${name} — ${facts}`.slice(0, 80) : `${business}: ${copy.benefit}`.slice(0, 80)),
      ];
    }
    case "HERO_SUBTITLE":
      return [
        suggestion(0, `${copy.benefit.charAt(0).toUpperCase()}${copy.benefit.slice(1)} ${profile.itemNounPlural.toLowerCase()}${location ? ` in ${location}` : ""}. Order or book directly — no middleman.`),
        suggestion(1, `Browse what we have, see the prices and reach us on WhatsApp in one tap.`),
      ];
    case "ABOUT": {
      const business = clean(request.businessName || "", 60) || "We";
      return [
        suggestion(0, `${business} is a ${profile.label.toLowerCase()} business${location ? ` in ${location}` : ""}. ${facts ? `${facts}. ` : ""}We serve customers directly, and you can see what we offer on this page.`),
        suggestion(1, `We run ${business}${location ? ` in ${location}` : ""}. ${facts ? `${facts}. ` : ""}Tell us what you need and we will take it from there.`),
      ];
    }
    case "FAQ_ANSWER": {
      const question = clean(request.question, 140);
      if (!question) return [];
      return [
        suggestion(0, `Thanks for asking. ${facts ? `${facts}. ` : ""}For anything specific, message us on WhatsApp and we will confirm right away.`),
      ];
    }
    case "CTA_LABEL":
      return [suggestion(0, profile.cta.primary), suggestion(1, profile.cta.add), suggestion(2, profile.cta.enquire)];
    default:
      return [];
  }
}

/** Async seam so a model-backed provider can replace the deterministic one (§44). */
export async function generateAssistContent(request: AssistRequest): Promise<AssistSuggestion[]> {
  return suggestContent(request);
}
