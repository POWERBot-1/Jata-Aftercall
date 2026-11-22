/**
 * Customer enquiries (Smart Customer Hub, feature B).
 *
 * The general "ask the business something" counterpart to an order request: no product lines,
 * no basket, no price. Owners work both kinds of enquiry in the same hub, with the same status
 * discipline, notes and history.
 */

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../db";
import { enqueueAutomationEvent } from "@/lib/automation/events";
import {
  ActionResult,
  HUB_SUBJECTS,
  ValidationResult,
  cleanOptionalText,
  cleanSearch,
  cleanText,
  createReference,
  listHubActivity,
  normaliseContactMethod,
  recordHubActivity,
  validateContact,
} from "./shared";

export const ENQUIRY_STATUSES = ["NEW", "REVIEWING", "CONTACTED", "CLOSED", "DECLINED"] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

export const ENQUIRY_STATUS_LABELS: Record<EnquiryStatus, string> = {
  NEW: "New",
  REVIEWING: "Reviewing",
  CONTACTED: "Contacted",
  CLOSED: "Closed",
  DECLINED: "Declined",
};

/** CLOSED is final; everything else can move freely so an owner can pick a thread back up. */
const ALLOWED_TRANSITIONS: Record<EnquiryStatus, EnquiryStatus[]> = {
  NEW: ["REVIEWING", "CONTACTED", "CLOSED", "DECLINED"],
  REVIEWING: ["CONTACTED", "CLOSED", "DECLINED", "NEW"],
  CONTACTED: ["CLOSED", "REVIEWING", "DECLINED"],
  DECLINED: ["REVIEWING", "CLOSED"],
  CLOSED: [],
};

export function isEnquiryStatus(value: unknown): value is EnquiryStatus {
  return typeof value === "string" && (ENQUIRY_STATUSES as readonly string[]).includes(value);
}

export function isValidEnquiryTransition(from: string, to: string): boolean {
  if (!isEnquiryStatus(from) || !isEnquiryStatus(to)) return false;
  if (from === to) return true;
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type ValidatedEnquiry = {
  requestKey: string;
  customerName: string;
  contactMethod: string;
  contactValue: string;
  subject: string | null;
  message: string;
};

export function validateEnquiryInput(raw: unknown): ValidationResult<ValidatedEnquiry> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const customerName = cleanText(body.customerName, 80);
  if (customerName.length < 2) return { ok: false, error: "Enter your name so the business knows who to reply to." };

  const contactMethod = normaliseContactMethod(body.contactMethod);
  if (!contactMethod) return { ok: false, error: "Choose how the business should reach you." };
  const contact = validateContact(contactMethod, body.contactValue);
  if (!contact.ok) return { ok: false, error: contact.error };

  const message = cleanText(body.message, 1000);
  if (message.length < 2) return { ok: false, error: "Tell the business what you need." };

  return {
    ok: true,
    value: {
      requestKey: cleanText(body.requestKey, 64) || createReference("JATA-KEY"),
      customerName,
      contactMethod,
      contactValue: contact.value,
      subject: cleanOptionalText(body.subject, 120),
      message,
    },
  };
}

export function enquiryAutomationEventId(businessId: string, requestKey: string): string {
  const digest = createHash("sha256").update(`${businessId}:${requestKey}`).digest("hex");
  return `enquiry_created_${digest}`;
}

function prismaErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

export async function createEnquiry(params: {
  businessId: string;
  input: ValidatedEnquiry;
  ipHash?: string | null;
  sessionHash?: string | null;
  source?: string;
}): Promise<{ idempotent: boolean; record: any }> {
  const where = { businessId: params.businessId, requestKey: params.input.requestKey };
  let outcome: { idempotent: boolean; record: any };
  try {
    outcome = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Reconfirm the tenant inside the write transaction. The public route resolves a published
      // business from the requested slug; this persisted row is the authoritative tenant identity.
      const business = await tx.business.findUnique({ where: { id: params.businessId }, select: { id: true } });
      if (!business) throw new Error("ENQUIRY_BUSINESS_NOT_FOUND");

      const existing = await tx.customerEnquiry.findFirst({ where });
      if (existing) return { idempotent: true, record: existing };

      const reference = createReference("JATA-ENQ");
      const record = await tx.customerEnquiry.create({
        data: {
          businessId: business.id,
          reference,
          requestKey: params.input.requestKey,
          customerName: params.input.customerName,
          contactMethod: params.input.contactMethod,
          contactValue: params.input.contactValue,
          subject: params.input.subject,
          message: params.input.message,
          status: "NEW",
          source: cleanText(params.source, 40) || "BUSINESS_PAGE",
          ipHash: params.ipHash ?? null,
          sessionHash: params.sessionHash ?? null,
        },
      });
      // Never trust a caller-supplied tenant field in the event: derive it from the created row,
      // whose FK was written against the business fetched within this same transaction.
      if (record.businessId !== business.id) throw new Error("ENQUIRY_TENANT_MISMATCH");
      await enqueueAutomationEvent(tx, {
        id: enquiryAutomationEventId(record.businessId, record.requestKey),
        type: "enquiry.created",
        occurredAt: record.createdAt.toISOString(),
        tenantId: record.businessId,
        source: "business_page",
        data: { businessId: record.businessId, enquiryId: record.id, reference: record.reference },
      });
      return { idempotent: false, record };
    });
  } catch (error) {
    // Two concurrent submissions with the same business/request key may both observe no row;
    // the unique key chooses one winner. Return that persisted winner only after its transaction
    // (including its outbox event) committed. Other unique-key failures still propagate.
    if (prismaErrorCode(error) === "P2002") {
      const existing = await prisma.customerEnquiry.findFirst({ where });
      if (existing) return { idempotent: true, record: existing };
    }
    throw error;
  }

  if (!outcome.idempotent) {
    const record = outcome.record;
    await recordHubActivity(prisma, {
      businessId: record.businessId,
      subjectType: HUB_SUBJECTS.CUSTOMER_ENQUIRY,
      subjectId: record.id,
      kind: "CREATED",
      summary: `Enquiry ${record.reference} from ${params.input.customerName}`,
      toStatus: "NEW",
      note: params.input.subject ? `${params.input.subject}: ${params.input.message}` : params.input.message,
    });
  }
  return outcome;
}

export async function listEnquiries(
  businessId: string,
  options: { status?: string | null; search?: string | null; take?: number } = {},
): Promise<any[]> {
  const where: Record<string, unknown> = { businessId };
  if (options.status && isEnquiryStatus(options.status)) where.status = options.status;
  const search = cleanSearch(options.search);
  if (search) {
    where.OR = [
      { reference: { contains: search } },
      { customerName: { contains: search } },
      { contactValue: { contains: search } },
      { message: { contains: search } },
      { subject: { contains: search } },
    ];
  }
  return prisma.customerEnquiry.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(500, Math.max(1, options.take ?? 200)),
  });
}

export async function getEnquiry(businessId: string, id: string): Promise<any | null> {
  if (!businessId || !id) return null;
  return prisma.customerEnquiry.findFirst({ where: { id, businessId } }).catch(() => null);
}

export async function updateEnquiryStatus(params: {
  businessId: string;
  id: string;
  status: string;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<ActionResult<any>> {
  if (!isEnquiryStatus(params.status)) return { ok: false, status: 400, error: "Choose one of the available enquiry statuses." };
  const record = await getEnquiry(params.businessId, params.id);
  if (!record) return { ok: false, status: 404, error: "That enquiry is not in your customer hub." };
  if (!isValidEnquiryTransition(record.status, params.status)) {
    return { ok: false, status: 409, error: `A ${record.status.toLowerCase()} enquiry cannot move to ${params.status.toLowerCase()}.` };
  }
  const updated = await prisma.customerEnquiry.update({
    where: { id: record.id },
    data: { status: params.status, statusChangedAt: new Date() },
  });
  if (updated.status !== record.status) {
    await recordHubActivity(prisma, {
      businessId: params.businessId,
      subjectType: HUB_SUBJECTS.CUSTOMER_ENQUIRY,
      subjectId: record.id,
      kind: "STATUS_CHANGED",
      summary: `${record.reference} moved from ${record.status} to ${params.status}`,
      fromStatus: record.status,
      toStatus: params.status,
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel ?? null,
    });
  }
  return { ok: true, record: updated };
}

export async function setEnquiryNotes(params: {
  businessId: string;
  id: string;
  notes: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<ActionResult<any>> {
  const record = await getEnquiry(params.businessId, params.id);
  if (!record) return { ok: false, status: 404, error: "That enquiry is not in your customer hub." };
  const notes = cleanOptionalText(params.notes, 2000);
  const updated = await prisma.customerEnquiry.update({ where: { id: record.id }, data: { ownerNotes: notes } });
  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.CUSTOMER_ENQUIRY,
    subjectId: record.id,
    kind: notes ? "NOTE_ADDED" : "NOTE_CLEARED",
    summary: notes ? `Note added to ${record.reference}` : `Note cleared on ${record.reference}`,
    note: notes,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });
  return { ok: true, record: updated };
}

export async function enquiryHistory(businessId: string, id: string, take = 30) {
  return listHubActivity(prisma, businessId, { subjectType: HUB_SUBJECTS.CUSTOMER_ENQUIRY, subjectId: id, take });
}
