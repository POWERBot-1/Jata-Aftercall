import { createHmac, timingSafeEqual } from "node:crypto";
import prisma from "@/lib/db";
import type { Prisma } from "@prisma/client";

/** Minimal, non-authoritative envelope. Never place credentials or unnecessary PII in an event. */
export type JataAutomationEvent = {
  id: string;
  type: string;
  occurredAt: string;
  tenantId: string;
  source: string;
  data: Record<string, unknown>;
};

const EVENT_TYPE = /^[a-z][a-z0-9_.-]{1,95}$/;
const ID = /^[A-Za-z0-9_-]{8,128}$/;
const PRODUCTS = new Set(["business_page", "ai_front_desk", "website_studio", "business_pos", "bos", "mjengo_os", "autopilot", "tapnet"]);

export function validateAutomationEvent(input: unknown): input is JataAutomationEvent {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const e = input as Record<string, unknown>;
  if (typeof e.id !== "string" || !ID.test(e.id) || typeof e.type !== "string" || !EVENT_TYPE.test(e.type)) return false;
  if (typeof e.tenantId !== "string" || !ID.test(e.tenantId) || typeof e.source !== "string" || !PRODUCTS.has(e.source)) return false;
  if (typeof e.occurredAt !== "string" || !Number.isFinite(Date.parse(e.occurredAt))) return false;
  return !!e.data && typeof e.data === "object" && !Array.isArray(e.data);
}

export function signAutomationPayload(rawBody: string, secret: string): string {
  if (secret.length < 32) throw new Error("AUTOMATION_SECRET_INVALID");
  return `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
}

export function verifyAutomationSignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature || secret.length < 32 || !/^sha256=[a-f0-9]{64}$/.test(signature)) return false;
  const expected = signAutomationPayload(rawBody, secret);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

/** Insert into the caller's transaction so domain state and its event commit or roll back together. */
export async function enqueueAutomationEvent(tx: Prisma.TransactionClient, event: JataAutomationEvent): Promise<void> {
  if (!validateAutomationEvent(event)) throw new Error("AUTOMATION_EVENT_INVALID");
  await tx.automationEvent.create({ data: {
    eventId: event.id, tenantId: event.tenantId, product: event.source, eventType: event.type,
    direction: "OUTBOUND", status: "PENDING", payload: event as never,
  } });
}

/** For events whose producer is not yet migrated to an enclosing transaction. */
export async function publishAutomationEvent(event: JataAutomationEvent): Promise<boolean> {
  if (!validateAutomationEvent(event)) return false;
  try {
    await prisma.automationEvent.create({ data: {
      eventId: event.id, tenantId: event.tenantId, product: event.source, eventType: event.type,
      direction: "OUTBOUND", status: "PENDING", payload: event as never,
    } });
    return true;
  } catch (error) {
    // An event ID may only be enqueued once; duplicate is already safely represented.
    if ((error as { code?: string })?.code === "P2002") return true;
    return false;
  }
}
