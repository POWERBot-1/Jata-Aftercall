/**
 * Durable request-only professional enquiries. Uses the existing tenant lead ledger (AIQualityEvent).
 * Unlike legacy captureLead's offline memory fallback, an acknowledgement requires a real persisted row.
 * Never creates Booking/Order/Payment, changes service price/deposit, confirms an appointment or subscribes marketing.
 */
import { createHash } from "node:crypto";
import prisma from "../db";
import { sanitizeText } from "../validation";
import type { LeadRecord } from "../leads";

export const ENQUIRY_CHANNEL = "website_studio_professional";
export const ENQUIRY_EVENT = "LEAD_GENERAL_INQUIRY";
/** Categories whose QUOTE services route to the durable request-only enquiry surface. Explicit set, never blanket authority. */
export const ENQUIRY_CATEGORY_KEYS = ["professional", "technical"] as const;
export function usesServiceEnquiries(categoryKey: string | null | undefined): boolean {
  return (ENQUIRY_CATEGORY_KEYS as readonly string[]).includes(categoryKey ?? "");
}
export type EnquiryInput = {
  slug: string; serviceId: string; customerName: string; customerPhone: string;
  customerEmail: string | null; notes: string; idempotencyKey: string;
};
export type EnquiryRecord = LeadRecord & {
  version: 1; serviceName: string; status: "RECEIVED"; requestHash: string;
};
export type OwnerEnquiry = Pick<EnquiryRecord, "id" | "serviceName" | "customerName" | "customerPhone" | "customerEmail" | "summary" | "createdAt" | "status" | "referenceId">;

/** Exact bounded customer fields only; no tenant, price, deposit, status, date or capability authority. */
export function validateEnquiryInput(raw: unknown): { kind: "ok"; input: EnquiryInput } | { kind: "error"; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { kind: "error", error: "We couldn't read that request." };
  const data = raw as Record<string, unknown>;
  if (Object.keys(data).some((key) => !["slug", "serviceId", "customerName", "customerPhone", "customerEmail", "notes", "idempotencyKey"].includes(key))) {
    return { kind: "error", error: "Only service and contact details may be supplied for an enquiry." };
  }
  for (const [key, max] of Object.entries({ slug: 60, serviceId: 128, customerName: 80, customerPhone: 30, customerEmail: 160, notes: 1000, idempotencyKey: 80 })) {
    if (data[key] !== undefined && data[key] !== null && (typeof data[key] !== "string" || String(data[key]).length > max)) return { kind: "error", error: "Keep your service and contact details within the form limits." };
  }
  const slug = typeof data.slug === "string" ? data.slug.trim() : "";
  const serviceId = typeof data.serviceId === "string" ? data.serviceId.trim() : "";
  const customerName = sanitizeText(typeof data.customerName === "string" ? data.customerName : "", 80).trim();
  const customerPhone = typeof data.customerPhone === "string" ? data.customerPhone.trim() : "";
  const customerEmail = typeof data.customerEmail === "string" ? data.customerEmail.trim() : "";
  const idempotencyKey = typeof data.idempotencyKey === "string" ? data.idempotencyKey : "";
  if (!/^[a-z0-9][a-z0-9-]{1,59}$/.test(slug) || !/^[a-zA-Z0-9_-]{1,128}$/.test(serviceId)) return { kind: "error", error: "Choose a service from this business." };
  if (customerName.length < 2) return { kind: "error", error: "Enter your name so the business knows who to contact." };
  if (!/^[+0-9()\s-]{9,30}$/.test(customerPhone) || customerPhone.replace(/\D/g, "").length < 9) return { kind: "error", error: "Enter a valid phone number." };
  if (customerEmail && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(customerEmail)) return { kind: "error", error: "Enter a valid email address or leave it blank." };
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(idempotencyKey)) return { kind: "error", error: "Reload the form before sending your request." };
  return { kind: "ok", input: { slug, serviceId, customerName, customerPhone, customerEmail: customerEmail || null,
    notes: sanitizeText(typeof data.notes === "string" ? data.notes : "", 1000).trim(), idempotencyKey } };
}
function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function readRecord(row: { id: string; businessId: string; eventType?: string | null; metadata?: string | null }): EnquiryRecord | null {
  try {
    const record = JSON.parse(row.metadata || "null") as EnquiryRecord;
    return record && record.version === 1 && record.id === row.id && record.businessId === row.businessId &&
      row.eventType === ENQUIRY_EVENT && record.channel === ENQUIRY_CHANNEL && record.status === "RECEIVED" &&
      record.transactionalOnly === true && typeof record.serviceName === "string" && typeof record.requestHash === "string" ? record : null;
  } catch { return null; }
}
export class EnquiryReplayConflict extends Error {}

export async function saveProfessionalEnquiry(params: { businessId: string; service: { id: string; title: string }; input: EnquiryInput }): Promise<{ record: EnquiryRecord; idempotent: boolean }> {
  const { businessId, service, input } = params;
  const id = `enquiry_${digest(`${businessId}:${input.idempotencyKey}`)}`;
  const { idempotencyKey: unused, ...fields } = input; void unused;
  const requestHash = digest(JSON.stringify(fields));
  const record: EnquiryRecord = {
    id, businessId, version: 1, classification: "GENERAL_INQUIRY", customerName: input.customerName,
    customerPhone: input.customerPhone, customerEmail: input.customerEmail,
    summary: input.notes || `Enquiry about ${service.title}`, conversationId: null, channel: ENQUIRY_CHANNEL,
    referenceId: service.id, serviceName: service.title, transactionalOnly: true, createdAt: new Date().toISOString(),
    status: "RECEIVED", requestHash,
  };
  try {
    const saved = await prisma.aIQualityEvent.create({ data: { id, businessId, sourceUsed: "structured_data", confidence: "high",
      escalatedToHuman: false, customerCorrectedAI: false, missingBusinessInfo: false, eventType: ENQUIRY_EVENT,
      metadata: JSON.stringify(record) }, select: { id: true } });
    if (saved.id !== id) throw new Error("Enquiry was not durably stored");
    return { record, idempotent: false };
  } catch (error) {
    if ((error as { code?: string })?.code !== "P2002") throw error;
    const row = await prisma.aIQualityEvent.findUnique({ where: { id }, select: { id: true, businessId: true, eventType: true, metadata: true } });
    const existing = row && row.businessId === businessId ? readRecord(row) : null;
    if (!existing || existing.requestHash !== requestHash) throw new EnquiryReplayConflict("The request changed; send it as a new enquiry.");
    return { record: existing, idempotent: true };
  }
}
export async function listProfessionalEnquiries(businessId: string): Promise<OwnerEnquiry[]> {
  const rows = await prisma.aIQualityEvent.findMany({ where: { businessId, eventType: ENQUIRY_EVENT }, orderBy: { timestamp: "desc" }, take: 100,
    select: { id: true, businessId: true, eventType: true, metadata: true } });
  return rows.flatMap((row) => {
    if (row.businessId !== businessId) return [];
    const record = readRecord(row); if (!record) return [];
    const { id, serviceName, customerName, customerPhone, customerEmail, summary, createdAt, status, referenceId } = record;
    return [{ id, serviceName, customerName, customerPhone, customerEmail, summary, createdAt, status, referenceId }];
  });
}
