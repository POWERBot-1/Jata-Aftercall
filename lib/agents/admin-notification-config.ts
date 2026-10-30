import "server-only";
import { normalizeKePhone } from "@/lib/phone";

/** Configuration readiness only. This does not enable a sender, queue or provider. */
export function agentAdminNotificationReadiness(): "NOT_CONFIGURED" | "INVALID" | "CONFIGURED" {
  const raw = process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS;
  if (!raw || !raw.trim()) return "NOT_CONFIGURED";
  // Bound work and reject the entire list rather than silently dropping an invalid recipient.
  if (raw.length > 500) return "INVALID";
  const entries = raw.split(",");
  if (!entries.length || entries.length > 10) return "INVALID";
  const numbers = new Set<string>();
  for (const entry of entries) {
    const value = entry.trim();
    if (!/^[+\d ()-]+$/.test(value)) return "INVALID";
    const compact = value.replace(/[ ()-]/g, "");
    if (!/^(?:0[71]\d{8}|\+?254[71]\d{8})$/.test(compact)) return "INVALID";
    const number = normalizeKePhone(compact);
    if (!number || numbers.has(number)) return "INVALID";
    numbers.add(number);
  }
  return "CONFIGURED";
}
