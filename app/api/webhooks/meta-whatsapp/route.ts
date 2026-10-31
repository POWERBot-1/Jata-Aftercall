import { NextResponse } from "next/server";
import { applyMetaStatus, parseMetaStatuses, verifyMetaSignature, verifyWebhookToken, webhookConfig } from "@/lib/messaging/meta-whatsapp-webhook";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request) {
  const config = webhookConfig();
  if (!config) return new Response("Unavailable", { status: 503 });
  const url = new URL(req.url);
  const challenge = url.searchParams.get("hub.challenge");
  if (url.searchParams.get("hub.mode") !== "subscribe" || !challenge || challenge.length > 256 || !verifyWebhookToken(url.searchParams.get("hub.verify_token"), config.verifyToken)) return new Response("Forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "Content-Type": "text/plain", "Cache-Control": "no-store" } });
}

export async function POST(req: Request) {
  const config = webhookConfig();
  if (!config) return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  const reader = req.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel(); return NextResponse.json({ error: "Too large" }, { status: 413 }); } chunks.push(value); }
  } catch { return NextResponse.json({ error: "Invalid request" }, { status: 400 }); }
  const raw = Buffer.concat(chunks);
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), config.secret)) return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  let data: unknown;
  try { data = JSON.parse(raw.toString("utf8")); } catch { return NextResponse.json({ error: "Invalid payload" }, { status: 400 }); }
  const events = parseMetaStatuses(data, config.phoneId);
  if (!events) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  try {
    for (const event of events) {
      if (await applyMetaStatus(event, config.phoneId) === "unmatched") return NextResponse.json({ error: "Status not yet correlated" }, { status: 503 });
    }
    return NextResponse.json({ ok: true });
  } catch { return NextResponse.json({ error: "Temporarily unavailable" }, { status: 503 }); }
}
