/**
 * Human handoff paths and speech/language/assistant behaviour
 * (§Voice deliverables 4 & 5): transfer success, busy/unavailable convergence on safe
 * termination, provider outage fallback, EN/KiSwahili switching, handoff intent,
 * barge-in-capable loopback speech and fail-closed provider selection.
 */
import { describe, expect, it } from "vitest";
import { attemptHumanHandoff, detectHandoffIntent, type HandoffDeps } from "@/lib/voice/handoff";
import type { TelnyxCallControlClient } from "@/lib/telnyx/call-control";
import { detectLanguage, detectLanguageSwitch } from "@/lib/voice/language";
import { runAssistantTurn } from "@/lib/voice/assistant";
import { resolveSpeechAdapters } from "@/lib/voice/speech";
import { createLoopbackStt, createLoopbackTts } from "@/lib/voice/speech/loopback";
import type { VoiceCallRow, VoiceCallCommandRow, VoiceCallEventRow } from "@/lib/voice";
import type { VoiceEventStore } from "@/lib/voice/call-events";

function call(): VoiceCallRow {
  return {
    id: "call_h",
    callControlId: "cc_h",
    callSessionId: null,
    businessId: "biz_1",
    direction: "inbound",
    callerNumber: "+254711222333",
    calledNumber: "+254724317010",
    state: "IN_CALL",
    language: "en",
    failoverReason: null,
    handoffTarget: null,
    answeredAt: new Date(),
    endedAt: null,
    hangupCause: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function store() {
  const updates: Array<Record<string, unknown>> = [];
  return {
    updates,
    store: {
      async updateCall(id: string, patch: Record<string, unknown>) {
        updates.push(patch);
      },
    } as unknown as VoiceEventStore,
  };
}

function clientWith(
  transferResult: { outcome: "SUCCEEDED" | "FAILED" | "NOOP"; error?: string } | (() => Promise<{ outcome: "SUCCEEDED" | "FAILED" | "NOOP"; error?: string }>),
  hangups: string[] = [],
) {
  const transfer = typeof transferResult === "function" ? transferResult : async () => transferResult;
  return {
    hangups,
    client: {
      transfer: async (_s: VoiceEventStore, cc: string, to: string) => transfer(),
      hangup: async (_s: VoiceEventStore, cc: string, cause?: string) => {
        hangups.push(cause ?? "");
        return { outcome: "SUCCEEDED" as const, deduped: false, status: 200, response: {} };
      },
    } as unknown as Pick<TelnyxCallControlClient, "transfer" | "hangup">,
  };
}

describe("handoff intent detection (en + sw)", () => {
  it("recognises human-agent requests in both languages", () => {
    expect(detectHandoffIntent("can I talk to a human please")).toBe(true);
    expect(detectHandoffIntent("nataka mwakilishi")).toBe(true);
    expect(detectHandoffIntent("niongee na mmiliki")).toBe(true);
    expect(detectHandoffIntent("what are your opening hours?")).toBe(false);
    expect(detectHandoffIntent("bei gani?")).toBe(false);
  });
});

describe("transfer attempts and failure convergence", () => {
  function deps(transfer: HandoffDeps["client"], extra: Partial<HandoffDeps> = {}): HandoffDeps {
    return { store: store().store, client: transfer, businessPhone: "+254711999888", ...extra };
  }

  it("transfers to the owner number on success", async () => {
    const { client } = clientWith({ outcome: "SUCCEEDED" });
    const outcome = await attemptHumanHandoff(call(), deps(client));
    expect(outcome).toEqual({ result: "TRANSFERRED", target: "+254711999888" });
  });

  it("refuses without a configured number: clear termination, no ringing forever", async () => {
    const hangups: string[] = [];
    const { client } = clientWith({ outcome: "SUCCEEDED" }, hangups);
    const outcome = await attemptHumanHandoff(call(), deps(client, { businessPhone: null }));
    expect(outcome).toMatchObject({ result: "TERMINATED", reason: "NO_HANDOFF_NUMBER" });
    expect(hangups[0]).toMatch(/^jata:/);
  });

  it("busy recipient terminates once — no retry storm against a busy line", async () => {
    let attempts = 0;
    const { client } = clientWith(async () => {
      attempts += 1;
      return { outcome: "FAILED", error: "call is busy" };
    });
    const outcome = await attemptHumanHandoff(call(), deps(client));
    expect(attempts).toBe(1);
    expect(outcome).toMatchObject({ result: "TERMINATED", reason: "RECIPIENT_BUSY" });
  });

  it("unavailable recipient terminates with the reason recorded", async () => {
    const { client } = clientWith({ outcome: "FAILED", error: "destination unavailable for transfer" });
    const outcome = await attemptHumanHandoff(call(), deps(client));
    expect(outcome).toMatchObject({ result: "TERMINATED", reason: "RECIPIENT_UNAVAILABLE" });
  });

  it("provider outage falls back to the automated front desk (bounded retries)", async () => {
    let attempts = 0;
    const { client } = clientWith(async () => {
      attempts += 1;
      return { outcome: "FAILED", error: "fetch failed: network timeout" };
    });
    const outcome = await attemptHumanHandoff(call(), deps(client));
    expect(attempts).toBe(3);
    expect(outcome).toMatchObject({ result: "FALLBACK_TO_AGENT", reason: "PROVIDER_OUTAGE" });
  });
});

describe("language switching", () => {
  it("switches on explicit requests only", () => {
    expect(detectLanguageSwitch("please switch to kiswahili", "en")).toBe("sw");
    expect(detectLanguageSwitch("badili kiswahili", "en")).toBe("sw");
    expect(detectLanguageSwitch("switch to english", "sw")).toBe("en");
    expect(detectLanguageSwitch("what time do you close?", "en")).toBeNull();
    expect(detectLanguageSwitch("habari za asubuhi", "sw")).toBeNull(); // already sw
  });

  it("hints the initial language from content", () => {
    expect(detectLanguage("habari za asubuhi, naomba msaada")).toBe("sw");
    expect(detectLanguage("good morning, I need help")).toBe("en");
  });
});

describe("front desk assistant turns", () => {
  it("greets on turn 0 in the session language", async () => {
    const en = await runAssistantTurn({ transcript: "hello", language: "en", businessName: "Acme", turnIndex: 0 });
    expect(en.intent).toBe("ANSWER");
    expect(en.reply).toContain("Acme");

    const sw = await runAssistantTurn({ transcript: "habari", language: "sw", businessName: "Duka", turnIndex: 0 });
    expect(sw.reply).toContain("Duka");
    expect(sw.reply).toContain("Asante");
  });

  it("handoff intent outranks the reply and acks in the right language", async () => {
    const handoff = await runAssistantTurn({ transcript: "I want to speak to a person", language: "en", businessName: "Acme", turnIndex: 2 });
    expect(handoff.intent).toBe("HANDOFF");
    expect(handoff.reply).toMatch(/connect/i);

    const swHandoff = await runAssistantTurn({ transcript: "nataka mtu", language: "sw", businessName: "Duka", turnIndex: 2 });
    expect(swHandoff.intent).toBe("HANDOFF");
    expect(swHandoff.reply).toMatch(/unganish/i);
  });

  it("honours an explicit language switch mid-call", async () => {
    const turn = await runAssistantTurn({ transcript: "please switch to kiswahili", language: "en", businessName: "Acme", turnIndex: 2 });
    expect(turn.language).toBe("sw");
    expect(turn.languageSwitched).toBe(true);
    expect(turn.reply.length).toBeGreaterThan(0);
    // An explicit switch request in Swahili content never silently reverts.
    const already = await runAssistantTurn({ transcript: "habari, nataka msaada", language: "sw", businessName: "Acme", turnIndex: 3 });
    expect(already.language).toBe("sw");
    expect(already.languageSwitched).toBe(false);
  });

  it("uses the LLM port when provided and survives LLM failure", async () => {
    const good = await runAssistantTurn({
      transcript: "how late are you open?",
      language: "en",
      businessName: "Acme",
      turnIndex: 1,
      facts: ["Open 08:00–18:00"],
      llm: async () => "We close at 18:00.",
    });
    expect(good.reply).toBe("We close at 18:00.");

    const failed = await runAssistantTurn({
      transcript: "how late are you open?",
      language: "en",
      businessName: "Acme",
      turnIndex: 1,
      facts: ["Open 08:00–18:00"],
      llm: async () => {
        throw new Error("provider down");
      },
    });
    expect(failed.reply).toContain("08:00"); // deterministic fallback cites owner facts only
  });

  it("says goodbye on explicit farewells", async () => {
    const turn = await runAssistantTurn({ transcript: "thank you, bye", language: "en", businessName: "Acme", turnIndex: 3 });
    expect(turn.intent).toBe("GOODBYE");
    expect(turn.reply).toMatch(/goodbye/i);
  });
});

describe("speech provider selection and loopback adapters", () => {
  it("fails closed when nothing is configured", () => {
    expect(resolveSpeechAdapters({})).toBeNull();
    expect(resolveSpeechAdapters({ VOICE_AI_PROVIDER: "openai" })).toBeNull(); // no key
    expect(resolveSpeechAdapters({ VOICE_AI_PROVIDER: "openai", OPENAI_API_KEY: "sk-test" })?.providerId).toBe("openai");
    expect(resolveSpeechAdapters({ VOICE_AI_PROVIDER: "loopback" })?.providerId).toBe("loopback");
  });

  it("loopback STT returns scripted utterances through the contract", async () => {
    const stt = createLoopbackStt(["hello there"]);
    stt.start("en", { onFinal: () => undefined });
    stt.pushFrame?.(new Int16Array(160));
    await expect(stt.finishUtterance()).resolves.toBe("hello there");
    stt.stop();
  });

  it("loopback TTS streams 160-byte μ-law frames sized by text", async () => {
    const tts = createLoopbackTts();
    const frames: Buffer[] = [];
    for await (const frame of tts.synthesize("one two three four five", "en")) frames.push(Buffer.from(frame));
    expect(frames.length).toBeGreaterThan(20); // ≥ ~5 words * 350 ms / 20 ms
    expect(frames.every((f) => f.length === 160)).toBe(true);
    expect(tts.spoken).toEqual(["one two three four five"]);
  });
});
