/**
 * Neutral-path alias for the C2B validation callback (`ValidationURL`).
 *
 * Safaricom's Daraja guidance, as reproduced by integration guides, says callback and registration
 * URLs containing "mpesa", "m-pesa" or "safaricom" are filtered and blocked. This path carries none
 * of those words and is what JATA hands to Safaricom by default. It runs exactly the same shared
 * handler — the same authentication, the same pipeline — as the legacy
 * `/api/payments/webhooks/mpesa/validation` route, so the two can never drift.
 */

import { mpesaWebhookHandler, mpesaWebhookProbe } from "../../mpesa/handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return mpesaWebhookHandler(request);
}

/** Some configurations issue a GET probe; it is answered without side effects. */
export async function GET() {
  return mpesaWebhookProbe();
}
