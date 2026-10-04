/**
 * Paystack provider events (§35, §111).
 *
 * Paystack signs with `x-paystack-signature` over the raw body; the adapter verifies it before
 * anything in the payload is believed. As with M-PESA, this is JATA's endpoint and JATA's secret —
 * merchants never see or configure it.
 */

import { NextResponse } from "next/server";
import { applyProviderEvent } from "@/lib/payments/webhooks";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
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
    provider: "PAYSTACK",
    rawBody,
    payload,
    headers: request.headers,
    url: new URL(request.url),
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}
