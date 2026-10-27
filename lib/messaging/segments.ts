/**
 * SMS segmentation and channel-aware message limits
 *
 * The billable unit is a *segment*, and the segment count depends on the alphabet the whole
 * message can be encoded in. A single accented character or emoji moves the entire message from
 * GSM-7 (160/153 characters) to UCS-2 (70/67), which can double or triple the cost. Guessing
 * this in the UI would produce dishonest estimates, so the calculation lives in one tested place.
 */

export type SmsEncoding = "GSM7" | "UCS2";

export type SegmentSummary = {
  encoding: SmsEncoding;
  /** GSM-7 septets (extension characters count twice) or UTF-16 code units for UCS-2. */
  units: number;
  segments: number;
  perSegmentUnits: number;
  singleSegmentLimit: number;
  multiSegmentLimit: number;
  charactersRemainingInLastSegment: number;
};

/** GSM 03.38 basic alphabet plus the escape (extension) characters that cost two septets. */
const GSM_BASIC = new Set(
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà".split(""),
);
const GSM_EXTENSION = new Set("^{}\\[~]|€".split(""));

export function isGsm7(text: string): boolean {
  for (const character of text) {
    if (!GSM_BASIC.has(character) && !GSM_EXTENSION.has(character)) return false;
  }
  return true;
}

export function calculateSegments(body: string): SegmentSummary {
  const text = String(body ?? "");
  const gsm = isGsm7(text);

  if (gsm) {
    let septets = 0;
    for (const character of text) septets += GSM_EXTENSION.has(character) ? 2 : 1;
    const segments = septets <= 160 ? Math.max(1, Math.ceil(septets / 160)) : Math.ceil(septets / 153);
    const per = septets <= 160 ? 160 : 153;
    const used = septets <= 160 ? septets : septets % 153 || 153;
    return {
      encoding: "GSM7",
      units: septets,
      segments,
      perSegmentUnits: per,
      singleSegmentLimit: 160,
      multiSegmentLimit: 153,
      charactersRemainingInLastSegment: segments === 0 ? 160 : Math.max(0, per - used),
    };
  }

  // UTF-16 code units: an emoji occupies a surrogate pair, which the provider bills as two units.
  const units = text.length;
  const segments = units <= 70 ? Math.max(1, Math.ceil(units / 70)) : Math.ceil(units / 67);
  const per = units <= 70 ? 70 : 67;
  const used = units <= 70 ? units : units % 67 || 67;
  return {
    encoding: "UCS2",
    units,
    segments,
    perSegmentUnits: per,
    singleSegmentLimit: 70,
    multiSegmentLimit: 67,
    charactersRemainingInLastSegment: Math.max(0, per - used),
  };
}

export type NetworkTariff = {
  network: "SAFARICOM" | "AIRTEL" | "TELKOM" | "MULTI";
  /** Merchant-facing rate in cents per segment. */
  perSegmentCents: number;
  currency: "KES";
  /**
   * A provider rate is a commercial term, not a law of nature. False means "configured
   * reference value — confirm with the provider before quoting it to a customer".
   */
  verified: boolean;
  sourceRef: string;
};

export const DEFAULT_SMS_TARIFFS: NetworkTariff[] = [
  { network: "SAFARICOM", perSegmentCents: 90, currency: "KES", verified: false, sourceRef: "Reference merchant rate — confirm with the approved SMS provider" },
  { network: "AIRTEL", perSegmentCents: 85, currency: "KES", verified: false, sourceRef: "Reference merchant rate — confirm with the approved SMS provider" },
  { network: "TELKOM", perSegmentCents: 80, currency: "KES", verified: false, sourceRef: "Reference merchant rate — confirm with the approved SMS provider" },
  { network: "MULTI", perSegmentCents: 90, currency: "KES", verified: false, sourceRef: "Reference merchant rate — confirm with the approved SMS provider" },
];

export type CostEstimate = {
  segments: number;
  perSegmentCents: number;
  totalCents: number;
  network: NetworkTariff["network"];
  verified: boolean;
  sourceRef: string;
  currency: "KES";
};

export function estimateSmsCost(
  body: string,
  options: { network?: NetworkTariff["network"]; tariffs?: NetworkTariff[]; recipientCount?: number } = {},
): CostEstimate {
  const network = options.network ?? "MULTI";
  const tariffs = options.tariffs ?? DEFAULT_SMS_TARIFFS;
  const tariff = tariffs.find((entry) => entry.network === network) ?? tariffs[0];
  const segments = calculateSegments(body).segments;
  const count = Math.max(1, Math.round(options.recipientCount ?? 1));
  return {
    segments,
    perSegmentCents: tariff.perSegmentCents,
    totalCents: tariff.perSegmentCents * segments * count,
    network: tariff.network,
    verified: tariff.verified,
    sourceRef: tariff.sourceRef,
    currency: "KES",
  };
}

/**
 * WhatsApp pricing is conversation/template-category based, not segment based. The ERP only
 * *estimates* from a configured merchant rate and always labels it as an estimate; the provider's
 * invoice is authoritative.
 */
export type WhatsAppEstimate = {
  conversations: number;
  perConversationCents: number;
  totalCents: number;
  category: "UTILITY" | "MARKETING" | "AUTHENTICATION" | "SERVICE";
  verified: boolean;
  note: string;
};

export function estimateWhatsAppCost(
  category: WhatsAppEstimate["category"],
  recipientCount: number,
  perConversationCents: number,
): WhatsAppEstimate {
  const count = Math.max(0, Math.round(recipientCount));
  return {
    conversations: count,
    perConversationCents: Math.max(0, Math.round(perConversationCents)),
    totalCents: count * Math.max(0, Math.round(perConversationCents)),
    category,
    verified: false,
    note: "Estimated from your configured merchant rate. WhatsApp charges are billed by the provider and may differ.",
  };
}
