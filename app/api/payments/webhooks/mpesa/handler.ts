/**
 * Shared M-PESA webhook handler (§35, §111).
 *
 * The central callback URL is a family of paths: `/stk` (STK prompt result), `/confirmation`
 * and `/validation` (C2B over the counter), `/result` and `/timeout` (C2B reversal outcome,
 * registered by the adapter), plus the bare path as the documented union endpoint. Every
 * member of the family runs this exact same code — a size-bounded JSON body, adapter
 * authentication, then the shared pipeline — so no member can drift out of sync or accept
 * something the others refuse. Nothing here trusts the payload: the adapter verifies the
 * event first, and only then does the pipeline decide whether a payment is confirmed.
 */

import { NextResponse } from "next/server";
import { applyProviderEvent } from "@/lib/payments/webhooks";

export async function mpesaWebhookHandler(request: Request): Promise<NextResponse> {
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

/** Some C2B configurations issue a GET validation probe; it is answered without side effects. */
export function mpesaWebhookProbe(): NextResponse {
  return NextResponse.json({ status: "ok" });
}
