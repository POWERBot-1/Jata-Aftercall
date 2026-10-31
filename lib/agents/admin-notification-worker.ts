import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { MessagingProviderAdapter, SendResult } from "@/lib/messaging/providers";
import { claimAdminNotification, finishAdminNotificationClaim, markExpiredAdminNotificationClaimsUnknown, type ClaimOutcome, type NotificationClaim } from "@/lib/agents/admin-notification-claims";
import { parseAdminNotificationRecipients } from "@/lib/agents/admin-notification-recipients";

const MAX_BATCH = 5;
const enabled = () => process.env.AGENT_ADMIN_NOTIFICATION_WORKER_ENABLED === "true" && process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED === "true";

/** Resolve only a recipient from the immutable plan's key version. A changed configuration never
 * silently redirects an existing delivery. No destination is returned by an API or stored. */
async function resolveDestination(db: PrismaClient, claim: NotificationClaim): Promise<string | null> {
  const parsed = parseAdminNotificationRecipients(process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS);
  const secret = process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY;
  const version = process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY_VERSION;
  if (parsed.status !== "CONFIGURED" || !secret || Buffer.byteLength(secret) < 32 || Buffer.byteLength(secret) > 512 || !version || !/^[A-Za-z0-9_-]{1,32}$/.test(version)) return null;
  const plans = await db.$queryRaw<Array<{ recipientKeyVersion: string }>>`SELECT "recipientKeyVersion" FROM "AgentAdminNotificationPlan" WHERE "applicationId" = ${claim.applicationId}`;
  if (plans.length !== 1 || plans[0].recipientKeyVersion !== version || !/^[a-f0-9]{64}$/.test(claim.recipientKey)) return null;
  const expected = Buffer.from(claim.recipientKey, "hex");
  const matches = parsed.recipients.filter((number) => timingSafeEqual(createHmac("sha256", secret).update("agent-admin-recipient:v1:").update(number).digest(), expected));
  return matches.length === 1 ? matches[0] : null;
}

/** Only a definite provider rejection which created no message can be retried. */
function classify(result: SendResult): { outcome: ClaimOutcome; messageId: string | null } {
  const id = result.providerMessageId;
  if ((result.outcome === "ACCEPTED" || result.outcome === "SENT") && typeof id === "string" && /^[A-Za-z0-9._:+/=-]{1,240}$/.test(id)) return { outcome: "ACCEPTED", messageId: id };
  if (result.outcome === "FAILED" && result.safeToFallback === true && !id) return { outcome: result.retryable === true ? "SAFE_TRANSIENT_REJECTION" : "SAFE_PERMANENT_REJECTION", messageId: null };
  return { outcome: "UNKNOWN", messageId: null };
}

async function sendWithDeadline(provider: MessagingProviderAdapter, claim: NotificationClaim, to: string): Promise<SendResult> {
  const key = createHash("sha256").update(JSON.stringify(["agent-admin-notification-v1", claim.applicationId, claim.recipientKey])).digest("hex");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      provider.send({ to, body: "A new agent application is ready for administrator review.", senderId: "", idempotencyKey: key, channel: provider.channel }),
      new Promise<SendResult>((resolve) => { timeout = setTimeout(() => resolve({ outcome: "UNKNOWN" }), 10000); }),
    ]);
  } catch { return { outcome: "UNKNOWN" }; }
  finally { if (timeout) clearTimeout(timeout); }
}

/** Bounded, default-off work unit. Injected non-live adapters are accepted only under test.
 * No cron or provider registration is created here. A timeout, crash, stale lease or failed
 * recording never authorizes a retry; an expired claim is moved to UNKNOWN instead. */
export async function processAdminNotificationBatch(db: PrismaClient, provider: MessagingProviderAdapter, limit = MAX_BATCH) {
  if (!enabled()) throw new Error("NOTIFICATION_WORKER_DISABLED");
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_BATCH) throw new Error("INVALID_BATCH_SIZE");
  if (!provider.configured || (process.env.NODE_ENV !== "test" && (!provider.live || process.env.AGENT_ADMIN_NOTIFICATION_LIVE_DELIVERY_APPROVED !== "true")) || !/^[a-z0-9_-]{1,64}$/.test(provider.key)) throw new Error("NOTIFICATION_PROVIDER_UNAVAILABLE");
  const expired = await markExpiredAdminNotificationClaimsUnknown(db);
  let processed = 0;
  for (let i = 0; i < limit; i++) {
    const claim = await claimAdminNotification(db);
    if (!claim) break;
    const destination = await resolveDestination(db, claim);
    const result = destination ? classify(await sendWithDeadline(provider, claim, destination)) : { outcome: "UNKNOWN" as const, messageId: null };
    // Completion and sanitized attempt evidence commit together. If persistence fails, the claim
    // remains unresolved; it must never be sent a second time merely because the lease expired.
    await db.$transaction(async (tx) => {
      if (!await finishAdminNotificationClaim(tx, claim, result.outcome)) throw new Error("NOTIFICATION_CLAIM_STALE");
      await tx.$executeRaw`INSERT INTO "AgentAdminNotificationAttempt" ("applicationId", "recipientKey", "attempt", "outcome", "providerKey", "messageId") VALUES (${claim.applicationId}, ${claim.recipientKey}, ${claim.attempts}, ${result.outcome}, ${provider.key}, ${result.messageId})`;
    });
    processed++;
  }
  return { processed, expired, deliveryVerified: false };
}
