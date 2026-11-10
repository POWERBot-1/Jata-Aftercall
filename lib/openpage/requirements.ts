/**
 * Deterministic prompt understanding for Website Studio.
 *
 * This is the "understand requirements" step: it turns a free-text brief into the
 * explicit inputs JATA's existing art-direction engine already understands (goal,
 * personality, audience, density), plus a layout plan adapted from OpenPage and an
 * honest list of what the business has NOT supplied.
 *
 * It never mutates a document and never invents business facts. A configured AI
 * provider may add a short grounded creative note (see `aiInterpretation.ts`), but it
 * cannot choose facts, prices, contact details or claims.
 */

import { EXPERIENCE_PROFILES, getExperienceProfile } from "@/lib/experience/categories";
import type { CategoryKey, ExperienceProfile, SectionType } from "@/lib/experience/types";
import type { DesignBrief } from "@/lib/experience/artDirector";
import {
  DESIGN_AUDIENCES,
  DESIGN_DENSITIES,
  DESIGN_GOALS,
  DESIGN_PERSONALITIES,
  type DesignDensity,
  type DesignGoal,
} from "@/lib/experience/templateFamilies";
import { planForPrompt, type LayoutPlan } from "./layoutPlans";

export type StudioBusinessFacts = {
  name: string;
  categoryKey: string;
  description?: string | null;
  location?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  openingHours?: Record<string, string> | null;
  products: number;
  services: number;
  images: number;
};

export type StudioRequirements = {
  prompt: string;
  businessType: {
    categoryKey: CategoryKey;
    label: string;
    /** True when the brief describes the business's recorded category. */
    matchesBusiness: boolean;
    suggestedLabel: string | null;
  };
  goal: (typeof DESIGN_GOALS)[number];
  personality: (typeof DESIGN_PERSONALITIES)[number];
  audience: (typeof DESIGN_AUDIENCES)[number];
  density: (typeof DESIGN_DENSITIES)[number];
  requestedSections: SectionType[];
  highlights: string[];
  missingInfo: string[];
  guardrails: string[];
  plan: { id: LayoutPlan["id"]; name: string };
  summary: string;
  confidence: "high" | "medium" | "low";
};

const SECTION_KEYWORDS: Array<{ section: SectionType; words: string[] }> = [
  { section: "gallery", words: ["gallery", "photos", "pictures", "portfolio", "work", "images"] },
  { section: "testimonials", words: ["testimonial", "reviews", "quotes", "customers say", "social proof"] },
  { section: "faq", words: ["faq", "questions", "answers"] },
  { section: "hours", words: ["opening hours", "open", "hours", "schedule"] },
  { section: "location", words: ["location", "directions", "map", "find us", "address"] },
  { section: "about", words: ["about", "story", "who we are", "history"] },
  { section: "steps", words: ["how it works", "process", "steps"] },
  { section: "why", words: ["why choose", "benefits", "reasons", "features"] },
  { section: "offers", words: ["offer", "discount", "promotion", "deal"] },
  { section: "contact", words: ["contact", "whatsapp", "call", "enquiry", "enquire"] },
];

const GOAL_WORDS = {
  sell: ["sell", "order", "buy", "shop", "store", "checkout", "delivery", "purchase", "menu", "products"],
  book: ["book", "booking", "appointment", "reserve", "reservation", "schedule", "session"],
  enquire: ["enquire", "enquiry", "quote", "consult", "contact", "request", "apply"],
  browse: ["showcase", "portfolio", "browse", "look", "discover", "brand", "story"],
} as const;

const PERSONALITY_WORDS = {
  premium: ["premium", "luxury", "luxurious", "high-end", "elegant", "classy", "upscale", "exclusive"],
  minimal: ["minimal", "clean", "simple", "uncluttered", "quiet", "calm", "understated"],
  bold: ["bold", "vibrant", "energetic", "loud", "dramatic", "striking", "playful"],
  editorial: ["editorial", "magazine", "journal", "modern", "sophisticated", "fashion"],
  warm: ["warm", "friendly", "welcoming", "local", "community", "family", "cosy", "cozy", "authentic"],
} as const;

const AUDIENCE_WORDS = {
  families: ["families", "family", "children", "kids", "parents"],
  professional: ["professionals", "business", "b2b", "corporate", "clients", "executives"],
  premium: ["high-end", "premium", "luxury", "affluent", "discerning"],
  discovery: ["tourists", "visitors", "new customers", "discovery", "explorers", "young"],
  local: ["local", "neighbourhood", "neighborhood", "community", "walk-in", "nearby"],
} as const;

const DENSITY_WORDS = {
  balanced: [],
  compact: ["compact", "concise", "short", "quick", "minimal text", "less text", "scannable"],
  spacious: ["spacious", "airy", "roomy", "editorial spacing", "large images", "full-screen"],
} as const;

const UNSAFE_INSTRUCTION = /(change|set|edit|update|make).{0,30}(price|cost|fee|charge|phone|whatsapp|email|address|opening hours|stock|quantity|payment|paystack)/i;

function normalized(input: string): string {
  return String(input || "").toLowerCase().replace(/\s+/g, " ").trim();
}

function scoreWords(text: string, words: readonly string[]): number {
  return words.reduce((score, word) => (text.includes(word) ? score + (word.includes(" ") ? 2 : 1) : score), 0);
}

function bestOf<T extends string>(text: string, groups: Record<T, readonly string[]>, fallback: T): { value: T; score: number } {
  let best: { value: T; score: number } = { value: fallback, score: 0 };
  for (const [value, words] of Object.entries(groups) as Array<[T, readonly string[]]>) {
    const score = scoreWords(text, words);
    if (score > best.score) best = { value, score };
  }
  return best;
}

/** Category detection scores every registered profile alias, so "barber" finds salon. */
function detectCategory(text: string): { categoryKey: CategoryKey; score: number } {
  let best: { categoryKey: CategoryKey; score: number } = { categoryKey: "other", score: 0 };
  for (const profile of EXPERIENCE_PROFILES) {
    const aliases = [profile.label, ...profile.aliases, profile.key];
    const score = scoreWords(text, aliases.map((alias) => alias.toLowerCase()));
    if (score > best.score) best = { categoryKey: profile.key, score };
  }
  return best;
}

function extractHighlights(prompt: string): string[] {
  return String(prompt || "")
    .split(/[\n.;]+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length >= 8 && line.length <= 180)
    .slice(0, 4);
}

function missingFacts(facts: StudioBusinessFacts, profile: ExperienceProfile): string[] {
  const missing: string[] = [];
  if (facts.products + facts.services === 0) {
    missing.push(`No ${profile.itemNounPlural.toLowerCase()} have been added yet, so catalogue sections will be empty until you add them.`);
  }
  if (facts.images === 0) missing.push("No photos are stored yet. JATA will use your category's approved fallback image, never a stock photo pretending to be your business.");
  if (!facts.location) missing.push("No location is recorded, so directions cannot be shown.");
  if (!facts.phone && !facts.whatsapp) missing.push("No phone or WhatsApp number is recorded, so contact actions cannot be shown.");
  if (!facts.openingHours || Object.keys(facts.openingHours).length === 0) missing.push("No opening hours are recorded, so an hours section would be empty.");
  return missing;
}

/**
 * Parses the brief. Pure and deterministic: the same prompt and facts always produce
 * the same requirements, which is what makes generation testable and reproducible.
 */
export function understandBrief(prompt: string, facts: StudioBusinessFacts): StudioRequirements {
  const text = normalized(prompt);
  const profile = getExperienceProfile(facts.categoryKey);
  const detected = detectCategory(text);
  const capabilities = profile.capabilities;

  const goalScore = bestOf<DesignGoal>(text, {
    sell: GOAL_WORDS.sell,
    book: GOAL_WORDS.book,
    enquire: GOAL_WORDS.enquire,
    browse: GOAL_WORDS.browse,
  }, "browse");
  let goal = goalScore.value;
  if (goal === "sell" && !capabilities.includes("commerce")) {
    goal = capabilities.includes("catalogue") ? "browse" : capabilities.includes("enquiry") ? "enquire" : "browse";
  }
  if (goal === "book" && !capabilities.includes("booking")) {
    goal = capabilities.includes("enquiry") ? "enquire" : "browse";
  }
  if (goal === "browse" && capabilities.includes("commerce") && scoreWords(text, GOAL_WORDS.sell) > 0) goal = "sell";

  const personality = bestOf(text, PERSONALITY_WORDS, "warm").value;
  const audience = bestOf(text, AUDIENCE_WORDS, "local").value;
  const density = bestOf<DesignDensity>(text, DENSITY_WORDS, "balanced").value;

  const requestedSections = SECTION_KEYWORDS
    .filter((entry) => scoreWords(text, entry.words) > 0)
    .map((entry) => entry.section);

  const plan = planForPrompt(text);
  const missingInfo = missingFacts(facts, profile);

  const guardrails: string[] = [
    "Prices, stock, payments and contact details are never generated. They come from your JATA business record only.",
    "Generated testimonials, statistics and team members are not imported as facts.",
  ];
  if (UNSAFE_INSTRUCTION.test(prompt)) {
    guardrails.push("Your brief asks JATA to change a price, stock level, payment or contact detail. Those fields are protected and were not changed; edit them in your business settings instead.");
  }

  const matchScore = detected.categoryKey === profile.key ? Math.max(1, detected.score) : 0;
  const confidence: StudioRequirements["confidence"] =
    text.length >= 40 && detected.score > 0 ? "high" : detected.score > 0 || text.length >= 20 ? "medium" : "low";

  const summary =
    `${profile.label} · ${goal === "sell" ? "sell and take orders" : goal === "book" ? "take bookings" : goal === "enquire" ? "collect enquiries" : "showcase the business"}` +
    ` · ${personality} tone · ${audience} audience · ${density} density · ${plan.name} layout plan`;

  return {
    prompt: String(prompt || "").slice(0, 1200),
    businessType: {
      categoryKey: profile.key,
      label: profile.label,
      matchesBusiness: matchScore > 0 || detected.categoryKey === "other",
      suggestedLabel: detected.categoryKey !== "other" && detected.categoryKey !== profile.key ? getExperienceProfile(detected.categoryKey).label : null,
    },
    goal,
    personality,
    audience,
    density,
    requestedSections,
    highlights: extractHighlights(prompt),
    missingInfo,
    guardrails,
    plan: { id: plan.id, name: plan.name },
    summary,
    confidence,
  };
}

/** The design brief JATA's art-direction engine consumes. */
export function briefFromRequirements(requirements: StudioRequirements): DesignBrief {
  return {
    goal: requirements.goal,
    personality: requirements.personality,
    audience: requirements.audience,
    density: requirements.density,
  };
}

export const STUDIO_PROMPT_EXAMPLES = [
  "A warm Nyama Choma spot in Kitengela. Customers should see the menu first, order on WhatsApp, and know we are open late.",
  "A premium bridal hair salon in Nairobi. Appointments should be easy to book, with a calm, editorial look and our best work in a gallery.",
  "A family furniture shop selling locally made pieces. Show the collection, delivery around Nairobi, and let people ask for a quote.",
  "A professional consultancy. Explain our services clearly and make it easy for a new client to request a quote.",
] as const;
