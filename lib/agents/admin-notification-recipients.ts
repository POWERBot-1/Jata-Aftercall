import { normalizeKePhone } from "@/lib/phone";

/** Pure validation shared by server-only configuration and the transactional queue planner. */
export function parseAdminNotificationRecipients(raw: string | undefined):
  | { status: "NOT_CONFIGURED" | "INVALID"; recipients: [] }
  | { status: "CONFIGURED"; recipients: string[] } {
  if (!raw || !raw.trim()) return { status: "NOT_CONFIGURED", recipients: [] };
  if (raw.length > 500) return { status: "INVALID", recipients: [] };
  const entries = raw.split(",");
  if (!entries.length || entries.length > 10) return { status: "INVALID", recipients: [] };
  const numbers = new Set<string>();
  for (const entry of entries) {
    const value = entry.trim();
    if (!/^[+\d ()-]+$/.test(value)) return { status: "INVALID", recipients: [] };
    const compact = value.replace(/[ ()-]/g, "");
    if (!/^(?:0[71]\d{8}|\+?254[71]\d{8})$/.test(compact)) return { status: "INVALID", recipients: [] };
    const number = normalizeKePhone(compact);
    if (!number || numbers.has(number)) return { status: "INVALID", recipients: [] };
    numbers.add(number);
  }
  return { status: "CONFIGURED", recipients: [...numbers] };
}
