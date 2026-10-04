/**
 * M-PESA (Safaricom Daraja) provider events (§35, §111).
 *
 * This is JATA's endpoint — merchants never create or register it. Daraja posts both the STK
 * (customer-entered PIN, on the till) and C2B (till/PayBill, over the counter) callbacks here, so
 * the route accepts the union of the two payload shapes and lets the adapter authenticate and
 * interpret each one.
 *
 * No PIN ever reaches this file: the customer enters it on Safaricom's own screen, and Daraja sends
 * only the result. Nothing here trusts the payload — the adapter verifies the event, and only then
 * does the shared pipeline decide whether a payment is confirmed.
 */

import { NextResponse } from "next/server";
import { applyProviderEvent } from "@/lib/payments/webhooks";

export const dynamic = "force-dynamic";

async function handle(request: Request): Promise<NextResponse> {
  const rawBody = await request.text();
  if (!rawBody || rawBody.length > 128_000) {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    payload = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
  }

  const result = await applyProviderEvent({
    provider: "MPESA",
    rawBody,
    payload,
    headers: request.headers,
    url: new URL(request.url),
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

/** Daraja posts confirmation and validation callbacks with POST. */
export async function POST(request: Request) {
  return handle(request);
}

/** Some C2B configurations issue a GET validation probe; it is answered without side effects. */
export async function GET() {
  return NextResponse.json({ status: "ok" });
}
