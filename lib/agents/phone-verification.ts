import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import prisma from "@/lib/db";
import { getMessagingProvider, liveProviderReady, type MessagingProviderAdapter } from "@/lib/messaging/providers";

const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

type Config = { secret: string; sender: string; provider: MessagingProviderAdapter };
/** The mock/sandbox registry can never establish a live ownership claim. */
export function verificationConfig(): Config | null {
  const key = process.env.AGENT_VERIFICATION_PROVIDER_KEY || "";
  const secret = process.env.AGENT_VERIFICATION_HMAC_SECRET || "";
  const sender = process.env.AGENT_VERIFICATION_SENDER_ID || "";
  if (process.env.AGENT_PHONE_VERIFICATION_ENABLED !== "true" || process.env.MESSAGING_LIVE_ENABLED !== "true" ||
      secret.length < 32 || !sender || !key || !liveProviderReady(key)) return null;
  const provider = getMessagingProvider(key);
  if (!provider.live || !provider.configured || provider.channel !== "SMS") return null;
  return { secret, sender, provider };
}

function digest(secret: string, applicationId: string, nonce: string, code: string): string {
  return createHmac("sha256", secret).update(`agent-phone:v1:${applicationId}:${nonce}:${code}`).digest("hex");
}
function equalDigest(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

/** Shared atomic account limits; failures and fallback clients refuse rather than allow. */
export async function verificationLimit(secret: string, userId: string, action: "issue" | "confirm" | "phone"): Promise<boolean> {
  const key = createHmac("sha256", secret).update(`agent-phone-limit:v1:${action}:${userId}`).digest("hex");
  const max = action === "confirm" ? 20 : 3;
  if (randomInt(100) === 0) {
    await prisma.agentRegistrationThrottle.deleteMany({ where: { expiresAt: { lt: new Date(Date.now() - 86_400_000) } } });
  }
  const rows: Array<{ count: number }> = await prisma.$queryRaw`
    INSERT INTO "AgentRegistrationThrottle" ("key", "count", "expiresAt")
    VALUES (${key}, 1, NOW() + INTERVAL '15 minutes')
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "AgentRegistrationThrottle"."expiresAt" <= NOW() THEN 1 ELSE "AgentRegistrationThrottle"."count" + 1 END,
      "expiresAt" = CASE WHEN "AgentRegistrationThrottle"."expiresAt" <= NOW() THEN NOW() + INTERVAL '15 minutes' ELSE "AgentRegistrationThrottle"."expiresAt" END
    WHERE "AgentRegistrationThrottle"."expiresAt" <= NOW() OR "AgentRegistrationThrottle"."count" < ${max}
    RETURNING "count"`;
  return rows.length === 1 && Number.isInteger(rows[0].count) && rows[0].count >= 1 && rows[0].count <= max;
}

/** Persist the digest before attempting delivery. Unknown or failed delivery cannot be confirmed. */
export async function issuePhoneChallenge(userId: string, config: Config): Promise<"sent" | "already" | "unavailable"> {
  const app = await prisma.agentApplication.findUnique({ where: { userId }, select: { id: true, status: true, phoneE164: true, phoneVerifiedAt: true } });
  if (!app || app.status !== "PENDING") return "unavailable";
  if (app.phoneVerifiedAt) return "already";
  // Prevent many accounts from repeatedly sending to the same phone. The number is HMAC-keyed.
  if (!await verificationLimit(config.secret, app.phoneE164, "phone")) return "unavailable";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const nonce = randomUUID();
  const codeDigest = digest(config.secret, app.id, nonce, code);
  const expiresAt = new Date(Date.now() + TTL_MS);
  await prisma.agentPhoneChallenge.upsert({
    where: { applicationId: app.id },
    create: { applicationId: app.id, phoneE164: app.phoneE164, nonce, codeDigest, expiresAt },
    update: { phoneE164: app.phoneE164, nonce, codeDigest, expiresAt, sentAt: null, consumedAt: null, attempts: 0 },
  });
  const result = await config.provider.send({ to: app.phoneE164, channel: "SMS", senderId: config.sender,
    idempotencyKey: `agent-phone-${nonce}`, body: `Your JATA verification code is ${code}. It expires in 10 minutes. Do not share it.` });
  if (result.outcome !== "ACCEPTED" && result.outcome !== "SENT") return "unavailable";
  // A concurrent issue invalidates the older message; never mark a newer challenge as sent.
  const marked = await prisma.agentPhoneChallenge.updateMany({ where: { applicationId: app.id, codeDigest, sentAt: null }, data: { sentAt: new Date() } });
  return marked.count === 1 ? "sent" : "unavailable";
}

/** One-time compare-and-set, including audit and globally unique verified phone in one transaction. */
export async function confirmPhoneChallenge(userId: string, code: string, secret: string): Promise<"verified" | "already" | "invalid"> {
  return prisma.$transaction(async (tx: typeof prisma) => {
    const app = await tx.agentApplication.findUnique({ where: { userId }, select: { id: true, status: true, phoneE164: true, phoneVerifiedAt: true } });
    if (!app || app.status !== "PENDING") return "invalid";
    if (app.phoneVerifiedAt) return "already";
    const challenge = await tx.agentPhoneChallenge.findUnique({ where: { applicationId: app.id } });
    const now = new Date();
    if (!challenge || challenge.phoneE164 !== app.phoneE164 || !challenge.sentAt || challenge.consumedAt || challenge.expiresAt <= now || challenge.attempts >= MAX_ATTEMPTS) return "invalid";
    // This locks the challenge row and consumes an attempt even when the code is wrong.
    const attempted = await tx.agentPhoneChallenge.updateMany({ where: { id: challenge.id, codeDigest: challenge.codeDigest,
      phoneE164: app.phoneE164, sentAt: { not: null }, consumedAt: null, expiresAt: { gt: now }, attempts: { lt: MAX_ATTEMPTS } }, data: { attempts: { increment: 1 } } });
    if (attempted.count !== 1) {
      const current = await tx.agentApplication.findUnique({ where: { userId }, select: { status: true, phoneVerifiedAt: true, verifiedPhoneE164: true } });
      return current?.status === "PENDING" && current.phoneVerifiedAt && current.verifiedPhoneE164 === app.phoneE164 ? "already" : "invalid";
    }
    if (!equalDigest(challenge.codeDigest, digest(secret, app.id, challenge.nonce, code))) return "invalid";
    const changed = await tx.agentApplication.updateMany({ where: { id: app.id, userId, status: "PENDING", phoneE164: app.phoneE164, phoneVerifiedAt: null },
      data: { verifiedPhoneE164: app.phoneE164, phoneVerifiedAt: now } });
    if (changed.count !== 1) {
      const current = await tx.agentApplication.findUnique({ where: { userId }, select: { status: true, phoneVerifiedAt: true, verifiedPhoneE164: true } });
      if (current?.status === "PENDING" && current.phoneVerifiedAt && current.verifiedPhoneE164 === app.phoneE164) return "already";
      throw new Error("Application changed during verification");
    }
    await tx.agentPhoneChallenge.updateMany({ where: { id: challenge.id, codeDigest: challenge.codeDigest, consumedAt: null }, data: { consumedAt: now } });
    await tx.auditEvent.create({ data: { actorId: userId, action: "AGENT_PHONE_VERIFIED", targetType: "AGENT_APPLICATION", targetId: app.id } });
    return "verified";
  });
}
