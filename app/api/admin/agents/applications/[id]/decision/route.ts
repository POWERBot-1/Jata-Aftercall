import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { isSameOriginRequest } from "@/lib/agent-application";
import { readSmallJson } from "@/lib/agent-registration";
import { rateLimitByIdentity } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/** Manual review is not a commission entitlement. Approval is separately disabled by default. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "Access denied." }, { status: 403 });
  const limit = rateLimitByIdentity(session.userId, { key: "agent-application-decision", max: 15, windowMs: 60_000 });
  if (!limit.allowed) return limit.response;
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  let body: unknown;
  try { body = await readSmallJson(req); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const action = body && typeof body === "object" && "action" in body ? body.action : null;
  const reason = body && typeof body === "object" && "reason" in body ? body.reason : null;
  if (!((action === "approve" && reason === "MANUAL_ELIGIBILITY_REVIEW") ||
        (action === "suspend" && ["COMPLIANCE_REVIEW", "APPLICANT_REQUEST"].includes(String(reason))))) {
    return NextResponse.json({ error: "Choose a valid decision and reason." }, { status: 400 });
  }
  // Suspending an existing agent remains possible during an activation freeze.
  if (action === "approve" && process.env.AGENT_ACTIVATION_ENABLED !== "true") return NextResponse.json({ error: "Activation is unavailable." }, { status: 503 });
  try {
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      // Lock role row so an authoritative concurrent revocation cannot commit midway through review.
      const actors: Array<{ role: string }> = await tx.$queryRaw`SELECT "role" FROM "User" WHERE "id" = ${session.userId} FOR UPDATE`;
      if (actors.length !== 1 || actors[0].role !== "ADMIN") return "forbidden";
      const apps: Array<{ userId: string; status: string; phoneE164: string; verifiedPhoneE164: string | null; phoneVerifiedAt: Date | null; privacyAcknowledgedAt: Date | null }> = await tx.$queryRaw`
        SELECT "userId", "status", "phoneE164", "verifiedPhoneE164", "phoneVerifiedAt", "privacyAcknowledgedAt"
        FROM "AgentApplication" WHERE "id" = ${id} FOR UPDATE`;
      const application = apps[0];
      if (!application) return "not_found";
      if (application.userId === session.userId) return "forbidden";
      const target = action === "approve" ? "ACTIVE" : "SUSPENDED";
      if (application.status === target) return "already";
      const from = action === "approve" ? "PENDING" : "ACTIVE";
      if (application.status !== from) return "conflict";
      if (action === "approve" && (!application.privacyAcknowledgedAt || !application.phoneVerifiedAt || application.verifiedPhoneE164 !== application.phoneE164)) return "ineligible";
      const changed = await tx.agentApplication.updateMany({ where: { id, status: from }, data: { status: target } });
      if (changed.count !== 1) return "conflict";
      await tx.auditEvent.create({ data: { actorId: session.userId, action: action === "approve" ? "AGENT_APPLICATION_APPROVED" : "AGENT_APPLICATION_SUSPENDED", targetType: "AGENT_APPLICATION", targetId: id, metadata: JSON.stringify({ reason, previousStatus: from, newStatus: target }) } });
      return "updated";
    });
    if (result === "forbidden") return NextResponse.json({ error: "Access denied." }, { status: 403 });
    if (result === "not_found") return NextResponse.json({ error: "Application not found." }, { status: 404 });
    if (result === "ineligible") return NextResponse.json({ error: "A verified matching phone and privacy acknowledgement are required." }, { status: 409 });
    if (result === "conflict") return NextResponse.json({ error: "Application changed or transition is not allowed." }, { status: 409 });
    return NextResponse.json({ ok: true, status: action === "approve" ? "ACTIVE" : "SUSPENDED" });
  } catch { return NextResponse.json({ error: "Decision could not be saved. Please try again." }, { status: 503 }); }
}
