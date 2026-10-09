/**
 * M-PESA C2B confirmation callback (§35, §111).
 *
 * This is a legacy path for the C2B confirmation URL registered with Safaricom
 * (`MPESA_C2B_CONFIRMATION_URL`; the default is the neutral `/api/payments/webhooks/daraja/confirmation?token=…`).
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
