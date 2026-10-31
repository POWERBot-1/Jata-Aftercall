import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { isSameOriginRequest } from "@/lib/agent-application";
import { readSmallJson } from "@/lib/agent-registration";
import { rateLimitByIdentity } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const message = (error: string, status: number) => NextResponse.json({ error }, { status, headers });
const unavailable = () => message("Notification operations are unavailable.", 503);

/** Admin-only bounded work list; no destination, token, body, or provider response is returned. */
export async function GET() {
  const session = await getSession();
  if (!session) return message("Sign in required.", 401);
  if (session.role !== "ADMIN") return message("Access denied.", 403);
  if (process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED !== "true") return unavailable();
  if (!rateLimitByIdentity(session.userId, { key: "agent-notification-operations-read", max: 30, windowMs: 60_000 }).allowed) return message("Rate limit exceeded.", 429);
  try {
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      const actors: Array<{ role: string }> = await tx.$queryRaw`SELECT "role" FROM "User" WHERE "id" = ${session.userId} FOR SHARE`;
      if (actors.length !== 1 || actors[0].role !== "ADMIN") return null;
      return tx.agentAdminNotificationClaimState.findMany({
        where: { state: { in: ["UNKNOWN", "DEAD"] }, review: { is: null } },
        select: { applicationId: true, recipientKey: true, state: true, attempts: true, updatedAt: true },
        orderBy: [{ updatedAt: "asc" }, { applicationId: "asc" }, { recipientKey: "asc" }], take: 101,
      });
    });
    if (!result) return message("Access denied.", 403);
    return NextResponse.json({ scope: "UNREVIEWED_UNKNOWN_OR_DEAD", items: result.slice(0, 100), truncated: result.length > 100, deliveryVerified: false }, { headers });
  } catch { return unavailable(); }
}

/** Acknowledge only: preserves state, never retries and never asserts delivery. */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return message("Request not allowed.", 403);
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return message("Invalid request.", 415);
  const session = await getSession();
  if (!session) return message("Sign in required.", 401);
  if (session.role !== "ADMIN") return message("Access denied.", 403);
  if (process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED !== "true") return unavailable();
  if (!rateLimitByIdentity(session.userId, { key: "agent-notification-operations-write", max: 15, windowMs: 60_000 }).allowed) return message("Rate limit exceeded.", 429);
  let body: unknown;
  try { body = await readSmallJson(req); } catch { return message("Invalid request.", 400); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return message("Invalid request.", 400);
  const { applicationId, recipientKey, action } = body as Record<string, unknown>;
  if (typeof applicationId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(applicationId) || typeof recipientKey !== "string" || !/^[a-f0-9]{64}$/.test(recipientKey) || action !== "ACKNOWLEDGE_NO_RETRY") return message("Invalid request.", 400);
  try {
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      const actors: Array<{ role: string }> = await tx.$queryRaw`SELECT "role" FROM "User" WHERE "id" = ${session.userId} FOR SHARE`;
      if (actors.length !== 1 || actors[0].role !== "ADMIN") return "forbidden";
      const rows: Array<{ state: string }> = await tx.$queryRaw`SELECT "state" FROM "AgentAdminNotificationClaimState" WHERE "applicationId" = ${applicationId} AND "recipientKey" = ${recipientKey} FOR UPDATE`;
      if (!rows.length) return "not_found";
      const state = rows[0].state;
      if (state !== "UNKNOWN" && state !== "DEAD") return "conflict";
      const existing = await tx.agentAdminNotificationReview.findUnique({ where: { applicationId_recipientKey: { applicationId, recipientKey } } });
      if (existing) return "already";
      await tx.agentAdminNotificationReview.create({ data: { applicationId, recipientKey, reviewedState: state, reviewedBy: session.userId } });
      await tx.auditEvent.create({ data: { actorId: session.userId, action: "AGENT_NOTIFICATION_ACKNOWLEDGED_NO_RETRY", targetType: "AGENT_NOTIFICATION", targetId: applicationId, metadata: JSON.stringify({ recipientKey, state }) } });
      return "created";
    });
    if (result === "forbidden") return message("Access denied.", 403);
    if (result === "not_found") return message("Notification not found.", 404);
    if (result === "conflict") return message("Notification is not awaiting review.", 409);
    return NextResponse.json({ ok: true, alreadyReviewed: result === "already", action: "ACKNOWLEDGE_NO_RETRY", deliveryVerified: false }, { headers });
  } catch { return unavailable(); }
}
