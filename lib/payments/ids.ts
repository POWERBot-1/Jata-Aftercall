/**
 * Payment identity (§32, §33, §64) — JATA payment ids, provider references and idempotency keys.
 *
 * Every payment has:
 *   • a JATA payment id, human-readable and unique   JTP-20261004-1048-X8K2
 *   • an idempotency key, unique in the database     one payment request = one financial effect
 *   • a provider reference JATA hands to the provider (used to correlate the callback)
 *   • a receipt token: unguessable, for the public receipt page (§38, §83)
 *
 * Nothing here is derived from a guessable sequence alone: the random suffix and the crypto
 * tokens come from `node:crypto`, and the provider reference is charset-safe for every provider
 * (Paystack accepts [A-Za-z0-9.=-]; Safaricom accepts 12–20 alphanumerics for AccountReference).
 */

import crypto from "crypto";

const UNAMBIGUOUS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I — these are read aloud

function randomToken(length: number, alphabet = UNAMBIGUOUS): string {
  const bytes = crypto.randomBytes(length);
  let out = "";
  for (let index = 0; index < length; index += 1) {
    out += alphabet[bytes[index] % alphabet.length];
  }
  return out;
}

function dateStamp(now: Date): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}${month}${day}`;
}

/**
 * JTP-20261004-1048-X8K2 (§32). The sequence is the order/receipt reference when there is one,
 * so a merchant can match JATA's id to a sale without a lookup; the suffix keeps it unique even
 * when two tills request payment for the same counter sale at the same instant.
 */
export function jataPaymentId(sequence: number | string, now: Date = new Date()): string {
  const numeric = typeof sequence === "number" ? sequence : Number(String(sequence).replace(/\D/g, ""));
  const reference = Number.isFinite(numeric) && numeric > 0 ? String(Math.trunc(numeric)).slice(-8) : "0";
  return `JTP-${dateStamp(now)}-${reference}-${randomToken(4)}`;
}

/** JATA's reference handed to the provider. Charset-safe for Paystack and Safaricom alike (§64). */
export function providerReferenceFor(jataId: string, provider: string): string {
  const base = String(jataId ?? "").replace(/[^A-Za-z0-9]/g, "-").slice(0, 40);
  return `${provider.slice(0, 4).toUpperCase()}-${base}`.slice(0, 50);
}

/**
 * Idempotency key (§33): the caller supplies what makes this request unique (a tenant, an order
 * or a till's request key); JATA never mints a fresh key for a retry of the same request, or a
 * double-tap at the till would create two payments.
 */
export function idempotencyKeyFor(parts: { businessId: string; scope: string; requestKey: string }): string {
  const material = [parts.businessId, parts.scope, parts.requestKey].map((part) => String(part ?? "").trim()).join("|");
  return `ipk_${crypto.createHash("sha256").update(material).digest("hex").slice(0, 48)}`;
}

/** Used for webhook events: the provider's own identity, namespaced by provider (§33). */
export function eventFingerprint(provider: string, eventId: string): string {
  return `${provider}:${String(eventId).slice(0, 160)}`;
}

/** 32 hex characters — the receipt page token (§38, §83). */
export function receiptToken(): string {
  return crypto.randomBytes(16).toString("hex");
}

/** Stable, non-reversible key for a customer's phone so a payment can be correlated without
 * storing the full number twice (§59). */
export function customerKey(phone: string | null | undefined): string | null {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  if (!digits) return null;
  return crypto.createHash("sha256").update(`jata-customer:${digits}`).digest("hex").slice(0, 32);
}

/** Correlation reference shown on the till and in the customer's message (§64). */
export function correlationReference(jataId: string): string {
  const tail = String(jataId ?? "").split("-");
  return tail.length >= 2 ? tail.slice(-2).join("-") : String(jataId ?? "");
}
