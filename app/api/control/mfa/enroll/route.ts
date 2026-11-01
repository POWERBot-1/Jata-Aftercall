import { controlJson } from "@/lib/control/http";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import prisma from "@/lib/db";
import { getControlIdentity, controlAccessError } from "@/lib/control/access";
import { createControlAuditEvent } from "@/lib/control/audit";
import { encryptTotpSecret, encodeBase32, generateTotpSecret, totpUri } from "@/lib/control/mfa";
import { getCorrelationId, hasSameOrigin } from "@/lib/control/security";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!hasSameOrigin(request)) return controlJson({ error: "Same-origin request required." }, { status: 403 });
  const access = await getControlIdentity();
  if (access.ok === false) return controlJson(controlAccessError(access), { status: access.status });
  const limited = rateLimitByIdentity(access.identity.session.userId, { key: "control-mfa-enroll", max: 3, windowMs: 30 * 60_000 });
  if (!limited.allowed) return limited.response ?? controlJson({ error: "Too many enrollment attempts." }, { status: 429 });

  const actorGrant = access.identity.grants[0];
  const secret = generateTotpSecret();
  const encrypted = encryptTotpSecret(secret);
  const correlationId = getCorrelationId(request.headers);
  try {
    const existing = await prisma.controlMfaCredential.findUnique({ where: { userId: access.identity.session.userId }, select: { verifiedAt: true } });
    if (existing?.verifiedAt) return controlJson({ error: "MFA is already enrolled. Recovery requires an owner-approved recovery process." }, { status: 409 });
    await prisma.$transaction(async (tx) => {
      await tx.controlMfaCredential.upsert({
        where: { userId: access.identity.session.userId },
        create: { userId: access.identity.session.userId, ...encrypted, updatedAt: new Date() },
        update: { ...encrypted, failedAttempts: 0, lockedUntil: null, lastAcceptedStep: null, updatedAt: new Date() },
      });
      await createControlAuditEvent(tx, {
        actorId: access.identity.session.userId,
        grant: actorGrant,
        action: "CONTROL_MFA_ENROLLMENT_STARTED",
        targetType: "CONTROL_MFA",
        targetId: access.identity.session.userId,
        outcome: "SUCCESS",
        correlationId,
      });
    });
    return controlJson({ secret: encodeBase32(secret), uri: totpUri(secret, access.identity.session.email), algorithm: "TOTP/SHA1/6 digits/30 seconds" }, { status: 201 });
  } catch {
    return controlJson({ error: "MFA enrollment could not be saved. No control access was granted." }, { status: 503 });
  }
}
