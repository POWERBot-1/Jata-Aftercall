import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { MessagingProviderAdapter } from "@/lib/messaging/providers";

/** Callback events never verify an OTP or assert a financial entitlement. Raw bodies, errors and
 * recipient details are not stored. Unknown IDs are rejected for safe provider redelivery. */
export async function applyAdminNotificationCallbacks(db: PrismaClient, provider: MessagingProviderAdapter, raw: string, headers: Record<string, string | undefined>) {
  if (process.env.AGENT_ADMIN_NOTIFICATION_CALLBACKS_ENABLED !== "true" || process.env.AGENT_ADMIN_NOTIFICATION_WORKER_ENABLED !== "true") throw new Error("NOTIFICATION_CALLBACK_DISABLED");
  if (!provider.configured || (process.env.NODE_ENV !== "test" && (!provider.live || process.env.AGENT_ADMIN_NOTIFICATION_LIVE_DELIVERY_APPROVED !== "true")) || !/^[a-z0-9_-]{1,64}$/.test(provider.key) || Buffer.byteLength(raw) > 65536) throw new Error("NOTIFICATION_CALLBACK_UNAVAILABLE");
  if (!provider.verifyCallback(raw, headers).ok) throw new Error("NOTIFICATION_CALLBACK_UNAUTHORIZED");
  const events = provider.parseCallbacks(raw, headers);
  if (!Array.isArray(events) || events.length < 1 || events.length > 100) throw new Error("NOTIFICATION_CALLBACK_INVALID");
  const normalized = events.map((event) => {
    if (!event || typeof event.eventId !== "string" || event.eventId.length < 1 || event.eventId.length > 240 || typeof event.providerMessageId !== "string" || !/^[A-Za-z0-9._:+/=-]{1,240}$/.test(event.providerMessageId) || (event.eventType !== "DELIVERED" && event.eventType !== "FAILED")) throw new Error("NOTIFICATION_CALLBACK_INVALID");
    return { messageId: event.providerMessageId, status: event.eventType, eventId: createHash("sha256").update(JSON.stringify([provider.key, event.eventId])).digest("hex") };
  });
  const inserted = await db.$transaction(async (tx) => {
    let countInserted = 0;
    for (const { eventId, messageId, status } of normalized) {
      const attempts = await tx.$queryRaw<Array<{ messageId: string }>>`SELECT "messageId" FROM "AgentAdminNotificationAttempt" WHERE "providerKey" = ${provider.key} AND "messageId" = ${messageId} AND "outcome" = 'ACCEPTED' FOR SHARE`;
      if (attempts.length !== 1) throw new Error("NOTIFICATION_CALLBACK_UNMATCHED");
      const count = await tx.$executeRaw`INSERT INTO "AgentAdminNotificationCallback" ("eventId", "messageId", "status") VALUES (${eventId}, ${messageId}, ${status}) ON CONFLICT ("eventId") DO NOTHING`;
      if (!count) {
        const previous = await tx.$queryRaw<Array<{ messageId: string; status: string }>>`SELECT "messageId", "status" FROM "AgentAdminNotificationCallback" WHERE "eventId" = ${eventId}`;
        if (previous.length !== 1 || previous[0].messageId !== messageId || previous[0].status !== status) throw new Error("NOTIFICATION_CALLBACK_CONFLICT");
      }
      countInserted += count;
    }
    return countInserted;
  });
  return { acceptedEvents: inserted, verifiedDelivery: false };
}
