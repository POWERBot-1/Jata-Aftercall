/**
 * Google Gemini adapter (§42, §56)
 *
 * The second interchangeable image/text provider, so the Studio is never tied to one vendor.
 * Registered only when a key is configured server-side; the key is appended to the request URL
 * at call time and never leaves the server or appears in a generation record.
 */

import { ProviderError, withRetry, type AiProvider, type EnhanceRequest, type GeneratedImage, type ImageRequest, type ProviderCapabilities, type ProviderContext, type TextRequest, type TextResult } from "../provider";
import { parseOptions } from "./openai";

const DEFAULT_IMAGE_MODEL = "gemini-2.5-flash-image";
const DEFAULT_TEXT_MODEL = "gemini-2.5-flash";
const API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";

function apiKey(): string {
  return (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
}

export function isGeminiConfigured(): boolean {
  return apiKey().length > 10;
}

function imageModel(): string {
  return (process.env.GEMINI_IMAGE_MODEL || DEFAULT_IMAGE_MODEL).trim();
}

function textModel(): string {
  return (process.env.GEMINI_TEXT_MODEL || DEFAULT_TEXT_MODEL).trim();
}

function mapError(status: number, body: unknown): ProviderError {
  const text = typeof body === "string" ? body : JSON.stringify(body ?? {});
  if (status === 400 && /safety|blocked|prohibited/i.test(text)) {
    return new ProviderError("blocked", "The request was refused by the provider", { retryable: false });
  }
  if (status === 401 || status === 403) return new ProviderError("auth", "Gemini rejected the credentials", { retryable: false });
  if (status === 429) return new ProviderError("rate_limited", "Gemini rate limit reached");
  if (status >= 500) return new ProviderError("provider_unavailable", "Gemini is unavailable");
  return new ProviderError("request_failed", `Gemini request failed (${status})`);
}

type GeminiPart = { text?: string; inlineData?: { mimeType?: string; data?: string } };

async function callModel(model: string, payload: unknown, signal: AbortSignal): Promise<any> {
  const response = await fetch(`${API_ROOT}/${model}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey(),
    },
    body: JSON.stringify(payload),
    signal,
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw mapError(response.status, body);
  return body;
}

function partsOf(body: any): GeminiPart[] {
  const candidates = Array.isArray(body?.candidates) ? body.candidates : [];
  const parts = candidates[0]?.content?.parts;
  return Array.isArray(parts) ? parts : [];
}

const CAPABILITIES: ProviderCapabilities = {
  imageGeneration: true,
  imageEditing: true,
  textGeneration: true,
  photorealistic: true,
  configured: true,
};

export const geminiProvider: AiProvider = {
  key: "gemini",
  label: "Google Gemini",
  modelKey: imageModel(),
  capabilities: { ...CAPABILITIES, configured: isGeminiConfigured() },

  async generateImage(request: ImageRequest, context: ProviderContext): Promise<GeneratedImage[]> {
    if (!isGeminiConfigured()) throw new ProviderError("not_configured", "GEMINI_API_KEY is not set", { retryable: false });
    const count = Math.max(1, Math.min(4, request.count));
    const body = await withRetry(
      (signal) =>
        callModel(
          imageModel(),
          {
            contents: [{ role: "user", parts: [{ text: request.prompt }] }],
            generationConfig: { responseModalities: ["IMAGE"], candidateCount: count },
          },
          signal,
        ),
      { timeoutMs: context.timeoutMs },
    );
    const images = partsOf(body)
      .filter((part) => part.inlineData?.data)
      .map((part) => ({
        dataUrl: `data:${part.inlineData?.mimeType || "image/png"};base64,${part.inlineData?.data}`,
        mime: part.inlineData?.mimeType || "image/png",
        width: request.width,
        height: request.height,
        representative: false,
      }));
    if (images.length === 0) {
      throw new ProviderError("blocked", "The provider returned no image", { retryable: false });
    }
    return images;
  },

  async enhanceImage(request: EnhanceRequest, context: ProviderContext): Promise<GeneratedImage[]> {
    if (!isGeminiConfigured()) throw new ProviderError("not_configured", "GEMINI_API_KEY is not set", { retryable: false });
    const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(request.image);
    if (!match) throw new ProviderError("bad_request", "Enhancement needs a base64 image", { retryable: false });
    const body = await withRetry(
      (signal) =>
        callModel(
          imageModel(),
          {
            contents: [
              {
                role: "user",
                parts: [{ text: request.instructions }, { inlineData: { mimeType: match[1], data: match[2] } }],
              },
            ],
            generationConfig: { responseModalities: ["IMAGE"] },
          },
          signal,
        ),
      { timeoutMs: context.timeoutMs },
    );
    const images = partsOf(body)
      .filter((part) => part.inlineData?.data)
      .map((part) => ({
        dataUrl: `data:${part.inlineData?.mimeType || "image/png"};base64,${part.inlineData?.data}`,
        mime: part.inlineData?.mimeType || "image/png",
        width: request.width,
        height: request.height,
        representative: false,
      }));
    if (images.length === 0) throw new ProviderError("blocked", "The provider returned no image", { retryable: false });
    return images;
  },

  async generateText(request: TextRequest, context: ProviderContext): Promise<TextResult> {
    if (!isGeminiConfigured()) throw new ProviderError("not_configured", "GEMINI_API_KEY is not set", { retryable: false });
    const body = await withRetry(
      (signal) =>
        callModel(
          textModel(),
          {
            systemInstruction: { parts: [{ text: request.system }] },
            contents: [{ role: "user", parts: [{ text: `${request.prompt}\n\nReply as JSON: {"options":["…"]} only.` }] }],
            generationConfig: { temperature: 0.7, responseMimeType: "application/json" },
          },
          signal,
        ),
      { timeoutMs: context.timeoutMs },
    );
    const raw = partsOf(body).map((part) => part.text || "").join("").trim();
    return { texts: parseOptions(raw, request.maxChars, request.count), deterministic: false };
  },
};
