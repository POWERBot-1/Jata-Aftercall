import "server-only";
import { NextResponse } from "next/server";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx/webhook-signature";
import { getCallControlClient } from "@/lib/telnyx/call-control";
import {
  createPrismaVoiceEventStore,
  ingestAndProcessVoiceEvent,
  markEventForRetry,
  processVoiceEvent,
  type VoiceEventStore,
} from "@/lib/voice/call-events";
import { finalizeCallFromEvent, handleIncomingCall } from "@/lib/voice/call-lifecycle";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telnyx voice webhook — durable, idempotent, tenant-safe ingress.
 *
 * Verification → persistence (exactly once) → routing → state application → lifecycle hooks.
 * Invalid signatures are 401 (fail-closed, no retry value in an unsigned request). Unparseable
 * bodies are 400. Persistence failure or processing failure returns 503 so Telnyx redelivers —
 * safe because ingest deduplicates on the provider event id and every downstream step is
 * idempotent. Unknown numbers and cross-tenant claims are recorded as REJECTED and acknowledged
 * (202) so the provider does not retry a rejection forever.
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

  let store: VoiceEventStore;
  try {
    store = createPrismaVoiceEventStore();
  } catch {
    return NextResponse.json({ ok: false, error: "VOICE_STORE_UNAVAILABLE" }, { status: 503 });
  }

  let ingested;
  try {
    ingested = await ingestAndProcessVoiceEvent(store, rawBody);
  } catch (error) {
    return NextResponse.json({ ok: false, error: "EVENT_PERSISTENCE_FAILED" }, { status: 503 });
  }

  if (!ingested.stored) {
    return NextResponse.json({ ok: false, error: "UNPARSEABLE_TELNYX_EVENT" }, { status: 400 });
  }

  try {
    let outcome = ingested.outcome;
    if (ingested.duplicate && outcome?.status === "PROCESSED") {
      // Provider redelivery: re-run processing (idempotent) so retries can finish work that
      // previously failed after the event was persisted.
      outcome = await processVoiceEvent(store, ingested.row);
    }
    if (!outcome) {
      return NextResponse.json({ ok: true, received: true, status: "PROCESSED" }, { status: 202 });
    }

    const event = ingested.row;
    if (outcome.status === "PROCESSED" && outcome.call) {
      // Re-read the durable row: processVoiceEvent may have just applied a monotonic
      // transition (the returned `call` object is the pre-transition snapshot).
      const call = (await store.findCallByControlId(outcome.call.callControlId).catch(() => null)) ?? outcome.call;
      if (event.eventType === "call.initiated") {
        // Late/duplicate initiated events on a terminal call are skipped inside the hook —
        // a completed call must never be re-answered or its state overwritten.
        await handleIncomingCall(call, { store, client: getCallControlClient() });
      } else if (event.eventType !== "call.answered" && event.eventType !== "call.ringing") {
        // call.answered / call.ringing: state + answeredAt were already applied by the
        // monotonic transition in processVoiceEvent — never write them again here.
        await finalizeCallFromEvent(store, call, event.eventType);
      }
    }

    if (outcome.status === "REJECTED") {
      return NextResponse.json(
        { ok: true, received: true, status: "REJECTED", reason: outcome.rejectReason },
        { status: 202 },
      );
    }
    return NextResponse.json({ ok: true, received: true, status: outcome.status }, { status: 202 });
  } catch (error) {
    try {
      await markEventForRetry(store, ingested.row, error);
    } catch {
      // Persistence of the retry marker failed; the 503 below still triggers provider retry,
      // and ingest dedupe keeps the redelivery side-effect free.
    }
    return NextResponse.json({ ok: false, error: "EVENT_PROCESSING_FAILED" }, { status: 503 });
  }
}
