/**
 * Durable call-event pipeline: idempotent ingest, tenant-safe routing, monotonic ordering,
 * cross-tenant rejection and recovery (§Voice deliverable 1).
 * In-memory store only — no database, no network, no provider.
 */
import { describe, expect, it } from "vitest";
import {
  ingestVoiceEvent,
  normalizeKenyaE164,
  parseTelnyxVoiceEvent,
  processVoiceEvent,
  recoverVoiceEvents,
  resolveTenantForCalledNumber,
  type VoiceEventStore,
  type InboundNumberRow,
} from "@/lib/voice";
import type { VoiceCallCommandRow, VoiceCallEventRow, VoiceCallRow } from "@/lib/voice";

function createMemoryStore(numbers: InboundNumberRow[] = []): VoiceEventStore & {
  events: Map<string, VoiceCallEventRow>;
  calls: Map<string, VoiceCallRow>;
} {
  const events = new Map<string, VoiceCallEventRow>();
  const calls = new Map<string, VoiceCallRow>();
  const commands = new Map<string, VoiceCallCommandRow>();
  let sequence = 0;
  return {
    events,
    calls,
    async insertEvent(row) {
      const existing = events.get(row.providerEventId);
      if (existing) return { duplicate: true, row: existing };
      const created: VoiceCallEventRow = {
        ...row,
        id: `evt_${++sequence}`,
        status: "RECEIVED",
        rejectReason: null,
        businessId: null,
        sequence: null,
        attempts: 0,
        receivedAt: new Date(),
        processedAt: null,
        lastError: null,
      };
      events.set(created.providerEventId, created);
      return { duplicate: false, row: created };
    },
    async updateEvent(id, patch) {
      for (const [key, row] of events) {
        if (row.id === id) events.set(key, { ...row, ...patch });
      }
    },
    async findActiveInboundNumbers() {
      return numbers.filter((n) => n.businessId);
    },
    async findCallByControlId(callControlId) {
      return calls.get(callControlId) ?? null;
    },
    async createCall(row) {
      const created: VoiceCallRow = {
        ...row,
        id: `call_${++sequence}`,
        direction: "inbound",
        language: "en",
        answeredAt: null,
        endedAt: null,
        hangupCause: null,
        failoverReason: null,
        handoffTarget: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      calls.set(row.callControlId, created);
      return created;
    },
    async updateCall(id, patch, options) {
      for (const [key, row] of calls) {
        if (row.id === id) {
          if (options?.expectedState && row.state !== options.expectedState) return false;
          calls.set(key, { ...row, ...patch, updatedAt: new Date() });
          return true;
        }
      }
      return false;
    },
    async findBusinessPolicy() {
      return null;
    },
    async countActiveCalls() {
      return 0;
    },
    async todaysSpendMinor() {
      return 0;
    },
    async hasActiveVoiceEntitlement() {
      return false;
    },
    async createUsageIfMissing() {
      throw new Error("not used");
    },
    async updateUsage() {},
    async findUsageByCallId() {
      return null;
    },
    async listUnprocessed(limit) {
      return [...events.values()].filter((e) => e.status === "RECEIVED" || e.status === "RETRY").slice(0, limit);
    },
    async findCommandByDedupeKey(dedupeKey) {
      return commands.get(dedupeKey) ?? null;
    },
    async createCommand(row) {
      const created: VoiceCallCommandRow = {
        ...row,
        id: `cmd_${++sequence}`,
        status: "PENDING",
        attempts: 0,
        responsePayload: null,
        lastError: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      commands.set(row.dedupeKey, created);
      return created;
    },
    async updateCommand(id, patch) {
      for (const [key, row] of commands) {
        if (row.id === id) commands.set(key, { ...row, ...patch, updatedAt: new Date() });
      }
    },
  };
}

function telnyxBody(overrides: {
  id?: string;
  event_type?: string;
  call_control_id?: string;
  to?: string;
  from?: string;
}): string {
  return JSON.stringify({
    data: {
      id: overrides.id ?? "evt_1",
      event_type: overrides.event_type ?? "call.initiated",
      payload: {
        call_control_id: overrides.call_control_id ?? "cc_1",
        call_session_id: "cs_1",
        to: overrides.to ?? "+254724317010",
        from: overrides.from ?? "+254711222333",
      },
    },
  });
}

describe("Kenyan number canonicalisation for DID routing", () => {
  it("normalises local, national and E.164 forms to the same value", () => {
    expect(normalizeKenyaE164("0724317010")).toBe("+254724317010");
    expect(normalizeKenyaE164("254724317010")).toBe("+254724317010");
    expect(normalizeKenyaE164("+254 724 317 010")).toBe("+254724317010");
    expect(normalizeKenyaE164("724317010")).toBe("+254724317010");
    expect(normalizeKenyaE164(null)).toBeNull();
    expect(normalizeKenyaE164("   ")).toBeNull();
  });
});

describe("Telnyx event parsing", () => {
  it("parses a v2 webhook into the provider-neutral shape", () => {
    const parsed = parseTelnyxVoiceEvent(telnyxBody({}));
    expect(parsed).toMatchObject({
      providerEventId: "evt_1",
      eventType: "call.initiated",
      callControlId: "cc_1",
      calledNumber: "+254724317010",
      callingNumber: "+254711222333",
    });
  });

  it("fails closed on garbage or missing identities", () => {
    expect(parseTelnyxVoiceEvent("not-json")).toBeNull();
    expect(parseTelnyxVoiceEvent(JSON.stringify({ data: {} }))).toBeNull();
    expect(parseTelnyxVoiceEvent(JSON.stringify({ data: { id: "x" } }))).toBeNull();
  });
});

describe("durable ingest and tenant-safe processing", () => {
  it("persists each provider event exactly once (idempotent duplicates)", async () => {
    const store = createMemoryStore([{ e164: "+254724317010", businessId: "biz_a" }]);
    const body = telnyxBody({});
    const first = await ingestVoiceEvent(store, body);
    const second = await ingestVoiceEvent(store, body);
    expect(first.stored && !first.duplicate).toBe(true);
    expect(second).toMatchObject({ stored: true, duplicate: true });
    expect(store.events.size).toBe(1);
  });

  it("rejects unparseable payloads without creating rows", async () => {
    const store = createMemoryStore();
    const result = await ingestVoiceEvent(store, "<<<");
    expect(result).toEqual({ stored: false, reason: "UNPARSEABLE" });
    expect(store.events.size).toBe(0);
  });

  it("routes the called Telnyx number to the owning business in any KE format", async () => {
    const store = createMemoryStore([{ e164: "0724317010", businessId: "biz_a" }]);
    const resolved = await resolveTenantForCalledNumber(store, "+254 724 317 010");
    expect(resolved?.businessId).toBe("biz_a");
  });

  it("refuses an ambiguous canonical match that spans two tenants", async () => {
    // Two active rows, different formats of the same number, different businesses: the
    // unique index cannot see this, so routing must refuse rather than pick one.
    const store = createMemoryStore([
      { e164: "0724317010", businessId: "biz_a" },
      { e164: "+254724317010", businessId: "biz_b" },
    ]);
    const resolved = await resolveTenantForCalledNumber(store, "+254 724 317 010");
    expect(resolved).toBeNull();
    const ingested = await ingestVoiceEvent(store, telnyxBody({ to: "+254724317010" }));
    if (!ingested.stored) throw new Error("expected stored");
    const outcome = await processVoiceEvent(store, ingested.row);
    expect(outcome.status).toBe("REJECTED");
    expect(outcome.rejectReason).toBe("UNKNOWN_NUMBER");
    expect(store.calls.size).toBe(0);
  });

  it("rejects unknown numbers — never processes an unroutable call", async () => {
    const store = createMemoryStore([{ e164: "+254724317010", businessId: "biz_a" }]);
    const ingested = await ingestVoiceEvent(store, telnyxBody({ to: "+254700000000" }));
    if (!ingested.stored) throw new Error("expected stored");
    const outcome = await processVoiceEvent(store, ingested.row);
    expect(outcome.status).toBe("REJECTED");
    expect(outcome.rejectReason).toBe("UNKNOWN_NUMBER");
    expect(store.calls.size).toBe(0);
    expect(store.events.get(ingested.row.providerEventId)?.status).toBe("REJECTED");
  });

  it("binds a call to its first tenant and rejects cross-tenant claims afterwards", async () => {
    const store = createMemoryStore([
      { e164: "+254724317010", businessId: "biz_a" },
      { e164: "+254724317011", businessId: "biz_b" },
    ]);
    const first = await ingestVoiceEvent(store, telnyxBody({ id: "e1", call_control_id: "cc_x", to: "+254724317010" }));
    if (!first.stored) throw new Error("expected stored");
    await processVoiceEvent(store, first.row);
    expect(store.calls.get("cc_x")?.businessId).toBe("biz_a");

    // A later event for the same call claiming another tenant's DID is rejected.
    const spoofed = await ingestVoiceEvent(
      store,
      telnyxBody({ id: "e2", event_type: "call.answered", call_control_id: "cc_x", to: "+254724317011" }),
    );
    if (!spoofed.stored) throw new Error("expected stored");
    const outcome = await processVoiceEvent(store, spoofed.row);
    expect(outcome.status).toBe("REJECTED");
    expect(outcome.rejectReason).toBe("CROSS_TENANT");
    expect(store.calls.get("cc_x")?.state).toBe("INITIATED");
  });

  it("applies monotonic transitions: out-of-order events cannot regress a call", async () => {
    const store = createMemoryStore([{ e164: "+254724317010", businessId: "biz_a" }]);
    const hangup = await ingestVoiceEvent(store, telnyxBody({ id: "h1", event_type: "call.hangup", call_control_id: "cc_o" }));
    if (!hangup.stored) throw new Error("expected stored");
    await processVoiceEvent(store, hangup.row);
    expect(store.calls.get("cc_o")?.state).toBe("COMPLETED");

    const lateInitiated = await ingestVoiceEvent(store, telnyxBody({ id: "i1", event_type: "call.initiated", call_control_id: "cc_o" }));
    if (!lateInitiated.stored) throw new Error("expected stored");
    const outcome = await processVoiceEvent(store, lateInitiated.row);
    expect(outcome.status).toBe("PROCESSED"); // acknowledged…
    expect(store.calls.get("cc_o")?.state).toBe("COMPLETED"); // …but the terminal state stands
    expect(outcome.transition).toBe("TERMINAL");
  });

  it("records answeredAt exactly once on replayed call.answered events", async () => {
    const store = createMemoryStore([{ e164: "+254724317010", businessId: "biz_a" }]);
    const answered = await ingestVoiceEvent(store, telnyxBody({ id: "a1", event_type: "call.answered", call_control_id: "cc_a" }));
    if (!answered.stored) throw new Error("expected stored");
    await processVoiceEvent(store, answered.row);
    const firstAnsweredAt = store.calls.get("cc_a")?.answeredAt;
    expect(firstAnsweredAt).toBeInstanceOf(Date);

    const replay = await ingestVoiceEvent(store, telnyxBody({ id: "a1", event_type: "call.answered", call_control_id: "cc_a" }));
    expect(replay).toMatchObject({ duplicate: true });
    if (!replay.stored) throw new Error("expected stored");
    await processVoiceEvent(store, replay.row);
    expect(store.calls.get("cc_a")?.answeredAt?.getTime()).toBe(firstAnsweredAt?.getTime());
  });

  it("loses the optimistic write gracefully when a concurrent transition wins the race", async () => {
    const store = createMemoryStore([{ e164: "+254724317010", businessId: "biz_a" }]);
    const initiated = await ingestVoiceEvent(store, telnyxBody({ id: "c1", call_control_id: "cc_race" }));
    if (!initiated.stored) throw new Error("expected stored");
    await processVoiceEvent(store, initiated.row);
    expect(store.calls.get("cc_race")?.state).toBe("INITIATED");

    // Simulate a hangup landing between this event's read and its write.
    let raced = false;
    const baseUpdate = store.updateCall.bind(store);
    store.updateCall = async (id, patch, options) => {
      if (!raced && patch.state === "ANSWERED") {
        raced = true;
        await baseUpdate(id, { state: "COMPLETED", endedAt: new Date(), hangupCause: "call.hangup" });
      }
      return baseUpdate(id, patch, options);
    };

    const answered = await ingestVoiceEvent(store, telnyxBody({ id: "c2", event_type: "call.answered", call_control_id: "cc_race" }));
    if (!answered.stored) throw new Error("expected stored");
    const outcome = await processVoiceEvent(store, answered.row);
    expect(raced).toBe(true);
    // The stale ANSWERED write must never overwrite the terminal state; the event still
    // settles as processed (idempotent, recoverable) with the terminal transition outcome.
    expect(store.calls.get("cc_race")?.state).toBe("COMPLETED");
    expect(store.calls.get("cc_race")?.answeredAt).toBeNull();
    expect(outcome.status).toBe("PROCESSED");
    expect(outcome.transition).toBe("TERMINAL");
  });

  it("recovers RETRY events oldest-first without double side effects", async () => {
    const store = createMemoryStore([{ e164: "+254724317010", businessId: "biz_a" }]);
    const ingested = await ingestVoiceEvent(store, telnyxBody({ id: "r1", call_control_id: "cc_r" }));
    if (!ingested.stored) throw new Error("expected stored");
    // Simulate a crashed processor: persisted but marked RETRY.
    await store.updateEvent(ingested.row.id, { status: "RETRY", lastError: "boom" });
    const summary = await recoverVoiceEvents(store);
    expect(summary).toEqual({ processed: 1, failed: 0 });
    expect(store.calls.get("cc_r")?.businessId).toBe("biz_a");
    const again = await recoverVoiceEvents(store);
    expect(again).toEqual({ processed: 0, failed: 0 });
  });
});
