/**
 * Shared rules for the subscription checkout route (`app/api/checkout`).
 *
 * These live outside the route file because a Next.js route module may only export HTTP
 * handlers and route segment config, and because the confirmation page and the tests refer to
 * the same values.
 */

/**
 * How long one unpaid checkout owns the "start a payment" slot for a business + plan.
 *
 * It matches the window the route already used to refuse a second attempt, and it is also the
 * age after which an abandoned attempt is retired (`EXPIRED`) so the owner can try again instead
 * of being locked out by a Paystack tab they closed yesterday. A later provider-verified success
 * still settles an EXPIRED payment (see `SETTLEABLE_PAYMENT_STATES`).
 */
export const CHECKOUT_PENDING_WINDOW_MS = 15 * 60 * 1000;

/** Where an owner can look at an attempt that already exists, without starting a second charge. */
export function checkoutStatusUrl(reference: string): string {
  return `/checkout/callback?reference=${encodeURIComponent(reference)}`;
}
