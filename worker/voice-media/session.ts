/**
 * Persistent voice media session (§Voice deliverable 3 — core logic).
 *
 * Runs inside the dedicated media worker (NOT a Vercel HTTP function). One session per
 * Telnyx media-streaming connection. Responsibilities:
 * - bidirectional 8 kHz μ-law audio framing over the transport,
 * - silence detection (VAD) with utterance endpointing,
 * - barge-in: caller speech during playback clears the playout and restarts listening,
 * - speech recognition → front-desk assistant → synthesis, English/Kiswahili switching,
 * - idle prompts, call-duration caps, graceful failure and deterministic session cleanup.
 *
 * All external effects (transport, speech, assistant, handoff, hangup) are injected so the
 * session is fully testable without a provider or network.
 */
import {
  DEFAULT_VAD_CONFIG,
  VoiceActivityDetector,
  decodeMuLawByte,
  encodeMuLawSample,
  muLawToPcm16,
} from "@/lib/voice/audio";
import { runAssistantTurn, type AssistantTurn } from "@/lib/voice/assistant";
import type { HandoffOutcome } from "@/lib/voice/handoff";
import type { ResolvedSpeech } from "@/lib/voice/speech";
import type { SpeechToTextAdapter } from "@/lib/voice/speech/types";
import { isVoiceLanguage, type VoiceLanguage } from "@/lib/voice/types";

export type MediaTransport = {
  sendJson: (message: unknown) => void;
  close?: (code?: number) => void;
};

export type SessionConfig = {
  idlePromptMs: number;
  maxPrompts: number;
  maxCallSeconds: number;
  framePaceMs: number;
  vad: Partial<typeof DEFAULT_VAD_CONFIG>;
};

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  idlePromptMs: 15_000,
  maxPrompts: 2,
  maxCallSeconds: 900,
  framePaceMs: 20,
  vad: {},
};

export type SessionDeps = {
  callControlId: string;
  businessId: string;
  language?: VoiceLanguage;
  transport: MediaTransport;
  speech: ResolvedSpeech;
  loadContext: (businessId: string) => Promise<{ businessName: string; facts: string[]; businessPhone: string | null }>;
  onHandoff?: (context: { businessPhone: string | null }) => Promise<HandoffOutcome>;
  onHangup: (cause: string) => Promise<void>;
  onUpdateLanguage?: (language: VoiceLanguage) => Promise<void>;
  llm?: (input: { system: string; prompt: string; facts: string[] }) => Promise<string | null>;
  config?: Partial<SessionConfig>;
  now?: () => number;
};

export type SessionMetrics = {
  framesIn: number;
  framesOut: number;
  utterances: number;
  interruptions: number;
  turns: number;
  startedAtMs: number | null;
  endedAtMs: number | null;
  endReason: string | null;
};

type TelnyxClientMessage = {
  event?: string;
  start?: { call_control_id?: string };
  media?: { payload?: string; track?: string };
  stop?: unknown;
  dtmf?: { digit?: string };
};

export class VoiceMediaSession {
  readonly callControlId: string;
  readonly metrics: SessionMetrics = {
    framesIn: 0,
    framesOut: 0,
    utterances: 0,
    interruptions: 0,
    turns: 0,
    startedAtMs: null,
    endedAtMs: null,
    endReason: null,
  };

  private readonly deps: SessionDeps;
  private readonly config: SessionConfig;
  private readonly vad: VoiceActivityDetector;
  private readonly transport: MediaTransport;
  private stt: SpeechToTextAdapter | null = null;
  private language: VoiceLanguage;
  private context: { businessName: string; facts: string[]; businessPhone: string | null } | null = null;
  private playbackAbort = false;
  private playing = false;
  private stopped = false;
  private turnIndex = 0;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private maxTimer: ReturnType<typeof setTimeout> | null = null;
  private promptCount = 0;
  private utteranceInFlight: Promise<void> | null = null;
  private pendingUtterances: Int16Array[] = [];

  constructor(deps: SessionDeps) {
    this.deps = deps;
    this.config = { ...DEFAULT_SESSION_CONFIG, ...deps.config };
    this.transport = deps.transport;
    this.language = deps.language && isVoiceLanguage(deps.language) ? deps.language : "en";
    this.vad = new VoiceActivityDetector({ ...DEFAULT_VAD_CONFIG, ...this.config.vad });
  }

  /** Entry point for every Telnyx media-streaming client message. */
  handleMessage(message: TelnyxClientMessage): void {
    if (this.stopped) return;
    switch (message.event) {
      case "start":
        this.onStart();
        break;
      case "media":
        this.onMedia(message.media?.payload);
        break;
      case "stop":
        this.stop("provider_stop");
        break;
      case "dtmf":
        // DTMF is ignored except as an interrupt signal: it cancels playout.
        if (this.playing) this.triggerBargeIn();
        break;
      default:
        break;
    }
  }

  private onStart(): void {
    if (this.metrics.startedAtMs !== null) return;
    this.metrics.startedAtMs = this.deps.now?.() ?? Date.now();
    this.maxTimer = setTimeout(() => {
      void this.stop("max_call_duration");
    }, this.config.maxCallSeconds * 1000);
    this.armIdleTimer();
    void this.deps.loadContext(this.deps.businessId).then((context) => {
      this.context = context;
    }).catch(() => {
      this.context = { businessName: "your business", facts: [], businessPhone: null };
    });
  }

  private onMedia(payload: string | undefined): void {
    if (!payload || this.stopped) return;
    this.metrics.framesIn += 1;
    const bytes = Buffer.from(payload, "base64");
    const samples = muLawToPcm16(bytes);

    // Barge-in: caller speech while the assistant is speaking cancels playout immediately.
    if (this.playing) {
      const energy = this.frameEnergy(samples);
      if (energy >= (this.config.vad.threshold ?? DEFAULT_VAD_CONFIG.threshold)) {
        this.triggerBargeIn();
      }
    }

    const event = this.vad.push(samples);
    if (event?.type === "UTTERANCE_START") {
      this.clearIdleTimer();
    } else if (event?.type === "UTTERANCE_END") {
      const pcm = event.pcm;
      // Serialize utterances: if recognition/reply from a previous utterance is still in
      // flight, queue this one (bounded) instead of replacing the in-flight turn — two
      // overlapping replies would race on the shared turn index and language state.
      if (this.utteranceInFlight) {
        if (this.pendingUtterances.length < MAX_PENDING_UTTERANCES) this.pendingUtterances.push(pcm);
        return;
      }
      const utterance = this.utteranceInFlight = this.handleUtterance(pcm).finally(() => {
        if (this.utteranceInFlight === utterance) {
          this.utteranceInFlight = null;
          const next = this.pendingUtterances.shift();
          if (next && !this.stopped) {
            const chained = this.utteranceInFlight = this.handleUtterance(next).finally(() => {
              if (this.utteranceInFlight === chained) this.utteranceInFlight = null;
            });
            void chained.catch(() => undefined);
          }
        }
      });
      void utterance.catch(() => undefined);
    }
  }

  private async handleUtterance(pcm: Int16Array): Promise<void> {
    if (this.stopped) return;
    this.metrics.utterances += 1;
    const stt = this.deps.speech.createStt(this.language);
    this.stt = stt;
    let transcript = "";
    stt.start(this.language, {
      onFinal: (text) => {
        transcript = text;
      },
      onError: () => undefined,
    });
    try {
      stt.pushFrame?.(pcm);
      const finished = await stt.finishUtterance();
      transcript = finished || transcript;
    } catch {
      // Recognition failure: re-prompt instead of hanging up (graceful failure).
      await this.speak(this.language === "sw" ? "Samahani, sikusikia vizuri. Tafadhali rudia." : "Sorry, I did not catch that. Please say it again.");
      this.armIdleTimer();
      return;
    } finally {
      stt.stop();
      if (this.stt === stt) this.stt = null;
    }
    if (!transcript || this.stopped) {
      this.armIdleTimer();
      return;
    }

    const context = this.context ?? (this.context = await this.deps.loadContext(this.deps.businessId).catch(() => ({
      businessName: "your business",
      facts: [],
      businessPhone: null,
    })));

    const turn: AssistantTurn = await runAssistantTurn({
      transcript,
      language: this.language,
      businessName: context.businessName,
      facts: context.facts,
      turnIndex: this.turnIndex,
      llm: this.deps.llm,
    });
    this.turnIndex += 1;
    this.metrics.turns += 1;
    if (turn.language !== this.language) {
      this.language = turn.language;
      void this.deps.onUpdateLanguage?.(turn.language).catch(() => undefined);
    }

    if (turn.intent === "HANDOFF" && this.deps.onHandoff) {
      // Acknowledge first (“let me connect you…”) so the caller is never left in silence
      // while the transfer is attempted.
      await this.speak(turn.reply);
      const outcome = await this.deps.onHandoff({ businessPhone: context.businessPhone });
      if (outcome.result === "TERMINATED") {
        this.stop("handoff_terminated");
        return;
      }
      if (outcome.result === "TRANSFERRED") {
        // Media stops flowing to us when the provider bridges the transfer; wait for stop.
        this.clearIdleTimer();
        return;
      }
      // FALLBACK_TO_AGENT: tell the caller and keep the session alive.
      await this.speak(this.language === "sw" ? "Samahani, hakuna kupatikana sasa hivi. Nikusaidie hapa?" : "Sorry, the team is unreachable right now. Can I help you here instead?");
      this.armIdleTimer();
      return;
    }

    await this.speak(turn.reply);
    if (turn.intent === "GOODBYE") {
      this.stop("goodbye");
      return;
    }
    if (!this.stopped) this.armIdleTimer();
  }

  private async speak(text: string): Promise<void> {
    if (this.stopped) return;
    this.playing = true;
    this.playbackAbort = false;
    try {
      for await (const frame of this.deps.speech.tts.synthesize(text, this.language)) {
        if (this.playbackAbort || this.stopped) break;
        this.sendAudio(frame);
        if (this.config.framePaceMs > 0) await delay(this.config.framePaceMs);
      }
    } catch {
      // Synthesis failure is non-fatal: the caller keeps the line and the flow continues.
    } finally {
      this.playing = false;
      this.playbackAbort = false;
    }
  }

  private triggerBargeIn(): void {
    this.playbackAbort = true;
    this.metrics.interruptions += 1;
    this.vad.reset();
    this.transport.sendJson({ clear: {} });
  }

  private sendAudio(frame: Buffer): void {
    if (this.stopped) return;
    this.metrics.framesOut += 1;
    const sized = frame.length === 160 ? frame : normalizeFrame(frame);
    this.transport.sendJson({ media: { payload: sized.toString("base64") } });
  }

  private armIdleTimer(): void {
    this.clearIdleTimer();
    if (this.stopped) return;
    this.idleTimer = setTimeout(() => {
      if (this.stopped) return;
      this.promptCount += 1;
      if (this.promptCount > this.config.maxPrompts) {
        void this.stop("idle_timeout");
        return;
      }
      void this.speak(this.language === "sw" ? "Bado uko hapo?" : "Are you still there?").then(() => {
        if (!this.stopped) this.armIdleTimer();
      });
    }, this.config.idlePromptMs);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }

  private frameEnergy(samples: Int16Array): number {
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) sum += samples[i] * samples[i];
    return Math.sqrt(sum / Math.max(1, samples.length));
  }

  /** Deterministic cleanup — safe to call any number of times. */
  async stop(reason: string): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.metrics.endedAtMs = this.deps.now?.() ?? Date.now();
    this.metrics.endReason = reason;
    this.clearIdleTimer();
    if (this.maxTimer) {
      clearTimeout(this.maxTimer);
      this.maxTimer = null;
    }
    this.vad.reset();
    this.stt?.stop();
    this.stt = null;
    this.playbackAbort = true;
    try {
      await this.deps.onHangup(reason);
    } catch {
      // Termination must be attempted even if the provider call fails.
    }
  }

  isStopped(): boolean {
    return this.stopped;
  }
}

function normalizeFrame(frame: Buffer): Buffer {
  const out = Buffer.alloc(160, 0xff);
  frame.copy(out, 0, 0, Math.min(160, frame.length));
  return out;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Bounded queue of completed-but-unprocessed utterances (speech serialization). */
const MAX_PENDING_UTTERANCES = 2;

export { decodeMuLawByte, encodeMuLawSample };
