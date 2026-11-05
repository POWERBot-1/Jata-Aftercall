import "server-only";
import { NextResponse } from "next/server";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx/webhook-signature";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Foundation only. No call is answered, transferred, recorded, or streamed here.
 * A verified event is rejected until durable idempotency, tenant routing, Call Control,
 * and the real-time media worker are implemented.
 */
export async function POST(request: Request) {
  const rawBody = await request.text();
  const verification = verifyTelnyxWebhookSignature({
    rawBody,
    signature: request.headers.get("telnyx-signature-ed25519"),
    timestamp: request.headers.get("telnyx-timestamp"),
    publicKey: process.env.TELNYX_PUBLIC_KEY,
  });

  if (verification.valid === false) {
    return NextResponse.json(
      { ok: false, error: "INVALID_TELNYX_WEBHOOK", reason: verification.reason },
      { status: 401 },
    );
  }

  // Deliberately do not return 2xx: the application cannot yet safely process this call.
  return NextResponse.json({ ok: false, error: "VOICE_ROUTING_NOT_CONFIGURED" }, { status: 503 });
}
