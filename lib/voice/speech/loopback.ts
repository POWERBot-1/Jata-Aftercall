/**
 * Loopback speech provider — deterministic, offline, no network.
 * Used by unit/integration tests and local development (`VOICE_AI_PROVIDER=loopback`).
 * Recognition returns utterances delivered through the `deliverUtterance` seam; synthesis
 * emits speech-energy frames sized by the text so VAD/barge-in paths behave realistically.
 */
import { syntheticSpeechFrame } from "../audio";
import { VOICE_LANGUAGES, type VoiceLanguage } from "../types";
import type { SpeechToTextAdapter, TextToSpeechAdapter } from "./types";

export type LoopbackStt = SpeechToTextAdapter & {
  /** Test seam: deliver a transcript as if recognition completed. */
  deliverUtterance: (text: string) => void;
  /** Everything recognized on this adapter instance, in order. */
  readonly recognized: string[];
};

export function createLoopbackStt(script: string[] = []): LoopbackStt {
  let callbacks: { onFinal: (text: string) => void; onError?: (error: Error) => void } | null = null;
  let language: VoiceLanguage = "en";
  const recognized: string[] = [];
  // Share the caller's queue so a factory can script multiple sequential utterances.
  let pending: string[] = script;

  return {
    id: "loopback",
    languages: VOICE_LANGUAGES,
    recognized,
    start(lang, cb) {
      language = lang;
      callbacks = cb;
      // The scripted queue (tests) survives start(); live utterances arrive via deliverUtterance.
    },
    pushFrame() {
      // Deterministic adapter: audio content is ignored, utterances arrive via deliverUtterance.
    },
    async finishUtterance() {
      const text = pending.shift() ?? "";
      return text;
    },
    deliverUtterance(text: string) {
      recognized.push(text);
      callbacks?.onFinal(text);
    },
    stop() {
      callbacks = null;
      pending = [];
    },
    get language() {
      return language;
    },
  } as LoopbackStt & { get language(): VoiceLanguage };
}

export type LoopbackTts = TextToSpeechAdapter & {
  /** Every string synthesized by this adapter, in order. */
  readonly spoken: string[];
};

/**
 * Synthesizes `≈350 ms per word` (clamped 400 ms–4 s) of speech-energy μ-law frames.
 * `onSpoken` observers can react synchronously (tests assert barge-in interrupts).
 */
export function createLoopbackTts(options: { onSpoken?: (text: string) => { interrupted?: boolean } | void } = {}): LoopbackTts {
  const spoken: string[] = [];
  return {
    id: "loopback",
    languages: VOICE_LANGUAGES,
    spoken,
    async *synthesize(text: string): AsyncIterable<Buffer> {
      spoken.push(text);
      const words = text.split(/\s+/).filter(Boolean).length || 1;
      const durationMs = Math.min(4000, Math.max(400, words * 350));
      const frames = Math.floor(durationMs / 20);
      for (let i = 0; i < frames; i += 1) {
        const interruption = options.onSpoken?.(text);
        if (interruption && typeof interruption === "object" && interruption.interrupted) return;
        yield syntheticSpeechFrame(160, i + 1);
      }
    },
  };
}
