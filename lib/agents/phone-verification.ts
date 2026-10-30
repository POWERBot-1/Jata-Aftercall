import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import prisma from "@/lib/db";
import { getMessagingProvider, liveProviderReady, type MessagingProviderAdapter } from "@/lib/messaging/providers";

const TTL_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

type Config = { secret: string; sender: string; provider: MessagingProviderAdapter; template?: { name: string; language: string } };
/** Only explicitly registered live adapters can be used; a WhatsApp auth template must be approved. */
export function verificationConfig(): Config | null {
  const secret = process.env.AGENT_VERIFICATION_HMAC_SECRET || "";
  if (process.env.AGENT_PHONE_VERIFICATION_ENABLED !== "true" || process.env.MESSAGING_LIVE_ENABLED !== "true" || secret.length < 32) return null;
  const waKey = process.env.AGENT_VERIFICATION_WHATSAPP_PROVIDER_KEY || "";
  const waSender = process.env.AGENT_VERIFICATION_WHATSAPP_SENDER_ID || "";
  const name = process.env.AGENT_VERIFICATION_WHATSAPP_TEMPLATE_NAME || "";
  const language = process.env.AGENT_VERIFICATION_WHATSAPP_TEMPLATE_LANGUAGE || "";
  if (waKey && waSender && /^[a-z0-9_]{1,128}$/.test(name) && /^[A-Za-z0-9_-]{2,20}$/.test(language) &&
      process.env.AGENT_VERIFICATION_WHATSAPP_TEMPLATE_APPROVED === "true" && liveProviderReady(waKey)) {
    const provider = getMessagingProvider(waKey);
    if (provider.live && provider.configured && provider.channel === "WHATSAPP" && provider.supportsWhatsAppAuthenticationTemplates === true) {
      return { secret, sender: waSender, provider, template: { name, language } };
    }
  }
  const key = process.env.AGENT_VERIFICATION_PROVIDER_KEY || "";
  const sender = process.env.AGENT_VERIFICATION_SENDER_ID || "";
  if (!sender || !key || !liveProviderReady(key)) return null;
  const provider = getMessagingProvider(key);
  return provider.live && provider.configured && provider.channel === "SMS" ? { secret, sender, provider } : null;
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
  const channel = config.provider.channel;
  if (channel !== "SMS" && channel !== "WHATSAPP") return "unavailable";
  if (channel === "WHATSAPP" && !config.template) return "unavailable";
  // One atomic claim per unexpired challenge. An uncertain outcome is never retried or switched
  // to another channel until expiry; otherwise a timeout could send duplicate messages.
  const id = randomUUID();
  const rows: Array<{ id: string }> = await prisma.$queryRaw`
    INSERT INTO "AgentPhoneChallenge" ("id", "applicationId", "phoneE164", "nonce", "codeDigest", "expiresAt", "deliveryChannel", "deliveryState")
    VALUES (${id}, ${app.id}, ${app.phoneE164}, ${nonce}, ${codeDigest}, ${expiresAt}, ${channel}, 'PENDING')
    ON CONFLICT ("applicationId") DO UPDATE SET
      "phoneE164" = EXCLUDED."phoneE164", "nonce" = EXCLUDED."nonce", "codeDigest" = EXCLUDED."codeDigest",
      "expiresAt" = EXCLUDED."expiresAt", "deliveryChannel" = EXCLUDED."deliveryChannel", "deliveryState" = 'PENDING',
      "providerMessageId" = NULL, "sentAt" = NULL, "consumedAt" = NULL, "attempts" = 0
    WHERE "AgentPhoneChallenge"."expiresAt" <= NOW()
    RETURNING "id"`;
  if (rows.length !== 1 || typeof rows[0].id !== "string") {
    const existing = await prisma.agentPhoneChallenge.findUnique({ where: { applicationId: app.id }, select: { sentAt: true, expiresAt: true, consumedAt: true } });
    return existing?.sentAt && !existing.consumedAt && existing.expiresAt > new Date() ? "sent" : "unavailable";
  }
  let result;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    // The provider may still finish after a timeout: the persisted UNKNOWN state prevents an
    // immediate resend or cross-channel fallback while the outcome is uncertain.
    result = await Promise.race([config.provider.send({ to: app.phoneE164, channel, senderId: config.sender,
      idempotencyKey: `agent-phone-${nonce}`,
      body: channel === "SMS" ? `Your JATA verification code is ${code}. It expires in 10 minutes. Do not share it.` : "",
      ...(config.template ? { authenticationTemplate: { ...config.template, code } } : {}) }),
      new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error("Provider timed out")), 10_000); }),
    ]);
  } catch {
    await prisma.agentPhoneChallenge.updateMany({ where: { applicationId: app.id, codeDigest, deliveryState: "PENDING" }, data: { deliveryState: "UNKNOWN" } });
    return "unavailable";
  } finally { if (timeout) clearTimeout(timeout); }
  const accepted = result.outcome === "ACCEPTED" || result.outcome === "SENT";
  const messageId = typeof result.providerMessageId === "string" && /^[A-Za-z0-9._:-]{1,200}$/.test(result.providerMessageId) && !result.providerMessageId.includes(code) && !result.providerMessageId.includes(app.phoneE164.replace(/\D/g, "")) ? result.providerMessageId : null;
  const state = ["ACCEPTED", "SENT", "FAILED"].includes(result.outcome) ? result.outcome : "UNKNOWN";
  const marked = await prisma.agentPhoneChallenge.updateMany({ where: { applicationId: app.id, codeDigest, deliveryState: "PENDING" },
    data: { deliveryState: state, providerMessageId: messageId, ...(accepted ? { sentAt: new Date() } : {}) } });
  return accepted && marked.count === 1 ? "sent" : "unavailable";
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
