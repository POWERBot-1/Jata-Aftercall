import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { isSameOriginRequest } from "@/lib/agent-application";
import { readSmallJson } from "@/lib/agent-registration";
import { rateLimitByIdentity } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  if (session.role !== "ADMIN") return NextResponse.json({ error: "Access denied." }, { status: 403 });
  const limit = rateLimitByIdentity(session.userId, { key: "agent-application-reject", max: 15, windowMs: 60_000 });
  if (!limit.allowed) return limit.response;
  const { id } = await params;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  let body: unknown;
  try { body = await readSmallJson(req); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const reason = body && typeof body === "object" && "reason" in body && typeof body.reason === "string" ? body.reason.trim() : "";
  if (!["APPLICANT_REQUEST", "DUPLICATE_APPLICATION"].includes(reason)) return NextResponse.json({ error: "Choose a valid reason." }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx: typeof prisma) => {
      // Authoritative role is checked within the write transaction, not only in the session.
      const actor = await tx.user.findUnique({ where: { id: session.userId }, select: { role: true } });
      if (actor?.role !== "ADMIN") return "forbidden";
      const application = await tx.agentApplication.findUnique({ where: { id }, select: { userId: true, status: true } });
      if (!application) return "not_found";
      if (application.userId === session.userId) return "forbidden";
      if (application.status === "REJECTED") return "already_rejected";
      const changed = await tx.agentApplication.updateMany({ where: { id, status: "PENDING" }, data: { status: "REJECTED" } });
      if (changed.count !== 1) return "conflict";
      await tx.auditEvent.create({ data: { actorId: session.userId, action: "AGENT_APPLICATION_REJECTED", targetType: "AGENT_APPLICATION", targetId: id, metadata: JSON.stringify({ reason, previousStatus: "PENDING", newStatus: "REJECTED" }) } });
      return "updated";
    });
    if (result === "forbidden") return NextResponse.json({ error: "Access denied." }, { status: 403 });
    if (result === "not_found") return NextResponse.json({ error: "Application not found." }, { status: 404 });
    if (result === "conflict") return NextResponse.json({ error: "Application changed. Refresh and try again." }, { status: 409 });
    return NextResponse.json({ ok: true, status: "REJECTED" });
  } catch { return NextResponse.json({ error: "Decision could not be saved. Please try again." }, { status: 503 }); }
}
