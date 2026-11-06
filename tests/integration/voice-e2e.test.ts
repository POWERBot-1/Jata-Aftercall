/**
 * §Voice end-to-end journey (automated portion of deliverables 1–6): a signed Telnyx
 * webhook → durable idempotent ingest → tenant routing → monotonic call state → answer
 * gating → idempotent call-control commands → media session (loopback speech) → language
 * switch → human handoff → hangup → usage finalization → reconciliation report.
 * In-memory fakes only: runs in every CI environment without network or database.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";
import { verifyTelnyxWebhookSignature } from "@/lib/telnyx/webhook-signature";
import { TelnyxCallControlClient, type TelnyxTransport } from "@/lib/telnyx/call-control";
import {
  ingestVoiceEvent,
  normalizeKenyaE164,
  processVoiceEvent,
  recoverVoiceEvents,
  type InboundNumberRow,
  type VoiceEventStore,
} from "@/lib/voice";
import { evaluateIncomingCall, handleIncomingCall } from "@/lib/voice/call-lifecycle";
import { finalizeUsageForCall, reconcileVoiceUsage, type VoiceUsageRow } from "@/lib/voice/metering";
import { attemptHumanHandoff } from "@/lib/voice/handoff";
import { VoiceMediaSession } from "@/worker/voice-media/session";
import { createLoopbackStt, createLoopbackTts } from "@/lib/voice/speech/loopback";
import { silenceMuLawFrame, syntheticSpeechFrame } from "@/lib/voice/audio";
import type { VoiceCallCommandRow, VoiceCallEventRow, VoiceCallRow } from "@/lib/voice";

type UsageExtras = {
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
  findBusinessPolicy: (businessId: string) => Promise<{ hardDisabled: boolean; concurrencyLimit: number | null; dailySpendLimitMinor: number | null } | null>;
  countActiveCalls: (businessId: string) => Promise<number>;
  usageRows: VoiceUsageRow[];
};

function createJourneyStore(numbers: InboundNumberRow[], options: { entitled?: boolean } = {}) {
  const events = new Map<string, VoiceCallEventRow>();
  const calls = new Map<string, VoiceCallRow>();
  const commands = new Map<string, VoiceCallCommandRow>();
  const usage: VoiceUsageRow[] = [];
  let seq = 0;

  const store: VoiceEventStore & UsageExtras = {
    usageRows: usage,
    async insertEvent(row) {
      const existing = events.get(row.providerEventId);
      if (existing) return { duplicate: true, row: existing };
      const created: VoiceCallEventRow = {
        ...row,
        id: `evt_${++seq}`,
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
      for (const [k, row] of events) if (row.id === id) events.set(k, { ...row, ...patch });
    },
    async findActiveInboundNumbers() {
      return numbers.filter((n) => n.businessId);
    },
    async findCallByControlId(cc) {
      return calls.get(cc) ?? null;
    },
    async createCall(row) {
      const created: VoiceCallRow = {
        ...row,
        id: `call_${++seq}`,
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
      for (const [k, row] of calls) {
        if (row.id === id) {
          if (options?.expectedState && row.state !== options.expectedState) return false;
          calls.set(k, { ...row, ...patch, updatedAt: new Date() });
          return true;
        }
      }
      return false;
    },
    async todaysSpendMinor() {
      return 0;
    },
    async hasActiveVoiceEntitlement() {
      return options?.entitled ?? true;
    },
    async listUnprocessed(limit) {
      return [...events.values()].filter((e) => e.status === "RECEIVED" || e.status === "RETRY").slice(0, limit);
    },
    async findCommandByDedupeKey(key) {
      return commands.get(key) ?? null;
    },
    async createCommand(row) {
      const created: VoiceCallCommandRow = {
        ...row,
        id: `cmd_${++seq}`,
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
      for (const [k, row] of commands) if (k === id || row.id === id) commands.set(k, { ...row, ...patch, updatedAt: new Date() });
    },
    async createUsageIfMissing(row) {
      const existing = usage.find((u) => u.callId === row.callId);
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
      usage.push(created);
      return created;
    },
    async findUsageByCallId(callId) {
      return usage.find((u) => u.callId === callId) ?? null;
    },
    async updateUsage(id, patch) {
      for (const row of usage) if (row.id === id) Object.assign(row, patch);
    },
    async findBusinessPolicy() {
      return null;
    },
    async countActiveCalls(businessId) {
      return [...calls.values()].filter((c) => c.businessId === businessId && c.state !== "COMPLETED" && c.state !== "FAILED").length;
    },
  };

  return { store, events, calls, commands, usage };
}

const KEY = generateKeyPairSync("ed25519");
const PUBLIC_DER = KEY.publicKey.export({ type: "spki", format: "der" }) as Buffer;
const PUBLIC_KEY_BASE64 = PUBLIC_DER.subarray(PUBLIC_DER.length - 32).toString("base64");

function signedWebhookBody(overrides: { id: string; event_type: string; call_control_id: string; to?: string; from?: string }) {
  const body = JSON.stringify({
    data: {
      id: overrides.id,
      event_type: overrides.event_type,
      payload: {
        call_control_id: overrides.call_control_id,
        call_session_id: "cs_journey",
        to: overrides.to ?? "0724317010",
        from: overrides.from ?? "+254711000111",
      },
    },
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = cryptoSign(null, Buffer.from(`${timestamp}|${body}`, "utf8"), KEY.privateKey).toString("base64");
  return { body, signature, timestamp };
}

async function mustIngest(store: VoiceEventStore, body: string): Promise<VoiceCallEventRow> {
  const result = await ingestVoiceEvent(store, body);
  if (!result.stored) throw new Error("expected parseable stored event");
  return result.row;
}

describe("voice journey: webhook → tenant → state → commands → session → handoff → billing", () => {
  it("runs the complete automated acceptance path", async () => {
    const DID = "+254724317010"; // canonical form of the official number
    const { store, events, calls, usage } = createJourneyStore([
      { e164: normalizeKenyaE164(DID)!, businessId: "biz_acme" },
      { e164: "+254700000001", businessId: "biz_other" }, // another tenant's active DID
    ]);

    // 1. Signature verification is real (generated keypair, same primitive as production).
    const first = signedWebhookBody({ id: "j1", event_type: "call.initiated", call_control_id: "cc_j" });
    const verified = verifyTelnyxWebhookSignature({
      rawBody: first.body,
      signature: first.signature,
      timestamp: first.timestamp,
      publicKey: PUBLIC_KEY_BASE64,
    });
    expect(verified.valid).toBe(true);

    // 2. Durable ingest (idempotent) + tenant routing + state creation.
    const ingested = await ingestVoiceEvent(store, first.body);
    expect(ingested.stored).toBe(true);
    expect(ingested.stored && ingested.duplicate).toBe(false);
    const processed = await processVoiceEvent(store, ingested.stored ? ingested.row : (null as never));
    expect(processed.status).toBe("PROCESSED");
    const call = calls.get("cc_j")!;
    expect(call.businessId).toBe("biz_acme");
    expect(call.state).toBe("INITIATED");
    expect(events.get("j1")?.status).toBe("PROCESSED");

    // 3. Provider redelivery: no duplicate row; processing is idempotent.
    const replay = await ingestVoiceEvent(store, first.body);
    expect(replay.stored && replay.duplicate).toBe(true);
    expect(events.size).toBe(1);
    const replayOutcome = await processVoiceEvent(store, replay.stored ? replay.row : (null as never));
    expect(replayOutcome.status).toBe("PROCESSED");

    // 4. Cross-tenant claim on the same call is rejected and recorded.
    const spoof = signedWebhookBody({ id: "j2", event_type: "call.hangup", call_control_id: "cc_j", to: "+254700000001" });
    const spoofRow = await mustIngest(store, spoof.body);
    const spoofOutcome = await processVoiceEvent(store, spoofRow);
    expect(spoofOutcome.status).toBe("REJECTED");
    expect(spoofOutcome.rejectReason).toBe("CROSS_TENANT");
    expect(calls.get("cc_j")?.state).toBe("INITIATED"); // untouched

    // 5. Answer gating (readiness on): kill switch off, no policy, within limits → allow.
    const READY_ENV: Record<string, string | undefined> = {
      TELNYX_PUBLIC_KEY: "pk",
      TELNYX_API_KEY: "tk",
      TELNYX_CONNECTION_ID: "conn",
      TELNYX_PHONE_NUMBER: DID,
      VOICE_MEDIA_STREAM_URL: "wss://voice.jataaftercall.co.ke/media",
      VOICE_MEDIA_STREAM_TOKEN: "e2e-secret",
      VOICE_AI_PROVIDER: "loopback",
      TELNYX_VOICE_LIVE_VERIFIED: "true",
      VOICE_CALLS_ENABLED: "true",
    };
    const gate = evaluateIncomingCall({ env: READY_ENV, policy: null, activeCalls: 0, todaysSpendMinor: 0 });
    expect(gate).toEqual({ allow: true, reason: "OK" });

    // 6. handleIncomingCall issues answer + media streaming through a fake transport and
    //    is idempotent when the provider redelivers call.initiated.
    const transportCalls: Array<{ path: string }> = [];
    let answeredOnce = false;
    const transport: TelnyxTransport = async (_m, path) => {
      transportCalls.push({ path });
      if (path.includes("/answer")) {
        if (answeredOnce) return { status: 409, json: async () => ({ errors: [{ detail: "Call is already in the answered state" }] }) };
        answeredOnce = true;
      }
      return { status: 200, json: async () => ({ ok: true }) };
    };
    const client = new TelnyxCallControlClient({ apiKey: "tk_journey", transport, retryBaseMs: 1 });
    const answerResult = await handleIncomingCall(call, { store, client, env: READY_ENV });
    expect(answerResult).toEqual({ handled: "ANSWERED", reason: "OK" });
    expect(transportCalls.map((c) => c.path)).toEqual([
      `https://api.telnyx.com/v2/calls/cc_j/actions/answer`,
      `https://api.telnyx.com/v2/calls/cc_j/actions/streaming_start`,
    ]);

    // Redelivered call.initiated: answer command is deduplicated (never issued twice).
    const secondAnswer = await client.answer(store, "cc_j");
    expect(secondAnswer).toMatchObject({ outcome: "SUCCEEDED", deduped: true });
    expect(transportCalls.filter((c) => c.path.includes("/answer"))).toHaveLength(1);

    // 7. Provider confirms ring/answer: monotonic transition, answeredAt kept.
    const answered = signedWebhookBody({ id: "j3", event_type: "call.answered", call_control_id: "cc_j" });
    const answeredRow = await mustIngest(store, answered.body);
    await processVoiceEvent(store, answeredRow);
    expect(calls.get("cc_j")?.state).toBe("ANSWERED");
    const answeredReplay = await ingestVoiceEvent(store, answered.body);
    expect(answeredReplay.stored && answeredReplay.duplicate).toBe(true);

    // 8. Media session: speech → greeting → language switch → handoff to the owner number.
    const script = ["switch to kiswahili", "nataka mtu"];
    const session = new VoiceMediaSession({
      callControlId: "cc_j",
      businessId: "biz_acme",
      language: "en",
      transport: { sendJson: () => undefined },
      speech: { providerId: "loopback", createStt: () => createLoopbackStt(script), tts: createLoopbackTts() },
      loadContext: async () => ({ businessName: "Acme Ltd", facts: ["Open 08:00–18:00"], businessPhone: "+254711999888" }),
      onHandoff: async ({ businessPhone }) => attemptHumanHandoff(calls.get("cc_j")!, { store, client, businessPhone }),
      onHangup: async (cause) => {
        await store.updateCall(call.id, { endedAt: new Date(), hangupCause: `media:${cause}` });
        await client.hangup(store, "cc_j", `jata:media:${cause}`);
      },
      onUpdateLanguage: async (language) => {
        await store.updateCall(call.id, { language });
      },
      config: { framePaceMs: 0, idlePromptMs: 60_000 },
    });
    session.handleMessage({ event: "start", start: { call_control_id: "cc_j" } });
    for (let i = 0; i < 15; i += 1) session.handleMessage({ event: "media", media: { payload: syntheticSpeechFrame(160, i + 1).toString("base64") } });
    for (let i = 0; i < 35; i += 1) session.handleMessage({ event: "media", media: { payload: silenceMuLawFrame(160).toString("base64") } });
    await new Promise((r) => setTimeout(r, 150));
    expect(calls.get("cc_j")?.language).toBe("sw");

    for (let i = 0; i < 15; i += 1) session.handleMessage({ event: "media", media: { payload: syntheticSpeechFrame(160, 50 + i).toString("base64") } });
    for (let i = 0; i < 35; i += 1) session.handleMessage({ event: "media", media: { payload: silenceMuLawFrame(160).toString("base64") } });
    await new Promise((r) => setTimeout(r, 200));
    expect(session.metrics.utterances).toBeGreaterThanOrEqual(2);
    // Handoff transferred to the owner's configured number via an idempotent transfer command.
    expect(calls.get("cc_j")?.state).toBe("HANDING_OFF");

    // 9. Provider hangup finalises the call (terminal, absorbing).
    const hangupBody = signedWebhookBody({ id: "j4", event_type: "call.hangup", call_control_id: "cc_j" });
    const hangupRow = await mustIngest(store, hangupBody.body);
    await processVoiceEvent(store, hangupRow);
    expect(calls.get("cc_j")?.state).toBe("COMPLETED");

    // 10. Recovery sweep after a simulated crash: nothing failed, nothing duplicated.
    const summary = await recoverVoiceEvents(store);
    expect(summary).toEqual({ processed: 0, failed: 0 });
    expect(events.size).toBe(4);

    // 11. Metering: exactly one usage row, answered duration only, no invented cost.
    await store.updateCall(call.id, {
      answeredAt: new Date("2026-11-27T10:00:00.000Z"),
      endedAt: new Date("2026-11-27T10:01:00.000Z"),
    });
    const finalCall = calls.get("cc_j")!;
    const usageRow = await finalizeUsageForCall(store, finalCall);
    const usageRow2 = await finalizeUsageForCall(store, finalCall); // replay-safe
    expect(usageRow).not.toBeNull();
    expect(usageRow2?.id).toBe(usageRow!.id);
    expect(usage).toHaveLength(1);
    expect(usage[0].durationSeconds).toBe(60);
    expect(usage[0].providerCostMinor).toBeNull();
    expect(usage[0].status).toBe("FINALIZED");

    // 12. Reconciliation: active entitlement + service available + no duplicates → clean.
    const window = { from: new Date("2026-11-01T00:00:00Z"), to: new Date("2026-12-01T00:00:00Z") };
    const report = reconcileVoiceUsage({
      usage: [...usage],
      voiceEntitlement: { businessId: "biz_acme", status: "ACTIVE", expiresAt: new Date("2026-12-01T00:00:00Z") },
      window,
      serviceAvailable: true,
    });
    expect(report.clean).toBe(true);
    expect(report.totalBillableSeconds).toBe(60);

    // 13. Provider usage disagreement is surfaced, never auto-fixed.
    const drifted = reconcileVoiceUsage({
      usage: [...usage],
      voiceEntitlement: { businessId: "biz_acme", status: "ACTIVE", expiresAt: new Date("2026-12-01T00:00:00Z") },
      providerReport: [{ callId: usage[0].callId, durationSeconds: 45, costMinor: null }],
      window,
      serviceAvailable: true,
    });
    expect(drifted.providerMismatches).toEqual([
      { callId: usage[0].callId, issue: "DURATION provider=45 local=60" },
    ]);

    // 14. Kill switch flips the gate deterministically.
    const killed = evaluateIncomingCall({
      env: { ...READY_ENV, VOICE_KILL_SWITCH: "true" },
      policy: null,
      activeCalls: 0,
      todaysSpendMinor: 0,
    });
    expect(killed).toEqual({ allow: false, reason: "GLOBAL_KILL_SWITCH" });
  }, 20_000);

  it("refuses to answer a business without a Voice entitlement and keeps tenant isolation", async () => {
    const DID = "+254724317010";
    const { store, calls } = createJourneyStore(
      [
        { e164: DID, businessId: "biz_free" },
        { e164: "+254700000001", businessId: "biz_other" },
      ],
      { entitled: false },
    );

    const body = signedWebhookBody({ id: "ne1", event_type: "call.initiated", call_control_id: "cc_ne" });
    const row = await mustIngest(store, body.body);
    const processed = await processVoiceEvent(store, row);
    expect(processed.status).toBe("PROCESSED");
    expect(calls.get("cc_ne")?.businessId).toBe("biz_free");

    const env: Record<string, string | undefined> = {
      TELNYX_PUBLIC_KEY: "pk",
      TELNYX_API_KEY: "tk",
      TELNYX_CONNECTION_ID: "conn",
      TELNYX_PHONE_NUMBER: DID,
      VOICE_MEDIA_STREAM_URL: "wss://voice.example/media",
      VOICE_MEDIA_STREAM_TOKEN: "e2e-secret",
      VOICE_AI_PROVIDER: "loopback",
      TELNYX_VOICE_LIVE_VERIFIED: "true",
      VOICE_CALLS_ENABLED: "true",
    };
    const transportPaths: string[] = [];
    const client = new TelnyxCallControlClient({
      apiKey: "tk",
      transport: async (_m, path) => {
        transportPaths.push(path);
        return { status: 200, json: async () => ({}) };
      },
      retryBaseMs: 1,
    });

    const result = await handleIncomingCall(calls.get("cc_ne")!, { store, client, env });
    expect(result).toEqual({ handled: "REFUSED", reason: "NOT_ENTITLED" });
    // Only the terminating hangup was ever issued — the call was never answered.
    expect(transportPaths.map((p) => p.split("/").pop())).toEqual(["hangup"]);
    expect(calls.get("cc_ne")?.state).toBe("FAILED");
    expect(calls.get("cc_ne")?.failoverReason).toBe("NOT_ENTITLED");

    // Tenant isolation end to end: an event claiming a number this business does not own
    // is rejected outright and never touches the existing call row.
    const spoof = signedWebhookBody({ id: "ne2", event_type: "call.answered", call_control_id: "cc_ne", to: "+254700000099" });
    const spoofRow = await mustIngest(store, spoof.body);
    const outcome = await processVoiceEvent(store, spoofRow);
    expect(outcome).toMatchObject({ status: "REJECTED", rejectReason: "UNKNOWN_NUMBER" });
    expect(calls.get("cc_ne")?.failoverReason).toBe("NOT_ENTITLED");
  }, 20_000);
});
