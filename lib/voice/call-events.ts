/**
 * Durable call-event ingestion, tenant-safe routing and ordered processing (§Voice deliverable 1).
 *
 * Guarantees:
 * - Every provider event is persisted exactly once (providerEventId is unique; replays return
 *   the stored row and never double-process).
 * - Called Telnyx numbers resolve to exactly one active JATA business; unknown numbers are
 *   rejected and never processed; a call is permanently bound to its first resolved tenant and
 *   any event claiming a different tenant is rejected as CROSS_TENANT.
 * - Processing is idempotent and monotonic (see call-state.ts); failures leave the event in
 *   RETRY with the error recorded so `recoverVoiceEvents` (or the provider's own retry) can
 *   re-run it without side effects.
 *
 * All database access flows through the `VoiceEventStore` interface so unit tests run against
 * an in-memory fake and never touch a database.
 */
import prisma from "@/lib/db";
import { callStateForEventType, transitionCallState } from "./call-state";
import {
  normalizeKenyaE164,
  type CallEventStatus,
  type CallRejectReason,
  type ParsedVoiceEvent,
  type VoiceCallCommandRow,
  type VoiceCallEventRow,
  type VoiceCallRow,
} from "./types";

export type InboundNumberRow = { e164: string; businessId: string };

export type VoiceEventStore = {
  insertEvent(
    row: Pick<VoiceCallEventRow, "providerEventId" | "eventType" | "callControlId" | "callSessionId" | "calledNumber" | "callingNumber" | "payload">,
  ): Promise<{ duplicate: boolean; row: VoiceCallEventRow }>;
  updateEvent(
    id: string,
    patch: Partial<Pick<VoiceCallEventRow, "status" | "rejectReason" | "businessId" | "attempts" | "processedAt" | "lastError">>,
  ): Promise<void>;
  findActiveInboundNumbers(): Promise<InboundNumberRow[]>;
  findCallByControlId(callControlId: string): Promise<VoiceCallRow | null>;
  createCall(row: {
    callControlId: string;
    callSessionId: string | null;
    businessId: string;
    callerNumber: string;
    calledNumber: string;
    state: string;
  }): Promise<VoiceCallRow>;
  updateCall(
    id: string,
    patch: Partial<Pick<VoiceCallRow, "state" | "language" | "answeredAt" | "endedAt" | "hangupCause" | "failoverReason" | "handoffTarget" | "callSessionId">>,
  ): Promise<void>;
  listUnprocessed(limit: number): Promise<VoiceCallEventRow[]>;
  findCommandByDedupeKey(dedupeKey: string): Promise<VoiceCallCommandRow | null>;
  createCommand(row: {
    callControlId: string;
    command: string;
    dedupeKey: string;
    requestPayload: string | null;
  }): Promise<VoiceCallCommandRow>;
  updateCommand(
    id: string,
    patch: Partial<Pick<VoiceCallCommandRow, "status" | "attempts" | "lastError" | "responsePayload">>,
  ): Promise<void>;
};

/** Prisma-backed store used by the webhook route and workers. */
export function createPrismaVoiceEventStore(): VoiceEventStore {
  const db = prisma as any;
  return {
    async insertEvent(row) {
      try {
        const created = await db.voiceCallEvent.create({ data: { ...row, status: "RECEIVED", attempts: 0 } });
        return { duplicate: false, row: created as VoiceCallEventRow };
      } catch (error: any) {
        if (isUniqueViolation(error)) {
          const existing = await db.voiceCallEvent.findUnique({ where: { providerEventId: row.providerEventId } });
          if (existing) return { duplicate: true, row: existing as VoiceCallEventRow };
        }
        throw error;
      }
    },
    async updateEvent(id, patch) {
      await db.voiceCallEvent.update({ where: { id }, data: patch });
    },
    async findActiveInboundNumbers() {
      return (await db.voiceInboundNumber.findMany({ where: { isActive: true }, select: { e164: true, businessId: true } })) as InboundNumberRow[];
    },
    async findCallByControlId(callControlId) {
      return (await db.voiceCall.findUnique({ where: { callControlId } })) as VoiceCallRow | null;
    },
    async createCall(row) {
      try {
        return (await db.voiceCall.create({ data: row })) as VoiceCallRow;
      } catch (error: any) {
        if (isUniqueViolation(error)) {
          const existing = await db.voiceCall.findUnique({ where: { callControlId: row.callControlId } });
          if (existing) return existing as VoiceCallRow;
        }
        throw error;
      }
    },
    async updateCall(id, patch) {
      await db.voiceCall.update({ where: { id }, data: patch });
    },
    async listUnprocessed(limit) {
      return (await db.voiceCallEvent.findMany({
        where: { status: { in: ["RECEIVED", "RETRY"] } },
        orderBy: { receivedAt: "asc" },
        take: limit,
      })) as VoiceCallEventRow[];
    },
    async findCommandByDedupeKey(dedupeKey) {
      return (await db.voiceCallCommand.findUnique({ where: { dedupeKey } })) as VoiceCallCommandRow | null;
    },
    async createCommand(row) {
      try {
        return (await db.voiceCallCommand.create({ data: row })) as VoiceCallCommandRow;
      } catch (error: any) {
        if (isUniqueViolation(error)) {
          const existing = await db.voiceCallCommand.findUnique({ where: { dedupeKey: row.dedupeKey } });
          if (existing) return existing as VoiceCallCommandRow;
        }
        throw error;
      }
    },
    async updateCommand(id, patch) {
      await db.voiceCallCommand.update({ where: { id }, data: patch });
    },
  };
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "P2002" || (error instanceof Error && /unique/i.test(error.message));
}

/** Parse a raw Telnyx webhook body into the provider-neutral event shape. Fail-closed. */
export function parseTelnyxVoiceEvent(rawBody: string): ParsedVoiceEvent | null {
  let parsed: any;
  try {
    parsed = JSON.parse(rawBody);
  } catch {
    return null;
  }
  const data = parsed?.data;
  const payload = data?.payload ?? {};
  const providerEventId = typeof data?.id === "string" && data.id ? data.id : null;
  const eventType = typeof data?.event_type === "string" && data.event_type ? data.event_type : null;
  if (!providerEventId || !eventType) return null;
  return {
    providerEventId,
    eventType,
    callControlId: typeof payload.call_control_id === "string" ? payload.call_control_id : null,
    callSessionId: typeof payload.call_session_id === "string" ? payload.call_session_id : null,
    calledNumber: typeof payload.to === "string" ? payload.to : null,
    callingNumber: typeof payload.from === "string" ? payload.from : null,
    sequence: Number.isFinite(payload.sequence_number) ? Number(payload.sequence_number) : null,
    payload: rawBody,
  };
}

export type IngestResult =
  | { stored: true; duplicate: false; row: VoiceCallEventRow }
  | { stored: true; duplicate: true; row: VoiceCallEventRow }
  | { stored: false; reason: "UNPARSEABLE" };

/** Persist exactly once. A duplicate provider event id returns the stored row. */
export async function ingestVoiceEvent(store: VoiceEventStore, rawBody: string): Promise<IngestResult> {
  const event = parseTelnyxVoiceEvent(rawBody);
  if (!event) return { stored: false, reason: "UNPARSEABLE" };
  const { row, duplicate } = await store.insertEvent(event);
  return { stored: true, duplicate, row };
}

export async function resolveTenantForCalledNumber(
  store: VoiceEventStore,
  calledNumber: string | null,
): Promise<InboundNumberRow | null> {
  const canonical = normalizeKenyaE164(calledNumber);
  if (!canonical) return null;
  const rows = await store.findActiveInboundNumbers();
  return rows.find((row) => normalizeKenyaE164(row.e164) === canonical) ?? null;
}

export type ProcessOutcome = {
  status: CallEventStatus;
  rejectReason: CallRejectReason | null;
  call: VoiceCallRow | null;
  transition: string | null;
  error: string | null;
};

/**
 * Route + apply a stored event. Idempotent: re-running a PROCESSED event is a no-op,
 * out-of-order regressions are ignored, and cross-tenant claims are rejected.
 */
export async function processVoiceEvent(store: VoiceEventStore, event: VoiceCallEventRow): Promise<ProcessOutcome> {
  const reject = async (reason: CallRejectReason): Promise<ProcessOutcome> => {
    await store.updateEvent(event.id, {
      status: "REJECTED",
      rejectReason: reason,
      attempts: event.attempts + 1,
      processedAt: new Date(),
    });
    return { status: "REJECTED", rejectReason: reason, call: null, transition: null, error: null };
  };

  if (event.status === "PROCESSED") {
    const call = event.callControlId ? await store.findCallByControlId(event.callControlId) : null;
    return { status: "PROCESSED", rejectReason: null, call, transition: null, error: null };
  }

  if (!event.callControlId) return reject("UNROUTABLE");

  const routed = await resolveTenantForCalledNumber(store, event.calledNumber);
  if (!routed) return reject("UNKNOWN_NUMBER");

  let call = await store.findCallByControlId(event.callControlId);
  if (call && call.businessId !== routed.businessId) return reject("CROSS_TENANT");

  if (!call) {
    // Always create at INITIATED and let the monotonic transition below apply the real
    // target state: that way answeredAt/endedAt/hangupCause are stamped by the same code
    // path for every event order (a call whose first seen event is call.answered still
    // gets its answeredAt exactly once).
    call = await store.createCall({
      callControlId: event.callControlId,
      callSessionId: event.callSessionId,
      businessId: routed.businessId,
      callerNumber: event.callingNumber ?? "unknown",
      calledNumber: event.calledNumber ?? routed.e164,
      state: "INITIATED",
    });
  }

  const target = callStateForEventType(event.eventType);
  let transition: string | null = null;
  if (target) {
    const result = transitionCallState(call.state, target);
    transition = result.reason;
    if (result.applied) {
      const patch: Record<string, unknown> = { state: result.next };
      if (result.next === "ANSWERED" && !call.answeredAt) patch.answeredAt = new Date();
      if (result.next === "COMPLETED" || result.next === "FAILED") {
        patch.endedAt = new Date();
        patch.hangupCause = event.eventType;
      }
      await store.updateCall(call.id, patch as any);
    }
  }

  await store.updateEvent(event.id, {
    status: "PROCESSED",
    businessId: routed.businessId,
    attempts: event.attempts + 1,
    processedAt: new Date(),
  });

  return { status: "PROCESSED", rejectReason: null, call, transition, error: null };
}

/**
 * Ingest + process in one step. Throws only when persistence fails — callers map that to a
 * retryable webhook response so the provider redelivers (safe: ingest is idempotent).
 */
export async function ingestAndProcessVoiceEvent(store: VoiceEventStore, rawBody: string): Promise<IngestResult & { outcome?: ProcessOutcome }> {
  const ingested = await ingestVoiceEvent(store, rawBody);
  if (!ingested.stored) return ingested;
  const outcome = await processVoiceEvent(store, ingested.row);
  return { ...ingested, outcome };
}

/** Recoverability: re-run RECEIVED/RETRY events oldest-first (provider retry or internal sweep). */
export async function recoverVoiceEvents(store: VoiceEventStore, limit = 25): Promise<{ processed: number; failed: number }> {
  const pending = await store.listUnprocessed(limit);
  let processed = 0;
  let failed = 0;
  for (const event of pending) {
    try {
      const outcome = await processVoiceEvent(store, event);
      if (outcome.status === "PROCESSED" || outcome.status === "REJECTED") processed += 1;
    } catch (error) {
      failed += 1;
      await store
        .updateEvent(event.id, {
          status: "RETRY",
          attempts: event.attempts + 1,
          lastError: error instanceof Error ? error.message.slice(0, 500) : "processing failed",
        })
        .catch(() => undefined);
    }
  }
  return { processed, failed };
}

/** Mark a processed-but-failed attempt for provider-driven retry. */
export async function markEventForRetry(store: VoiceEventStore, event: VoiceCallEventRow, error: unknown): Promise<void> {
  await store.updateEvent(event.id, {
    status: "RETRY",
    attempts: event.attempts + 1,
    lastError: error instanceof Error ? error.message.slice(0, 500) : "processing failed",
  });
}
