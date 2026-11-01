import { controlJson } from "@/lib/control/http";
import prisma from "@/lib/db";
import { requireAnyControlPermission } from "@/lib/control/access";
import { createControlAuditEvent } from "@/lib/control/audit";
import { getCorrelationId, hasSameOrigin } from "@/lib/control/security";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { CONTROL_PERMISSIONS } from "@/lib/control/permissions";
import { SESSION_COOKIE_NAME } from "@/lib/auth";

export const dynamic = "force-dynamic";
const REVOKE_ACCESS = CONTROL_PERMISSIONS.filter((permission) => permission.endsWith(".read"));

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return controlJson({ error: "Same-origin request required." }, { status: 403 });
  let body: any;
  try { body = await request.json(); } catch { return controlJson({ error: "Explicit revocation confirmation is required." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body) || body.confirmation !== "REVOKE_ALL_MY_SESSIONS") {
    return controlJson({ error: "Explicit revocation confirmation is required." }, { status: 400 });
  }
  const access = await requireAnyControlPermission(REVOKE_ACCESS);
  if (access.ok === false) return controlJson({ error: access.code }, { status: access.status });
  const limited = rateLimitByIdentity(access.identity.session.userId, { key: "control-session-revoke", max: 3, windowMs: 10 * 60_000 });
  if (!limited.allowed) return limited.response ?? controlJson({ error: "Too many session-revocation attempts." }, { status: 429 });
  const grant = access.identity.grants.find((candidate) => candidate.permissionKeys.some((permission) => REVOKE_ACCESS.includes(permission as any)));
  if (!grant) return controlJson({ error: "An explicit read permission is required." }, { status: 403 });

  try {
    await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: access.identity.session.userId }, select: { sessionVersion: true } });
      if (!user) throw new Error("SESSION_USER_MISSING");
      const beforeVersion = Number(user.sessionVersion ?? 0);
      await tx.user.update({ where: { id: access.identity.session.userId }, data: { sessionVersion: { increment: 1 } } });
      await createControlAuditEvent(tx, {
        actorId: access.identity.session.userId,
        grant,
        action: "CONTROL_SESSIONS_REVOKED",
        targetType: "USER_SESSIONS",
        targetId: access.identity.session.userId,
        outcome: "SUCCESS",
        reason: "User-initiated revocation of all sessions for the current account.",
        beforeState: { sessionVersion: beforeVersion },
        afterState: { sessionVersion: beforeVersion + 1 },
        correlationId: getCorrelationId(request.headers),
      });
    });
    const response = controlJson({ revoked: true, scope: "all sessions for the current account" });
    response.cookies.set(SESSION_COOKIE_NAME, "", { maxAge: 0, path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
    response.cookies.set("jata_control_mfa", "", { maxAge: 0, path: "/", httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" });
    return response;
  } catch {
    return controlJson({ error: "Session revocation failed. No success was recorded." }, { status: 503 });
  }
}
