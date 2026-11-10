/**
 * Call lifecycle gates, answer/refuse side effects and metering/reconciliation
 * (§Voice deliverables 5 & 6): kill switches, readiness gating, concurrency and spend
 * caps, exact usage rows, provider-cost validation and reconciliation reporting.
 */
import { describe, expect, it, vi } from "vitest";

// The NO_CLIENT branch can only be reached when no call-control client can be constructed;
// keep every other call-control behaviour real via importOriginal.
vi.mock("@/lib/telnyx/call-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/telnyx/call-control")>();
  return { ...actual, getCallControlClient: vi.fn(() => null) };
});

import { evaluateIncomingCall, handleIncomingCall } from "@/lib/voice/call-lifecycle";
import { applyProviderCost, billableDurationSeconds, finalizeUsageForCall, reconcileVoiceUsage, type VoiceUsageRow } from "@/lib/voice/metering";
import type { VoiceCallRow } from "@/lib/voice";
import type { TelnyxCallControlClient } from "@/lib/telnyx/call-control";
import type { VoiceEventStore } from "@/lib/voice/call-events";
import type { VoiceCallCommandRow } from "@/lib/voice";

/** A fully-configured environment: every readiness gate open (unit-test fixture only). */
const READY_ENV: Record<string, string | undefined> = {
  TELNYX_PUBLIC_KEY: "test-public-key",
  TELNYX_API_KEY: "tk_test",
  TELNYX_CONNECTION_ID: "conn_test",
  TELNYX_PHONE_NUMBER: "+254724317010",
  VOICE_MEDIA_STREAM_URL: "wss://voice.example/media",
  VOICE_MEDIA_STREAM_TOKEN: "lifecycle-secret",
  VOICE_AI_PROVIDER: "loopback",
  TELNYX_VOICE_LIVE_VERIFIED: "true",
  VOICE_CALLS_ENABLED: "true",
  VOICE_CUSTOMER_BILLING_ENABLED: "false",
};

function baseCall(overrides: Partial<VoiceCallRow> = {}): VoiceCallRow {
  return {
    id: "call_1",
    callControlId: "cc_1",
    callSessionId: null,
    businessId: "biz_1",
    direction: "inbound",
    callerNumber: "+254711222333",
    calledNumber: "+254724317010",
    state: "INITIATED",
    language: "en",
    failoverReason: null,
    handoffTarget: null,
    answeredAt: null,
    endedAt: null,
    hangupCause: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe("answer gates (deterministic ordering, fail-safe)", () => {
  it("allows a call when readiness, kill switch, policy and limits all pass", () => {
    expect(
      evaluateIncomingCall({ env: READY_ENV, policy: null, activeCalls: 0, todaysSpendMinor: 0 }),
    ).toEqual({ allow: true, reason: "OK" });
  });

  it("kill switch wins over everything", () => {
    expect(
      evaluateIncomingCall({ env: { ...READY_ENV, VOICE_KILL_SWITCH: "true" }, policy: null, activeCalls: 0, todaysSpendMinor: 0 }),
    ).toEqual({ allow: false, reason: "GLOBAL_KILL_SWITCH" });
  });

  it("per-business hard disable refuses after the kill switch, before readiness work", () => {
    expect(
      evaluateIncomingCall({
        env: READY_ENV,
        policy: { hardDisabled: true, concurrencyLimit: 5, dailySpendLimitMinor: null },
        activeCalls: 0,
        todaysSpendMinor: 0,
      }),
    ).toEqual({ allow: false, reason: "BUSINESS_DISABLED" });
    // …and the global kill switch still outranks it.
    expect(
      evaluateIncomingCall({
        env: { ...READY_ENV, VOICE_KILL_SWITCH: "true" },
        policy: { hardDisabled: true, concurrencyLimit: 5, dailySpendLimitMinor: null },
        activeCalls: 0,
        todaysSpendMinor: 0,
      }),
    ).toEqual({ allow: false, reason: "GLOBAL_KILL_SWITCH" });
  });

  it("fails closed when the deployment is not verified/enabled for live calls", () => {
    expect(evaluateIncomingCall({ env: {}, policy: null, activeCalls: 0, todaysSpendMinor: 0 })).toEqual({
      allow: false,
      reason: "READINESS_GATED",
    });
    expect(
      evaluateIncomingCall({ env: { ...READY_ENV, VOICE_CALLS_ENABLED: "false" }, policy: null, activeCalls: 0, todaysSpendMinor: 0 }),
    ).toEqual({ allow: false, reason: "READINESS_GATED" });
  });

  it("concurrency: policy limit preferred over env default", () => {
    expect(
      evaluateIncomingCall({
        env: READY_ENV,
        policy: { hardDisabled: false, concurrencyLimit: 1, dailySpendLimitMinor: null },
        activeCalls: 1,
        todaysSpendMinor: 0,
      }),
    ).toEqual({ allow: false, reason: "CONCURRENCY_LIMIT" });

    expect(
      evaluateIncomingCall({
        env: { ...READY_ENV, VOICE_CONCURRENT_CALLS_LIMIT: "3" },
        policy: null,
        activeCalls: 2,
        todaysSpendMinor: 0,
      }),
    ).toEqual({ allow: true, reason: "OK" });
    expect(
      evaluateIncomingCall({
        env: { ...READY_ENV, VOICE_CONCURRENT_CALLS_LIMIT: "3" },
        policy: null,
        activeCalls: 3,
        todaysSpendMinor: 0,
      }),
    ).toEqual({ allow: false, reason: "CONCURRENCY_LIMIT" });
  });

  it("daily spend cap refuses once today's usage reaches the limit", () => {
    expect(
      evaluateIncomingCall({
        env: READY_ENV,
        policy: { hardDisabled: false, concurrencyLimit: 5, dailySpendLimitMinor: 1000 },
        activeCalls: 0,
        todaysSpendMinor: 1000,
      }),
    ).toEqual({ allow: false, reason: "SPEND_LIMIT" });
    expect(
      evaluateIncomingCall({
        env: { ...READY_ENV, VOICE_DAILY_SPEND_LIMIT_MINOR: "500" },
        policy: null,
        activeCalls: 0,
        todaysSpendMinor: 499,
      }),
    ).toEqual({ allow: true, reason: "OK" });
  });
});

describe("answer/refuse side effects", () => {
  function recordingClient(behaviour: { answer?: "ok" | "fail" | "uncertain"; stream?: "ok" | "fail" } = {}) {
    const sent: Array<{ command: string; callControlId: string; detail?: string }> = [];
    const client = {
      answer: async (_s: VoiceEventStore, callControlId: string) => {
        sent.push({ command: "answer", callControlId });
        if (behaviour.answer === "fail") {
          return { outcome: "FAILED" as const, status: 409, deduped: false, error: "line busy", response: null };
        }
        if (behaviour.answer === "uncertain") {
          return { outcome: "UNCERTAIN" as const, status: null, deduped: true, error: "sent but unconfirmed", response: null };
        }
        return { outcome: "SUCCEEDED" as const, status: 200, deduped: false, response: {} };
      },
      hangup: async (_s: VoiceEventStore, callControlId: string, cause?: string) => {
        sent.push({ command: "hangup", callControlId, detail: cause });
        return { outcome: "SUCCEEDED" as const, status: 200, deduped: false, response: {} } as const;
      },
      startMediaStream: async (_s: VoiceEventStore, callControlId: string, url: string) => {
        sent.push({ command: "streaming_start", callControlId, detail: url });
        return behaviour.stream === "fail"
          ? { outcome: "FAILED" as const, status: 422, deduped: false, error: "stream rejected", response: null }
          : { outcome: "SUCCEEDED" as const, status: 200, deduped: false, response: {} };
      },
    };
    return { client: client as unknown as TelnyxCallControlClient, sent };
  }

  function recordingStore(call: VoiceCallRow, options: { entitled?: boolean } = {}) {
    const updates: Array<Record<string, unknown>> = [];
    const store = {
      async updateCall(_id: string, patch: Record<string, unknown>) {
        updates.push(patch);
        return true;
      },
      async findCallByControlId() {
        return call;
      },
      async hasActiveVoiceEntitlement() {
        return options.entitled ?? true;
      },
    } as unknown as VoiceEventStore;
    return { updates, store };
  }

  it("answers, starts media streaming and marks ANSWERED", async () => {
    const call = baseCall();
    const { client, sent } = recordingClient();
    const { store, updates } = recordingStore(call);
    const result = await handleIncomingCall(call, { store, client, env: READY_ENV });
    expect(result).toEqual({ handled: "ANSWERED", reason: "OK" });
    expect(sent.map((s) => s.command)).toEqual(["answer", "streaming_start"]);
    expect(sent[1].detail).toContain("callControlId=cc_1");
    expect(sent[1].detail).toContain("token=");
    expect(updates[0]).toMatchObject({ state: "ANSWERED" });
    expect(updates[0].answeredAt).toBeInstanceOf(Date);
  });

  it("skips a redelivered call.initiated after answer (answeredAt never moves)", async () => {
    const answeredAt = new Date("2026-01-05T10:00:00Z");
    const call = baseCall({ state: "ANSWERED", answeredAt });
    const { client, sent } = recordingClient();
    const { store, updates } = recordingStore(call);
    const result = await handleIncomingCall(call, { store, client, env: READY_ENV });
    expect(result).toEqual({ handled: "ANSWERED", reason: "ALREADY_ANSWERED" });
    expect(sent).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });

  it("refuses a business without an active Voice entitlement before answering", async () => {
    const call = baseCall();
    const { client, sent } = recordingClient();
    const { store, updates } = recordingStore(call, { entitled: false });
    const result = await handleIncomingCall(call, { store, client, env: READY_ENV });
    expect(result).toEqual({ handled: "REFUSED", reason: "NOT_ENTITLED" });
    expect(sent.map((s) => s.detail)).toEqual(["jata:not_entitled"]);
    expect(updates[0]).toMatchObject({ state: "FAILED", failoverReason: "NOT_ENTITLED" });
  });

  it("refuses to answer when the media handshake secret is not configured", async () => {
    const call = baseCall();
    const { client, sent } = recordingClient();
    const { store, updates } = recordingStore(call);
    // VOICE_MEDIA_STREAM_TOKEN is required configuration: readiness refuses the call before
    // any answer/stream work (the lifecycle's own media-auth guard behind it is defence in
    // depth for any future readiness change). Either way the call is never answered.
    const { VOICE_MEDIA_STREAM_TOKEN: _omitted, ...envWithoutSecret } = READY_ENV;
    const result = await handleIncomingCall(call, { store, client, env: envWithoutSecret });
    expect(result).toEqual({ handled: "REFUSED", reason: "READINESS_GATED" });
    expect(sent.map((s) => s.detail)).toEqual(["jata:readiness_gated"]);
    expect(updates[0]).toMatchObject({ state: "FAILED", failoverReason: "READINESS_GATED" });
  });

  it("fails safe when the answer command's status is uncertain (never marks answered)", async () => {
    const call = baseCall();
    const { client, sent } = recordingClient({ answer: "uncertain" });
    const { store, updates } = recordingStore(call);
    const result = await handleIncomingCall(call, { store, client, env: READY_ENV });
    expect(result).toEqual({ handled: "REFUSED", reason: "ANSWER_UNCERTAIN" });
    expect(sent.map((s) => s.command)).toEqual(["answer"]);
    expect(updates[0]).toMatchObject({ state: "FAILED", failoverReason: "ANSWER_UNCERTAIN" });
  });

  it("terminates the call when the media stream command fails (no answered-but-deaf call)", async () => {
    const call = baseCall();
    const { client, sent } = recordingClient({ stream: "fail" });
    const { store, updates } = recordingStore(call);
    const result = await handleIncomingCall(call, { store, client, env: READY_ENV });
    expect(result).toEqual({ handled: "REFUSED", reason: "MEDIA_STREAM_FAILED" });
    expect(sent.map((s) => s.detail)).toContain("jata:media_stream_failed");
    expect(updates[0]).toMatchObject({ state: "FAILED", failoverReason: "MEDIA_STREAM_FAILED" });
  });

  it("refuses with an explicit jata: cause and FAILED state (no silent drop)", async () => {
    const call = baseCall();
    const { client, sent } = recordingClient();
    const { store, updates } = recordingStore(call);
    const result = await handleIncomingCall(call, {
      store,
      client,
      env: { ...READY_ENV, VOICE_KILL_SWITCH: "true" },
      countActiveCalls: async () => 0,
      todaysSpendMinor: async () => 0,
    });
    expect(result).toEqual({ handled: "REFUSED", reason: "GLOBAL_KILL_SWITCH" });
    expect(sent[0]).toMatchObject({ command: "hangup" });
    expect(sent[0].detail).toMatch(/^jata:/);
    expect(updates[0]).toMatchObject({ state: "FAILED", failoverReason: "GLOBAL_KILL_SWITCH" });
  });

  it("records ANSWER_FAILED when the provider rejects the answer", async () => {
    const call = baseCall();
    const { client } = recordingClient({ answer: "fail" });
    const { store, updates } = recordingStore(call);
    const result = await handleIncomingCall(call, { store, client, env: READY_ENV });
    expect(result).toEqual({ handled: "REFUSED", reason: "ANSWER_FAILED" });
    expect(updates[0]).toMatchObject({ state: "FAILED", failoverReason: "ANSWER_FAILED" });
  });

  it("fails closed when no call-control client exists", async () => {
    const call = baseCall();
    const { store, updates } = recordingStore(call);
    const result = await handleIncomingCall(call, { store, env: READY_ENV }); // client resolves to null
    expect(result).toEqual({ handled: "REFUSED", reason: "NO_CLIENT" });
    expect(updates[0]).toMatchObject({ state: "FAILED", failoverReason: "NO_CLIENT" });
  });

  it("uses injected concurrency/spend seams when provided", async () => {
    const call = baseCall();
    const { client, sent } = recordingClient();
    const { store } = recordingStore(call);
    const result = await handleIncomingCall(call, {
      store,
      client,
      env: READY_ENV,
      countActiveCalls: async () => 2,
      todaysSpendMinor: async () => 0,
    });
    expect(result).toEqual({ handled: "REFUSED", reason: "CONCURRENCY_LIMIT" });
    expect(sent[0].command).toBe("hangup");
  });

  it("never touches an already-terminal call (late duplicate call.initiated)", async () => {
    const call = baseCall({ state: "COMPLETED", answeredAt: new Date(), endedAt: new Date() });
    const { client, sent } = recordingClient();
    const { store, updates } = recordingStore(call);
    const result = await handleIncomingCall(call, { store, client, env: READY_ENV });
    expect(result).toEqual({ handled: "SKIPPED", reason: "ALREADY_TERMINAL" });
    expect(sent).toHaveLength(0); // no answer, no hangup — terminal state is absorbing
    expect(updates).toHaveLength(0);
  });
});

describe("metering: exact rows, never duplicate, never invented cost", () => {
  type UsageStore = VoiceEventStore & {
    createUsageIfMissing: (row: {
      callId: string;
      businessId: string;
      startedAt: Date;
      answeredAt: Date | null;
      endedAt: Date;
      durationSeconds: number;
    }) => Promise<VoiceUsageRow>;
    findUsageByCallId: (callId: string) => Promise<VoiceUsageRow | null>;
    updateUsage: (id: string, patch: Partial<VoiceUsageRow>) => Promise<void>;
    usageRows: VoiceUsageRow[];
  };

  function usageStore(): UsageStore {
    const usageRows: VoiceUsageRow[] = [];
    let seq = 0;
    return {
      usageRows,
      async createUsageIfMissing(row) {
        const existing = usageRows.find((u) => u.callId === row.callId);
        if (existing) return existing;
        const created: VoiceUsageRow = {
          id: `usage_${++seq}`,
          callId: row.callId,
          businessId: row.businessId,
          startedAt: row.startedAt,
          answeredAt: row.answeredAt,
          endedAt: row.endedAt,
          durationSeconds: row.durationSeconds,
          providerCostMinor: null,
          providerCostCurrency: null,
          status: "OPEN",
        };
        usageRows.push(created);
        return created;
      },
      async findUsageByCallId(callId) {
        return usageRows.find((u) => u.callId === callId) ?? null;
      },
      async updateUsage(id, patch) {
        for (const row of usageRows) if (row.id === id) Object.assign(row, patch);
      },
      // Unused VoiceEventStore members for this suite:
      async insertEvent() {
        throw new Error("unused");
      },
      async updateEvent() {},
      async findActiveInboundNumbers() {
        return [];
      },
      async findCallByControlId() {
        return null;
      },
      async createCall() {
        throw new Error("unused");
      },
      async updateCall() {},
      async listUnprocessed() {
        return [];
      },
      async findCommandByDedupeKey(): Promise<VoiceCallCommandRow | null> {
        return null;
      },
      async createCommand() {
        throw new Error("unused");
      },
      async updateCommand() {},
    } as unknown as UsageStore;
  }

  it("computes answered duration from real timestamps only", async () => {
    const store = usageStore();
    const call = baseCall({ state: "COMPLETED", answeredAt: new Date("2026-11-27T10:00:00Z"), endedAt: new Date("2026-11-27T10:01:15Z") });
    const usage = await finalizeUsageForCall(store, call);
    expect(usage).not.toBeNull();
    expect(usage!.durationSeconds).toBe(75);
    expect(usage!.providerCostMinor).toBeNull();
    expect(usage!.status).toBe("FINALIZED");
    expect(store.usageRows).toHaveLength(1);
  });

  it("keeps an unanswered refused call billable-free", async () => {
    const store = usageStore();
    const call = baseCall({ state: "FAILED", failoverReason: "GLOBAL_KILL_SWITCH", endedAt: new Date() });
    const usage = await finalizeUsageForCall(store, call);
    expect(usage).toBeNull();
    expect(store.usageRows).toHaveLength(0);
  });

  it("creates exactly one usage row per call (duplicate billing impossible)", async () => {
    const store = usageStore();
    const call = baseCall({ state: "COMPLETED", answeredAt: new Date("2026-11-27T10:00:00Z"), endedAt: new Date("2026-11-27T10:00:30Z") });
    await finalizeUsageForCall(store, call);
    await finalizeUsageForCall(store, call); // provider redelivery must not double-bill
    expect(store.usageRows).toHaveLength(1);
    expect(store.usageRows[0].durationSeconds).toBe(30);
  });

  it("records provider cost only from reported figures, with validation", async () => {
    const store = usageStore();
    const call = baseCall({ state: "COMPLETED", answeredAt: new Date("2026-11-27T10:00:00Z"), endedAt: new Date("2026-11-27T10:01:00Z") });
    const usage = await finalizeUsageForCall(store, call);
    await applyProviderCost(store, { callId: usage!.callId, costMinor: 50, currency: "usd" });
    expect(store.usageRows[0].providerCostMinor).toBe(50);
    expect(store.usageRows[0].providerCostCurrency).toBe("usd");

    await expect(applyProviderCost(store, { callId: usage!.callId, costMinor: -5, currency: "usd" })).rejects.toThrow(/non-negative/);
    await expect(applyProviderCost(store, { callId: "ghost", costMinor: 10, currency: "usd" })).rejects.toThrow(/no usage row/);
  });

  it("duration helper is a pure floor of answered-to-ended seconds", () => {
    expect(billableDurationSeconds(null, new Date())).toBe(0);
    expect(billableDurationSeconds(new Date("2026-11-27T10:00:00Z"), new Date("2026-11-27T10:00:00.999Z"))).toBe(0);
    expect(billableDurationSeconds(new Date("2026-11-27T10:00:00Z"), new Date("2026-11-27T10:00:59.999Z"))).toBe(59);
  });
});

describe("reconciliation report (pure; provider ↔ customer ↔ entitlement)", () => {
  const window = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") };
  const usage = (callId: string, overrides: Partial<VoiceUsageRow> = {}): VoiceUsageRow => ({
    id: `u_${callId}`,
    callId,
    businessId: "biz_1",
    startedAt: new Date("2026-11-10T10:00:00Z"),
    answeredAt: new Date("2026-11-10T10:00:00Z"),
    endedAt: new Date("2026-11-10T10:01:00Z"),
    durationSeconds: 60,
    providerCostMinor: null,
    providerCostCurrency: null,
    status: "FINALIZED",
    ...overrides,
  });
  const activeEntitlement = { businessId: "biz_1", status: "ACTIVE", expiresAt: new Date("2026-12-01T00:00:00Z") };

  it("passes a clean month: usage inside an active entitlement, service available", () => {
    const report = reconcileVoiceUsage({
      usage: [usage("c1"), usage("c2")],
      voiceEntitlement: activeEntitlement,
      window,
      serviceAvailable: true,
    });
    expect(report.clean).toBe(true);
    expect(report.calls).toBe(2);
    expect(report.totalBillableSeconds).toBe(120);
    expect(report.totalProviderCostMinor).toBeNull();
  });

  it("flags usage without an active entitlement", () => {
    const report = reconcileVoiceUsage({
      usage: [usage("c1")],
      voiceEntitlement: null,
      window,
      serviceAvailable: true,
    });
    expect(report.clean).toBe(false);
    expect(report.usageWithoutEntitlement).toEqual(["c1"]);
  });

  it("flags usage metered while the service was reported unavailable (never charge)", () => {
    const report = reconcileVoiceUsage({
      usage: [usage("c1")],
      voiceEntitlement: activeEntitlement,
      window,
      serviceAvailable: false,
    });
    expect(report.clean).toBe(false);
    expect(report.usageDuringOutage).toEqual(["c1"]);
  });

  it("flags duplicate usage rows and provider report disagreements", () => {
    const duplicates = reconcileVoiceUsage({
      usage: [usage("c1"), usage("c1", { id: "u_dup" })],
      voiceEntitlement: activeEntitlement,
      window,
      serviceAvailable: true,
    });
    expect(duplicates.clean).toBe(false);
    expect(duplicates.duplicateCallIds).toEqual(["c1"]);

    const mismatch = reconcileVoiceUsage({
      usage: [usage("c1", { providerCostMinor: 35, providerCostCurrency: "usd" })],
      voiceEntitlement: activeEntitlement,
      providerReport: [
        { callId: "c1", durationSeconds: 60, costMinor: 40 },
        { callId: "c2", durationSeconds: 60, costMinor: null },
        { callId: "ghost", durationSeconds: 30, costMinor: null },
      ],
      window,
      serviceAvailable: true,
    });
    expect(mismatch.providerMismatches).toEqual([
      { callId: "c1", issue: "COST provider=40 local=35" },
      { callId: "c2", issue: "PROVIDER_ONLY" },
      { callId: "ghost", issue: "PROVIDER_ONLY" },
    ]);
    expect(mismatch.clean).toBe(false);
  });

  it("sums provider-reported costs when they exist", () => {
    const report = reconcileVoiceUsage({
      usage: [usage("c1", { providerCostMinor: 30, providerCostCurrency: "usd" }), usage("c2", { providerCostMinor: 20, providerCostCurrency: "usd" })],
      voiceEntitlement: activeEntitlement,
      window,
      serviceAvailable: true,
    });
    expect(report.totalProviderCostMinor).toBe(50);
    expect(report.clean).toBe(true);
  });
});

describe("source-level guard: metering never writes billing rows", () => {
  it("metering.ts contains no payment writes", async () => {
    const { readFile } = await import("node:fs/promises");
    const source = await readFile(new URL("../../lib/voice/metering.ts", import.meta.url), "utf8");
    const withoutComments = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(withoutComments).not.toMatch(/prisma\.payment\s*\./);
    expect(withoutComments).not.toMatch(/\.payment\s*\.\s*(create|update|upsert|delete)/);
    expect(withoutComments).not.toMatch(/\.payment\.updateMany/);
  });
});
