/**
 * Telnyx Call Control command issuance: authentication, retries, classification and — above
 * all — command idempotency under duplicate/delayed conditions (§Voice deliverable 2).
 * Transport is faked; no network and no credentials are used.
 */
import { describe, expect, it, vi } from "vitest";
import {
  TelnyxCallControlClient,
  buildMediaStreamUrl,
  getCallControlClient,
  signMediaStreamToken,
  type TelnyxTransport,
} from "@/lib/telnyx/call-control";
import type { VoiceEventStore, InboundNumberRow } from "@/lib/voice";
import type { VoiceCallCommandRow, VoiceCallEventRow, VoiceCallRow } from "@/lib/voice";

function createMemoryStore(): VoiceEventStore & { commands: Map<string, VoiceCallCommandRow> } {
  const commands = new Map<string, VoiceCallCommandRow>();
  let seq = 0;
  return {
    commands,
    async insertEvent(row): Promise<{ duplicate: boolean; row: VoiceCallEventRow }> {
      throw new Error(`not used in this suite: ${row.providerEventId}`);
    },
    async updateEvent() {},
    async findActiveInboundNumbers(): Promise<InboundNumberRow[]> {
      return [];
    },
    async findCallByControlId(): Promise<VoiceCallRow | null> {
      return null;
    },
    async createCall(): Promise<VoiceCallRow> {
      throw new Error("not used");
    },
    async updateCall() {
      return true;
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
    async listUnprocessed() {
      return [];
    },
    async findCommandByDedupeKey(dedupeKey) {
      return commands.get(dedupeKey) ?? null;
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
      for (const [key, row] of commands) {
        if (row.id === id) commands.set(key, { ...row, ...patch, updatedAt: new Date() });
      }
    },
  };
}

function transportResponding(handler: (path: string, body: unknown, attempt: number) => { status: number; json?: unknown }) {
  const calls: Array<{ path: string; body: unknown }> = [];
  let attempt = 0;
  const transport: TelnyxTransport = async (_method, path, body) => {
    calls.push({ path, body });
    attempt += 1;
    const result = handler(path, body, attempt);
    return { status: result.status, json: async () => result.json ?? {} };
  };
  return { transport, calls };
}

describe("Telnyx Call Control command safety", () => {
  it("no client without credentials (fail closed)", () => {
    expect(getCallControlClient({})).toBeNull();
    expect(getCallControlClient({ TELNYX_API_KEY: "  " })).toBeNull();
    expect(getCallControlClient({ TELNYX_API_KEY: "tk_test" })).toBeInstanceOf(TelnyxCallControlClient);
  });

  it("issues answer once and deduplicates every repeat for the same call", async () => {
    const store = createMemoryStore();
    const { transport, calls } = transportResponding(() => ({ status: 200, json: { data: { result: "ok" } } }));
    const client = new TelnyxCallControlClient({ apiKey: "tk", transport, retryBaseMs: 1 });

    const first = await client.answer(store, "cc_1");
    const second = await client.answer(store, "cc_1");
    const third = await client.answer(store, "cc_1");
    expect(first).toMatchObject({ outcome: "SUCCEEDED", deduped: false });
    expect(second).toMatchObject({ outcome: "SUCCEEDED", deduped: true });
    expect(third).toMatchObject({ outcome: "SUCCEEDED", deduped: true });
    expect(calls).toHaveLength(1);
    expect(store.commands.get("answer:cc_1")?.status).toBe("SUCCEEDED");
  });

  it("treats a SENT-but-unconfirmed command as UNCERTAIN — never a silent success, never a blind re-send", async () => {
    const store = createMemoryStore();
    await store.createCommand({ callControlId: "cc_s", command: "answer", dedupeKey: "answer:cc_s", requestPayload: null });
    await store.updateCommand((await store.findCommandByDedupeKey("answer:cc_s"))!.id, { status: "SENT" });
    const { transport, calls } = transportResponding(() => ({ status: 200 }));
    const client = new TelnyxCallControlClient({ apiKey: "tk", transport, retryBaseMs: 1 });
    const outcome = await client.answer(store, "cc_s");
    expect(outcome).toMatchObject({ outcome: "UNCERTAIN", deduped: true, status: null });
    expect(calls).toHaveLength(0);
    // The uncertain row stays visible for reconciliation instead of being overwritten as success.
    expect(store.commands.get("answer:cc_s")?.status).toBe("SENT");
  });

  it("re-issues a PENDING command (created but never sent — no remote effect to double)", async () => {
    const store = createMemoryStore();
    await store.createCommand({ callControlId: "cc_p", command: "answer", dedupeKey: "answer:cc_p", requestPayload: null });
    const { transport, calls } = transportResponding(() => ({ status: 200, json: { data: { ok: true } } }));
    const client = new TelnyxCallControlClient({ apiKey: "tk", transport, retryBaseMs: 1 });
    const outcome = await client.answer(store, "cc_p");
    expect(outcome).toMatchObject({ outcome: "SUCCEEDED", deduped: false });
    expect(calls).toHaveLength(1);
    expect(store.commands.get("answer:cc_p")?.status).toBe("SUCCEEDED");
  });

  it("starts bidirectional media with Telnyx's documented streaming_start shape", async () => {
    const store = createMemoryStore();
    const { transport, calls } = transportResponding(() => ({ status: 200, json: { data: { ok: true } } }));
    const client = new TelnyxCallControlClient({ apiKey: "tk", transport, retryBaseMs: 1 });
    const outcome = await client.startMediaStream(store, "cc_m", "wss://voice.example/media?callControlId=cc_m&token=t");
    expect(outcome).toMatchObject({ outcome: "SUCCEEDED" });
    expect(calls[0].path).toContain("/actions/streaming_start");
    expect(calls[0].body).toMatchObject({
      stream_track: "both_tracks",
      stream_bidirectional_mode: "rtp",
      stream_url: "wss://voice.example/media?callControlId=cc_m&token=t",
    });
  });

  it("retries 5xx and network failures with backoff, then succeeds", async () => {
    const store = createMemoryStore();
    let failures = 2;
    const transport: TelnyxTransport = async () => {
      if (failures > 0) {
        failures -= 1;
        return { status: 503, json: async () => ({ errors: [{ detail: "upstream busy" }] }) };
      }
      return { status: 200, json: async () => ({ ok: true }) };
    };
    const client = new TelnyxCallControlClient({ apiKey: "tk", transport, maxAttempts: 3, retryBaseMs: 1 });
    const outcome = await client.hangup(store, "cc_h", "jata:test");
    expect(outcome).toMatchObject({ outcome: "SUCCEEDED", status: 200 });
    expect(store.commands.get("hangup:cc_h")?.attempts).toBeGreaterThanOrEqual(3);
  });

  it("treats 4xx as terminal — no retry loop burning the call", async () => {
    const store = createMemoryStore();
    const { transport, calls } = transportResponding(() => ({ status: 422, json: { errors: [{ detail: "invalid destination" }] } }));
    const client = new TelnyxCallControlClient({ apiKey: "tk", transport, maxAttempts: 3, retryBaseMs: 1 });
    const outcome = await client.transfer(store, "cc_t", "+254724317010");
    expect(outcome).toMatchObject({ outcome: "FAILED", status: 422 });
    expect(calls).toHaveLength(1);
    expect(store.commands.get("transfer:cc_t:+254724317010")?.status).toBe("FAILED");
  });

  it("records provider 'already in state' answers as NOOP successes", async () => {
    const store = createMemoryStore();
    const { transport } = transportResponding(() => ({ status: 409, json: { errors: [{ detail: "Call is already in the answered state" }] } }));
    const client = new TelnyxCallControlClient({ apiKey: "tk", transport, retryBaseMs: 1 });
    const outcome = await client.answer(store, "cc_dup");
    expect(outcome).toMatchObject({ outcome: "NOOP" });
    expect(store.commands.get("answer:cc_dup")?.status).toBe("SUCCEEDED");
  });

  it("allows a FAILED command to be retried under a fresh attempt sequence", async () => {
    const store = createMemoryStore();
    let status = 422;
    const transport: TelnyxTransport = async () => ({ status, json: async () => ({ errors: [{ detail: "temporary" }] }) });
    const client = new TelnyxCallControlClient({ apiKey: "tk", transport, retryBaseMs: 1 });
    const first = await client.sendCommand(store, { callControlId: "cc_r", command: "answer", dedupeKey: "answer:cc_r" });
    expect(first.outcome).toBe("FAILED");
    status = 200;
    const second = await client.sendCommand(store, { callControlId: "cc_r", command: "answer", dedupeKey: "answer:cc_r" });
    expect(second).toMatchObject({ outcome: "SUCCEEDED", deduped: false });
    expect(store.commands.get("answer:cc_r")?.status).toBe("SUCCEEDED");
  });

  it("authenticates every request with the bearer key and hits the call action path", async () => {
    const store = createMemoryStore();
    const seen: Array<{ path: string; headers: Record<string, string> }> = [];
    const transport: TelnyxTransport = async (_m, path, _b, headers) => {
      seen.push({ path, headers });
      return { status: 200, json: async () => ({}) };
    };
    const client = new TelnyxCallControlClient({ apiKey: "tk_live_x", transport, retryBaseMs: 1 });
    await client.answer(store, "cc_auth");
    expect(seen[0].path).toContain("/v2/calls/cc_auth/actions/answer");
    expect(seen[0].headers.Authorization).toBe("Bearer tk_live_x");
  });

  it("mints per-call media tokens that bind to the call id and never expose the secret", () => {
    const tokenA = signMediaStreamToken("shared-secret", "cc_a");
    const tokenB = signMediaStreamToken("shared-secret", "cc_b");
    expect(tokenA).toBe(signMediaStreamToken("shared-secret", "cc_a"));
    expect(tokenA).not.toBe(tokenB);
    expect(signMediaStreamToken("other-secret", "cc_a")).not.toBe(tokenA);
    expect(tokenA).not.toContain("shared-secret");
  });

  it("builds an authenticated stream URL and fails closed without the shared secret", () => {
    const url = buildMediaStreamUrl("wss://voice.example/media", "cc_1", "shared-secret");
    expect(url).not.toBeNull();
    const parsed = new URL(url!);
    expect(parsed.pathname).toBe("/media");
    expect(parsed.searchParams.get("callControlId")).toBe("cc_1");
    expect(parsed.searchParams.get("token")).toBe(signMediaStreamToken("shared-secret", "cc_1"));
    expect(buildMediaStreamUrl("wss://voice.example/media", "cc_1", undefined)).toBeNull();
    expect(buildMediaStreamUrl("wss://voice.example/media", "cc_1", "   ")).toBeNull();
  });
});
