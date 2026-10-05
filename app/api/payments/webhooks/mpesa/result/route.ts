/**
 * M-PESA C2B reversal result callback (§35, §111).
 *
 * This is the exact URL JATA registers with Safaricom as the reversal `ResultURL` (derived from
 * `MPESA_C2B_CONFIRMATION_URL`: `…/mpesa/confirmation?token=…` → `…/mpesa/result?token=…`). When a
 * reversal is requested, Safaricom posts the outcome here and the shared pipeline correlates it
 * back to the recorded reversal. It runs the same shared handler as the base union endpoint.
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
