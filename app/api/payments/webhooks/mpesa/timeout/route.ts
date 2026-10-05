/**
 * M-PESA C2B queue-timeout callback (§35, §111).
 *
 * This is the exact URL JATA registers with Safaricom as the reversal `QueueTimeOutURL` (derived
 * from `MPESA_C2B_VALIDATION_URL`: `…/mpesa/validation?token=…` → `…/mpesa/timeout?token=…`).
 * Safaricom posts here when a queued C2B transaction expires unanswered, and the shared pipeline
 * records the timeout. It runs the same shared handler as the base union endpoint.
 */

import { NextResponse } from "next/server";
import { mpesaWebhookHandler, mpesaWebhookProbe } from "../handler";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  return mpesaWebhookHandler(request);
}

export async function GET() {
  return mpesaWebhookProbe();
}
