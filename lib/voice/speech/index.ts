/**
 * Speech provider selection (§Voice deliverable 4).
 * Fail-closed: no configuration → null; callers must handle an absent bundle by refusing
 * the call rather than serving an undetectable degraded experience.
 */
import type { VoiceLanguage } from "../types";
import { createLoopbackStt, createLoopbackTts, type LoopbackStt, type LoopbackTts } from "./loopback";
import { createOpenAiStt, createOpenAiTts, type OpenAiSpeechConfig } from "./openai";
import type { SpeechToTextAdapter, TextToSpeechAdapter } from "./types";

export * from "./types";

export type SpeechEnvironment = {
  VOICE_AI_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  [key: string]: string | undefined;
};

export type ResolvedSpeech = {
  providerId: string;
  createStt: (language: VoiceLanguage) => SpeechToTextAdapter;
  tts: TextToSpeechAdapter;
};

export function resolveSpeechAdapters(env: SpeechEnvironment = process.env): ResolvedSpeech | null {
  const provider = env.VOICE_AI_PROVIDER?.trim().toLowerCase();
  if (provider === "loopback" || provider === "test") {
    return {
      providerId: "loopback",
      createStt: () => createLoopbackStt() as LoopbackStt,
      tts: createLoopbackTts() as LoopbackTts,
    };
  }
  if (provider === "openai") {
    const apiKey = env.OPENAI_API_KEY?.trim();
    if (!apiKey) return null;
    const config: OpenAiSpeechConfig = { apiKey, baseUrl: env.OPENAI_BASE_URL };
    return {
      providerId: "openai",
      createStt: (language) => createOpenAiStt(config, language),
      tts: createOpenAiTts(config),
    };
  }
  return null;
}
