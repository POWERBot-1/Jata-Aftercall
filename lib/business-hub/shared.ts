/**
 * Shared primitives for the JATA Business Hub (conversion & retention).
 *
 * Customer conversion features live on a *public* page, so every helper here assumes the input
 * is hostile: no value from a request body is ever written as-is, and no helper trusts a client
 * price, id or tenant. Server-side code loads the tenant's own rows and passes them in.
 */

import crypto from "node:crypto";
import { sanitizeText, validateEmail, validatePhone } from "../validation";
import { hashIp, hashSession } from "../analytics";

export const CONTACT_METHODS = ["PHONE", "WHATSAPP", "EMAIL", "IN_PERSON"] as const;
export type ContactMethod = (typeof CONTACT_METHODS)[number];

export const HUB_SUBJECTS = {
  ORDER_REQUEST: "ORDER_REQUEST",
  CUSTOMER_ENQUIRY: "CUSTOMER_ENQUIRY",
  PROMOTION: "PROMOTION",
  LOYALTY: "LOYALTY",
} as const;

/** Uppercase Crockford-ish alphabet without I, O, 0 and 1: codes are read aloud and typed back. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function randomCode(length: number): string {
  const bytes = crypto.randomBytes(length * 4);
  let out = "";
  for (let i = 0; i < length; i += 1) out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return out;
}

/**
 * Human-quotable reference, e.g. `JATA-REQ-20261106-4F9K2Q`.
 *
 * The date is the Nairobi calendar day (business time zone), and the suffix is random: a
 * sequential counter would let anyone enumerate another business's order requests.
 */
export function createReference(prefix: string, now: Date = new Date()): string {
  const day = new Date(now.getTime() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10).replace(/-/g, "");
  return `${prefix}-${day}-${randomCode(6)}`;
}

export function cleanText(value: unknown, max: number): string {
  return sanitizeText(typeof value === "string" ? value : "", max);
}

export function cleanOptionalText(value: unknown, max: number): string | null {
  const cleaned = cleanText(value, max);
  return cleaned ? cleaned : null;
}

export function normaliseContactMethod(value: unknown): ContactMethod | null {
  const upper = typeof value === "string" ? value.trim().toUpperCase() : "";
  return (CONTACT_METHODS as readonly string[]).includes(upper) ? (upper as ContactMethod) : null;
}

/**
 * Shape of every validation result in the hub.
 *
 * The absent branch's fields are declared `never` rather than omitted. This project compiles with
 * `strict: false` (see `tsconfig.json`), and with `strictNullChecks` disabled TypeScript does not
 * narrow a union on a boolean discriminant — `if (!result.ok) return result.error` fails to
 * compile even though it is correct at runtime. Declaring both branches' fields keeps every read
 * type-checked while still making an invalid combination impossible to construct.
 */
export type ValidationResult<T> =
  | { ok: true; value: T; error?: never }
  | { ok: false; error: string; value?: never };

/** Shape of every owner action result: the failure branch carries the HTTP status to return. */
export type ActionResult<T> =
  | { ok: true; record: T; status?: never; error?: never }
  | { ok: false; status: number; error: string; record?: never };

/**
 * Validates the contact value against the chosen method.
 *
 * PHONE and WHATSAPP must be real Kenyan numbers (the same rule the rest of the product uses,
 * so a WhatsApp link built later never silently points at nothing). IN_PERSON accepts a short
 * free-text placeholder such as "ask for Mary at the counter".
 */
export function validateContact(method: ContactMethod, raw: unknown): ValidationResult<string> {
  const value = cleanText(raw, 60);
  if (method === "PHONE" || method === "WHATSAPP") {
    if (!validatePhone(value)) {
      return { ok: false, error: "Enter a Kenyan phone number, for example 0712 345 678." };
    }
    return { ok: true, value };
  }
  if (method === "EMAIL") {
    if (!validateEmail(value)) return { ok: false, error: "Enter a valid email address." };
    return { ok: true, value };
  }
  if (value.length < 2) return { ok: false, error: "Tell the business how to reach you." };
  return { ok: true, value };
}

/** Stores only hashes: a submission must be traceable for abuse without storing contactable PII. */
export function submissionFingerprint(input: { ip?: string | null; userAgent?: string | null }) {
  return {
    ipHash: hashIp(input.ip ?? null),
    sessionHash: hashSession({ ip: input.ip ?? null, userAgent: input.userAgent ?? null }),
  };
}

export function clampInt(value: unknown, min: number, max: number, fallback = min): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

/** A public search term: letters, digits and spaces only, so it can never inject a filter. */
export function cleanSearch(value: unknown, max = 60): string {
  const raw = typeof value === "string" ? value : "";
  return raw.replace(/[^\p{L}\p{N}@.\-\s]/gu, "").trim().slice(0, max);
}

export type HubActivityInput = {
  businessId: string;
  subjectType: string;
  subjectId: string;
  kind: string;
  summary: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  note?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
};

/**
 * Appends one activity row. The hub's history is append-only by design: nothing rewrites or
 * deletes an entry, so "who changed this and when" survives later edits.
 *
 * A failed write must never lose a customer submission, so this is best-effort everywhere.
 */
export async function recordHubActivity(prisma: any, input: HubActivityInput): Promise<void> {
  try {
    await prisma.businessHubActivity.create({
      data: {
        businessId: input.businessId,
        subjectType: input.subjectType,
        subjectId: input.subjectId,
        kind: input.kind,
        summary: cleanText(input.summary, 200),
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        note: cleanOptionalText(input.note, 2000),
        actorId: input.actorId ?? null,
        actorLabel: cleanOptionalText(input.actorLabel, 80),
      },
    });
  } catch (error) {
    console.warn("Business hub activity unavailable", error);
  }
}

export async function listHubActivity(
  prisma: any,
  businessId: string,
  options: { subjectType?: string; subjectId?: string; take?: number } = {},
): Promise<any[]> {
  const where: Record<string, unknown> = { businessId };
  if (options.subjectType) where.subjectType = options.subjectType;
  if (options.subjectId) where.subjectId = options.subjectId;
  try {
    return await prisma.businessHubActivity.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: Math.min(200, Math.max(1, options.take ?? 50)),
    });
  } catch {
    return [];
  }
}
