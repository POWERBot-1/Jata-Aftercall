import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getMessagingProvider } from "@/lib/messaging/providers";
import { applyAdminNotificationCallbacks } from "@/lib/agents/admin-notification-callback";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const response = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

/** Provider-authenticated callback. No recipient, raw body or provider error is stored. */
export async function POST(req: Request) {
  if (process.env.AGENT_ADMIN_NOTIFICATION_CALLBACKS_ENABLED !== "true" || process.env.AGENT_ADMIN_NOTIFICATION_WORKER_ENABLED !== "true") return response("Unavailable.", 503);
  const key = process.env.AGENT_ADMIN_NOTIFICATION_PROVIDER;
  if (!key || !/^[a-z0-9_-]{1,64}$/.test(key)) return response("Unavailable.", 503);
  const reader = req.body?.getReader();
  if (!reader) return response("Invalid request.", 400);
  const chunks: Uint8Array[] = []; let size = 0;
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > 65536) { await reader.cancel(); return response("Too large.", 413); } chunks.push(value); } }
  catch { return response("Invalid request.", 400); }
  const bytes = Buffer.concat(chunks);
  const raw = bytes.toString("utf8");
  if (!Buffer.from(raw, "utf8").equals(bytes)) return response("Invalid request.", 400);
  const provider = getMessagingProvider(key);
  const supplied = { "x-signature": req.headers.get("x-signature") ?? undefined, "x-jata-signature": req.headers.get("x-jata-signature") ?? undefined, "x-hub-signature-256": req.headers.get("x-hub-signature-256") ?? undefined };
  try { return NextResponse.json(await applyAdminNotificationCallbacks(prisma, provider, raw, supplied), { headers }); }
  catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "NOTIFICATION_CALLBACK_UNAUTHORIZED") return response("Access denied.", 401);
    if (code === "NOTIFICATION_CALLBACK_INVALID" || code === "NOTIFICATION_CALLBACK_CONFLICT") return response("Invalid callback.", 400);
    return response("Unavailable.", 503);
  }
}
