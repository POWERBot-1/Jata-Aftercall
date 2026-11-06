/**
 * Voice media worker over a REAL WebSocket connection (§Voice deliverable 3):
 * tenant-bound session start, refusal paths, bidirectional μ-law framing, VAD → speech →
 * reply loop, barge-in clearing, idle termination and deterministic cleanup.
 * Speech is the loopback provider; store/client are in-memory fakes; no network egress.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startVoiceMediaWorker, type WorkerHandle, type WorkerDeps } from "@/worker/voice-media/server";
import { VoiceMediaSession } from "@/worker/voice-media/session";
import { signMediaStreamToken } from "@/lib/telnyx/call-control";
import { createLoopbackStt, createLoopbackTts } from "@/lib/voice/speech/loopback";
import { silenceMuLawFrame, syntheticSpeechFrame } from "@/lib/voice/audio";
import type { ResolvedSpeech } from "@/lib/voice/speech";
import type { VoiceCallRow } from "@/lib/voice";
import type { TelnyxCallControlClient } from "@/lib/telnyx/call-control";

function callRow(overrides: Partial<VoiceCallRow> = {}): VoiceCallRow {
  return {
    id: "call_w",
    callControlId: "cc_w",
    callSessionId: null,
    businessId: "biz_w",
    direction: "inbound",
    callerNumber: "+254711222333",
    calledNumber: "+254724317010",
    state: "ANSWERED",
    language: "en",
    failoverReason: null,
    handoffTarget: null,
    answeredAt: new Date(),
    endedAt: null,
    hangupCause: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function fakeStore(call: VoiceCallRow | null = callRow()) {
  const updates: Array<Record<string, unknown>> = [];
  const storeObj = {
    async findCallByControlId() {
      return call;
    },
    async updateCall(_id: string, patch: Record<string, unknown>) {
      updates.push(patch);
    },
    async insertEvent() {
      throw new Error("unused");
    },
    async updateEvent() {},
    async findActiveInboundNumbers() {
      return [];
    },
    async createCall() {
      throw new Error("unused");
    },
    async listUnprocessed() {
      return [];
    },
    async findCommandByDedupeKey() {
      return null;
    },
    async createCommand() {
      throw new Error("unused");
    },
    async updateCommand() {},
    async findUsageByCallId() {
      return null;
    },
    async createUsage() {
      throw new Error("unused");
    },
    async updateUsage() {},
    async findPolicyByBusinessId() {
      return null;
    },
  };
  return {
    storeObj,
    deps: { store: storeObj } as unknown as WorkerDeps,
    updatesRef: updates,
  };
}

function fakeClient(hangups: string[] = []) {
  return {
    client: {
      answer: async () => ({ outcome: "SUCCEEDED" as const, deduped: false, status: 200, response: {} }),
      hangup: async (_s: unknown, _cc: string, cause?: string) => {
        hangups.push(cause ?? "");
        return { outcome: "SUCCEEDED" as const, deduped: false, status: 200, response: {} };
      },
      transfer: async () => ({ outcome: "SUCCEEDED" as const, deduped: false, status: 200, response: {} }),
      startMediaStream: async () => ({ outcome: "SUCCEEDED" as const, deduped: false, status: 200, response: {} }),
      stopMediaStream: async () => ({ outcome: "SUCCEEDED" as const, deduped: false, status: 200, response: {} }),
    } as unknown as TelnyxCallControlClient,
    hangups,
  };
}

function speechBundle(script: string[]): ResolvedSpeech {
  const queue = script;
  const tts = createLoopbackTts();
  return {
    providerId: "loopback",
    createStt: () => createLoopbackStt(queue),
    tts,
  };
}

/** Shared handshake secret for the worker's per-call media authentication (fixture only). */
const TEST_MEDIA_SECRET = "media-test-secret";

function mediaUrl(port: number, callControlId: string, token?: string): string {
  const params = new URLSearchParams({ callControlId });
  if (token !== undefined) params.set("token", token);
  return `ws://127.0.0.1:${port}/media?${params.toString()}`;
}

function connect(port: number, callControlId = "cc_w", token?: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const url = mediaUrl(port, callControlId, token ?? signMediaStreamToken(TEST_MEDIA_SECRET, callControlId));
    const socket = new WebSocket(url);
    socket.once("open", () => resolve(socket));
    socket.once("error", reject);
  });
}

type Seen = { messages: Array<any>; waitFor: (predicate: (m: any) => boolean, timeoutMs?: number) => Promise<any> };

function collect(socket: WebSocket): Seen {
  const messages: Array<any> = [];
  socket.on("message", (raw) => {
    try {
      messages.push(JSON.parse(raw.toString()));
    } catch {
      /* ignore */
    }
  });
  return {
    messages,
    async waitFor(predicate, timeoutMs = 5000) {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = messages.find(predicate);
        if (found) return found;
        if (Date.now() > deadline) throw new Error(`waitFor timed out; saw: ${messages.map((m) => m.event ?? (m.media ? "media" : Object.keys(m))).join(",")}`);
        await new Promise((r) => setTimeout(r, 10));
      }
    },
  };
}

function mediaFrame(bytes: Buffer) {
  return JSON.stringify({ event: "media", media: { payload: bytes.toString("base64") } });
}

let handle: WorkerHandle | null = null;

beforeEach(() => {
  handle = null;
});

afterEach(async () => {
  await handle?.close().catch(() => undefined);
});

describe("voice media worker transport", () => {
  it("serves /healthz with readiness facts", async () => {
    const fake = fakeStore();
    handle = await startVoiceMediaWorker(0, { ...fake.deps, speech: speechBundle([]), client: fakeClient().client, env: { VOICE_MEDIA_STREAM_TOKEN: TEST_MEDIA_SECRET } });
    const response = await fetch(`http://127.0.0.1:${handle.port}/healthz`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, service: "jata-voice-media-worker", speechProvider: "loopback" });
  });

  it("refuses sessions when no speech provider is configured (fail closed)", async () => {
    const fake = fakeStore();
    handle = await startVoiceMediaWorker(0, { ...fake.deps, speech: null, client: fakeClient().client, env: { VOICE_MEDIA_STREAM_TOKEN: TEST_MEDIA_SECRET } });
    const socket = await connect(handle.port);
    const seen = collect(socket);
    const closed = new Promise<{ code: number }>((resolve) => socket.once("close", (code) => resolve({ code })));
    socket.send(JSON.stringify({ event: "start", start: { call_control_id: "cc_w" } }));
    const refused = await seen.waitFor((m) => m.event === "jata.refused");
    expect(refused.reason).toBe("SPEECH_PROVIDER_UNAVAILABLE");
    expect((await closed).code).toBe(1013);
  });

  it("refuses media for unknown call ids (tenant binding from durable state)", async () => {
    const fake = fakeStore(null);
    handle = await startVoiceMediaWorker(0, { ...fake.deps, speech: speechBundle([]), client: fakeClient().client, env: { VOICE_MEDIA_STREAM_TOKEN: TEST_MEDIA_SECRET } });
    const socket = await connect(handle.port, "cc_unknown");
    const seen = collect(socket);
    const closed = new Promise<{ code: number }>((resolve) => socket.once("close", (code) => resolve({ code })));
    socket.send(JSON.stringify({ event: "start", start: { call_control_id: "cc_unknown" } }));
    const refused = await seen.waitFor((m) => m.event === "jata.refused");
    expect(refused.reason).toBe("UNKNOWN_CALL");
    expect((await closed).code).toBe(1008);
  });

  it("rejects the WebSocket handshake when the media token is missing or wrong (fail closed)", async () => {
    const fake = fakeStore();
    handle = await startVoiceMediaWorker(0, { ...fake.deps, speech: speechBundle([]), client: fakeClient().client, env: { VOICE_MEDIA_STREAM_TOKEN: TEST_MEDIA_SECRET } });
    for (const url of [
      mediaUrl(handle.port, "cc_w"), // no token at all
      mediaUrl(handle.port, "cc_w", "forged-token"),
      `ws://127.0.0.1:${handle.port}/media`, // neither call id nor token
    ]) {
      const socket = new WebSocket(url);
      const closed = await new Promise<{ code: number }>((resolve, reject) => {
        socket.once("close", (code) => resolve({ code }));
        socket.once("error", reject);
      });
      expect(closed.code).toBe(1008);
    }
    expect(handle.sessions()).toBe(0);
  });

  it("rejects a start frame naming a different call than the handshake authenticated", async () => {
    const fake = fakeStore();
    handle = await startVoiceMediaWorker(0, { ...fake.deps, speech: speechBundle([]), client: fakeClient().client, env: { VOICE_MEDIA_STREAM_TOKEN: TEST_MEDIA_SECRET } });
    const socket = await connect(handle.port, "cc_w");
    const seen = collect(socket);
    const closed = new Promise<{ code: number }>((resolve) => socket.once("close", (code) => resolve({ code })));
    socket.send(JSON.stringify({ event: "start", start: { call_control_id: "cc_other" } }));
    const refused = await seen.waitFor((m) => m.event === "jata.refused");
    expect(refused.reason).toBe("CALL_ID_MISMATCH");
    expect((await closed).code).toBe(1008);
    expect(handle.sessions()).toBe(0);
  });

  it("refuses sessions bound to calls already in a terminal state", async () => {
    const fake = fakeStore(callRow({ state: "COMPLETED" }));
    handle = await startVoiceMediaWorker(0, { ...fake.deps, speech: speechBundle([]), client: fakeClient().client, env: { VOICE_MEDIA_STREAM_TOKEN: TEST_MEDIA_SECRET } });
    const socket = await connect(handle.port, "cc_w");
    const seen = collect(socket);
    const closed = new Promise<{ code: number }>((resolve) => socket.once("close", (code) => resolve({ code })));
    socket.send(JSON.stringify({ event: "start", start: { call_control_id: "cc_w" } }));
    const refused = await seen.waitFor((m) => m.event === "jata.refused");
    expect(refused.reason).toBe("CALL_ALREADY_ENDED");
    expect((await closed).code).toBe(1008);
    expect(handle.sessions()).toBe(0);
  });

  it("refuses the handshake when the worker has no media secret configured (fail closed)", async () => {
    const fake = fakeStore();
    handle = await startVoiceMediaWorker(0, { ...fake.deps, speech: speechBundle([]), client: fakeClient().client, env: {} });
    const socket = new WebSocket(mediaUrl(handle.port, "cc_w", signMediaStreamToken("", "cc_w")));
    const closed = await new Promise<{ code: number }>((resolve, reject) => {
      socket.once("close", (code) => resolve({ code }));
      socket.once("error", reject);
    });
    expect(closed.code).toBe(1008);
    expect(handle.sessions()).toBe(0);
  });

  it("runs a full call over the socket: utterance → reply audio → stop → hangup", async () => {
    const fake = fakeStore();
    const { client, hangups } = fakeClient();
    handle = await startVoiceMediaWorker(0, {
      ...fake.deps,
      speech: speechBundle(["hello there please"]),
      client,
      env: { VOICE_MEDIA_STREAM_TOKEN: TEST_MEDIA_SECRET },
      loadContext: async () => ({ businessName: "Test Business", facts: ["Open 8 to 6"], businessPhone: "+254711999888" }),
      sessionConfig: { framePaceMs: 0, idlePromptMs: 60_000 },
    });
    const socket = await connect(handle.port);
    const seen = collect(socket);

    socket.send(JSON.stringify({ event: "start", start: { call_control_id: "cc_w" } }));
    // 15 voiced frames (300 ms) → VAD opens; then 35 silent frames (700 ms) → utterance ends.
    for (let i = 0; i < 15; i += 1) socket.send(mediaFrame(syntheticSpeechFrame(160, i + 1)));
    for (let i = 0; i < 35; i += 1) socket.send(mediaFrame(silenceMuLawFrame(160)));

    // Assistant turn 0 replies with the greeting — audio frames must flow back out.
    const firstAudio = await seen.waitFor((m) => m.media?.payload, 8000);
    const decoded = Buffer.from(firstAudio.media.payload, "base64");
    expect(decoded.length).toBe(160);

    socket.send(JSON.stringify({ event: "stop" }));
    await new Promise((r) => setTimeout(r, 100));
    expect(hangups[0]).toMatch(/^jata:media:/);
    expect(fake.updatesRef.some((u) => String(u.hangupCause ?? "").startsWith("media:"))).toBe(true);
    socket.close();
  }, 15_000);

  it("cleans up the session when the socket drops (no leaked sessions)", async () => {
    const fake = fakeStore();
    const { client, hangups } = fakeClient();
    handle = await startVoiceMediaWorker(0, {
      ...fake.deps,
      speech: speechBundle([]),
      client,
      env: { VOICE_MEDIA_STREAM_TOKEN: TEST_MEDIA_SECRET },
      loadContext: async () => ({ businessName: "T", facts: [], businessPhone: null }),
      sessionConfig: { framePaceMs: 0, idlePromptMs: 60_000 },
    });
    const socket = await connect(handle.port);
    socket.send(JSON.stringify({ event: "start", start: { call_control_id: "cc_w" } }));
    await new Promise((r) => setTimeout(r, 50));
    expect(handle.sessions()).toBe(1);
    socket.close();
    await new Promise((r) => setTimeout(r, 150));
    expect(handle.sessions()).toBe(0);
    expect(hangups[0]).toMatch(/^jata:media:socket_closed/);
  });
});

describe("session-level barge-in and language switching", () => {
  it("caller speech during playback clears the playout (barge-in)", async () => {
    const sent: Array<any> = [];
    const script = ["hello"];
    const session = new VoiceMediaSession({
      callControlId: "cc_b",
      businessId: "biz_w",
      transport: { sendJson: (m) => sent.push(m) },
      speech: speechBundle(script),
      loadContext: async () => ({ businessName: "Barge Business", facts: [], businessPhone: null }),
      onHangup: async () => undefined,
      config: { framePaceMs: 8, idlePromptMs: 60_000 },
    });
    session.handleMessage({ event: "start", start: { call_control_id: "cc_b" } });
    for (let i = 0; i < 15; i += 1) session.handleMessage({ event: "media", media: { payload: syntheticSpeechFrame(160, i + 1).toString("base64") } });
    for (let i = 0; i < 35; i += 1) session.handleMessage({ event: "media", media: { payload: silenceMuLawFrame(160).toString("base64") } });

    // Wait for playback to start, then inject caller speech mid-greeting.
    await new Promise((r) => setTimeout(r, 60));
    expect(sent.some((m) => m.media)).toBe(true);
    const framesBefore = sent.filter((m) => m.media).length;
    for (let i = 0; i < 12; i += 1) session.handleMessage({ event: "media", media: { payload: syntheticSpeechFrame(160, 99).toString("base64") } });
    await new Promise((r) => setTimeout(r, 80));
    expect(sent.some((m) => m.clear)).toBe(true);
    expect(session.metrics.interruptions).toBeGreaterThanOrEqual(1);
    const framesAfterBarge = sent.filter((m) => m.media).length;
    expect(framesAfterBarge - framesBefore).toBeLessThan(150); // greeting was cut short
    await session.stop("test_done");
    expect(session.metrics.endReason).toBe("test_done");
  });

  it("persists an explicit language switch onto the call row", async () => {
    const fake = fakeStore(callRow());
    const session = new VoiceMediaSession({
      callControlId: "cc_l",
      businessId: "biz_w",
      language: "en",
      transport: { sendJson: () => undefined },
      speech: speechBundle(["switch to kiswahili"]),
      loadContext: async () => ({ businessName: "Lang Business", facts: [], businessPhone: null }),
      onHangup: async () => undefined,
      onUpdateLanguage: async (language) => {
        await fake.storeObj.updateCall("call_w", { language });
      },
      config: { framePaceMs: 0, idlePromptMs: 60_000 },
    });
    session.handleMessage({ event: "start", start: { call_control_id: "cc_l" } });
    for (let i = 0; i < 15; i += 1) session.handleMessage({ event: "media", media: { payload: syntheticSpeechFrame(160, i + 1).toString("base64") } });
    for (let i = 0; i < 35; i += 1) session.handleMessage({ event: "media", media: { payload: silenceMuLawFrame(160).toString("base64") } });
    await new Promise((r) => setTimeout(r, 150));
    expect(fake.updatesRef.some((u) => u.language === "sw")).toBe(true);
    await session.stop("done");
  });
});

describe("speech turn serialization (utterance queue)", () => {
  it("queues a second utterance while the first is in flight — turns never overlap", async () => {
    const sent: Array<any> = [];
    const script = ["what are your opening hours", "and where are you located"];
    let sttCount = 0;
    const speech: ResolvedSpeech = {
      providerId: "loopback",
      createStt: () => {
        sttCount += 1;
        const inner = createLoopbackStt(script);
        return {
          ...inner,
          async finishUtterance() {
            return inner.finishUtterance();
          },
          stop() {
            inner.stop();
          },
        } as ReturnType<ResolvedSpeech["createStt"]>;
      },
      tts: createLoopbackTts(),
    };

    // The first turn's reply is slow: with serialization the second turn cannot begin its
    // reply until the first has finished; with overlapping turns maxActive would reach 2.
    let llmCalls = 0;
    let active = 0;
    let maxActive = 0;
    const session = new VoiceMediaSession({
      callControlId: "cc_q",
      businessId: "biz_w",
      transport: { sendJson: (m) => sent.push(m) },
      speech,
      loadContext: async () => ({ businessName: "Queue Business", facts: [], businessPhone: null }),
      onHangup: async () => undefined,
      llm: async () => {
        llmCalls += 1;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((r) => setTimeout(r, llmCalls === 1 ? 500 : 40));
        active -= 1;
        return "Sure, we can help with that.";
      },
      config: { framePaceMs: 0, idlePromptMs: 60_000 },
    });

    session.handleMessage({ event: "start", start: { call_control_id: "cc_q" } });
    const speakUtterance = () => {
      for (let i = 0; i < 15; i += 1) session.handleMessage({ event: "media", media: { payload: syntheticSpeechFrame(160, i + 1).toString("base64") } });
      for (let i = 0; i < 35; i += 1) session.handleMessage({ event: "media", media: { payload: silenceMuLawFrame(160).toString("base64") } });
    };

    speakUtterance(); // turn 1 ends → in flight (slow first reply)
    await new Promise((r) => setTimeout(r, 20));
    speakUtterance(); // turn 2 ends while turn 1 is still running → must queue
    await new Promise((r) => setTimeout(r, 1_200));

    expect(session.metrics.utterances).toBe(2); // neither utterance dropped
    expect(session.metrics.turns).toBe(2); // both answered
    expect(llmCalls).toBe(2);
    expect(maxActive).toBe(1); // replies strictly serialized
    await session.stop("queue_test_done");
    expect(session.metrics.endReason).toBe("queue_test_done");
  }, 15_000);
});
