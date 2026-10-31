import { NextResponse } from "next/server";
import { hashPassword, getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { enqueueApplicationSubmitted } from "@/lib/agents/admin-notification-event";
import { isSameOriginRequest } from "@/lib/agent-application";
import { recordRegistrationReferral } from "@/lib/agents/referral-registration";
import { agentRegistrationEnabled, allowAgentRegistration, readSmallJson, validateAgentRegistration } from "@/lib/agent-registration";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!agentRegistrationEnabled()) return NextResponse.json({ error: "Agent-only registration is not available yet." }, { status: 503 });
  if (!isSameOriginRequest(req)) return NextResponse.json({ error: "Request not allowed." }, { status: 403 });
  if (!req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return NextResponse.json({ error: "Invalid request." }, { status: 415 });
  if (await getSession()) return NextResponse.json({ error: "You are already signed in. Use the application page." }, { status: 409 });
  try {
    if (!(await allowAgentRegistration(req))) return NextResponse.json({ error: "Too many attempts. Please try again later." }, { status: 429 });
  } catch { return NextResponse.json({ error: "Registration is temporarily unavailable." }, { status: 503 }); }
  let input: unknown;
  try { input = await readSmallJson(req); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  const fields = validateAgentRegistration(input);
  if (!fields) return NextResponse.json({ error: "Check your name, email, Kenyan mobile number, password and acknowledgements." }, { status: 400 });
  try {
    // Hash even when an email already exists; never update or sign in an existing account from a
    // registration request. CUSTOMER is fixed server-side, even for administrator email addresses.
    const passwordHash = await hashPassword(fields.password);
    await prisma.$transaction(async (tx: typeof prisma) => {
      const user = await tx.user.create({ data: { name: fields.fullName, email: fields.email, phone: fields.phoneE164, passwordHash, role: "CUSTOMER" }, select: { id: true } });
      const application = await tx.agentApplication.create({ data: { userId: user.id, fullName: fields.fullName, phoneE164: fields.phoneE164, privacyAcknowledgedAt: new Date() }, select: { id: true } });
      await tx.auditEvent.create({ data: { actorId: user.id, action: "AGENT_APPLICATION_SUBMITTED", targetType: "AGENT_APPLICATION", targetId: application.id, metadata: JSON.stringify({ websiteTermsAcknowledged: true }) } });
      await enqueueApplicationSubmitted(tx, application.id);
      await recordRegistrationReferral(tx, { input, applicationId: application.id, userId: user.id, email: fields.email, phoneE164: fields.phoneE164 });
    });
  } catch (error) {
    // Same response for duplicate email and new registrations, without an automatic session.
    const detail = error && typeof error === "object" ? error as { code?: unknown; meta?: { target?: unknown } } : null;
    const target = detail?.meta?.target;
    const emailConflict = detail?.code === "P2002" && (target === "email" || (Array.isArray(target) && target.length === 1 && target[0] === "email"));
    if (!emailConflict) return NextResponse.json({ error: "Registration is temporarily unavailable." }, { status: 503 });
  }
  return NextResponse.json({ ok: true });
}
