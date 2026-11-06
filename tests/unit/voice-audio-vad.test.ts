/**
 * Audio primitives: G.711 μ-law codec, resampling and silence/voice detection
 * (§Voice deliverable 4 foundations).
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAD_CONFIG,
  VoiceActivityDetector,
  decodeMuLawByte,
  encodeMuLawSample,
  muLawToPcm16,
  pcm16ToMuLaw,
  resamplePcm16,
  rms,
  silenceMuLawFrame,
  syntheticSpeechFrame,
} from "@/lib/voice/audio";

describe("G.711 μ-law codec", () => {
  it("decodes the canonical anchor values", () => {
    expect(decodeMuLawByte(0xff)).toBe(0); // positive zero / silence
    expect(decodeMuLawByte(0x00)).toBe(-32124);
    expect(decodeMuLawByte(0x80)).toBe(32124);
    expect(decodeMuLawByte(0x7f)).toBe(0); // negative zero
  });

  it("round-trips representative amplitudes within quantisation error", () => {
    for (const value of [-30000, -8000, -1000, -200, 0, 200, 1000, 8000, 30000]) {
      const decoded = decodeMuLawByte(encodeMuLawSample(value));
      expect(Math.abs(decoded - value)).toBeLessThan(Math.max(8, Math.abs(value) * 0.03 + 8));
    }
  });

  it("encodes buffer silence as 0xFF and decodes back to 0", () => {
    const silence = silenceMuLawFrame(160);
    expect([...silence].every((b) => b === 0xff)).toBe(true);
    expect(rms(muLawToPcm16(silence))).toBe(0);
  });

  it("synthetic speech frames carry clearly voiced energy", () => {
    const speech = muLawToPcm16(syntheticSpeechFrame(160, 7));
    expect(speech.length).toBe(160);
    expect(rms(speech)).toBeGreaterThan(DEFAULT_VAD_CONFIG.threshold);
  });

  it("buffer helpers are lossless in shape", () => {
    const samples = new Int16Array([0, 100, -100, 1234, -1234]);
    const back = muLawToPcm16(pcm16ToMuLaw(samples));
    expect(back.length).toBe(samples.length);
  });
});

describe("resampling", () => {
  it("decimates 24 kHz → 8 kHz by block averaging", () => {
    const input = new Int16Array(480).fill(3000); // 24 kHz: 20 ms
    const output = resamplePcm16(input, 24000, 8000);
    expect(output.length).toBe(160);
    expect(output[0]).toBe(3000);
  });

  it("decimates 16 kHz → 8 kHz", () => {
    const input = new Int16Array(320).fill(-2000);
    expect(resamplePcm16(input, 16000, 8000).length).toBe(160);
  });

  it("identity when rates match", () => {
    const input = new Int16Array([1, 2, 3]);
    expect([...resamplePcm16(input, 8000, 8000)]).toEqual([1, 2, 3]);
  });
});

describe("voice activity detection", () => {
  const speech = () => syntheticSpeechFrame(160, Math.floor(Math.random() * 1000) + 1);
  const silence = () => silenceMuLawFrame(160);

  function feed(vad: VoiceActivityDetector, frames: Buffer[]) {
    const events: string[] = [];
    for (const frame of frames) {
      const event = vad.push(muLawToPcm16(frame));
      if (event) events.push(event.type);
    }
    return events;
  }

  it("opens after the minimum speech and closes after the tail silence", () => {
    const vad = new VoiceActivityDetector();
    const frames: Buffer[] = [];
    for (let i = 0; i < 12; i += 1) frames.push(speech()); // 240 ms voiced → open
    for (let i = 0; i < 35; i += 1) frames.push(silence()); // 700 ms silent → close
    const events = feed(vad, frames);
    expect(events).toEqual(["UTTERANCE_START", "UTTERANCE_END"]);
  });

  it("does not open on isolated noise shorter than the minimum speech", () => {
    const vad = new VoiceActivityDetector();
    const frames: Buffer[] = [];
    for (let i = 0; i < 3; i += 1) frames.push(speech()); // 60 ms blip
    for (let i = 0; i < 50; i += 1) frames.push(silence());
    expect(feed(vad, frames)).toEqual([]);
  });

  it("keeps a pre-roll so the opening words are not clipped", () => {
    const vad = new VoiceActivityDetector();
    const events: Array<{ type: string; pcm?: Int16Array }> = [];
    for (let i = 0; i < 12; i += 1) {
      const event = vad.push(muLawToPcm16(speech()));
      if (event?.type === "UTTERANCE_START") events.push({ type: event.type });
    }
    expect(events).toHaveLength(1);
    // Continue into the utterance and verify collected audio covers pre-open speech energy.
    for (let i = 0; i < 5; i += 1) vad.push(muLawToPcm16(speech()));
    const end = vad.push(muLawToPcm16(silence()));
    // 5 voiced frames only → tail silence not yet reached; finish() flushes what was kept.
    const flushed = vad.finish();
    expect(flushed).not.toBeNull();
    expect(flushed!.length).toBeGreaterThanOrEqual(12 * 160); // pre-roll included
    void end;
  });

  it("reset() clears any open utterance deterministically", () => {
    const vad = new VoiceActivityDetector();
    for (let i = 0; i < 15; i += 1) vad.push(muLawToPcm16(speech()));
    expect(vad.isOpen()).toBe(true);
    vad.reset();
    expect(vad.isOpen()).toBe(false);
    expect(vad.finish()).toBeNull();
  });

  it("retains the full 30-second window on a long utterance (cap trims to 30s, not 1s)", () => {
    const vad = new VoiceActivityDetector();
    for (let i = 0; i < 12; i += 1) vad.push(muLawToPcm16(speech())); // open
    // ~32 s of continuous voiced audio: 1600 frames × 20 ms × 160 samples = 256,000 samples.
    for (let i = 0; i < 1600; i += 1) vad.push(muLawToPcm16(speech()));
    let end: ReturnType<VoiceActivityDetector["push"]> = null;
    for (let i = 0; i < 35 && !end; i += 1) end = vad.push(muLawToPcm16(silence()));
    expect(end?.type).toBe("UTTERANCE_END");
    if (end?.type !== "UTTERANCE_END") throw new Error("expected UTTERANCE_END");
    // The hard cap keeps the most recent 30 seconds — never a single second of tail.
    expect(end.pcm.length).toBe(8000 * 30);
  });
});
