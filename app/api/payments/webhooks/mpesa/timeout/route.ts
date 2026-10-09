/**
 * M-PESA reversal queue-timeout notice (§35, §111).
 *
 * This is a legacy path for the reversal `QueueTimeOutURL`, which JATA derives from the validation
 * URL (`…/validation?token=…` → `…/timeout?token=…`). Safaricom posts here when its queue gave up
 * on a reversal request. That is a notice, not a verdict — the reversal may still complete — so the
 * pipeline keeps the refund reserved with an explicit unknown outcome and never releases it as a
 * failure. It runs the same shared handler as the base union endpoint.
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
