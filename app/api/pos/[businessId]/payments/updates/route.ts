/**
 * Live payment updates (§21, §25, §41, §112).
 *
 * Server-Sent Events carrying *server state*: when a payment changes, the board and the till hear
 * about it without a refresh. The stream never carries an optimistic "paid" — a status only moves
 * here after JATA's own engine has applied a verified provider confirmation (§41).
 *
 * A client that misses an event (a dropped connection, a sleeping laptop) is not stuck: the same
 * route answers a plain request with everything that changed since a timestamp, which is the
 * polling fallback the screens use when `EventSource` is unavailable.
 */

import { NextResponse } from "next/server";
import { requirePosAccessFromRequest, posErrorBody } from "@/lib/pos/guard";
import { paymentsChangedSince, subscribeToPaymentEvents } from "@/lib/payments/realtime";
import { listRecentPayments } from "@/lib/payments/store";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  try {
    await requirePosAccessFromRequest(businessId, { permission: "VIEW_PAYMENTS", fast: true });
  } catch (error) {
    const mapped = posErrorBody(error, "We couldn't update your payments.");
    return NextResponse.json(mapped.body, { status: mapped.status });
  }

  const url = new URL(request.url);
  const since = url.searchParams.get("since");

  // Polling mode: everything that changed since the caller's last look.
  if (since) {
    const parsed = new Date(since);
    const sinceDate = Number.isNaN(parsed.getTime()) ? new Date(Date.now() - 60_000) : parsed;
    const [changed, recent] = await Promise.all([
      paymentsChangedSince(businessId, sinceDate),
      listRecentPayments(businessId, { take: 25 }),
    ]);
    return NextResponse.json({ mode: "poll", now: new Date().toISOString(), changed, payments: recent });
  }

  // Streaming mode.
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = (payload: unknown) => {
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
        } catch {
          // The browser went away; the cleanup below handles it.
        }
      };
      send({ type: "ready", at: new Date().toISOString() });
      unsubscribe = subscribeToPaymentEvents(businessId, (event) => send({ type: "payment", ...event }));
      heartbeat = setInterval(() => send({ type: "heartbeat", at: new Date().toISOString() }), 25_000);
      request.signal.addEventListener("abort", () => {
        unsubscribe?.();
        if (heartbeat) clearInterval(heartbeat);
        try {
          controller.close();
        } catch {
          // Already closed.
        }
      });
    },
    cancel() {
      unsubscribe?.();
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new NextResponse(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store, no-cache, must-revalidate",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}
