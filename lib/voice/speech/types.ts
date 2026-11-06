/**
 * Provider-agnostic speech contracts (§Voice deliverable 4).
 * The application talks only to these interfaces; concrete recognizers/synthesizers are
 * selected by `VOICE_AI_PROVIDER` so an approved provider can be connected later without
 * touching the worker, session logic or call pipeline.
 */
import type { VoiceLanguage } from "../types";

export type TranscriptCallbacks = {
  onPartial?: (text: string) => void;
  onFinal: (text: string) => void;
  onError?: (error: Error) => void;
};

export type SpeechToTextAdapter = {
  readonly id: string;
  readonly languages: readonly VoiceLanguage[];
  /** Prepare the adapter for an utterance in `language`. */
  start(language: VoiceLanguage, callbacks: TranscriptCallbacks): void;
  /**
   * Optional streaming hook: receive endpointed utterance audio incrementally so a
   * websocket-based recognizer can emit partials before `finishUtterance` resolves.
   */
  pushFrame?(framePcm16: Int16Array): void;
  /** Resolve the transcript for the utterance accumulated since `start`. */
  finishUtterance(): Promise<string>;
  stop(): void;
};

export type TextToSpeechAdapter = {
  readonly id: string;
  readonly languages: readonly VoiceLanguage[];
  /** Synthesize `text` into an async stream of 8 kHz μ-law frames (20 ms / 160 bytes). */
  synthesize(text: string, language: VoiceLanguage): AsyncIterable<Buffer>;
};

export type SpeechAdapterBundle = {
  stt: () => SpeechToTextAdapter;
  tts: TextToSpeechAdapter;
  providerId: string;
};

export class SpeechProviderUnavailable extends Error {
  constructor(providerId: string, detail: string) {
    super(`speech provider "${providerId}" unavailable: ${detail}`);
    this.name = "SpeechProviderUnavailable";
  }
}
