import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { isSameOriginRequest, validateAgentApplication } from "@/lib/agent-application";
import { rateLimit, rateLimitByIdentity } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

// Return only the caller's status; contact details do not need to be exposed in this response.
export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in to view your application." }, { status: 401 });
  try {
    const application = await prisma.agentApplication.findUnique({ where: { userId: session.userId }, select: { createdAt: true, status: true } });
    return NextResponse.json({ applied: !!application, status: application?.status ?? null, createdAt: application?.createdAt ?? null }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Application status is temporarily unavailable." }, { status: 503 });
  }
}

export async function POST(req: Request) {
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Sign in before applying." }, { status: 401 });
  const ipLimit = rateLimit(req, { key: "agent-application-ip", max: 20, windowMs: 60_000 });
  if (!ipLimit.allowed) return ipLimit.response;
  const accountLimit = rateLimitByIdentity(session.userId, { key: "agent-application-account", max: 5, windowMs: 60_000 });
  if (!accountLimit.allowed) return accountLimit.response;
  // Limit request body independently of headers, which are controlled by the caller.
  const reader = req.body?.getReader();
  if (!reader) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 4096) { await reader.cancel(); return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
      chunks.push(value);
    }
  } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const raw = new TextDecoder().decode(Buffer.concat(chunks));
  let input: unknown;
  try { input = JSON.parse(raw); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const fields = validateAgentApplication(input);
  if (!fields) return NextResponse.json({ error: "Enter your full name, a valid Kenyan mobile number, and acknowledge the privacy notice." }, { status: 400 });
  try {
    // Unique userId makes retries and concurrent submissions idempotent. The audit and application
    // are committed together; no submitted personal details are copied to the audit record.
    await prisma.$transaction(async (tx: typeof prisma) => {
      const existing = await tx.agentApplication.findUnique({ where: { userId: session.userId }, select: { id: true } });
      if (existing) return;
      const application = await tx.agentApplication.create({ data: { userId: session.userId, ...fields, privacyAcknowledgedAt: new Date() }, select: { id: true } });
      await tx.auditEvent.create({ data: { actorId: session.userId, action: "AGENT_APPLICATION_SUBMITTED", targetType: "AGENT_APPLICATION", targetId: application.id } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    // A concurrent submission can win the unique constraint. Only return success when this account
    // now has an application, never when another invariant or the audit write failed.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      try {
        if (await prisma.agentApplication.findUnique({ where: { userId: session.userId }, select: { id: true } })) return NextResponse.json({ ok: true });
      } catch { /* report unavailable below */ }
    }
    return NextResponse.json({ error: "We could not save your application. Please try again." }, { status: 503 });
  }
}
