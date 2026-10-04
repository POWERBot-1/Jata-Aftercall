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

export function matchCatalogue(message: string, products: CatalogueProduct[]): CatalogueProduct[] {
  const raw = (message || "").toLowerCase();
  const msgTokens = contentTokens(message);
  if (msgTokens.length === 0) return [];
  const msgTokenSet = new Set(msgTokens);
  const scored = products
    .filter((product) => product.isActive !== false)
    .map((product) => {
      const name = product.name.toLowerCase();
      const nameTokens = contentTokens(product.name);
      const categoryTokens = contentTokens(product.category || "");
      let score = 0;
      if (name.length >= 3 && (raw.includes(name) || raw.includes(singularize(name)))) score += 100;
      const overlap = nameTokens.filter((token) => msgTokenSet.has(token) || raw.includes(token));
      score += overlap.length * 10;
      if (nameTokens.length > 0 && overlap.length === nameTokens.length) score += 15;
      if (categoryTokens.some((token) => msgTokenSet.has(token)) && (overlap.length > 0 || score >= 100)) score += 4;
      else if (overlap.length === 0 && categoryTokens.some((token) => msgTokenSet.has(token))) score += 4;
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

export function refersToPreviousPlace(message: string): boolean {
  return /\b(there|that\s+place|same\s+place|that\s+area|huko|pale)\b/i.test(message || "");
}

export function extractDeliveryArea(message: string): { zone: string | null; refersToPrevious: boolean } {
  const text = message || "";
  if (refersToPreviousPlace(text) && /\b(deliver|delivery|send|peleka|delivered)\b/i.test(text)) {
    return { zone: null, refersToPrevious: true };
  }
  const patterns = [
    /deliver(?:ed|y)?\s+(?:to|in|for)\s+([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.|,|!)/i,
    /delivery\s+(?:to|in|for)\s+([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.|,|!)/i,
    /mnafanya\s+delivery\s+([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.|,)/i,
    /mnadeliver\s+([a-z0-9][a-z0-9\s-]{1,40}?)(?:\?|$|\.|,)/i,
    /\bto\s+([a-z][a-z\s-]{1,40})$/i,
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const zone = match?.[1]?.trim();
    if (!zone) continue;
    if (/^(there|here|me|them|us|it)$/i.test(zone)) return { zone: null, refersToPrevious: true };
    return { zone, refersToPrevious: false };
  }
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
