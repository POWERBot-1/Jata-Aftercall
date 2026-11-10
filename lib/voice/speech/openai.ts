/**
 * Reference HTTP speech provider adapter (OpenAI-compatible endpoints).
 *
 * This adapter is fully implemented but NEVER active without explicit configuration:
 * `VOICE_AI_PROVIDER=openai` plus a server-side API key must be present (readiness gates
 * already treat VOICE_AI_PROVIDER as required configuration). Swapping to another approved
 * provider means adding a sibling adapter implementing the same contracts — no worker or
 * pipeline redesign.
 *
 * STT: utterance-level transcription (audio arrives endpointed from the VAD; `pushFrame`
 * accumulates so a future websocket recognizer can stream partials through the same port).
 * TTS: synthesizes to 24 kHz s16le and converts down to the 8 kHz μ-law frames Telnyx needs.
 */
import { pcm16ToMuLaw, resamplePcm16 } from "../audio";
import { VOICE_LANGUAGES, type VoiceLanguage } from "../types";
import { SpeechProviderUnavailable, type SpeechToTextAdapter, type TextToSpeechAdapter } from "./types";

export type OpenAiSpeechConfig = {
  apiKey: string;
  baseUrl?: string;
  sttModel?: string;
  ttsModel?: string;
  ttsVoice?: string;
  fetchImpl?: typeof fetch;
};

export function createOpenAiStt(config: OpenAiSpeechConfig, initialLanguage: VoiceLanguage = "en"): SpeechToTextAdapter & { deliverUtterance: (text: string) => void } {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = (config.baseUrl ?? "https://api.openai.com").replace(/\/$/, "");
  let language = initialLanguage;
  let callbacks: { onFinal: (text: string) => void; onPartial?: (text: string) => void; onError?: (error: Error) => void } | null = null;
  let buffer: number[] = [];
  const delivered: string[] = [];

  return {
    id: "openai",
    languages: VOICE_LANGUAGES,
    start(lang, cb) {
      language = lang;
      callbacks = cb;
      buffer = [];
    },
    pushFrame(framePcm16: Int16Array) {
      for (let i = 0; i < framePcm16.length; i += 1) buffer.push(framePcm16[i]);
    },
    async finishUtterance(): Promise<string> {
      if (buffer.length === 0) return "";
      const pcm = Int16Array.from(buffer);
      buffer = [];
      try {
        const wav = pcm16leToWav(pcm, 8000);
        const form = new FormData();
        form.append("file", new Blob([new Uint8Array(wav)], { type: "audio/wav" }), "utterance.wav");
        form.append("model", config.sttModel ?? "whisper-1");
        form.append("language", language);
        const response = await fetchImpl(`${baseUrl}/v1/audio/transcriptions`, {
          method: "POST",
          headers: { Authorization: `Bearer ${config.apiKey}` },
          body: form,
        });
        if (!response.ok) throw new Error(`STT HTTP ${response.status}`);
        const json = (await response.json()) as { text?: string };
        const text = (json.text ?? "").trim();
        if (text) callbacks?.onFinal?.(text);
        return text;
      } catch (error) {
        const err = error instanceof Error ? error : new Error("STT failed");
        callbacks?.onError?.(err);
        throw new SpeechProviderUnavailable("openai", err.message);
      }
    },
    deliverUtterance(text: string) {
      delivered.push(text);
      callbacks?.onFinal(text);
    },
    stop() {
      callbacks = null;
      buffer = [];
    },
  };
}

export function createOpenAiTts(config: OpenAiSpeechConfig): TextToSpeechAdapter {
  const fetchImpl = config.fetchImpl ?? fetch;
  const baseUrl = (config.baseUrl ?? "https://api.openai.com").replace(/\/$/, "");
  return {
    id: "openai",
    languages: VOICE_LANGUAGES,
    async *synthesize(text: string, language: VoiceLanguage): AsyncIterable<Buffer> {
      const response = await fetchImpl(`${baseUrl}/v1/audio/speech`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: config.ttsModel ?? "tts-1",
          voice: config.ttsVoice ?? "alloy",
          input: text,
          response_format: "pcm",
          speed: 1,
        }),
      });
      if (!response.ok) throw new SpeechProviderUnavailable("openai", `TTS HTTP ${response.status}`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      // OpenAI `pcm` is 24 kHz s16le mono — downsample to the Telnyx 8 kHz μ-law wire format.
      const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 2));
      const downsampled = resamplePcm16(samples, 24000, 8000);
      const muLaw = pcm16ToMuLaw(downsampled);
      for (let offset = 0; offset < muLaw.length; offset += 160) {
        yield muLaw.subarray(offset, Math.min(muLaw.length, offset + 160));
      }
      void language;
    },
  };
}

/** Minimal canonical WAV container (PCM s16le) around the utterance for upload. */
function pcm16leToWav(samples: Int16Array, sampleRate: number): Buffer {
  const dataSize = samples.length * 2;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataSize, 40);
  const data = Buffer.alloc(dataSize);
  for (let i = 0; i < samples.length; i += 1) data.writeInt16LE(samples[i], i * 2);
  return Buffer.concat([header, data]);
}
