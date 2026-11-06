/**
 * Voice webhook route contract (§Voice deliverable 1/2 boundary):
 * 401 unsigned/invalid signature (fail-closed), 400 unparseable, 503 persistence or
 * processing failure (provider redelivery is safe because ingest is idempotent),
 * 202 otherwise — including REJECTED tenant outcomes.
 * The durable store is faked; signature verification is real (generated keypair).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign as cryptoSign } from "node:crypto";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  storeImpl: {
    findCallByControlId: vi.fn(async () => null),
    updateCall: vi.fn(async () => undefined),
  },
  ingestFn: vi.fn(),
  processFn: vi.fn(),
  markRetryFn: vi.fn(),
  handleIncomingFn: vi.fn(async () => undefined),
  finalizeFn: vi.fn(async () => undefined),
  getCallControlClientFn: vi.fn(() => null),
}));
const { storeImpl, ingestFn, processFn, markRetryFn, handleIncomingFn, finalizeFn, getCallControlClientFn } = mocks;

vi.mock("@/lib/voice/call-events", () => ({
  createPrismaVoiceEventStore: () => mocks.storeImpl,
  ingestAndProcessVoiceEvent: mocks.ingestFn,
  processVoiceEvent: mocks.processFn,
  markEventForRetry: mocks.markRetryFn,
}));

vi.mock("@/lib/voice/call-lifecycle", () => ({
  handleIncomingCall: mocks.handleIncomingFn,
  finalizeCallFromEvent: mocks.finalizeFn,
}));

vi.mock("@/lib/telnyx/call-control", () => ({
  getCallControlClient: mocks.getCallControlClientFn,
}));

import { POST } from "@/app/api/webhooks/telnyx/voice/route";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicDer = publicKey.export({ type: "spki", format: "der" }) as Buffer;
const publicKeyBase64 = publicDer.subarray(publicDer.length - 32).toString("base64");

function sign(rawBody: string, timestamp: string): string {
  const data = `${timestamp}|${rawBody}`;
  return cryptoSign(null, Buffer.from(data, "utf8"), privateKey).toString("base64");
}

function makeRequest(body: string, opts: { signature?: string | null; timestamp?: string } = {}): Request {
  const timestamp = opts.timestamp ?? String(Math.floor(Date.now() / 1000));
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "telnyx-timestamp": timestamp,
  };
  if (opts.signature !== null) headers["telnyx-signature-ed25519"] = opts.signature ?? sign(body, timestamp);
  return new Request("https://jataaftercall.co.ke/api/webhooks/telnyx/voice", { method: "POST", body, headers });
}

const BODY = JSON.stringify({
  data: { id: "evt_route_1", event_type: "call.initiated", payload: { call_control_id: "cc_route", call_session_id: "cs", to: "+254724317010", from: "+254711000111" } },
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TELNYX_PUBLIC_KEY = publicKeyBase64;
});

afterEach(() => {
  delete process.env.TELNYX_PUBLIC_KEY;
});

describe("POST /api/webhooks/telnyx/voice", () => {
  it("401 for unsigned or invalid signatures (fail-closed)", async () => {
    const unsigned = await POST(makeRequest(BODY, { signature: null }));
    expect(unsigned.status).toBe(401);

    const tamperedTimestamp = String(Math.floor(Date.now() / 1000));
    const tamperedHeaders: Record<string, string> = {
      "content-type": "application/json",
      "telnyx-timestamp": tamperedTimestamp,
      "telnyx-signature-ed25519": sign(BODY, tamperedTimestamp), // signature covers the original body
    };
    const tampered = await POST(
      new Request("https://jataaftercall.co.ke/api/webhooks/telnyx/voice", {
        method: "POST",
        body: BODY + " ",
        headers: tamperedHeaders,
      }),
    );
    expect(tampered.status).toBe(401);

    const noKeyEnv = async () => {
      delete process.env.TELNYX_PUBLIC_KEY;
      return POST(makeRequest(BODY, {}));
    };
    expect((await noKeyEnv()).status).toBe(401);
    process.env.TELNYX_PUBLIC_KEY = publicKeyBase64;
  });

  it("400 for a correctly signed but unparseable body", async () => {
    ingestFn.mockResolvedValueOnce({ stored: false, reason: "UNPARSEABLE" });
    const response = await POST(makeRequest("not-json", {}));
    expect(response.status).toBe(400);
    expect(ingestFn).toHaveBeenCalledTimes(1);
    expect(processFn).not.toHaveBeenCalled();
  });

  it("503 when persistence fails — provider redelivers, ingest dedupes", async () => {
    ingestFn.mockRejectedValueOnce(new Error("db down"));
    const response = await POST(makeRequest(BODY, {}));
    expect(response.status).toBe(503);
  });

  it("503 when processing fails after persistence — marked for recovery", async () => {
    const row = { id: "e1", providerEventId: "evt_route_1", eventType: "call.initiated", status: "PROCESSED" as const };
    // Redelivery of a persisted event whose re-processing throws → RETRY marker + 503.
    ingestFn.mockResolvedValueOnce({ stored: true, duplicate: true, row, outcome: { status: "PROCESSED", call: null, transition: null, rejectReason: null, error: null } });
    processFn.mockRejectedValueOnce(new Error("processing exploded"));
    const response = await POST(makeRequest(BODY, {}));
    expect(response.status).toBe(503);
    expect(markRetryFn).toHaveBeenCalledTimes(1);
  });

  it("202 PROCESSED for a fresh routable event, lifecycle hook invoked", async () => {
    const call = { id: "c1", callControlId: "cc_route", businessId: "biz_a", state: "INITIATED", language: "en" };
    const row = { id: "e1", providerEventId: "evt_route_1", eventType: "call.initiated", status: "RECEIVED" as const };
    ingestFn.mockResolvedValueOnce({
      stored: true,
      duplicate: false,
      row,
      outcome: { status: "PROCESSED", call, transition: "INITIATED" },
    });
    const response = await POST(makeRequest(BODY, {}));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, status: "PROCESSED" });
    expect(handleIncomingFn).toHaveBeenCalledTimes(1);
  });

  it("202 REJECTED for unknown/cross-tenant events without lifecycle side effects", async () => {
    const row = { id: "e2", providerEventId: "evt_route_2", eventType: "call.initiated", status: "RECEIVED" as const };
    ingestFn.mockResolvedValueOnce({
      stored: true,
      duplicate: false,
      row,
      outcome: { status: "REJECTED", rejectReason: "CROSS_TENANT" },
    });
    const response = await POST(makeRequest(BODY, {}));
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ ok: true, status: "REJECTED", reason: "CROSS_TENANT" });
    expect(handleIncomingFn).not.toHaveBeenCalled();
    expect(finalizeFn).not.toHaveBeenCalled();
  });

  it("duplicate deliveries re-run processing (idempotent recovery path)", async () => {
    const call = { id: "c1", callControlId: "cc_route", businessId: "biz_a", state: "ANSWERED", language: "en" };
    const row = { id: "e1", providerEventId: "evt_route_1", eventType: "call.hangup", status: "PROCESSED" as const };
    ingestFn.mockResolvedValueOnce({ stored: true, duplicate: true, row, outcome: { status: "PROCESSED", call, transition: "OK" } });
    processFn.mockResolvedValueOnce({ status: "PROCESSED", call, transition: "OK" });
    const response = await POST(makeRequest(BODY, {}));
    expect(response.status).toBe(202);
    expect(processFn).toHaveBeenCalledTimes(1);
    expect(finalizeFn).toHaveBeenCalledTimes(1);
  });
});
