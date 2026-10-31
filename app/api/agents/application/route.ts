import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { enqueueApplicationSubmitted } from "@/lib/agents/admin-notification-event";
import { isSameOriginRequest, validateAgentApplication } from "@/lib/agent-application";
import { rateLimit } from "@/lib/rate-limit";
import { recordRegistrationReferral, referralLifetimeSeconds, referralTokenHash } from "@/lib/agents/referral-registration";
import { allowAgentApplication } from "@/lib/agent-application-throttle";

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
  try {
    if (!(await allowAgentApplication(session.userId))) return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  } catch { return NextResponse.json({ error: "Applications are temporarily unavailable." }, { status: 503 }); }
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
    const status = await prisma.$transaction(async (tx: typeof prisma) => {
      const existing = await tx.agentApplication.findUnique({ where: { userId: session.userId }, select: { status: true } });
      if (existing) return existing.status;
      const application = await tx.agentApplication.create({ data: { userId: session.userId, ...fields, privacyAcknowledgedAt: new Date() }, select: { id: true } });
      await tx.auditEvent.create({ data: { actorId: session.userId, action: "AGENT_APPLICATION_SUBMITTED", targetType: "AGENT_APPLICATION", targetId: application.id } });
      await enqueueApplicationSubmitted(tx, application.id);
      const referral = input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : null;
      if (referralLifetimeSeconds() && referral?.referralConsent === true && referralTokenHash(referral.referralCode)) {
        // Do not trust the email or user ID supplied in the browser; read the authenticated account.
        const account = await tx.user.findUnique({ where: { id: session.userId }, select: { email: true } });
        if (!account || typeof account.email !== "string") throw new Error("Account unavailable");
        await recordRegistrationReferral(tx, { input, applicationId: application.id, userId: session.userId, email: account.email.toLowerCase(), phoneE164: fields.phoneE164, source: "EXISTING_ACCOUNT" });
      }
      return "PENDING";
    });
    return NextResponse.json({ ok: true, status });
  } catch (error) {
    // A concurrent submission can win the unique constraint. Only return success when this account
    // now has an application, never when another invariant or the audit write failed.
    if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
      try {
        const existing = await prisma.agentApplication.findUnique({ where: { userId: session.userId }, select: { status: true } });
        if (existing) return NextResponse.json({ ok: true, status: existing.status });
      } catch { /* report unavailable below */ }
    }
    return NextResponse.json({ error: "We could not save your application. Please try again." }, { status: 503 });
  }
}
