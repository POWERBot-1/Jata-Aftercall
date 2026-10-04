/**
 * AI provider contract (§42, §56)
 *
 * Website Studio never talks to a vendor directly. It asks the registry for a provider and
 * uses one of four capabilities:
 *
 *   generateImage()    — create a marketing/hero image
 *   enhanceImage()     — improve a photo the owner already has
 *   generateCopy()     — write a description, headline, FAQ answer or SEO line
 *   generateAltText()  — describe an image for screen readers
 *
 * Providers are chosen from server-side environment configuration only. Keys never leave the
 * server, and a provider that is not configured simply is not returned: the Studio falls back
 * to the built-in JATA provider rather than showing a button that does nothing (§58).
 */

import type { DesignContext } from "./designContext";

export type ProviderCapabilities = {
  /** Can produce a brand-new image. */
  imageGeneration: boolean;
  /** Can edit an image the owner supplied. */
  imageEditing: boolean;
  /** Can write text grounded in supplied facts. */
  textGeneration: boolean;
  /** Output is photographic rather than designed artwork. */
  photorealistic: boolean;
  /** Provider is configured and reachable (keys present). */
  configured: boolean;
};

export type ImageRequest = {
  /** Fully-built prompt — see `lib/ai/promptBuilder.ts`. Never raw user input. */
  prompt: string;
  /** What the Studio is filling, which also decides composition. */
  placement: "product" | "service" | "hero" | "gallery" | "logo" | "background";
  width: number;
  height: number;
  count: number;
  /** Deterministic style seed so repeated generations look like one brand. */
  seed: string;
  design: DesignContext;
  /** Reference image (data URL) when the owner wants their own photo respected. */
  referenceImage?: string | null;
  negativePrompt?: string | null;
};

export type GeneratedImage = {
  dataUrl: string;
  mime: string;
  width: number;
  height: number;
  /** True when the provider produced designed artwork rather than a photograph (§15). */
  representative: boolean;
};

export type EnhanceRequest = {
  /** The owner's own photo, as a data URL. */
  image: string;
  instructions: string;
  width: number;
  height: number;
  design: DesignContext;
  /** Photos of real products must keep their identity (§14, §15). */
  preserveIdentity: boolean;
};

export type TextRequest = {
  /** What is being written — drives the shape of the answer. */
  kind: string;
  system: string;
  prompt: string;
  maxChars: number;
  /** Facts the model is allowed to use. Anything else is fabrication (§55). */
  facts: string[];
  design: DesignContext;
  /** How many alternatives to return. */
  count: number;
  seed: string;
};

export type TextResult = {
  texts: string[];
  /** True when the text was composed locally rather than by a model. */
  deterministic: boolean;
};

export type ProviderContext = {
  /** Scoped so a provider can be traced back to a generation record without logging content. */
  businessId: string;
  generationId: string;
  /** Milliseconds the provider must respect before giving up. */
  timeoutMs: number;
  signal?: AbortSignal;
};

export interface AiProvider {
  /** Stable machine key stored on every generation record. */
  key: string;
  /** Human label shown in the Studio ("JATA built-in", "OpenAI"). */
  label: string;
  /** Model identity for observability, e.g. `gpt-image-1`. */
  modelKey: string;
  capabilities: ProviderCapabilities;
  generateImage(request: ImageRequest, context: ProviderContext): Promise<GeneratedImage[]>;
  enhanceImage(request: EnhanceRequest, context: ProviderContext): Promise<GeneratedImage[]>;
  generateText(request: TextRequest, context: ProviderContext): Promise<TextResult>;
}

export class ProviderError extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, message: string, options: { retryable?: boolean } = {}) {
    super(message);
    this.name = "ProviderError";
    this.code = code;
    this.retryable = options.retryable ?? true;
  }
}

/** Owner-facing sentence for a failed generation (§39). Never a vendor stack trace. */
export function providerErrorMessage(error: unknown): { message: string; code: string; retryable: boolean } {
  if (error instanceof ProviderError) {
    switch (error.code) {
      case "not_configured":
        return {
          message: "Photo generation isn't connected on this account yet. JATA can still design branded artwork for you.",
          code: error.code,
          retryable: false,
        };
      case "rate_limited":
        return { message: "We're creating a lot of images right now. Try again in a minute.", code: error.code, retryable: true };
      case "timeout":
        return {
          message: "Creating the image took too long. Your business information is safe — try again.",
          code: error.code,
          retryable: true,
        };
      case "auth":
        return {
          message: "Image generation needs reconnecting. Your website and photos are unaffected.",
          code: error.code,
          retryable: false,
        };
      case "blocked":
        return { message: "That image couldn't be created. Try describing your product in a different way.", code: error.code, retryable: false };
      default:
        return { message: "We couldn't create the image this time. Your business information is safe. Try again.", code: error.code, retryable: true };
    }
  }
  return { message: "We couldn't create the image this time. Your business information is safe. Try again.", code: "unknown", retryable: true };
}

/**
 * Runs a provider call with a hard timeout and at most one retry. Two attempts is deliberate:
 * it recovers from a dropped mobile connection without creating a runaway generation loop
 * (§17, §51).
 */
export async function withRetry<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  options: { timeoutMs: number; attempts?: number; onAttempt?: (attempt: number, error?: unknown) => void; signal?: AbortSignal },
): Promise<T> {
  const attempts = Math.max(1, Math.min(2, options.attempts ?? 2));
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, Math.max(1000, options.timeoutMs));
    const onAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await fn(controller.signal);
    } catch (error) {
      lastError = timedOut && !(error instanceof ProviderError) ? new ProviderError("timeout", "Provider timed out") : error;
      options.onAttempt?.(attempt, lastError);
      const retryable = !(lastError instanceof ProviderError) || lastError.retryable;
      if (!retryable || attempt === attempts) break;
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
    }
  }
  throw lastError instanceof Error ? lastError : new ProviderError("unknown", "Generation failed");
}
