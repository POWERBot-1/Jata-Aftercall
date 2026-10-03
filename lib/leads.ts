/**
 * Lead Capture Service (§20, §49) — tenant-isolated lead classification and storage.
 *
 * Supported classifications:
 * - GENERAL_INQUIRY
 * - QUALIFIED_LEAD
 * - ORDER_STARTED
 * - ORDER_COMPLETED
 * - PREORDER
 * - BOOKING_REQUEST
 * - SUPPORT_REQUEST
 * - HUMAN_HANDOFF
 * - ABANDONED
 *
 * Captures only necessary information. Never automatically adds customers to marketing lists (§49).
 */

import prisma from "./db";
import { createNotification } from "./notification";

export const LEAD_CLASSIFICATIONS = [
  "GENERAL_INQUIRY",
  "QUALIFIED_LEAD",
  "ORDER_STARTED",
  "ORDER_COMPLETED",
  "PREORDER",
  "BOOKING_REQUEST",
  "SUPPORT_REQUEST",
  "HUMAN_HANDOFF",
  "ABANDONED",
] as const;

export type LeadClassification = (typeof LEAD_CLASSIFICATIONS)[number];

export type LeadRecord = {
  id: string;
  businessId: string;
  classification: LeadClassification;
  customerName: string | null;
  customerPhone: string | null;
  customerEmail: string | null;
  summary: string;
  conversationId: string | null;
  channel: string;
  referenceId: string | null;
  transactionalOnly: boolean;
  createdAt: string;
};

const tenantLeadStore = new Map<string, LeadRecord[]>();
const leadIdempotencyKeys = new Map<string, LeadRecord>();

export function isValidLeadClassification(value: unknown): value is LeadClassification {
  return typeof value === "string" && (LEAD_CLASSIFICATIONS as readonly string[]).includes(value);
}

export async function captureLead(input: {
  businessId: string;
  classification: LeadClassification;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  summary: string;
  conversationId?: string | null;
  channel?: string;
  referenceId?: string | null;
  idempotencyKey?: string;
  preview?: boolean;
}): Promise<{ lead: LeadRecord; preview: boolean; idempotent: boolean }> {
  const { businessId } = input;
  if (!businessId) throw new Error("businessId required for lead capture — tenant isolation enforced.");
  const classification: LeadClassification = isValidLeadClassification(input.classification)
    ? input.classification
    : "GENERAL_INQUIRY";

  if (input.idempotencyKey) {
    const dedupKey = `${businessId}:${input.idempotencyKey}`;
    const existing = leadIdempotencyKeys.get(dedupKey);
    if (existing) {
      return { lead: existing, preview: Boolean(input.preview), idempotent: true };
    }
  }

  const record: LeadRecord = {
    id: `lead_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    businessId,
    classification,
    customerName: input.customerName ? String(input.customerName).trim().slice(0, 80) : null,
    customerPhone: input.customerPhone ? String(input.customerPhone).trim().slice(0, 30) : null,
    customerEmail: input.customerEmail ? String(input.customerEmail).trim().slice(0, 120) : null,
    summary: String(input.summary || classification).trim().slice(0, 500),
    conversationId: input.conversationId || null,
    channel: input.channel || "web_chat",
    referenceId: input.referenceId || null,
    transactionalOnly: true, // §49: Never automatically add customers to marketing lists
    createdAt: new Date().toISOString(),
  };

  if (input.preview) {
    return { lead: record, preview: true, idempotent: false };
  }

  const existingList = tenantLeadStore.get(businessId) || [];
  existingList.unshift(record);
  tenantLeadStore.set(businessId, existingList.slice(0, 500));

  if (input.idempotencyKey) {
    leadIdempotencyKeys.set(`${businessId}:${input.idempotencyKey}`, record);
  }

  try {
    await prisma.aIQualityEvent?.create?.({
      data: {
        businessId,
        conversationId: record.conversationId,
        sourceUsed: "structured_data",
        confidence: "high",
        escalatedToHuman: classification === "HUMAN_HANDOFF" || classification === "SUPPORT_REQUEST",
        customerCorrectedAI: false,
        missingBusinessInfo: false,
        eventType: `LEAD_${classification}`,
        metadata: JSON.stringify(record),
      },
    });
  } catch {
    // Kept in tenantLeadStore when DB is mocked/offline
  }

  // Notify business for qualified/escalated leads (§21, §22) without failing lead capture if notification fails
  const notifyClassifications: LeadClassification[] = [
    "QUALIFIED_LEAD",
    "ORDER_COMPLETED",
    "PREORDER",
    "BOOKING_REQUEST",
    "HUMAN_HANDOFF",
    "SUPPORT_REQUEST",
  ];
  if (notifyClassifications.includes(classification)) {
    try {
      await createNotification({
        businessId,
        eventType: classification === "HUMAN_HANDOFF" ? "HUMAN_HANDOFF" : "NEW_ORDER",
        title: `Lead: ${classification.replace(/_/g, " ")}`,
        message: `${record.customerName || "Customer"}${record.customerPhone ? ` (${record.customerPhone})` : ""}: ${record.summary}`,
        referenceId: record.id,
      });
    } catch {
      // §22: Separate transaction/lead success from notification delivery
    }
  }

  return { lead: record, preview: false, idempotent: false };
}

export async function listLeadsForBusiness(
  businessId: string,
  classification?: LeadClassification,
): Promise<LeadRecord[]> {
  if (!businessId) throw new Error("businessId required — tenant isolation enforced.");
  const fromMemory = tenantLeadStore.get(businessId) || [];
  const results = new Map<string, LeadRecord>();
  for (const item of fromMemory) {
    if (!classification || item.classification === classification) {
      results.set(item.id, item);
    }
  }

  try {
    if (prisma.aIQualityEvent?.findMany) {
      const rows = await prisma.aIQualityEvent.findMany({
        where: { businessId },
        orderBy: { timestamp: "desc" },
        take: 100,
      });
      for (const row of Array.isArray(rows) ? rows : []) {
        if (typeof row.eventType === "string" && row.eventType.startsWith("LEAD_") && row.metadata) {
          try {
            const parsed = JSON.parse(row.metadata) as LeadRecord;
            if (parsed.businessId === businessId && (!classification || parsed.classification === classification)) {
              results.set(parsed.id || row.id, parsed);
            }
          } catch {
            // ignore malformed metadata
          }
        }
      }
    }
  } catch {
    // Fallback to in-memory records
  }

  return Array.from(results.values());
}

export function resetLeadsForTests() {
  tenantLeadStore.clear();
  leadIdempotencyKeys.clear();
}
