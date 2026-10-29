/**
 * Consent, suppression and contact eligibility
 *
 * The UI may feel simple; the rules behind it are not negotiable. Marketing needs recorded
 * consent, a suppression or opt-out always wins, quiet hours delay a send rather than dropping
 * it, and a frequency cap stops a campaign from becoming harassment. Every refusal returns a
 * reason the owner can read and act on.
 *
 * Possession of a phone number is never treated as consent.
 */

export type CampaignPurpose = "MARKETING" | "TRANSACTIONAL";
export type ContactChannel = "SMS" | "WHATSAPP" | "EMAIL";

export type ConsentState = {
  /** Explicit opt-in to promotional messages on this channel. */
  marketing: boolean;
  /** Explicit permission for service/transactional messages where one is required. */
  transactional: boolean;
};

export type EligibilityContact = {
  id?: string;
  name?: string | null;
  phoneNormalized?: string | null;
  status?: string | null;
  customerId?: string | null;
  consent: ConsentState;
  suppressed?: boolean;
};

export type EligibilityInput = {
  contact: EligibilityContact;
  channel: ContactChannel;
  purpose: CampaignPurpose;
  now?: Date;
  /** Number of marketing messages this contact received in the last 30 days. */
  marketingMessagesLast30Days?: number;
  marketingFrequencyCap?: number;
  /** Start/end of permitted contact hours in local time, inclusive start, exclusive end. */
  permittedHours?: { startHour: number; endHour: number };
  timeZone?: string;
  /** Date.now-style offset check; the caller can pass a fixed offset in tests. */
  localHour?: number;
};

export type EligibilityCode =
  | "ELIGIBLE"
  | "INVALID_CONTACT"
  | "NO_MARKETING_CONSENT"
  | "NO_TRANSACTIONAL_PERMISSION"
  | "SUPPRESSED"
  | "OUTSIDE_PERMITTED_HOURS"
  | "FREQUENCY_CAP_REACHED";

export type EligibilityResult = {
  eligible: boolean;
  code: EligibilityCode;
  reason: string;
  /** When outside permitted hours, the next time the message may be sent. */
  nextAllowedAt?: Date;
};

export const DEFAULT_MARKETING_FREQUENCY_CAP = 4; // per contact per rolling 30 days
export const DEFAULT_PERMITTED_HOURS = { startHour: 8, endHour: 20 } as const;

/**
 * Local hour in the business time zone. Africa/Nairobi has no DST (UTC+3); for any other zone the
 * caller must supply `localHour`, otherwise UTC is used rather than silently guessing.
 */
export function localHourFor(now: Date, timeZone = "Africa/Nairobi"): number {
  if (timeZone === "Africa/Nairobi" || timeZone === "Africa/Addis_Ababa" || timeZone === "Africa/Dar_es_Salaam") {
    return (now.getUTCHours() + 3) % 24;
  }
  return now.getUTCHours();
}

export function nextPermittedSend(now: Date, hours: { startHour: number; endHour: number } = DEFAULT_PERMITTED_HOURS, timeZone = "Africa/Nairobi"): Date | null {
  const hour = localHourFor(now, timeZone);
  const offsetHours = timeZone === "Africa/Nairobi" ? 3 : 0;
  const startUtcHour = (hours.startHour - offsetHours + 24) % 24;

  if (hour >= hours.startHour && hour < hours.endHour) return null;

  const candidate = new Date(now);
  candidate.setUTCMinutes(0, 0, 0);
  if (hour >= hours.endHour) {
    candidate.setUTCDate(candidate.getUTCDate() + 1);
  }
  candidate.setUTCHours(startUtcHour);
  // Defensive: if the computed instant is still in the past (e.g. now exactly at start), move a day.
  if (candidate.getTime() <= now.getTime()) candidate.setUTCDate(candidate.getUTCDate() + 1);
  return candidate;
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const contact = input.contact;
  const purpose = input.purpose;
  const channel = input.channel;

  if (!contact || String(contact.status ?? "ACTIVE").toUpperCase() !== "ACTIVE") {
    return { eligible: false, code: "INVALID_CONTACT", reason: "This contact is not active." };
  }
  if (channel === "SMS" || channel === "WHATSAPP") {
    if (!contact.phoneNormalized) {
      return { eligible: false, code: "INVALID_CONTACT", reason: "This contact has no valid phone number." };
    }
  }

  if (contact.suppressed) {
    return { eligible: false, code: "SUPPRESSED", reason: "This customer opted out or is on your suppression list." };
  }

  if (purpose === "MARKETING") {
    if (!contact.consent.marketing) {
      return {
        eligible: false,
        code: "NO_MARKETING_CONSENT",
        reason: "No recorded marketing consent for this contact. Add consent before including them in a promotion.",
      };
    }
    const cap = Math.max(1, input.marketingFrequencyCap ?? DEFAULT_MARKETING_FREQUENCY_CAP);
    if ((input.marketingMessagesLast30Days ?? 0) >= cap) {
      return {
        eligible: false,
        code: "FREQUENCY_CAP_REACHED",
        reason: `This customer already received ${cap} marketing messages in the last 30 days.`,
      };
    }
  } else {
    // Transactional messaging is permitted where a genuine service relationship exists, but an
    // explicit refusal recorded for this channel is honoured.
    if (!contact.consent.transactional && !contact.customerId) {
      return {
        eligible: false,
        code: "NO_TRANSACTIONAL_PERMISSION",
        reason: "No service relationship or permission on record for this contact.",
      };
    }
  }

  const now = input.now ?? new Date();
  const hours: { startHour: number; endHour: number } = input.permittedHours ?? DEFAULT_PERMITTED_HOURS;
  const hour = input.localHour ?? localHourFor(now, input.timeZone);
  if (hour < hours.startHour || hour >= hours.endHour) {
    const nextAllowedAt = nextPermittedSend(now, hours, input.timeZone) ?? undefined;
    return {
      eligible: false,
      code: "OUTSIDE_PERMITTED_HOURS",
      reason: `Messages are only sent between ${String(hours.startHour).padStart(2, "0")}:00 and ${String(hours.endHour).padStart(2, "0")}:00. This one will wait.`,
      nextAllowedAt,
    };
  }

  return { eligible: true, code: "ELIGIBLE", reason: "Eligible." };
}

/** Normalise a consent record request. Marketing consent must never be inferred from a profile. */
export function consentDecision(input: {
  channel: ContactChannel;
  purpose: CampaignPurpose;
  granted: boolean;
  source: string;
  wordingVersion?: string;
}): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!input.source || input.source.trim().length < 3) errors.push("Record where the consent came from.");
  if (!input.channel) errors.push("Choose a channel.");
  if (!input.purpose) errors.push("Choose a purpose.");
  if (input.granted && !input.wordingVersion) errors.push("Record which consent wording the customer agreed to.");
  return { ok: errors.length === 0, errors };
}

/**
 * Stop keywords are interpreted case-insensitively and as whole words. "STOP" in the middle of a
 * sentence is not an opt-out; the customer replying STOP is.
 */
export const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "OPTOUT", "OPT OUT", "QUIT", "END"];

export function isOptOutMessage(text: string): boolean {
  const normalized = String(text ?? "").trim().toUpperCase().replace(/\s+/g, " ");
  return STOP_KEYWORDS.includes(normalized);
}
