import "server-only";
import { parseAdminNotificationRecipients } from "@/lib/agents/admin-notification-recipients";

/** Configuration readiness only. This does not enable a sender, queue or provider. */
export function agentAdminNotificationReadiness(): "NOT_CONFIGURED" | "INVALID" | "CONFIGURED" {
  return parseAdminNotificationRecipients(process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS).status;
}
