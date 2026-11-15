import { createHmac, timingSafeEqual } from "node:crypto";

/** Minimal, non-authoritative envelope. n8n receives identifiers and event metadata, never DB credentials. */
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

export function validateAutomationEvent(input: unknown): input is JataAutomationEvent {
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const e = input as Record<string, unknown>;
  if (typeof e.id !== "string" || !ID.test(e.id) || typeof e.type !== "string" || !EVENT_TYPE.test(e.type)) return false;
  if (typeof e.tenantId !== "string" || !ID.test(e.tenantId) || typeof e.source !== "string" || e.source.length > 64) return false;
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

/** Best-effort event delivery. The source application's completed transaction is never coupled to n8n availability. */
export async function publishAutomationEvent(event: JataAutomationEvent): Promise<boolean> {
  const url = process.env.JATA_N8N_EVENTS_URL;
  const secret = process.env.JATA_AUTOMATION_HMAC_SECRET;
  if (!url || !secret || !validateAutomationEvent(event)) return false;
  let target: URL;
  try { target = new URL(url); } catch { return false; }
  if (target.protocol !== "https:" && process.env.NODE_ENV === "production") return false;
  const body = JSON.stringify(event);
  try {
    const response = await fetch(target, { method: "POST", headers: { "content-type": "application/json", "x-jata-signature": signAutomationPayload(body, secret), "x-jata-event-id": event.id }, body, signal: AbortSignal.timeout(4000) });
    return response.ok;
  } catch { return false; }
}
