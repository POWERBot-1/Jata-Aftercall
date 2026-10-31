import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { isSameOriginRequest } from "@/lib/agent-application";
import { readSmallJson } from "@/lib/agent-registration";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { replayAdminNotification } from "@/lib/agents/admin-notification-replay";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status, headers });
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return error("Request not allowed.", 403);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return error("Invalid request.", 415);
  const session = await getSession();
  if (!session) return error("Sign in required.", 401);
  if (session.role !== "ADMIN") return error("Access denied.", 403);
  if (process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED !== "true" || process.env.AGENT_ADMIN_NOTIFICATION_REPLAY_ENABLED !== "true") return error("Notification replay unavailable.", 503);
  if (!rateLimitByIdentity(session.userId, { key: "agent-notification-replay", max: 15, windowMs: 60_000 }).allowed) return error("Rate limit exceeded.", 429);
  let input: unknown; try { input = await readSmallJson(req); } catch { return error("Invalid request.", 400); }
  if (!input || typeof input !== "object" || Array.isArray(input)) return error("Invalid request.", 400);
  const { applicationId, recipientKey, requestId } = input as Record<string, unknown>;
  if (typeof applicationId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(applicationId) || typeof recipientKey !== "string" || !/^[a-f0-9]{64}$/.test(recipientKey) || typeof requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(requestId)) return error("Invalid request.", 400);
  try {
    const result = await replayAdminNotification(prisma, { applicationId, recipientKey, requestId, actorId: session.userId });
    if (result === "forbidden") return error("Access denied.", 403);
    if (result === "not_found") return error("Notification not found.", 404);
    if (result === "conflict") return error("Notification cannot be replayed.", 409);
    return NextResponse.json({ ok: true, alreadyAuthorized: result === "already", deliveryVerified: false }, { headers });
  } catch { return error("Notification replay unavailable.", 503); }
}
