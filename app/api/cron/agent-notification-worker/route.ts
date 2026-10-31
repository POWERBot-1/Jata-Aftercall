import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getMessagingProvider } from "@/lib/messaging/providers";
import { processAdminNotificationBatch } from "@/lib/agents/admin-notification-worker";
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store" };
const unavailable = () => NextResponse.json({ error: "Notification worker unavailable." }, { status: 503, headers });

/** Explicitly invoked only; this route does not register cron or enable a provider. */
export async function POST(req: Request) {
  if (process.env.AGENT_ADMIN_NOTIFICATION_WORKER_ENABLED !== "true" || process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED !== "true") return unavailable();
  const secret = process.env.AGENT_ADMIN_NOTIFICATION_WORKER_SECRET;
  const key = process.env.AGENT_ADMIN_NOTIFICATION_PROVIDER;
  if (!secret || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 512 || !key || !/^[a-z0-9_-]{1,64}$/.test(key)) return unavailable();
  const expected = Buffer.from(`Bearer ${secret}`); const provided = Buffer.from(req.headers.get("authorization") || "");
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return NextResponse.json({ error: "Access denied." }, { status: 401, headers });
  try {
    const provider = getMessagingProvider(key);
    const result = await processAdminNotificationBatch(prisma, provider);
    return NextResponse.json(result, { headers });
  } catch { return unavailable(); }
}
