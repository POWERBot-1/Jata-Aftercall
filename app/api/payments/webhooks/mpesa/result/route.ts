/**
 * M-PESA C2B reversal result callback (§35, §111).
 *
 * This is a legacy path for the reversal `ResultURL`, which JATA derives from the confirmation URL
 * (`…/confirmation?token=…` → `…/result?token=…`). When a
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
