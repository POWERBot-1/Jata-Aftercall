import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import {
  getTeamAccessStatus,
  revokeTeamAccess,
  startTeamPhoneVerification,
} from "@/lib/team-access";

/**
 * ADMIN-ONLY JATA Team Free Access control plane (Phase 5).
 *
 * There is no unauthenticated, self-service or client-flag path to a grant. An administrator may
 * look up an account, start a verification (and receives the one-time code to deliver out of
 * band), or revoke access. The actual grant is written only by
 * `/api/account/team-access` after the signed-in account proves possession of the code.
 *
 * The allowlist is never returned. Only a masked phone and a yes/no entitlement are exposed.
 */

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!session) return { session: null, response: NextResponse.json({ error: "Please sign in." }, { status: 401 }) };
  if (session.role !== "ADMIN") return { session: null, response: NextResponse.json({ error: "Administrator access required." }, { status: 403 }) };
  return { session, response: null };
}

function readBody(body: unknown): Record<string, unknown> | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  return body as Record<string, unknown>;
}

export async function POST(req: Request) {
  const { session, response } = await requireAdmin();
  if (!session || response) return response;

  const limited = rateLimitByIdentity(session.userId, { key: "admin-team-access", max: 12, windowMs: 10 * 60 * 1000 });
  if (!limited.allowed) return limited.response!;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  const input = readBody(body);
  if (!input) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  const action = String(input.action || "");

  if (action === "lookup") {
    const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
    if (!email || email.length > 200) return NextResponse.json({ error: "Enter the account email." }, { status: 400 });
    try {
      const user = await prisma.user.findUnique({ where: { email }, select: { id: true, email: true, phone: true } });
      if (!user) return NextResponse.json({ error: "We couldn't find that account." }, { status: 404 });
      const status = await getTeamAccessStatus(user.id);
      const normalized = String(user.phone || "").replace(/\D/g, "");
      return NextResponse.json({
        userId: user.id,
        email: user.email,
        maskedPhone: normalized ? `${normalized.slice(0, 3)}••••${normalized.slice(-3)}` : null,
        entitled: status.entitled,
        label: status.label,
      });
    } catch {
      return NextResponse.json({ error: "We could not read that account." }, { status: 503 });
    }
  }

  if (action === "start-verification") {
    const userId = typeof input.userId === "string" ? input.userId.trim() : "";
    if (!userId) return NextResponse.json({ error: "An account is required." }, { status: 400 });
    const result = await startTeamPhoneVerification(session.userId, userId);
    if ("error" in result) return NextResponse.json({ error: result.error }, { status: result.status });
    // `code` is returned ONLY to the authenticated administrator over the current response.
    // It is never logged, never stored in plaintext and never returned by any other endpoint.
    return NextResponse.json({
      challengeId: result.challengeId,
      code: result.code,
      expiresAt: result.expiresAt,
      maskedPhone: result.maskedPhone,
      delivery: "Give this code to the team member by phone or WhatsApp. It expires in 10 minutes.",
    });
  }

  if (action === "revoke") {
    const userId = typeof input.userId === "string" ? input.userId.trim() : "";
    const result = await revokeTeamAccess(session.userId, userId);
    return NextResponse.json(result.ok ? { ok: true } : { error: result.error }, { status: result.status });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
