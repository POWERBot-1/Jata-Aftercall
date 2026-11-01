import { controlJson } from "@/lib/control/http";
import prisma from "@/lib/db";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { getControlIdentity, controlAccessError, CONTROL_MFA_COOKIE } from "@/lib/control/access";
import { createControlAuditEvent } from "@/lib/control/audit";
import { createControlMfaSession, decryptTotpSecret, matchingTotpStep } from "@/lib/control/mfa";
import { getCorrelationId, hasSameOrigin } from "@/lib/control/security";

export const dynamic = "force-dynamic";
const MFA_SESSION_MAX_AGE_SECONDS = 15 * 60;
const MAX_FAILED_CODES = 5;
const LOCKOUT_MS = 15 * 60_000;

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return controlJson({ error: "Same-origin request required." }, { status: 403 });
  const access = await getControlIdentity();
  if (access.ok === false) return controlJson(controlAccessError(access), { status: access.status });
  const limited = rateLimitByIdentity(access.identity.session.userId, { key: "control-mfa-verify", max: 5, windowMs: 60_000 });
  if (!limited.allowed) return limited.response ?? controlJson({ error: "Too many MFA attempts." }, { status: 429 });
  if (Number(request.headers.get("content-length") || 0) > 1024) return controlJson({ error: "Invalid request." }, { status: 413 });

  let code = "";
  try {
    const body = await request.json();
    code = body && typeof body.code === "string" ? body.code : "";
  } catch {
    return controlJson({ error: "Enter the six-digit authenticator code." }, { status: 400 });
  }
  if (!/^\d{6}$/.test(code)) return controlJson({ error: "Enter the six-digit authenticator code." }, { status: 400 });

  const userId = access.identity.session.userId;
  const grant = access.identity.grants[0];
  const correlationId = getCorrelationId(request.headers);
  try {
    const result = await prisma.$transaction(async (tx) => {
      // Serialize attempts for this credential. The compare-and-update happens under the row lock,
      // preventing two concurrent requests from reusing one TOTP step.
      await tx.$queryRaw`SELECT "userId" FROM "ControlMfaCredential" WHERE "userId" = ${userId} FOR UPDATE`;
      const credential = await tx.controlMfaCredential.findUnique({ where: { userId } });
      if (!credential) return { kind: "missing" as const };
      const now = new Date();
      if (credential.lockedUntil && credential.lockedUntil > now) return { kind: "locked" as const };
      const secret = decryptTotpSecret(credential);
      const step = matchingTotpStep(secret, code, now.getTime(), credential.lastAcceptedStep ?? null);
      if (step === null) {
        const failedAttempts = credential.failedAttempts + 1;
        await tx.controlMfaCredential.update({
          where: { userId },
          data: { failedAttempts, lockedUntil: failedAttempts >= MAX_FAILED_CODES ? new Date(now.getTime() + LOCKOUT_MS) : null },
        });
        await createControlAuditEvent(tx, {
          actorId: userId, grant, action: "CONTROL_MFA_VERIFICATION_FAILED", targetType: "CONTROL_MFA", targetId: userId,
          outcome: "DENIED", metadata: { failedAttempts }, correlationId,
        });
        return { kind: "invalid" as const };
      }
      await tx.controlMfaCredential.update({
        where: { userId },
        data: { verifiedAt: credential.verifiedAt ?? now, lastAcceptedStep: step, failedAttempts: 0, lockedUntil: null },
      });
      await createControlAuditEvent(tx, {
        actorId: userId, grant, action: "CONTROL_MFA_VERIFIED", targetType: "CONTROL_MFA", targetId: userId,
        outcome: "SUCCESS", correlationId,
      });
      return { kind: "verified" as const };
    });

    if (result.kind === "missing") return controlJson({ error: "Start MFA enrollment first." }, { status: 409 });
    if (result.kind === "locked") return controlJson({ error: "MFA is temporarily locked after failed attempts." }, { status: 429 });
    if (result.kind === "invalid") return controlJson({ error: "The code is invalid, expired, or already used." }, { status: 401 });

    const token = createControlMfaSession({ userId, sessionVersion: access.identity.session.sessionVersion ?? 0 });
    const response = controlJson({ ok: true, expiresInSeconds: MFA_SESSION_MAX_AGE_SECONDS });
    response.cookies.set(CONTROL_MFA_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: MFA_SESSION_MAX_AGE_SECONDS,
    });
    return response;
  } catch {
    return controlJson({ error: "MFA could not be verified. No control operation was performed." }, { status: 503 });
  }
}
