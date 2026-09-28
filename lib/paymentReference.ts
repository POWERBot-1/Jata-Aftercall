import crypto from "crypto";

/**
 * Paystack references allow alphanumerics, hyphens, dots, and equals signs.
 * A UUIDv4 provides 122 bits of randomness; the fixed prefix is provider-safe
 * and keeps references recognizable without accepting any client-supplied data.
 */
export function generatePaymentReference(): string {
  return `jata-${crypto.randomUUID()}`;
}
