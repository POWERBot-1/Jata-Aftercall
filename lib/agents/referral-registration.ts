import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// A configured link lifetime is required; there is deliberately no default policy.
export function referralLifetimeSeconds(): number | null {
  if (process.env.AGENT_REGISTRATION_REFERRALS_ENABLED !== "true") return null;
  const value = process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS || "";
  if (!/^[1-9]\d{0,7}$/.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 31_536_000 ? seconds : null;
}
export function newReferralToken(): string { return randomBytes(32).toString("base64url"); }
export function referralTokenHash(token: unknown): string | null {
  return typeof token === "string" && /^[A-Za-z0-9_-]{43}$/.test(token) ? createHash("sha256").update(`agent-referral:v1:${token}`).digest("hex") : null;
}

/** Must be called inside the application transaction. An invalid or ineligible link never blocks signup
 * and never creates earnings. The referrer and link rows are locked against suspension/rotation. */
export async function recordRegistrationReferral(tx: PrismaClient, args: { input: unknown; applicationId: string; userId: string; email: string; phoneE164: string; source?: "REGISTRATION" | "EXISTING_ACCOUNT" }): Promise<boolean> {
  if (!referralLifetimeSeconds() || !args.input || typeof args.input !== "object" || Array.isArray(args.input)) return false;
  const body = args.input as Record<string, unknown>;
  if (body.referralConsent !== true) return false;
  const hash = referralTokenHash(body.referralCode);
  if (!hash) return false;
  const link = await tx.agentReferralLink.findUnique({ where: { tokenHash: hash }, select: { id: true, referrerApplicationId: true } });
  if (!link) return false;
  // Lock the application before the link, the same order used by link rotation and suspension.
  const owners: Array<{ id: string; userId: string; phoneE164: string; email: string }> = await tx.$queryRaw`
    SELECT a."id", a."userId", a."phoneE164", u."email" FROM "AgentApplication" a
    JOIN "User" u ON u."id" = a."userId"
    WHERE a."id" = ${link.referrerApplicationId} AND a."status" = 'PENDING' AND a."agentStatus" = 'ACTIVE'
    FOR UPDATE OF a`;
  const referrer = owners[0];
  if (owners.length !== 1 || !referrer || referrer.userId === args.userId || referrer.email.toLowerCase() === args.email || referrer.phoneE164 === args.phoneE164) return false;
  const valid: Array<{ id: string }> = await tx.$queryRaw`
    SELECT "id" FROM "AgentReferralLink" WHERE "id" = ${link.id} AND "referrerApplicationId" = ${referrer.id}
      AND "tokenHash" = ${hash} AND "revokedAt" IS NULL AND "expiresAt" > clock_timestamp() FOR UPDATE`;
  if (valid.length !== 1) return false;
  const source = args.source ?? "REGISTRATION";
  await tx.agentReferralAttribution.create({ data: { linkId: link.id, referrerApplicationId: referrer.id, referredApplicationId: args.applicationId, consentedAt: new Date(), source } });
  await tx.auditEvent.create({ data: { actorId: args.userId, action: source === "REGISTRATION" ? "AGENT_REGISTRATION_ATTRIBUTION_RECORDED" : "AGENT_EXISTING_ACCOUNT_ATTRIBUTION_RECORDED", targetType: "AGENT_APPLICATION", targetId: args.applicationId, metadata: JSON.stringify({ referrerApplicationId: referrer.id, linkId: link.id }) } });
  return true;
}
