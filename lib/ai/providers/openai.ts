/**
 * OpenAI image/text adapter (§42, §56)
 *
 * One of several interchangeable providers. It is only registered when `OPENAI_API_KEY` is
 * present server-side; the key is read from the environment at call time and is never returned
 * to a client, logged, or embedded in a prompt.
 *
 * Swapping vendors is a configuration change: nothing in the Studio imports this file.
 */

import { ProviderError, withRetry, type AiProvider, type EnhanceRequest, type GeneratedImage, type ImageRequest, type ProviderCapabilities, type ProviderContext, type TextRequest, type TextResult } from "../provider";

const DEFAULT_IMAGE_MODEL = "gpt-image-1";
const DEFAULT_TEXT_MODEL = "gpt-4o-mini";

function apiKey(): string {
  return (process.env.OPENAI_API_KEY || "").trim();
}

function baseUrl(): string {
  return (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
}

export function isOpenAiConfigured(): boolean {
  return apiKey().length > 10;
}

function imageSize(request: ImageRequest): string {
  const ratio = request.width / Math.max(1, request.height);
  if (ratio > 1.2) return "1536x1024";
  if (ratio < 0.85) return "1024x1536";
  return "1024x1024";
}

function mapError(status: number, body: unknown): ProviderError {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
  if (status === 401 || status === 403) return new ProviderError("auth", "OpenAI rejected the credentials", { retryable: false });
  if (status === 429) return new ProviderError("rate_limited", "OpenAI rate limit reached");
  if (status === 400 && /content_policy|safety|moderation/i.test(text)) {
    return new ProviderError("blocked", "The image request was refused by the provider", { retryable: false });
  }
  if (status >= 500) return new ProviderError("provider_unavailable", "OpenAI is unavailable");
  return new ProviderError("request_failed", `OpenAI request failed (${status})`);
}

async function postJson(path: string, payload: unknown, signal: AbortSignal): Promise<any> {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey()}`,
    },
    body: JSON.stringify(payload),
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw mapError(response.status, body);
  return body;
}

function dataUrlFrom(base64: string, mime = "image/png"): string {
  return `data:${mime};base64,${base64}`;
}

function dimensionsFor(request: ImageRequest): { width: number; height: number } {
  const size = imageSize(request);
  const [width, height] = size.split("x").map((value) => Number(value));
  return { width: width || 1024, height: height || 1024 };
}

const CAPABILITIES: ProviderCapabilities = {
  imageGeneration: true,
  imageEditing: true,
  textGeneration: true,
  photorealistic: true,
  configured: true,
};

export const openAiProvider: AiProvider = {
  key: "openai",
  label: "OpenAI",
  modelKey: (process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL).trim(),
  capabilities: { ...CAPABILITIES, configured: isOpenAiConfigured() },

  async generateImage(request: ImageRequest, context: ProviderContext): Promise<GeneratedImage[]> {
    if (!isOpenAiConfigured()) throw new ProviderError("not_configured", "OPENAI_API_KEY is not set", { retryable: false });
    const model = (process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL).trim();
    const size = imageSize(request);
    const body = await withRetry(
      (signal) =>
        postJson(
          "/images/generations",
          {
            model,
            prompt: request.prompt,
            n: Math.max(1, Math.min(4, request.count)),
            size,
            quality: "high",
          },
          signal,
        ),
      { timeoutMs: context.timeoutMs },
    );
    const results: GeneratedImage[] = Array.isArray(body?.data) ? body.data : [];
    const { width, height } = dimensionsFor(request);
    return results
      .map((entry: any) => (typeof entry?.b64_json === "string" ? entry.b64_json : null))
      .filter((value: string | null): value is string => Boolean(value))
      .map((base64: string) => ({ dataUrl: dataUrlFrom(base64), mime: "image/png", width, height, representative: false }));
  },

  async enhanceImage(request: EnhanceRequest, context: ProviderContext): Promise<GeneratedImage[]> {
    if (!isOpenAiConfigured()) throw new ProviderError("not_configured", "OPENAI_API_KEY is not set", { retryable: false });
    const model = (process.env.OPENAI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL).trim();
    const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(request.image);
    if (!match) throw new ProviderError("bad_request", "Enhancement needs a base64 image", { retryable: false });
    const mime = match[1];
    const buffer = Buffer.from(match[2], "base64");
    const extension = mime.includes("png") ? "png" : "jpg";

    const body = await withRetry(
      async (signal) => {
        const form = new FormData();
        form.append("model", model);
        form.append("prompt", request.instructions);
        form.append("size", "auto");
        form.append("image[]", new Blob([buffer], { type: mime }), `photo.${extension}`);
        const response = await fetch(`${baseUrl()}/images/edits`, {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey()}` },
          body: form,
          signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok) throw mapError(response.status, payload);
        return payload;
      },
      { timeoutMs: context.timeoutMs },
    );

    const results: GeneratedImage[] = Array.isArray(body?.data) ? body.data : [];
    return results
      .map((entry: any) => (typeof entry?.b64_json === "string" ? entry.b64_json : null))
      .filter((value: string | null): value is string => Boolean(value))
      .map((base64: string) => ({ dataUrl: dataUrlFrom(base64), mime: "image/png", width: request.width, height: request.height, representative: false }));
  },

  async generateText(request: TextRequest, context: ProviderContext): Promise<TextResult> {
    if (!isOpenAiConfigured()) throw new ProviderError("not_configured", "OPENAI_API_KEY is not set", { retryable: false });
    const model = (process.env.OPENAI_TEXT_MODEL || DEFAULT_TEXT_MODEL).trim();
    const body = await withRetry(
      (signal) =>
        postJson(
          "/chat/completions",
          {
            model,
            temperature: 0.7,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: request.system },
              { role: "user", content: `${request.prompt}\n\nReply with JSON: {"options":["…"]} and nothing else.` },
            ],
          },
          signal,
        ),
      { timeoutMs: context.timeoutMs },
    );
    const raw = String(body?.choices?.[0]?.message?.content || "").trim();
    return { texts: parseOptions(raw, request.maxChars, request.count), deterministic: false };
  },
};

/** Parses `{"options":[…]}` defensively — a model may wrap it in prose or a code fence. */
export function parseOptions(raw: string, maxChars: number, count: number): string[] {
  const cleaned = raw.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  let options: unknown[] = [];
  try {
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) options = parsed;
    else if (parsed && Array.isArray((parsed as any).options)) options = (parsed as any).options;
  } catch {
    const start = cleaned.indexOf("[");
    const end = cleaned.lastIndexOf("]");
    if (start >= 0 && end > start) {
      try {
        options = JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        options = [];
      }
    }
    if (options.length === 0) options = cleaned.split(/\n+/).filter((line) => line.trim().length > 0);
  }
  return options
    .map((option) => String(option ?? "").replace(/^["'\-\s]+/, "").trim())
    .filter((option) => option.length > 0)
    .map((option) => (option.length > maxChars ? `${option.slice(0, Math.max(0, maxChars - 1)).trimEnd()}…` : option))
    .slice(0, Math.max(1, Math.min(4, count)));
}
