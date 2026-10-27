import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { getTeamAccessStatus, verifyTeamPhoneCode } from "@/lib/team-access";

/**
 * Authenticated account surface for JATA Team Free Access (Phase 5).
 *
 * GET  — the session's own status only (no allowlist, no other account's data).
 * POST — submit the six-digit code an administrator generated. No phone number, userId, role,
 *        entitlement flag or URL parameter is accepted from the client; the account id comes
 *        solely from the verified server session.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const status = await getTeamAccessStatus(session.userId);
  return NextResponse.json({
    entitled: status.entitled,
    label: status.label,
    // A status code, not a reason string, so an ineligible account learns nothing about the list.
    eligibility: status.entitled ? "TEAM" : "STANDARD",
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in." }, { status: 401 });
  const limited = rateLimitByIdentity(session.userId, { key: "account-team-access-verify", max: 8, windowMs: 10 * 60 * 1000 });
  if (!limited.allowed) return limited.response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const code = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>).code : undefined;
  const result = await verifyTeamPhoneCode(session.userId, code);
  return NextResponse.json(result.ok ? { ok: true, label: "JATA Team — Free Access" } : { error: result.error }, { status: result.status });
}
