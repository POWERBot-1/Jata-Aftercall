/**
 * M-PESA (Safaricom Daraja) provider events (§35, §111).
 *
 * This is JATA's endpoint — merchants never create or register it. Daraja posts both the STK
 * (customer-entered PIN, on the till) and C2B (till/PayBill, over the counter) callbacks here, so
 * the route accepts the union of the two payload shapes and lets the adapter authenticate and
 * interpret each one.
 *
 * The callback URLs JATA registers with Safaricom are the path members under this route
 * (`/stk`, `/confirmation`, `/validation`, `/result`, `/timeout`); each one delegates to the same
 * shared handler in `handler.ts`, so the registered URL and the union endpoint can never drift.
 *
 * No PIN ever reaches this file: the customer enters it on Safaricom's own screen, and Daraja sends
 * only the result. Nothing here trusts the payload — the adapter verifies the event, and only then
 * does the shared pipeline decide whether a payment is confirmed.
 */

import { NextResponse } from "next/server";
import { mpesaWebhookHandler, mpesaWebhookProbe } from "./handler";

export const dynamic = "force-dynamic";

/** Daraja posts confirmation and validation callbacks with POST. */
export async function POST(request: Request) {
  return mpesaWebhookHandler(request);
}

/** Some C2B configurations issue a GET validation probe; it is answered without side effects. */
export async function GET() {
  return mpesaWebhookProbe();
}
