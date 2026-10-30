import { createHash, timingSafeEqual } from "node:crypto";
import prisma from "@/lib/db";
import { verifyMetaSignature } from "./meta-whatsapp";

type MetaStatus = "sent" | "delivered" | "read" | "failed";
type Event = { id: string; status: MetaStatus; timestamp: string };
const allowed = new Set(["sent", "delivered", "read", "failed"]);
export function webhookConfig() {
  const secret = process.env.META_WHATSAPP_APP_SECRET || "";
  const verifyToken = process.env.META_WHATSAPP_VERIFY_TOKEN || "";
  const phoneId = process.env.META_WHATSAPP_PHONE_NUMBER_ID || "";
  if (process.env.META_WHATSAPP_WEBHOOK_ENABLED !== "true" || secret.length < 16 || verifyToken.length < 16 || !/^\d{5,32}$/.test(phoneId)) return null;
  return { secret, verifyToken, phoneId };
}
export function verifyWebhookToken(value: string | null, expected: string): boolean {
  if (!value || !expected || value.length > 512) return false;
  const a = Buffer.from(value); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export { verifyMetaSignature };

/** Strictly parse status-only Meta messages without storing contacts, bodies or error details. */
export function parseMetaStatuses(input: unknown, phoneId: string): Event[] | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const envelope = input as { object?: unknown; entry?: unknown };
  if (envelope.object !== "whatsapp_business_account" || !Array.isArray(envelope.entry) || envelope.entry.length > 100) return null;
  const events: Event[] = [];
  for (const entry of envelope.entry) {
    if (!entry || typeof entry !== "object" || !Array.isArray(entry.changes) || entry.changes.length > 100) return null;
    for (const change of entry.changes) {
      if (!change || typeof change !== "object" || typeof change.field !== "string" || !change.value || typeof change.value !== "object") return null;
      if (change.field !== "messages") continue;
      const value = change.value as { metadata?: { phone_number_id?: unknown }; statuses?: unknown };
      if (value.metadata?.phone_number_id !== phoneId) return null;
      if (value.statuses === undefined) continue;
      if (!Array.isArray(value.statuses) || value.statuses.length > 100) return null;
      for (const status of value.statuses) {
        if (!status || typeof status !== "object" || typeof status.id !== "string" || !/^wamid\.[A-Za-z0-9._:+/=-]{1,240}$/.test(status.id) ||
            typeof status.status !== "string" || !allowed.has(status.status) || typeof status.timestamp !== "string" || !/^\d{1,12}$/.test(status.timestamp)) return null;
        const seconds = Number(status.timestamp);
        if (!Number.isSafeInteger(seconds) || seconds <= 0 || seconds > Math.floor(Date.now() / 1000) + 300) return null;
        events.push({ id: status.id, status: status.status as MetaStatus, timestamp: status.timestamp });
        if (events.length > 100) return null;
      }
    }
  }
  return events;
}

/** Retries are acknowledged without reapplying. Rows are locked so racing status callbacks cannot
 * regress a later state. Unknown ids must be retried: the send response may still be committing. */
export async function applyMetaStatus(event: Event, phoneId: string): Promise<"applied" | "duplicate" | "unmatched"> {
  return prisma.$transaction(async (tx: typeof prisma) => {
    const rows: Array<{ id: string; providerStatus: MetaStatus | null; providerStatusAt: Date | null }> = await tx.$queryRaw`
      SELECT "id", "providerStatus", "providerStatusAt" FROM "AgentPhoneChallenge"
      WHERE "providerMessageId" = ${event.id} AND "deliveryChannel" = 'WHATSAPP' FOR UPDATE`;
    if (rows.length !== 1) return "unmatched";
    const row = rows[0];
    const eventAt = new Date(Number(event.timestamp) * 1000);
    const id = createHash("sha256").update(JSON.stringify([phoneId, event.id, event.status, event.timestamp])).digest("hex");
    const inserted = await tx.agentWhatsAppWebhookEvent.createMany({ data: [{ id, challengeId: row.id, providerMessageId: event.id, status: event.status, eventAt }], skipDuplicates: true });
    if (inserted.count === 0) return "duplicate";
    const rank: Record<MetaStatus, number> = { sent: 1, failed: 2, delivered: 3, read: 4 };
    if ((!row.providerStatusAt || eventAt >= row.providerStatusAt) && (!row.providerStatus || rank[event.status] >= rank[row.providerStatus])) {
      await tx.agentPhoneChallenge.update({ where: { id: row.id }, data: { providerStatus: event.status, providerStatusAt: eventAt } });
    }
    return "applied";
  });
}
