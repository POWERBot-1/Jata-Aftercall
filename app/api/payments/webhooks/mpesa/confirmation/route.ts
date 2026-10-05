/**
 * M-PESA C2B confirmation callback (§35, §111).
 *
 * This is the exact URL JATA registers with Safaricom as the C2B `ResultURL`
 * (`MPESA_C2B_CONFIRMATION_URL`, default `/api/payments/webhooks/mpesa/confirmation?token=…`).
 * It runs the same shared handler as the base union endpoint.
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
