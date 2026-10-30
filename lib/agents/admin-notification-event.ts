import type { Prisma } from "@prisma/client";

/** Called only within the application creation transaction. No messages are sent here. */
export async function enqueueApplicationSubmitted(tx: Prisma.TransactionClient, applicationId: string): Promise<void> {
  if (process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED !== "true") return;
  await tx.$executeRaw`
    INSERT INTO "AgentAdminNotificationEvent" ("applicationId", "eventType")
    VALUES (${applicationId}, 'APPLICATION_SUBMITTED')
    ON CONFLICT ("applicationId") DO NOTHING`;
}
