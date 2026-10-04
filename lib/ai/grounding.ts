/**
 * The content truth principle, enforced in code (§10, §55)
 *
 * "Enhance presentation, never fabricate business facts."
 *
 * A model will happily write "20 years of experience" if nothing stops it. This module is the
 * stop: every generated sentence is checked against the facts the owner actually supplied, and
 * anything that asserts a credential, a guarantee, a policy, a delivery promise, a price or a
 * statistic that was never given is rejected before it can reach the owner's screen.
 *
 * Rejected text is never silently published — it is dropped, and the caller falls back to
 * grounded wording.
 */

export type GroundingResult = {
  ok: boolean;
  /** Machine reasons, for logs and tests. */
  violations: string[];
  /** Owner-facing explanation, safe to show in the Studio. */
  reason?: string;
};

type ClaimRule = {
  id: string;
  pattern: RegExp;
  /** Facts that make the claim legitimate, matched case-insensitively against supplied facts. */
  allowedWhen: RegExp;
  message: string;
};

/**
 * Claims that may only appear when the owner supplied them. Each rule is deliberately narrow:
 * it catches invented *assertions*, not ordinary marketing adjectives.
 */
const CLAIM_RULES: ClaimRule[] = [
  {
    id: "experience_years",
    pattern: /\b(\d{1,3})\s*\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:experience|service|expertise)\b/i,
    allowedWhen: /\b\d{1,3}\s*\+?\s*(?:years?|yrs?)\b/i,
    message: "years of experience",
  },
  {
    id: "award",
    // Covers the two ways a model fabricates a ranking: an explicit endorsement ("voted the
    // best…", "as seen on…") and a superlative placed against a location ("the best chapati in
    // Nairobi"). Both are statements about the world, not descriptions of the product.
    pattern:
      /\b(award[- ]winning|awarded|voted\s+(?:the\s+)?(?:best|number\s+one|#1)|won\s+(?:an\s+)?award|as\s+seen\s+on|rated\s+[\d.]+|(?:the\s+)?(?:best|finest|top|leading|premier|number\s+one|most\s+(?:trusted|popular|recommended))\b[^.!?]{0,40}\b(?:in|of|across)\s+[A-Za-z]|#1|top[- ]rated|leading\s+(?:provider|company|brand))\b/i,
    allowedWhen: /\b(award|awarded|best|number one|#1|top[- ]rated|leading|voted|rated|as seen on)\b/i,
    message: "an award or ranking",
  },
  {
    id: "credential",
    pattern: /\b(certified|accredited|licensed|registered|approved|ISO\s*\d+|KFDA|KEBS\s+certified|board[- ]certified|member of)\b/i,
    allowedWhen: /\b(certified|accredited|licensed|registered|ISO|member of)\b/i,
    message: "a certification or licence",
  },
  {
    id: "guarantee",
    pattern: /\b(guarantee[ds]?|warrant(?:y|ies)|money[- ]back|satisfaction guaranteed|risk[- ]free)\b/i,
    allowedWhen: /\b(guarantee|warranty|money[- ]back|risk[- ]free)\b/i,
    message: "a guarantee or warranty",
  },
  {
    id: "delivery_promise",
    pattern: /\b(same[- ]day delivery|free delivery|free shipping|delivered within \d+|next[- ]day delivery|24\/7 delivery|nationwide delivery)\b/i,
    allowedWhen: /\b(deliver|delivery|shipping|pickup)\b/i,
    message: "a delivery promise",
  },
  {
    id: "price",
    pattern: /\b(?:KSh|Ksh|KES|K\.?Sh\.?)\s?[\d,]{2,}|(?:\d{1,3}(?:,\d{3})+|\d{2,})\s*(?:shillings|bob|ksh)\b|\b(?:only|just)\s+(?:KES|KSh)\s?\d+/i,
    allowedWhen: /\b(?:KSh|Ksh|KES|shillings|bob|\d{2,})\b/i,
    message: "a price",
  },
  {
    id: "discount",
    pattern: /\b(\d{1,2})\s?%\s*(off|discount|saving|less)\b|\b(half price|buy one get one|BOGO)\b/i,
    allowedWhen: /%\s*(off|discount)?|\b(offer|discount|promo|sale)\b/i,
    message: "a discount",
  },
  {
    id: "statistic",
    pattern: /\b(\d{1,3}(?:,\d{3})+|\d{2,})\s*\+?\s*(?:happy\s+)?(?:customers|clients|orders|projects|students|patients|installations)\b/i,
    allowedWhen: /\bcustomers\b|\bclients\b|\borders\b/i,
    message: "a customer statistic",
  },
  {
    id: "medical_claim",
    pattern: /\b(cures?|treats?|heals?|clinically proven|miracle|guaranteed results)\b/i,
    allowedWhen: /\b(cure|treat|heal|clinical|miracle)\b/i,
    message: "a health claim",
  },
  {
    id: "opening_claim",
    pattern: /\b(open\s+(?:24|twenty[- ]four)\s*(?:\/\s*7|hours)|24\/7|open daily|open every day)\b/i,
    allowedWhen: /\b(24\/7|daily|every day|opening hours|hours)\b/i,
    message: "opening hours",
  },
  {
    id: "legal_claim",
    pattern: /\b(no\s+refund|refunds? (?:are )?(?:not )?(?:accepted|available)|returns? (?:are )?(?:not )?accepted|cancellation policy)\b/i,
    allowedWhen: /\b(refund|return|cancel|policy)\b/i,
    message: "a policy",
  },
  {
    id: "contact_invention",
    pattern: /\b(?:0\d{9,10}|07\d{8}|01\d{8})\b|\b[\w.+-]+@[\w-]+\.[\w.]{2,}\b/i,
    allowedWhen: /(?:\d{9,}|@)/,
    message: "contact details",
  },
  {
    id: "invented_years_since",
    pattern: /\b(since\s+(?:19|20)\d{2}|established\s+in\s+(?:19|20)\d{2}|founded\s+in\s+(?:19|20)\d{2})\b/i,
    allowedWhen: /\b(since|established|founded)\b/i,
    message: "a founding date",
  },
];

function normalizeFacts(facts: Array<string | null | undefined>): string {
  return facts
    .map((fact) => String(fact ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" · ");
}

/**
 * Checks one generated string against the supplied facts. Used both to reject vendor output and
 * to keep the deterministic composer honest as it grows.
 */
export function validateGroundedText(text: string, facts: Array<string | null | undefined>): GroundingResult {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (!value) return { ok: false, violations: ["empty"], reason: "Nothing was generated." };
  const known = normalizeFacts(facts);
  const violations: string[] = [];
  for (const rule of CLAIM_RULES) {
    if (!rule.pattern.test(value)) continue;
    if (rule.allowedWhen.test(known)) continue;
    violations.push(rule.id);
  }
  if (violations.length === 0) return { ok: true, violations: [] };
  const first = CLAIM_RULES.find((rule) => rule.id === violations[0]);
  return {
    ok: false,
    violations,
    reason: `JATA won't claim ${first?.message || "unverified information"} unless you tell us it is true.`,
  };
}

/** Keeps only the grounded options; if none survive, the caller supplies a safe fallback. */
export function filterGroundedTexts(texts: string[], facts: Array<string | null | undefined>): { accepted: string[]; rejected: Array<{ text: string; violations: string[] }> } {
  const accepted: string[] = [];
  const rejected: Array<{ text: string; violations: string[] }> = [];
  for (const text of texts) {
    const verdict = validateGroundedText(text, facts);
    if (verdict.ok) accepted.push(text);
    else rejected.push({ text, violations: verdict.violations });
  }
  return { accepted, rejected };
}

/** True when the text contains a claim family at all — used to warn the owner about their own draft. */
export function detectClaims(text: string): string[] {
  return CLAIM_RULES.filter((rule) => rule.pattern.test(String(text || ""))).map((rule) => rule.id);
}

/**
 * The instruction handed to any text provider. Paired with `validateGroundedText`, this makes
 * fabrication a rejected output rather than a shipped sentence.
 */
export const GROUNDING_SYSTEM_RULES = [
  "You write website copy for small Kenyan businesses.",
  "Use ONLY the facts supplied in the FACTS list. Never invent prices, discounts, guarantees, certifications, awards, years of experience, delivery times, product specifications, locations, contact details, opening hours, statistics or policies.",
  "If a fact is not supplied, write around it: describe the benefit and invite the customer to ask.",
  "Do not mention any brand name, product model or trademark that is not in the facts.",
  "Keep sentences short and concrete. No exclamation-mark stacking, no hype, no invented testimonial quotes.",
  "Return plain text only — no markdown, no headings, no emoji unless asked.",
].join(" ");
