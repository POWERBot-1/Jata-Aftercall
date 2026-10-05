/**
 * M-PESA STK prompt result callback (§35, §111).
 *
 * This is the exact URL JATA registers as the Daraja `CallBackURL` when it raises an STK prompt
 * (`MPESA_STK_CALLBACK_URL`, default `/api/payments/webhooks/mpesa/stk?token=…`). It runs the same
 * shared handler as the base union endpoint — the same authentication, the same pipeline — so the
 * registered callback URL and the documented endpoint can never diverge.
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
