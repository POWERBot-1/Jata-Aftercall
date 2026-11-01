import { controlJson } from "@/lib/control/http";
import { cookies } from "next/headers";
import prisma from "@/lib/db";
import { getControlIdentity, controlAccessError, CONTROL_MFA_COOKIE } from "@/lib/control/access";
import { verifyControlMfaSession } from "@/lib/control/mfa";

export const dynamic = "force-dynamic";

export async function GET() {
  const access = await getControlIdentity();
  if (access.ok === false) return controlJson(controlAccessError(access), { status: access.status });
  try {
    const [credential, cookieStore] = await Promise.all([
      prisma.controlMfaCredential.findUnique({ where: { userId: access.identity.session.userId }, select: { verifiedAt: true } }),
      cookies(),
    ]);
    const sessionVersion = access.identity.session.sessionVersion ?? 0;
    return controlJson({
      enrolled: Boolean(credential?.verifiedAt),
      verified: Boolean(credential?.verifiedAt && verifyControlMfaSession(cookieStore.get(CONTROL_MFA_COOKIE)?.value, { userId: access.identity.session.userId, sessionVersion })),
      roles: [...new Set(access.identity.grants.map((grant) => grant.role))],
    });
  } catch {
    return controlJson({ error: "MFA status is unavailable." }, { status: 503 });
  }
}
