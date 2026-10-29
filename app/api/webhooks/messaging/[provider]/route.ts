import prisma from "@/lib/db";
import { getMessagingProvider } from "@/lib/messaging/providers";
import { handleProviderCallback } from "@/lib/messaging/pipeline";
import { rateLimit } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Provider delivery callbacks.
 *
 * The signature is checked over the *raw* body before anything is parsed. A missing secret is a
 * rejection. Events are de-duplicated by their stable event id, so a provider retrying a callback
 * cannot double-charge a wallet.
 *
 * The tenant is supplied on the query string by the callback URL we registered with the provider;
 * it is never trusted for authorisation — the signature is what authorises the call, and the
 * recipient lookup is scoped to that tenant.
 */
export async function POST(request: Request, context: { params: Promise<{ provider: string }> }) {
  const { provider: providerKey } = await context.params;
  const url = new URL(request.url);
  const businessId = url.searchParams.get("businessId");
  const limiter = rateLimit(request, { key: `webhook:${providerKey}`, max: 120, windowMs: 60_000 });
  if (!limiter.allowed) return NextResponse.json({ error: "Too many callbacks." }, { status: 429 });
  if (!businessId) return NextResponse.json({ error: "Missing business reference on the callback URL." }, { status: 400 });

  const adapter = getMessagingProvider(providerKey);
  if (adapter.live === false && process.env.MESSAGING_WEBHOOK_SECRET == null) {
    return NextResponse.json({ error: "Callbacks are not configured on this deployment." }, { status: 503 });
  }

  const rawBody = await request.text();
  const headers: Record<string, string | undefined> = {
    "x-signature": request.headers.get("x-signature") ?? undefined,
    "x-hub-signature-256": request.headers.get("x-hub-signature-256") ?? undefined,
    "x-webhook-signature": request.headers.get("x-webhook-signature") ?? undefined,
  };

  const result = await handleProviderCallback(prisma, { businessId, providerKey, rawBody, headers });
  if (!result.ok) {
    return NextResponse.json({ error: "The callback signature could not be verified." }, { status: 401 });
  }
  return NextResponse.json({ ok: true, processed: result.processed, duplicates: result.duplicates, ignored: result.ignored });
}
