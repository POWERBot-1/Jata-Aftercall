import { createHmac } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { parseAdminNotificationRecipients } from "@/lib/agents/admin-notification-recipients";

/** Called only within application creation. No messages are sent or destinations stored. */
export async function enqueueApplicationSubmitted(tx: Prisma.TransactionClient, applicationId: string): Promise<void> {
  if (process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED !== "true") return;
  await tx.$executeRaw`
    INSERT INTO "AgentAdminNotificationEvent" ("applicationId", "eventType")
    VALUES (${applicationId}, 'APPLICATION_SUBMITTED')
    ON CONFLICT ("applicationId") DO NOTHING`;
  if (process.env.AGENT_ADMIN_NOTIFICATION_OUTBOX_PLAN_ENABLED !== "true") return;

  const parsed = parseAdminNotificationRecipients(process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS);
  const secret = process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY;
  const version = process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY_VERSION;
  if (parsed.status !== "CONFIGURED" || !secret || Buffer.byteLength(secret, "utf8") < 32 || Buffer.byteLength(secret, "utf8") > 512 || !version || !/^[A-Za-z0-9_-]{1,32}$/.test(version)) throw new Error("ADMIN_NOTIFICATION_PLAN_NOT_CONFIGURED");
  // One plan per event, established atomically. Later config/key changes never silently add or
  // replace recipients on replay. A failed transaction leaves neither a partial plan nor event.
  const created: Array<{ applicationId: string }> = await tx.$queryRaw`
    INSERT INTO "AgentAdminNotificationPlan" ("applicationId", "recipientKeyVersion")
    VALUES (${applicationId}, ${version}) ON CONFLICT ("applicationId") DO NOTHING
    RETURNING "applicationId"`;
  if (created.length === 0) return;
  for (const recipient of parsed.recipients) {
    const recipientKey = createHmac("sha256", secret).update("agent-admin-recipient:v1:").update(recipient).digest("hex");
    await tx.$executeRaw`
      INSERT INTO "AgentAdminNotificationDelivery" ("applicationId", "recipientKey")
      VALUES (${applicationId}, ${recipientKey})`;
  }
}
