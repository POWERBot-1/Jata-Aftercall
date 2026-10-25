/**
 * JATA Autopilot — Consent, Opt-Out & Quiet-Hours Compliance Engine (§8.4)
 *
 * Enforces explicit channel/scope consent, instant deterministic `STOP` /
 * `UNSUBSCRIBE` / `ACHA` / `TOA` opt-outs, and East Africa Time (`Africa/Nairobi`)
 * quiet hours (`20:00–07:00` default) before any promotional or non-urgent outreach.
 */

import prisma from "@/lib/db";

const STOP_KEYWORDS_REGEX =
  /^\s*(stop|unsubscribe|opt\s*-?\s*out|cancel\s+messages|acha|toa|wacha)\s*[.!]?\s*$/i;

export function normalizeAutopilotPhone(raw?: string | null): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+254") && digits.length === 13) return digits;
  if (digits.startsWith("254") && digits.length === 12) return `+${digits}`;
  if ((digits.startsWith("07") || digits.startsWith("01")) && digits.length === 10) {
    return `+254${digits.slice(1)}`;
  }
  return digits.length >= 8 ? digits : null;
}

export function normalizeAutopilotEmail(raw?: string | null): string | null {
  if (!raw) return null;
  const clean = raw.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) ? clean : null;
}

export function isOptOutMessage(text: string): boolean {
  return STOP_KEYWORDS_REGEX.test(text);
}

export function isValidHhMm(value: unknown): value is string {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value.trim());
}

function parseHhMm(hhmm: string, fallbackMinutes: number): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return fallbackMinutes;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h < 0 || h > 23 || min < 0 || min > 59) return fallbackMinutes;
  return h * 60 + min;
}

/**
 * Evaluates whether `now` falls inside the tenant's quiet hours in `timezone`
 * (defaults to `Africa/Nairobi`, UTC+3, `20:00` to `07:00`).
 */
export function isWithinQuietHours(params: {
  now?: Date;
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
}): boolean {
  const now = params.now ?? new Date();
  const tz = params.timezone || "Africa/Nairobi";
  const startMin = parseHhMm(params.quietHoursStart ?? "20:00", 20 * 60);
  const endMin = parseHhMm(params.quietHoursEnd ?? "07:00", 7 * 60);

  let currentMinutes: number;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", {
      timeZone: tz,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0") % 24;
    const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    currentMinutes = hour * 60 + minute;
  } catch {
    // Deterministic UTC+3 fallback for Africa/Nairobi
    const eat = new Date(now.getTime() + 3 * 3_600_000);
    currentMinutes = eat.getUTCHours() * 60 + eat.getUTCMinutes();
  }

  if (startMin === endMin) return false;
  if (startMin < endMin) {
    return currentMinutes >= startMin && currentMinutes < endMin;
  }
  // Overnight window, e.g. 20:00 -> 07:00
  return currentMinutes >= startMin || currentMinutes < endMin;
}

export async function recordCustomerOptOutByKeyword(params: {
  businessId: string;
  phone?: string | null;
  email?: string | null;
  channel: "WHATSAPP" | "SMS" | "EMAIL" | "VOICE";
  messageText: string;
}): Promise<{ optedOut: boolean; customerProfileId?: string }> {
  if (!isOptOutMessage(params.messageText)) {
    return { optedOut: false };
  }
  const phoneNormalized = normalizeAutopilotPhone(params.phone);
  const emailNormalized = normalizeAutopilotEmail(params.email);
  if (!phoneNormalized && !emailNormalized) return { optedOut: true };

  try {
    let profile = phoneNormalized
      ? await prisma.autopilotCustomerProfile.findUnique({
          where: {
            businessId_phoneNormalized: {
              businessId: params.businessId,
              phoneNormalized,
            },
          },
        })
      : await prisma.autopilotCustomerProfile.findFirst({
          where: { businessId: params.businessId, emailNormalized },
        });

    if (!profile) {
      try {
        profile = await prisma.autopilotCustomerProfile.create({
          data: {
            businessId: params.businessId,
            phoneNormalized,
            emailNormalized,
            lifecycleStage: "DORMANT",
          },
        });
      } catch (err: any) {
        if (err?.code === "P2002") {
          profile = phoneNormalized
            ? await prisma.autopilotCustomerProfile.findUnique({
                where: {
                  businessId_phoneNormalized: {
                    businessId: params.businessId,
                    phoneNormalized,
                  },
                },
              })
            : await prisma.autopilotCustomerProfile.findFirst({
                where: { businessId: params.businessId, emailNormalized },
              });
        } else {
          throw err;
        }
      }
    }
    if (!profile) return { optedOut: true };

    for (const scope of ["MARKETING", "TRANSACTIONAL"] as const) {
      await prisma.autopilotConsentRecord.upsert({
        where: {
          businessId_customerProfileId_channel_scope: {
            businessId: params.businessId,
            customerProfileId: profile.id,
            channel: params.channel,
            scope,
          },
        },
        update: {
          status: "UNSUBSCRIBED_KEYWORD",
          source: "INBOUND_STOP_KEYWORD",
        },
        create: {
          businessId: params.businessId,
          customerProfileId: profile.id,
          channel: params.channel,
          scope,
          status: "UNSUBSCRIBED_KEYWORD",
          source: "INBOUND_STOP_KEYWORD",
        },
      });
    }
    return { optedOut: true, customerProfileId: profile.id };
  } catch {
    return { optedOut: true };
  }
}

export async function verifyCustomerChannelConsent(params: {
  businessId: string;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  channel: "WHATSAPP" | "SMS" | "EMAIL";
  scope: "TRANSACTIONAL" | "MARKETING";
  quietHoursStart?: string;
  quietHoursEnd?: string;
  timezone?: string;
  urgentTransactionalBypass?: boolean;
  now?: Date;
}): Promise<{ allowed: true; customerProfileId: string } | { allowed: false; code: string; reason: string }> {
  const phoneNormalized = normalizeAutopilotPhone(params.recipientPhone);
  const emailNormalized = normalizeAutopilotEmail(params.recipientEmail);

  if (params.channel === "EMAIL" && !emailNormalized) {
    return {
      allowed: false,
      code: "INVALID_RECIPIENT_EMAIL",
      reason: "A valid recipient email address is required before queuing an email follow-up.",
    };
  }
  if ((params.channel === "SMS" || params.channel === "WHATSAPP") && !phoneNormalized) {
    return {
      allowed: false,
      code: "INVALID_RECIPIENT_PHONE",
      reason: "A valid phone number is required before queuing an SMS or WhatsApp follow-up.",
    };
  }

  const bypassQuietHours =
    params.scope === "TRANSACTIONAL" && params.urgentTransactionalBypass === true;
  if (
    !bypassQuietHours &&
    isWithinQuietHours({
      now: params.now,
      quietHoursStart: params.quietHoursStart,
      quietHoursEnd: params.quietHoursEnd,
      timezone: params.timezone,
    })
  ) {
    return {
      allowed: false,
      code: "QUIET_HOURS_ACTIVE",
      reason: `Automated outbound messages are blocked during tenant quiet hours (${params.quietHoursStart ?? "20:00"}–${params.quietHoursEnd ?? "07:00"} ${params.timezone ?? "Africa/Nairobi"}).`,
    };
  }

  const profile = phoneNormalized
    ? await prisma.autopilotCustomerProfile.findUnique({
        where: {
          businessId_phoneNormalized: {
            businessId: params.businessId,
            phoneNormalized,
          },
        },
      })
    : await prisma.autopilotCustomerProfile.findFirst({
        where: { businessId: params.businessId, emailNormalized },
      });

  if (!profile) {
    return {
      allowed: false,
      code: "MISSING_CONSENT_RECORD",
      reason:
        "No opted-in customer consent record exists for this recipient in this business. Record customer opt-in first.",
    };
  }

  const keywordOptOuts = await prisma.autopilotConsentRecord.findMany({
    where: {
      businessId: params.businessId,
      status: "UNSUBSCRIBED_KEYWORD",
    },
  });
  if (keywordOptOuts.some((c: { customerProfileId?: string }) => c.customerProfileId === profile.id)) {
    return {
      allowed: false,
      code: "RECIPIENT_OPTED_OUT",
      reason:
        "Recipient has opted out via STOP/UNSUBSCRIBE keyword. All automated outbound contact is blocked until explicit re-consent.",
    };
  }

  const consent = await prisma.autopilotConsentRecord.findUnique({
    where: {
      businessId_customerProfileId_channel_scope: {
        businessId: params.businessId,
        customerProfileId: profile.id,
        channel: params.channel,
        scope: params.scope,
      },
    },
  });

  if (!consent || consent.status !== "OPTED_IN") {
    return {
      allowed: false,
      code: consent?.status === "UNSUBSCRIBED_KEYWORD" || consent?.status === "OPTED_OUT"
        ? "RECIPIENT_OPTED_OUT"
        : "CONSENT_NOT_GRANTED",
      reason:
        consent?.status === "UNSUBSCRIBED_KEYWORD" || consent?.status === "OPTED_OUT"
          ? "Recipient has opted out (`STOP` / `OPTED_OUT`). Outbound contact is permanently blocked until explicit re-consent."
          : `Explicit ${params.scope} consent on ${params.channel} is not recorded for this recipient.`,
    };
  }

  return { allowed: true, customerProfileId: profile.id };
}
