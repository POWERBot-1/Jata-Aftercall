/**
 * Render modes and capability scoring (Immersive Website Engine — Phase 1)
 *
 * Every published website has three rendering tiers. The server always renders the full
 * content (Lite): business information, prices, WhatsApp/Call/Directions and ordering work
 * without JavaScript. The browser may then *upgrade* the presentation, never remove content:
 *
 *   LITE       server-rendered HTML/CSS, no motion library, no 3D. Always available.
 *   MOTION     CSS + IntersectionObserver reveals. Only when the device can afford it.
 *   IMMERSIVE  WebGL/WebGPU presentation. Requires a working WebGL context and is not yet
 *              implemented; until it is, the engine falls back to MOTION, then LITE.
 *
 * This module is pure: it takes plain signals and returns a decision, so it can be tested
 * without a browser. `readCapabilitySignals()` is the only function that touches globals and
 * it is defensive about every API being absent.
 */

export const RENDER_MODES = ["lite", "motion", "immersive"] as const;
export type RenderMode = (typeof RENDER_MODES)[number];

/** What an owner (or the document) may request. "auto" lets the capability score decide. */
export const RENDER_PREFERENCES = ["auto", "lite", "motion", "immersive"] as const;
export type RenderPreference = (typeof RENDER_PREFERENCES)[number];

/**
 * Modes this build can actually render. Immersive is intentionally absent until its engine
 * exists (Phase 5): requesting it must fall back, never render a blank canvas.
 */
export const IMPLEMENTED_RENDER_MODES: readonly RenderMode[] = ["lite", "motion"];

/** Score bands (0–100). Configurable: callers may pass their own thresholds. */
export const DEFAULT_CAPABILITY_THRESHOLDS = {
  /** Scores at or above this use MOTION. */
  motionMin: 31,
  /** Scores at or above this use IMMERSIVE (still gated by IMPLEMENTED_RENDER_MODES). */
  immersiveMin: 66,
} as const;

export type CapabilityThresholds = { motionMin: number; immersiveMin: number };

/** Plain facts about the visitor's device. Every field may be unknown. */
export type CapabilitySignals = {
  webgl: boolean;
  webgpu: boolean;
  /** navigator.deviceMemory (GB), when the browser exposes it. */
  deviceMemoryGB: number | null;
  /** navigator.hardwareConcurrency, when available. */
  hardwareConcurrency: number | null;
  viewportWidth: number | null;
  /** navigator.connection.effectiveType: "slow-2g" | "2g" | "3g" | "4g" … */
  effectiveType: string | null;
  saveData: boolean;
  reducedMotion: boolean;
};

export type CapabilityScore = {
  score: number;
  /** Plain-language reasons, for analytics and the owner's diagnostics (never shown to customers). */
  reasons: string[];
};

export type RenderDecision = {
  mode: RenderMode;
  /** The mode the score or preference asked for before fallbacks were applied. */
  requested: RenderMode;
  /** Why the mode differs from the requested one, if it does. */
  fallbackReason: string | null;
  score: number;
};

export function isRenderPreference(value: unknown): value is RenderPreference {
  return typeof value === "string" && (RENDER_PREFERENCES as readonly string[]).includes(value);
}

/** Scores the device on a 0–100 scale. Unknown signals score neutrally, never punitively. */
export function scoreCapabilities(signals: CapabilitySignals): CapabilityScore {
  const reasons: string[] = [];
  let score = 0;

  if (signals.webgl) {
    score += 25;
    reasons.push("webgl");
    if (signals.webgpu) {
      score += 10;
      reasons.push("webgpu");
    }
  } else {
    reasons.push("no-webgl");
  }

  const memory = signals.deviceMemoryGB;
  if (memory === null || !Number.isFinite(memory)) {
    score += 10;
    reasons.push("memory-unknown");
  } else if (memory < 2) {
    reasons.push("memory-low");
  } else if (memory < 4) {
    score += 10;
    reasons.push("memory-2-3gb");
  } else if (memory < 8) {
    score += 20;
    reasons.push("memory-4-7gb");
  } else {
    score += 30;
    reasons.push("memory-8gb+");
  }

  const cores = signals.hardwareConcurrency;
  if (cores === null || !Number.isFinite(cores)) {
    score += 5;
    reasons.push("cores-unknown");
  } else if (cores <= 2) {
    reasons.push("cores-low");
  } else if (cores <= 4) {
    score += 8;
    reasons.push("cores-3-4");
  } else {
    score += 15;
    reasons.push("cores-5+");
  }

  if (signals.effectiveType === "4g") {
    score += 15;
    reasons.push("network-4g");
  } else if (signals.effectiveType === null) {
    score += 8;
    reasons.push("network-unknown");
  } else {
    reasons.push(`network-${signals.effectiveType}`);
  }

  if (signals.viewportWidth !== null && signals.viewportWidth >= 1024) {
    score += 5;
    reasons.push("wide-viewport");
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

/** Maps a score to a mode using the configured bands. Never returns a mode above the score's band. */
export function modeForScore(score: number, thresholds: CapabilityThresholds = DEFAULT_CAPABILITY_THRESHOLDS): RenderMode {
  if (score >= thresholds.immersiveMin) return "immersive";
  if (score >= thresholds.motionMin) return "motion";
  return "lite";
}

const FALLBACK_ORDER: RenderMode[] = ["immersive", "motion", "lite"];

/**
 * Decides the mode a visitor actually gets.
 *
 *  1. Reduced motion, Save-Data or a 2G/3G-class connection always get LITE. These are the
 *     visitor's explicit or practical constraints and they override any preference.
 *  2. Otherwise the owner's preference wins if it is "lite"/"motion"/"immersive"; "auto" uses the score.
 *  3. IMMERSIVE needs WebGL. Without it, or when the mode is not implemented, the engine
 *     steps down IMMERSIVE → MOTION → LITE. It never steps up.
 */
export function resolveRenderMode(input: {
  preference?: RenderPreference | string | null;
  signals: CapabilitySignals;
  thresholds?: CapabilityThresholds;
  implemented?: readonly RenderMode[];
}): RenderDecision {
  const implemented = input.implemented ?? IMPLEMENTED_RENDER_MODES;
  const { score } = scoreCapabilities(input.signals);
  const preference = isRenderPreference(input.preference) ? input.preference : "auto";
  const requested: RenderMode = preference === "auto" ? modeForScore(score, input.thresholds) : (preference as RenderMode);

  const constrained =
    input.signals.reducedMotion ||
    input.signals.saveData ||
    input.signals.effectiveType === "slow-2g" ||
    input.signals.effectiveType === "2g" ||
    input.signals.effectiveType === "3g";

  if (constrained) {
    const reason = input.signals.reducedMotion
      ? "reduced-motion"
      : input.signals.saveData
        ? "save-data"
        : "slow-connection";
    return { mode: "lite", requested, fallbackReason: requested === "lite" ? null : reason, score };
  }

  let mode = requested;
  let fallbackReason: string | null = null;
  if (mode === "immersive" && !input.signals.webgl) {
    mode = "motion";
    fallbackReason = "no-webgl";
  }

  const startIndex = FALLBACK_ORDER.indexOf(mode);
  for (let index = startIndex; index < FALLBACK_ORDER.length; index += 1) {
    const candidate = FALLBACK_ORDER[index];
    if (implemented.includes(candidate)) {
      mode = candidate;
      break;
    }
  }
  if (mode !== requested && fallbackReason === null) fallbackReason = "not-implemented";

  return { mode, requested, fallbackReason, score };
}

/**
 * Reads the visitor's capabilities in the browser. Every access is guarded: a missing API
 * yields `null`/`false`, so this function cannot throw on old WebViews or privacy-hardened browsers.
 */
export function readCapabilitySignals(win: Window | undefined = typeof window === "undefined" ? undefined : window): CapabilitySignals {
  const empty: CapabilitySignals = {
    webgl: false,
    webgpu: false,
    deviceMemoryGB: null,
    hardwareConcurrency: null,
    viewportWidth: null,
    effectiveType: null,
    saveData: false,
    reducedMotion: false,
  };
  if (!win) return empty;

  let webgl = false;
  try {
    const canvas = win.document.createElement("canvas");
    webgl = Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    webgl = false;
  }

  const nav = win.navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; saveData?: boolean };
    gpu?: unknown;
  };
  let reducedMotion = false;
  try {
    reducedMotion = typeof win.matchMedia === "function" && win.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    reducedMotion = false;
  }

  return {
    webgl,
    webgpu: Boolean(nav?.gpu),
    deviceMemoryGB: typeof nav?.deviceMemory === "number" ? nav.deviceMemory : null,
    hardwareConcurrency: typeof nav?.hardwareConcurrency === "number" ? nav.hardwareConcurrency : null,
    viewportWidth: typeof win.innerWidth === "number" ? win.innerWidth : null,
    effectiveType: typeof nav?.connection?.effectiveType === "string" ? nav.connection.effectiveType : null,
    saveData: Boolean(nav?.connection?.saveData),
    reducedMotion,
  };
}
