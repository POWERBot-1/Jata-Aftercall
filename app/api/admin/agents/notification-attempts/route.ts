import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { rateLimitByIdentity } from "@/lib/rate-limit";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
const message = (error: string, status: number) => NextResponse.json({ error }, { status, headers });

/** Bounded diagnostic history: never returns destinations, message IDs or raw provider data. */
export async function GET() {
  const session = await getSession();
  if (!session) return message("Sign in required.", 401);
  if (session.role !== "ADMIN") return message("Access denied.", 403);
  if (process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED !== "true") return message("Notification history unavailable.", 503);
  if (!rateLimitByIdentity(session.userId, { key: "agent-notification-attempts", max: 30, windowMs: 60_000 }).allowed) return message("Rate limit exceeded.", 429);
  try {
    const rows = await prisma.$transaction(async (tx: typeof prisma) => {
      const actors: Array<{ role: string }> = await tx.$queryRaw`SELECT "role" FROM "User" WHERE "id" = ${session.userId} FOR SHARE`;
      if (actors.length !== 1 || actors[0].role !== "ADMIN") return null;
      return tx.agentAdminNotificationAttempt.findMany({
        select: { applicationId: true, recipientKey: true, attempt: true, outcome: true, providerKey: true, createdAt: true, callbacks: { select: { status: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 6 } },
        orderBy: [{ createdAt: "desc" }, { applicationId: "asc" }, { recipientKey: "asc" }, { attempt: "desc" }], take: 101,
      });
    });
    if (!rows) return message("Access denied.", 403);
    return NextResponse.json({ scope: "ADMIN_NOTIFICATION_ATTEMPTS", items: rows.slice(0, 100).map((row: typeof rows[number]) => ({ ...row, callbackTruncated: row.callbacks.length > 5, callbacks: row.callbacks.slice(0, 5) })), truncated: rows.length > 100, deliveryVerified: false }, { headers });
  } catch { return message("Notification history unavailable.", 503); }
}
