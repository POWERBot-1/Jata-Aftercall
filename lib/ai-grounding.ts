/**
 * Grounded customer answers for the AI Business Front Desk.
 *
 * Every price, fee, time, stock claim and policy in these helpers comes from the
 * caller's Business Brain. Nothing here invents a business fact.
 */

import { formatOpeningHours } from "./openingHours";
import type { DeliveryConfiguration, DeliveryZoneConfig } from "./ai-config";

export const PREVIEW_TEST_QUESTIONS = [
  "How much is your product?",
  "Do you deliver?",
  "How much is delivery?",
  "How long does delivery take?",
  "Are you open now?",
  "I want to order.",
  "Can I pay by M-Pesa?",
  "I want to speak to someone.",
] as const;

const STOPWORDS = new Set([
  "how", "much", "is", "are", "the", "a", "an", "your", "you", "do", "does", "did",
  "sell", "have", "has", "price", "prices", "of", "for", "please", "me", "i", "want",
  "need", "give", "get", "can", "to", "and", "with", "some", "any", "what", "where",
  "when", "my", "we", "us", "it", "this", "that", "there", "today", "now", "tomorrow",
  "bag", "bags", "piece", "pieces", "plate", "plates", "order", "orders", "kgs", "kg",
  "kes", "ksh", "please", "like", "would", "could", "just", "also", "then", "from",
  "into", "onto", "about", "bei", "ya", "gani", "nataka", "naomba", "nipe", "leo",
  "sasa", "delivered", "deliver", "delivery", "send", "shipping",
]);

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  twenty: 20,
  moja: 1,
  mbili: 2,
  tatu: 3,
  nne: 4,
  tano: 5,
  kumi: 10,
  ishirini: 20,
};

export type CatalogueProduct = {
  id: string;
  name: string;
  description?: string | null;
  category?: string | null;
  basePriceKES?: number | null;
  variantPriceKES?: number | null;
  salePriceKES?: number | null;
  stockStatus?: string | null;
  quantity?: number | null;
  preOrderAllowed?: boolean | null;
  minOrder?: number | null;
  maxOrder?: number | null;
  isActive?: boolean | null;
  portionSize?: string | null;
  variantOptions?: string | null;
  variants?: Array<{ id?: string; label: string; options?: string | null; priceKES?: number | null; stockStatus?: string | null }>;
};

export type BulkPriceRule = {
  productName: string;
  minQuantity: number;
  unitPriceKES: number;
};

export function singularize(word: string): string {
  const lower = word.toLowerCase().trim();
  if (lower === "chips" || lower === "fries" || lower.length <= 3) return lower;
  if (lower.endsWith("ies") && lower.length > 4) return `${lower.slice(0, -3)}y`;
  if (lower.endsWith("es") && lower.length > 4 && !lower.endsWith("oes") && !lower.endsWith("ses")) {
    return lower.slice(0, -2);
  }
  if (lower.endsWith("s") && !lower.endsWith("ss")) return lower.slice(0, -1);
  return lower;
}

export function contentTokens(text: string): string[] {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9.\s]/g, " ")
    .split(/\s+/)
    .map((token) => singularize(token.replace(/[^a-z0-9]/g, "")))
    .filter((token) => token.length >= 3 && !STOPWORDS.has(token));
}

const UNIT_OR_PACK_TOKENS = new Set([
  "50kg", "25kg", "20kg", "10kg", "5kg", "1kg", "kg", "kgs",
  "bag", "bags", "piece", "pieces", "plate", "plates", "portion", "portions", "pcs", "pc",
]);

/** Category nouns and pack sizes are not a brand or model. */
function genericCatalogueTokens(products: CatalogueProduct[]): Set<string> {
  const generic = new Set<string>(["cement", "cements", ...UNIT_OR_PACK_TOKENS]);
  for (const product of products) {
    for (const token of contentTokens(product.category || "")) generic.add(token);
  }
  return generic;
}

const NON_IDENTITY_TOKENS = new Set([
  "place", "places", "area", "areas", "address", "addresses", "same", "here", "huko", "pale",
  "one", "item", "items", "product", "products", "grade", "grades", "confirm", "please", "yes",
  ...Object.keys(WORD_NUMBERS),
]);

function identityTokens(text: string, generic: Set<string>): string[] {
  return contentTokens(text).filter(
    (token) =>
      !generic.has(token) &&
      !UNIT_OR_PACK_TOKENS.has(token) &&
      !NON_IDENTITY_TOKENS.has(token) &&
      !/^\d+$/.test(token),
  );
}

/** Brand/model tokens in the message that do not belong to any configured product name. */
export function unrecognizedProductTokens(
  message: string,
  products: CatalogueProduct[],
  extraKnownPhrases: string[] = [],
): string[] {
  const active = products.filter((product) => product.isActive !== false);
  const generic = genericCatalogueTokens(active);
  const known = new Set([
    ...active.flatMap((product) => identityTokens(product.name, generic)),
    ...extraKnownPhrases.flatMap((phrase) => identityTokens(phrase, generic)),
  ]);
  return identityTokens(message, generic).filter((token) => !known.has(token));
}

/**
 * Conversational, contact, scheduling and generic service vocabulary. None of these words
 * establish product identity on their own, so a message made only of them is ordinary
 * conversation rather than an unlisted product request (PR #34 DEFECT-1 remediation).
 */
const NON_PRODUCT_WORDS = new Set<string>([
  // greetings, thanks, acknowledgements, pleasantries
  "hello", "hallo", "hey", "hie", "habari", "jambo", "mambo", "niaje", "asante", "shukran",
  "thank", "thankyou", "karibu", "welcome", "sorry", "pole", "kindly", "okay", "sawa", "ndio",
  "ndiyo", "hapana", "sure", "great", "cool", "bye", "kwaheri", "cheers", "greeting", "greetings",
  "morning", "evening", "afternoon", "night", "good", "day",
  // help / information requests
  "help", "helping", "assist", "assistance", "information", "info", "detail", "question", "enquiry",
  "inquiry", "support", "advice", "guidance", "explain", "explanation", "understand", "understanding",
  "clarify", "clarification", "talk", "chat", "speak", "discuss", "discussion",
  // conversational verbs, modals and function words
  "will", "shall", "should", "must", "might", "would", "could", "cannot", "cant", "dont", "doesnt",
  "didnt", "wont", "wouldnt", "couldnt", "shouldnt", "been", "being", "having", "let", "make",
  "makes", "made", "tell", "tells", "told", "say", "says", "said", "know", "knows", "knew", "think",
  "thinks", "thought", "feel", "feels", "felt", "saw", "seen", "look", "looking", "looks", "find",
  "finding", "found", "come", "comes", "came", "coming", "goes", "went", "going", "gets", "got",
  "getting", "meet", "meeting", "wait", "waiting", "sends", "sent", "sending", "gives", "given",
  "giving", "takes", "taken", "taking", "wants", "wanted", "wishing", "needs", "needed", "likes",
  "liked", "prefer", "prefers", "ask", "asks", "asked", "asking", "reply", "replied", "respond",
  "answer", "answers", "answered", "something", "anything", "nothing", "everything", "somebody",
  "someone", "anybody", "anyone", "everybody", "everyone",
  // identity, contact and people
  "name", "names", "number", "numbers", "phone", "phones", "mobile", "contact", "contacts", "person",
  "persons", "people", "whose", "customer", "client", "clients", "team", "staff", "manager", "owner",
  "boss", "agent", "human", "friend", "guys", "sir", "madam", "mama", "baba",
  // scheduling and time
  "today", "tomorrow", "yesterday", "tonight", "later", "soon", "already", "still", "again", "time",
  "hour", "hours", "minute", "minutes", "week", "weeks", "month", "months", "days", "date", "dates",
  "booking", "bookings", "appointment", "appointments", "schedule", "reservation", "reservations",
  "slot", "slots",
  // generic service, venue and meal words
  "table", "tables", "seat", "seats", "chair", "chairs", "room", "rooms", "lunch", "dinner",
  "breakfast", "supper", "brunch", "snack", "snacks", "meal", "meals", "food", "foods", "drink",
  "drinks", "beverage", "beverages", "service", "services", "request", "requests", "offer", "offers",
  "deal", "deals", "discount", "discounts", "promo", "promotion", "promotions", "voucher", "vouchers",
  "coupon", "coupons", "punguzo", "receipt", "receipts", "invoice", "invoices", "statement", "balance",
  "account", "accounts", "payment", "payments", "paying", "refund", "refunds", "complaint",
  "complaints", "problem", "problems", "issue", "issues", "feedback", "review", "reviews",
  // place/venue context nouns — they describe where an item is used, not what it is
  "site", "sites", "project", "projects", "building", "buildings", "construction", "mjengo",
  "home", "house", "office", "shop", "store", "farm", "school", "church", "hospital", "hotel",
  "plot", "land", "yard", "compound", "warehouse", "factory", "apartment", "estate",
]);

const PHONE_LIKE_PATTERN = /\b\d{9,}\b/;

/** Pack sizes, quantities, clock times and ordinals: never product identity on their own. */
function isUnitOrNumericToken(token: string): boolean {
  if (UNIT_OR_PACK_TOKENS.has(token)) return true;
  if (/^\d+$/.test(token)) return true;
  return /^\d+(?:[.,]\d+)?(?:kg|kgs|g|gm|gms|ml|l|bag|bags|piece|pieces|pcs|pc|plate|plates|portion|portions|pack|packs|packet|packets|am|pm|hr|hrs|hour|hours|min|mins|minute|minutes|week|weeks|day|days|st|nd|rd|th)$/.test(
    token,
  );
}

function hintTokens(extraKnownPhrases: string[]): Set<string> {
  return new Set((extraKnownPhrases || []).flatMap((phrase) => contentTokens(phrase)));
}

/**
 * Unknown brand/model tokens in `candidate` that belong to no configured product, category,
 * unit, place reference or conversational word. A non-empty result means the message named
 * something this catalogue does not carry; an empty result means ordinary conversation.
 */
export function unlistedProductTokens(
  candidate: string,
  products: CatalogueProduct[],
  extraKnownPhrases: string[] = [],
): string[] {
  const active = products.filter((product) => product.isActive !== false);
  const generic = genericCatalogueTokens(active);
  const catalogueIdentity = new Set(active.flatMap((product) => identityTokens(product.name, generic)));
  const hints = hintTokens(extraKnownPhrases);
  return contentTokens(candidate).filter(
    (token) =>
      !generic.has(token) &&
      !catalogueIdentity.has(token) &&
      !hints.has(token) &&
      !NON_IDENTITY_TOKENS.has(token) &&
      !NON_PRODUCT_WORDS.has(token) &&
      !isUnitOrNumericToken(token),
  );
}

/** How a candidate was captured: an explicit price/availability question, an order phrase, or a bare line. */
export type ProductRequestFrame = "price" | "order" | "bare";

const QUANTITY_UNIT_PATTERN =
  /\b\d{1,4}\s*(?:x\s*|×\s*)?(?:kg|kgs|g|gm|gms|bags?|pieces?|pcs?|pc|plates?|portions?|packs?|packets?)\b/i;
const MODEL_GRADE_PATTERN = /\d+[.,]\d+/;

/**
 * Deterministic plausibility test for an unlisted-product determination.
 *
 * A message only names a product the business does not carry when it carries product evidence
 * beyond a bare noun: an explicit price/availability question, a quantity with packaging, a
 * model/grade number, a catalogue category noun, or a multi-token item phrase. Greetings,
 * contact details, place names and generic service words never qualify
 * (PR #34 DEFECT-1 remediation).
 */
export function detectUnlistedProductRequest(input: {
  message: string;
  candidate: string;
  frame: ProductRequestFrame;
  products: CatalogueProduct[];
  extraKnownPhrases?: string[];
}): { plausible: boolean; tokens: string[] } {
  const tokens = unlistedProductTokens(input.candidate, input.products, input.extraKnownPhrases || []);
  if (tokens.length === 0) return { plausible: false, tokens };
  if (PHONE_LIKE_PATTERN.test(input.candidate)) return { plausible: false, tokens };
  if (input.frame === "price") return { plausible: true, tokens };
  const active = input.products.filter((product) => product.isActive !== false);
  const categoryTokens = new Set(active.flatMap((product) => contentTokens(product.category || "")));
  const hasCategoryNoun = contentTokens(input.candidate).some((token) => categoryTokens.has(token));
  const plausible =
    QUANTITY_UNIT_PATTERN.test(input.message) ||
    MODEL_GRADE_PATTERN.test(input.message) ||
    hasCategoryNoun ||
    (input.frame === "order" && tokens.length >= 2);
  return { plausible, tokens };
}

function escapeForRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Unlisted item phrases that sit in a product-request position: right after a quantity +
 * packaging ("2 bags of Savannah") or right before a catalogue category noun ("Savannah
 * cement"). Used to name an unlisted item inside an otherwise valid mixed order instead of
 * silently dropping it (PR #34 DEFECT-2).
 */
export function unlistedOrderItems(
  message: string,
  products: CatalogueProduct[],
  extraKnownPhrases: string[] = [],
): string[] {
  const text = (message || "").toLowerCase();
  const tokens = unlistedProductTokens(message, products, extraKnownPhrases);
  if (tokens.length === 0) return [];
  const active = products.filter((product) => product.isActive !== false);
  const categoryTokens = [...new Set(active.flatMap((product) => contentTokens(product.category || "")))];
  const found: string[] = [];
  for (const token of tokens) {
    const escaped = escapeForRegex(token);
    const afterQuantity = new RegExp(
      `\\b\\d{1,4}\\s*(?:x\\s*|×\\s*)?(?:kg|kgs|g|gm|gms|bags?|pieces?|pcs?|pc|plates?|portions?|packs?|packets?)\\s*(?:of\\s+)?${escaped}\\b`,
      "i",
    ).test(text);
    const category = categoryTokens.find((item) =>
      new RegExp(`\\b${escaped}\\s+${escapeForRegex(item)}\\b`, "i").test(text),
    );
    if (category) found.push(`${token} ${category}`);
    else if (afterQuantity) found.push(token);
  }
  return [...new Set(found)];
}

/**
 * Exact configured-zone answer such as "Syokimau" or "Athi River" — a place, never a product.
 * Returns the canonical zone name only when the whole message is that zone name.
 */
export function matchConfiguredZoneName(message: string, zones: Array<{ name: string }>): string | null {
  const text = normalizeDeliveryText(message).toLowerCase();
  if (!text) return null;
  const match = (zones || []).find((zone) => {
    const name = normalizeDeliveryText(zone?.name || "").toLowerCase();
    return name.length >= 3 && name === text;
  });
  return match ? match.name : null;
}

export function matchCatalogue(message: string, products: CatalogueProduct[]): CatalogueProduct[] {
  const raw = (message || "").toLowerCase();
  const msgTokens = contentTokens(message);
  if (msgTokens.length === 0) return [];
  const active = products.filter((product) => product.isActive !== false);
  const generic = genericCatalogueTokens(active);
  const messageIdentity = identityTokens(message, generic);
  const unknownIdentity = unrecognizedProductTokens(message, active);
  const msgTokenSet = new Set(msgTokens);
  const scored = active
    .map((product) => {
      const name = product.name.toLowerCase();
      const nameTokens = contentTokens(product.name);
      const categoryTokens = contentTokens(product.category || "");
      const fullName = name.length >= 3 && (raw.includes(name) || raw.includes(singularize(name)));
      let score = 0;
      if (fullName) score += 100;
      const overlap = nameTokens.filter((token) => msgTokenSet.has(token) || raw.includes(token));
      score += overlap.length * 10;
      if (nameTokens.length > 0 && overlap.length === nameTokens.length) score += 15;
      if (categoryTokens.some((token) => msgTokenSet.has(token)) && (overlap.length > 0 || score >= 100)) score += 4;
      else if (overlap.length === 0 && categoryTokens.some((token) => msgTokenSet.has(token))) {
        if (unknownIdentity.length === 0) score += 4;
      }
      // An unrecognized brand/model must not inherit a match from a shared category noun such as "cement".
      if (unknownIdentity.length > 0 && !fullName) {
        const knownOverlap = identityTokens(product.name, generic).filter((token) => messageIdentity.includes(token));
        if (knownOverlap.length === 0) score = 0;
      }
      return { product, score };
    })
    .filter((item) => item.score > 0);
  if (scored.length === 0) return [];
  const best = Math.max(...scored.map((item) => item.score));
  // A clearly more specific hit (full name, or a distinctive grade such as 32.5) wins over a family match.
  return scored.filter((item) => item.score === best).map((item) => item.product);
}

export function parseQuantityToken(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.toLowerCase().trim();
  if (WORD_NUMBERS[cleaned]) return WORD_NUMBERS[cleaned];
  const asNum = Number(cleaned.replace(/,/g, ""));
  if (Number.isFinite(asNum) && asNum > 0) return Math.min(999, Math.round(asNum));
  return null;
}

/** Quantity nearest a product mention, allowing words such as "bags of". */
export function extractQuantityNear(message: string, productName: string): number | null {
  const text = (message || "").toLowerCase();
  const name = productName.toLowerCase();
  const idx = text.indexOf(name);
  const head = contentTokens(productName).slice(-1)[0];
  const headIdx = head ? text.indexOf(head) : -1;
  const anchor = idx >= 0 ? idx : headIdx;
  const window = anchor >= 0 ? text.slice(Math.max(0, anchor - 48), anchor) : text;
  // A quantity before "and" belongs to the previous item ("5 chapatis and beef").
  const parts = window.split(/\s+(?:and|&|,)\s+/i);
  const local = parts[parts.length - 1] ?? window;
  if (!local.trim()) return null;
  const matches = [...local.matchAll(/\b(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|twenty|moja|mbili|tatu|nne|tano|kumi|ishirini)\b/gi)];
  if (matches.length === 0) return null;
  return parseQuantityToken(matches[matches.length - 1][1]);
}

export function extractStandaloneQuantity(message: string): number | null {
  const text = (message || "").toLowerCase().trim();
  const match = text.match(
    /\b(?:give me|i need|i want|i'd like|i would like|nataka|naomba|nipe|get me|add|order|buy|can i get|let me have)\s+(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|twenty|moja|mbili|tatu|nne|tano|kumi|ishirini)\b/,
  );
  if (match) return parseQuantityToken(match[1]);
  const only = text.match(/^(\d{1,4}|one|two|three|four|five|six|seven|eight|nine|ten|twenty|mbili|tatu)\b/);
  return only ? parseQuantityToken(only[1]) : null;
}

export function isOrderingIntent(message: string): boolean {
  if (/\b(refund|money\s+back|cancel|complaint|dispute|speak\s+to|talk\s+to)\b/i.test(message || "")) return false;
  return /\b(i\s+want|i\s+need|i'd\s+like|i\s+would\s+like|order|buy|add\s+to\s+cart|nataka|naomba|nipe|get\s+me|give\s+me|can\s+i\s+get|let\s+me\s+have|place\s+an\s+order|i\s+wish)\b/i.test(
    message || "",
  );
}

export function isConfirmation(message: string): boolean {
  return /\b(confirm(?:\s+order)?|yes\s+please|yes|proceed|place\s+(?:the\s+|my\s+)?order|go\s+ahead|that's\s+correct|that\s+is\s+correct|ndio|sawa|ndiyo)\b/i.test(
    message || "",
  );
}

function normalizeDeliveryText(message: string): string {
  return (message || "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/(\d)\.(\d)/g, "$1<$2")
    .replace(/[.!?,;:]+/g, " ")
    .replace(/(\d)<(\d)/g, "$1.$2")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Bounded previous-place reference. Bare "place", "area", "that", or "same"
 * do not match, and existential "there is" / "is there" is not a destination.
 */
export function refersToPreviousPlace(message: string): boolean {
  const text = normalizeDeliveryText(message);
  if (!text) return false;
  if (/\b(?:same|that)\s+(?:delivery\s+)?(?:place|area|address)\b/i.test(text)) return true;
  if (/\b(?:delivered|deliver(?:y|ing)?|send|peleka|shipping|dispatch|to|at)\s+(?:the\s+)?(?:there|huko|pale)\b/i.test(text)) {
    return true;
  }
  if (/\b(?:is|are|was|were|isn't|aren't)\s+(?:there|huko|pale)\b/i.test(text)) return false;
  if (/\bthere\s+(?:is|are|was|were)\b/i.test(text)) return false;
  return (
    /\b(?:there|huko|pale)$/i.test(text) &&
    /\b(?:need|want|order|buy|get|give|send|deliver|peleka|nataka|naomba|nipe|bags?)\b/i.test(text)
  );
}

/**
 * A whole-message delivery follow-up such as "same place", "there", or "to that area".
 * Not an order, and not an existential "there is".
 */
export function isBareDeliveryFollowUp(message: string): boolean {
  const text = normalizeDeliveryText(message);
  if (!text) return false;
  if (/\b(?:is|are|was|were|isn't|aren't)\s+(?:there|huko|pale)\b/i.test(text)) return false;
  if (/\bthere\s+(?:is|are|was|were)\b/i.test(text)) return false;
  if (/\bplace\s+an\s+order\b/i.test(text)) return false;
  if (/^(?:to\s+)?(?:the\s+)?(?:same|that)\s+(?:delivery\s+)?(?:place|area|address)$/i.test(text)) return true;
  if (/^(?:delivered|deliver(?:y|ing)?|send|peleka)\s+(?:to\s+)?(?:the\s+)?(?:there|huko|pale)$/i.test(text)) return true;
  if (/^(?:there|huko|pale)$/i.test(text)) return true;
  return false;
}

function isBarePlaceReference(value: string): boolean {
  const text = normalizeDeliveryText(value);
  return (
    /^(?:the\s+)?(?:same|that)\s+(?:delivery\s+)?(?:place|area|address)$/i.test(text) ||
    /^(?:there|huko|pale|here|it)$/i.test(text)
  );
}

/** Demonstrative product reference. Does not match a bare product family such as "the cement". */
export function refersToPreviousProduct(message: string): boolean {
  return /\b(that\s+one|this\s+one|that\s+product|this\s+product|that\s+item|this\s+item|the\s+one\s+you\s+mentioned|the\s+same\s+one)\b/i.test(
    message || "",
  );
}

function captureExplicitDeliveryZone(text: string): string | null {
  const patterns = [
    /deliver(?:ed|y)?\s+(?:to|in|for)\s+([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.|,|!)/i,
    /delivery\s+(?:to|in|for)\s+([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.|,|!)/i,
    /mnafanya\s+delivery\s+([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.|,)/i,
    /mnadeliver\s+([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.|,)/i,
    /\bto\s+([a-z][a-z\s-]{1,40}?)(?:[.!?,;:]|$)/i,
  ];
  for (const pattern of patterns) {
    const zone = pattern.exec(text)?.[1]?.trim().replace(/[.!?,;:]+$/g, "");
    if (!zone || isBarePlaceReference(zone) || refersToPreviousPlace(zone)) continue;
    return zone;
  }
  return null;
}

export function extractDeliveryArea(message: string): { zone: string | null; refersToPrevious: boolean } {
  const text = message || "";
  const explicit = captureExplicitDeliveryZone(text) || captureExplicitDeliveryZone(normalizeDeliveryText(text));
  if (refersToPreviousPlace(text)) {
    // "deliver to Syokimau there" names a place; "to the same place." does not.
    if (explicit) return { zone: explicit, refersToPrevious: false };
    return { zone: null, refersToPrevious: true };
  }
  if (explicit) return { zone: explicit, refersToPrevious: false };
  return { zone: null, refersToPrevious: false };
}

export function extractContactDetails(message: string): { name: string | null; phone: string | null } {
  const text = message || "";
  const phoneMatch = text.match(/(\+?254\d{9}|0\d{9})/);
  const named =
    text.match(/confirm\s+order\s+for\s+([A-Za-z][A-Za-z\s'-]{1,40}?)\s*\(/i) ||
    text.match(/\bmy\s+name\s+is\s+([A-Za-z][A-Za-z\s'-]{1,40}?)(?:\s*,|\s+and|\s+phone|\s+0|\s+\+|$)/i) ||
    text.match(/\b(?:i\s+am|this\s+is)\s+([A-Za-z][A-Za-z\s'-]{1,40}?)(?:\s*,|\s+and|\s+0|\s+\+|$)/i);
  const name = named?.[1]?.trim().replace(/\s+/g, " ") || null;
  return {
    name: name && !/^(yes|confirm|order)$/i.test(name) ? name.slice(0, 80) : null,
    phone: phoneMatch?.[1] || null,
  };
}

export function authoritativeUnitPrice(product: CatalogueProduct): number | null {
  const base = product.basePriceKES ?? product.variantPriceKES ?? null;
  if (typeof base === "number" && Number.isFinite(base) && base >= 0) return Math.round(base);
  return null;
}

export function applyBulkUnitPrice(
  productName: string,
  baseUnitKES: number,
  quantity: number,
  rules: BulkPriceRule[] | null | undefined,
): { unitPriceKES: number; bulkApplied: boolean } {
  const match = (rules || []).find(
    (rule) =>
      rule.productName.trim().toLowerCase() === productName.trim().toLowerCase() &&
      quantity >= rule.minQuantity &&
      Number.isFinite(rule.unitPriceKES) &&
      rule.unitPriceKES >= 0,
  );
  if (!match) return { unitPriceKES: baseUnitKES, bulkApplied: false };
  return { unitPriceKES: Math.round(match.unitPriceKES), bulkApplied: true };
}

export function stockIsConfirmed(product: CatalogueProduct): boolean {
  if (typeof product.quantity === "number" && Number.isFinite(product.quantity)) return true;
  return typeof product.stockStatus === "string" && product.stockStatus.trim().length > 0;
}

export function formatKes(amount: number): string {
  return `KES ${Math.round(amount)}`;
}

export function unitLabel(product: CatalogueProduct): string {
  const unit = (product.portionSize || "").trim();
  return unit ? ` per ${unit}` : "";
}

export function formatProductPriceLine(product: CatalogueProduct, quantity = 1, rules?: BulkPriceRule[]): string {
  const base = authoritativeUnitPrice(product);
  if (base === null) return `${product.name}: price is not configured.`;
  const priced = applyBulkUnitPrice(product.name, base, quantity, rules);
  const unit = unitLabel(product);
  const bulkNote = priced.bulkApplied ? ` (configured bulk price from ${quantity})` : "";
  return `${product.name} is ${formatKes(priced.unitPriceKES)}${unit}${bulkNote}`;
}

export function formatDeliveryAnswer(zone: DeliveryZoneConfig, extra?: { freeDeliveryAboveKES?: number | null }): string {
  const fee = `Yes. Delivery to ${zone.name} is ${formatKes(zone.feeKES)}`;
  const eta = zone.estimatedTime?.trim() ? ` and normally takes ${zone.estimatedTime.trim()}` : "";
  const threshold =
    typeof extra?.freeDeliveryAboveKES === "number" && extra.freeDeliveryAboveKES > 0
      ? ` Free delivery applies on orders above ${formatKes(extra.freeDeliveryAboveKES)}.`
      : typeof zone.freeDeliveryAboveKES === "number" && zone.freeDeliveryAboveKES > 0
        ? ` Free delivery applies on orders above ${formatKes(zone.freeDeliveryAboveKES)}.`
        : "";
  return `${fee}${eta}.${threshold}`.replace(/\s+/g, " ").trim();
}

export function formatZoneList(delivery: DeliveryConfiguration): string {
  return delivery.zones
    .map((zone) => {
      const eta = zone.estimatedTime?.trim() ? `, ${zone.estimatedTime.trim()}` : "";
      return `${zone.name}: ${formatKes(zone.feeKES)}${eta}`;
    })
    .join("; ");
}

const DAY_INDEX: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

export function openingHoursSummary(raw: string | null | undefined): string | null {
  const rows = formatOpeningHours(raw);
  if (!rows.length) return null;
  return rows.map((row) => (row.label ? `${row.label}: ${row.value}` : row.value)).join("; ");
}

function nairobiParts(now: Date): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = (parts.find((part) => part.type === "weekday")?.value || "").slice(0, 3).toLowerCase();
  const hour = Number(parts.find((part) => part.type === "hour")?.value || "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value || "0");
  return { day: DAY_INDEX[weekday] ?? now.getUTCDay(), minutes: hour * 60 + minute };
}

/**
 * Interpret a simple hours string. Returns openNow=null when the string cannot be
 * read confidently — callers must not claim the business is open or closed.
 */
export function interpretOpeningStatus(
  raw: string | null | undefined,
  now: Date = new Date(),
): { summary: string | null; openNow: boolean | null } {
  const summary = openingHoursSummary(raw);
  if (!summary) return { summary: null, openNow: null };
  const text = summary.toLowerCase();
  const clock = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–to]+\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i.exec(summary);
  if (!clock) return { summary, openNow: null };
  const toMinutes = (hourRaw: string, minuteRaw: string | undefined, meridiem: string | undefined) => {
    let hour = Number(hourRaw);
    const minute = Number(minuteRaw || "0");
    const mark = (meridiem || "").toLowerCase();
    if (mark === "pm" && hour < 12) hour += 12;
    if (mark === "am" && hour === 12) hour = 0;
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
    return hour * 60 + minute;
  };
  const open = toMinutes(clock[1], clock[2], clock[3]);
  const close = toMinutes(clock[4], clock[5], clock[6] || clock[3]);
  if (open === null || close === null || close <= open) return { summary, openNow: null };

  let days: number[] | null = null;
  if (/\b(daily|every day|everyday)\b/.test(text)) days = [0, 1, 2, 3, 4, 5, 6];
  else if (/\bmon(?:day)?\s*[-–to]+\s*sat(?:urday)?\b/.test(text)) days = [1, 2, 3, 4, 5, 6];
  else if (/\bmon(?:day)?\s*[-–to]+\s*fri(?:day)?\b/.test(text) || /\bweekdays?\b/.test(text)) days = [1, 2, 3, 4, 5];
  else if (/\bweekends?\b/.test(text)) days = [0, 6];
  if (!days) return { summary, openNow: null };

  const nairobi = nairobiParts(now);
  const openNow = days.includes(nairobi.day) && nairobi.minutes >= open && nairobi.minutes < close;
  return { summary, openNow };
}

export type PolicyKey =
  | "refund"
  | "cancellation"
  | "exchange"
  | "credit"
  | "minimum_order"
  | "bulk"
  | "delivery"
  | "booking"
  | "preorder"
  | "modification"
  | "after_hours"
  | "walk_in";

export function detectPolicyEnquiry(message: string): PolicyKey | null {
  const text = (message || "").toLowerCase();
  const asking =
    /\b(what(?:'s| is| are)|policy|policies|rules|do you (?:allow|accept|offer|give)|can i|how do)\b/.test(text) ||
    /\b(refund policy|cancellation policy|exchange policy|return policy|credit policy)\b/.test(text);
  const dispute = /\b(my order|immediately|right now|dispute|complaint|money back|refund me|cancel my)\b/.test(text);
  if (!asking || dispute) return null;
  if (/\b(refund|money back)\b/.test(text)) return "refund";
  if (/\b(cancel|cancellation)\b/.test(text)) return "cancellation";
  if (/\b(exchange|return)\b/.test(text)) return "exchange";
  if (/\bcredit\b/.test(text)) return "credit";
  if (/\b(minimum order|min order)\b/.test(text)) return "minimum_order";
  if (/\bbulk\b/.test(text)) return "bulk";
  if (/\b(change|modify|modification)\b/.test(text) && /\border\b/.test(text)) return "modification";
  if (/\b(closed|after hours|after-hours)\b/.test(text)) return "after_hours";
  if (/\bwalk-?ins?\b/.test(text)) return "walk_in";
  if (/\b(book|booking|appointment)\b/.test(text)) return "booking";
  if (/\bpre-?order\b/.test(text)) return "preorder";
  if (/\bdeliver/.test(text) && /\b(condition|policy|rule)\b/.test(text)) return "delivery";
  return null;
}

const SECRET_PATTERNS = [
  /\bsk_(?:live|test)_[a-z0-9]+\b/gi,
  /\b(?:api[_ ]?key|secret key|webhook secret|consumer secret|password|private key)\b\s*[:=]?\s*\S+/gi,
  /\bBearer\s+[A-Za-z0-9._\-]{8,}\b/g,
];

export function redactSecretsFromPublicText(value: string): { text: string; containedSecret: boolean } {
  let containedSecret = false;
  let text = value || "";
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) containedSecret = true;
    pattern.lastIndex = 0;
    text = text.replace(pattern, "[removed]");
  }
  return { text: text.replace(/\s+/g, " ").trim(), containedSecret };
}

export type PublicPaymentDetails = {
  mpesaTill?: string | null;
  paybill?: string | null;
  paybillAccount?: string | null;
  pochi?: string | null;
  bankName?: string | null;
  bankAccount?: string | null;
  cash?: boolean;
  cashOnDelivery?: boolean;
  depositRequirements?: string | null;
  otherInstructions?: string | null;
};

export function composePublicPaymentText(details: PublicPaymentDetails): string {
  const parts: string[] = [];
  if (details.mpesaTill?.trim()) parts.push(`M-Pesa Till: ${details.mpesaTill.trim()}`);
  if (details.paybill?.trim()) {
    parts.push(
      `M-Pesa Paybill: ${details.paybill.trim()}${details.paybillAccount?.trim() ? ` Account: ${details.paybillAccount.trim()}` : ""}`,
    );
  }
  if (details.pochi?.trim()) parts.push(`Pochi la Biashara: ${details.pochi.trim()}`);
  if (details.bankName?.trim() || details.bankAccount?.trim()) {
    parts.push(`Bank: ${[details.bankName, details.bankAccount].filter(Boolean).join(" ")}`.trim());
  }
  if (details.cash) parts.push("Cash accepted");
  if (details.cashOnDelivery) parts.push("Cash on delivery accepted");
  if (details.depositRequirements?.trim()) parts.push(`Deposit: ${details.depositRequirements.trim()}`);
  if (details.otherInstructions?.trim()) parts.push(details.otherInstructions.trim());
  return redactSecretsFromPublicText(parts.join(". ")).text;
}

export function isClosedQuestion(message: string): boolean {
  return /\b(what happens if (?:you(?:'re| are) )?closed|if you(?:'re| are) closed|after[- ]hours)\b/i.test(message || "");
}

export function isOpenQuestion(message: string): boolean {
  return /\b(are you open|open today|open now|are you closed|mko wazi|mnafungua leo)\b/i.test(message || "");
}

export function isBookingIntent(message: string): boolean {
  return /\b(book|booking|appointment|schedule|reserve a slot)\b/i.test(message || "");
}

export function isPreorderIntent(message: string): boolean {
  return /\b(pre-?order|order for tomorrow|for tomorrow|kesho)\b/i.test(message || "");
}

export function isHumanHandoff(message: string): boolean {
  return /\b(speak\s+to|talk\s+to|call\s+the|human|person|manager|owner|agent|staff|someone)\b/i.test(message || "");
}
