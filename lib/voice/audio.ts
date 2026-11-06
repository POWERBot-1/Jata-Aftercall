/**
 * Audio primitives for the voice pipeline: G.711 μ-law (8 kHz) codec, resampling and
 * energy-based voice-activity detection. Pure CPU code — no I/O, no providers.
 * Telnyx media streaming delivers/accepts 8 kHz μ-law frames; speech providers want s16le.
 */

/** Decode one G.711 μ-law byte to a signed 16-bit sample (ITU-T G.711 / Sun g711 convention). */
export function decodeMuLawByte(byte: number): number {
  const u = ~byte & 0xff;
  let t = ((u & 0x0f) << 3) + 0x84;
  t <<= (u & 0x70) >> 4;
  return u & 0x80 ? 0x84 - t : t - 0x84;
}

const MU_LAW_TABLE: Int16Array = (() => {
  const table = new Int16Array(256);
  for (let b = 0; b < 256; b += 1) table[b] = decodeMuLawByte(b);
  return table;
})();

/** Encode a signed 16-bit sample as one G.711 μ-law byte (nearest decode-table value). */
export function encodeMuLawSample(sample: number): number {
  const target = Math.max(-32768, Math.min(32767, Math.round(sample)));
  let best = 0;
  let bestDistance = Number.MAX_SAFE_INTEGER;
  for (let b = 0; b < 256; b += 1) {
    const distance = Math.abs(MU_LAW_TABLE[b] - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = b;
      if (distance === 0) break;
    }
  }
  return best;
}

/** Decode a μ-law byte buffer into s16le samples. */
export function muLawToPcm16(buffer: Buffer | Uint8Array): Int16Array {
  const out = new Int16Array(buffer.length);
  for (let i = 0; i < buffer.length; i += 1) out[i] = decodeMuLawByte(buffer[i]);
  return out;
}

/** Encode s16le samples as μ-law bytes. */
export function pcm16ToMuLaw(samples: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(samples.length);
  for (let i = 0; i < samples.length; i += 1) out[i] = encodeMuLawSample(samples[i]);
  return out;
}

/** Linear decimation with 3-sample block averaging (24 kHz → 8 kHz, also 16 kHz → 8 kHz). */
export function resamplePcm16(samples: Int16Array, fromRate: number, toRate: number): Int16Array {
  if (fromRate === toRate) return samples;
  const step = fromRate / toRate;
  if (!Number.isInteger(step) || step < 1) {
    // Generic fallback: nearest-neighbour (only used for non-integer ratios).
    const outLength = Math.floor(samples.length * (toRate / fromRate));
    const out = new Int16Array(outLength);
    for (let i = 0; i < outLength; i += 1) out[i] = samples[Math.min(samples.length - 1, Math.floor(i * (fromRate / toRate)))] ?? 0;
    return out;
  }
  const outLength = Math.floor(samples.length / step);
  const out = new Int16Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    let sum = 0;
    for (let j = 0; j < step; j += 1) sum += samples[i * step + j] ?? 0;
    out[i] = Math.round(sum / step);
  }
  return out;
}

/** Root-mean-square energy of s16le samples. */
export function rms(samples: Int16Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export type VadConfig = {
  /** RMS above which a frame counts as speech. */
  threshold: number;
  /** Minimum continuous speech before an utterance may open. */
  minSpeechMs: number;
  /** Silence that closes an open utterance. */
  tailSilenceMs: number;
  /** Frame duration assumed (Telnyx default 20 ms). */
  frameMs: number;
};

export const DEFAULT_VAD_CONFIG: VadConfig = {
  threshold: 450,
  minSpeechMs: 240,
  tailSilenceMs: 700,
  frameMs: 20,
};

export type VadEvent =
  | { type: "UTTERANCE_START"; atMs: number }
  | { type: "UTTERANCE_END"; atMs: number; pcm: Int16Array }
  | null;

/**
 * Energy VAD with hysteresis: opens after `minSpeechMs` of voiced frames and closes after
 * `tailSilenceMs` of unvoiced frames, returning the accumulated utterance audio once.
 */
export class VoiceActivityDetector {
  private readonly config: VadConfig;
  private speaking = false;
  private speechRunMs = 0;
  private silenceRunMs = 0;
  private clockMs = 0;
  private collected: number[] = [];
  private preRoll: Int16Array[] = [];

  constructor(config: Partial<VadConfig> = {}) {
    this.config = { ...DEFAULT_VAD_CONFIG, ...config };
  }

  reset(): void {
    this.speaking = false;
    this.speechRunMs = 0;
    this.silenceRunMs = 0;
    this.collected = [];
  }

  /** Feed one frame of s16le samples; may emit exactly one event per call. */
  push(samples: Int16Array): VadEvent {
    this.clockMs += this.config.frameMs;
    const voiced = rms(samples) >= this.config.threshold;

    if (!this.speaking) {
      // Keep a look-back window so opening an utterance does not clip its first words.
      this.preRoll.push(samples.slice());
      const maxPreRoll = Math.ceil(this.config.minSpeechMs / this.config.frameMs) + 2;
      while (this.preRoll.length > maxPreRoll) this.preRoll.shift();
      this.speechRunMs = voiced ? this.speechRunMs + this.config.frameMs : 0;
      this.silenceRunMs = 0;
      if (this.speechRunMs >= this.config.minSpeechMs) {
        this.speaking = true;
        this.silenceRunMs = 0;
        this.collected = [];
        for (const frame of this.preRoll) {
          for (let i = 0; i < frame.length; i += 1) this.collected.push(frame[i]);
        }
        this.preRoll = [];
        return { type: "UTTERANCE_START", atMs: this.clockMs };
      }
      return null;
    }

    // Speaking: accumulate audio (a short look-back of the opening speech is included by
    // construction because we start collecting from the open event onward).
    this.append(samples);
    if (voiced) {
      this.silenceRunMs = 0;
      return null;
    }
    this.silenceRunMs += this.config.frameMs;
    if (this.silenceRunMs >= this.config.tailSilenceMs) {
      const pcm = Int16Array.from(this.collected);
      this.reset();
      return { type: "UTTERANCE_END", atMs: this.clockMs, pcm };
    }
    return null;
  }

  /** Force-close any open utterance (session stop / barge-in reset). */
  finish(): Int16Array | null {
    if (!this.speaking) return null;
    const pcm = Int16Array.from(this.collected);
    this.reset();
    return pcm;
  }

  isOpen(): boolean {
    return this.speaking;
  }

  private append(samples: Int16Array): void {
    for (let i = 0; i < samples.length; i += 1) this.collected.push(samples[i]);
    // Hard cap (~30 s of audio) so a stuck open utterance cannot exhaust memory.
    if (this.collected.length > 8000 * 30) this.collected.splice(0, this.collected.length - 8000);
  }
}

/** Build a 20 ms μ-law silence frame (0xFF encodes linear 0). */
export function silenceMuLawFrame(frameBytes = 160): Buffer {
  return Buffer.alloc(frameBytes, 0xff);
}

/** Deterministic speech-like μ-law frame for tests/loopback (above typical VAD threshold). */
export function syntheticSpeechFrame(frameBytes = 160, seed = 1): Buffer {
  const samples = new Int16Array(frameBytes);
  let state = (seed * 1103515245 + 12345) & 0x7fffffff;
  for (let i = 0; i < frameBytes; i += 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    samples[i] = ((state % 4000) - 2000) * 4; // ±8000 energy — comfortably voiced
  }
  return pcm16ToMuLaw(samples);
}
