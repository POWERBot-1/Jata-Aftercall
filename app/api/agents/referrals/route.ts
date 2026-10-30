import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { isSameOriginRequest } from "@/lib/agent-application";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { newReferralToken, referralLifetimeSeconds, referralTokenHash } from "@/lib/agents/referral-registration";
export const dynamic = "force-dynamic";

/** Rotation revokes older links in the same transaction; the raw token is shown only once. */
export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const lifetime = referralLifetimeSeconds();
  if (!lifetime) return NextResponse.json({ error: "Registration referrals are unavailable." }, { status: 503 });
  const limit = rateLimitByIdentity(session.userId, { key: "agent-referral-rotate", max: 5, windowMs: 60_000 });
  if (!limit.allowed) return limit.response;
  try {
    const token = newReferralToken();
    const hash = referralTokenHash(token);
    if (!hash) throw new Error("Invalid generated token");
    const expiresAt = new Date(Date.now() + lifetime * 1000);
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      const rows: Array<{ id: string; status: string; agentStatus: string }> = await tx.$queryRaw`
        SELECT "id", "status", "agentStatus" FROM "AgentApplication" WHERE "userId" = ${session.userId} FOR UPDATE`;
      if (rows.length !== 1 || rows[0].status !== "PENDING" || rows[0].agentStatus !== "ACTIVE") return false;
      await tx.agentReferralLink.updateMany({ where: { referrerApplicationId: rows[0].id, revokedAt: null }, data: { revokedAt: new Date() } });
      const link = await tx.agentReferralLink.create({ data: { referrerApplicationId: rows[0].id, tokenHash: hash, expiresAt }, select: { id: true } });
      await tx.auditEvent.create({ data: { actorId: session.userId, action: "AGENT_REGISTRATION_REFERRAL_LINK_ROTATED", targetType: "AGENT_APPLICATION", targetId: rows[0].id, metadata: JSON.stringify({ linkId: link.id }) } });
      return true;
    });
    if (!result) return NextResponse.json({ error: "An active agent account is required." }, { status: 403 });
    return NextResponse.json({ path: `/agents/register?ref=${token}`, expiresAt: expiresAt.toISOString() }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch { return NextResponse.json({ error: "Referral link is temporarily unavailable." }, { status: 503 }); }
}
