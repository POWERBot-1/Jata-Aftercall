/**
 * Provider registry (§17, §42, §56)
 *
 * Resolution order is configuration, not code:
 *
 *   JATA_AI_IMAGE_PROVIDER = auto | openai | gemini | jata-local
 *   JATA_AI_TEXT_PROVIDER  = auto | openai | gemini | jata-local
 *
 * `auto` prefers a configured vendor and always falls back to the built-in JATA provider, so a
 * deployment with no AI keys still has working copywriting and working branded artwork — and a
 * deployment that adds a key gets photographic generation with no Studio changes at all.
 *
 * Nothing here is imported by a client component: provider keys are read from `process.env` on
 * the server only, and the status object exposed to the UI never contains a secret.
 */

import { localProvider } from "./providers/local";
import { geminiProvider, isGeminiConfigured } from "./providers/gemini";
import { isOpenAiConfigured, openAiProvider } from "./providers/openai";
import type { AiProvider } from "./provider";

export type ProviderPurpose = "image" | "text";

export type ProviderSummary = {
  key: string;
  label: string;
  modelKey: string;
  configured: boolean;
  photorealistic: boolean;
  imageGeneration: boolean;
  imageEditing: boolean;
  textGeneration: boolean;
  builtIn: boolean;
};

export type ProviderStatus = {
  image: ProviderSummary;
  text: ProviderSummary;
  /** True when a vendor is handling at least one capability. */
  vendorConnected: boolean;
  /** Short, owner-facing description of what generation will do right now. */
  note: string;
};

const VENDORS: AiProvider[] = [openAiProvider, geminiProvider];

function explicitlyConfigured(purpose: ProviderPurpose): string {
  const raw = purpose === "image" ? process.env.JATA_AI_IMAGE_PROVIDER : process.env.JATA_AI_TEXT_PROVIDER;
  return String(raw || "").trim().toLowerCase();
}

function vendorSupports(provider: AiProvider, purpose: ProviderPurpose): boolean {
  return purpose === "image" ? provider.capabilities.imageGeneration : provider.capabilities.textGeneration;
}

function vendorIsUsable(provider: AiProvider): boolean {
  if (provider.key === "openai") return isOpenAiConfigured();
  if (provider.key === "gemini") return isGeminiConfigured();
  return false;
}

/**
 * Resolves the provider for a capability. An explicitly named provider that is not usable
 * (wrong key, not configured) falls back to JATA's built-in provider rather than failing the
 * request — the owner sees a working button and a truthful note (§58).
 */
export function resolveProvider(purpose: ProviderPurpose): AiProvider {
  const requested = explicitlyConfigured(purpose);
  if (requested && requested !== "auto") {
    if (requested === "jata-local" || requested === "local" || requested === "builtin") return localProvider;
    const match = VENDORS.find((provider) => provider.key === requested);
    if (match && vendorSupports(match, purpose) && vendorIsUsable(match)) return match;
    return localProvider;
  }
  const vendor = VENDORS.find((provider) => vendorSupports(provider, purpose) && vendorIsUsable(provider));
  return vendor || localProvider;
}

/** Provider that can *edit* a photograph, if one is connected (§14). */
export function resolveImageEditor(): AiProvider | null {
  const requested = explicitlyConfigured("image");
  if (requested === "jata-local" || requested === "local" || requested === "builtin") return null;
  if (requested && requested !== "auto") {
    const match = VENDORS.find((provider) => provider.key === requested);
    if (match && match.capabilities.imageEditing && vendorIsUsable(match)) return match;
    return null;
  }
  return VENDORS.find((provider) => provider.capabilities.imageEditing && vendorIsUsable(provider)) || null;
}

function summarize(provider: AiProvider): ProviderSummary {
  return {
    key: provider.key,
    label: provider.label,
    modelKey: provider.modelKey,
    configured: provider.capabilities.configured,
    photorealistic: provider.capabilities.photorealistic,
    imageGeneration: provider.capabilities.imageGeneration,
    imageEditing: provider.capabilities.imageEditing,
    textGeneration: provider.capabilities.textGeneration,
    builtIn: provider.key === "jata-local",
  };
}

/** Safe for the browser: keys, endpoints and quotas never appear here. */
export function providerStatus(): ProviderStatus {
  const image = resolveProvider("image");
  const text = resolveProvider("text");
  const vendorConnected = !image.capabilities.configured ? false : image.key !== "jata-local";
  const note = image.capabilities.photorealistic
    ? `${image.label} is creating photographic images for your website.`
    : "JATA will design branded artwork from your colours. Connect an image provider to create photographic product shots.";
  return { image: summarize(image), text: summarize(text), vendorConnected, note };
}

/** Diagnostics for the admin/health surface: which providers exist and whether they are wired. */
export function providerCatalogue(): ProviderSummary[] {
  return [openAiProvider, geminiProvider, localProvider].map(summarize);
}
