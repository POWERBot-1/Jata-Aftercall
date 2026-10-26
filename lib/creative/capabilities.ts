/**
 * Creative capabilities — the truth table (Website Studio creative engine).
 *
 * What the creative workspace may offer is *derived* here from what is actually configured:
 * the AI provider registry (`lib/ai/registry`) and the durable media-storage decision
 * (`lib/storage`). Nothing is hard-coded to "available": a capability with no provider, no
 * editor, or no way to durably save its output reports itself unavailable with the reason
 * and the exact owner action that would unblock it. This is what makes fake generation
 * impossible — the API refuses before any provider call, and the UI shows the same truth.
 *
 * Server-only: it reads `process.env` through the provider registry. Keys never appear in
 * the returned value; only booleans, labels and owner-facing sentences do.
 */

import { providerStatus, resolveImageEditor } from "@/lib/ai/registry";
import { hasDurableStorage } from "@/lib/storage";
import type { CreativeMediaType } from "./intent";

export type CreativeCapabilityState = "available" | "unavailable" | "browser-dependent";

export type CreativeCapability = {
  key: string;
  label: string;
  state: CreativeCapabilityState;
  /** Owner-facing reason, always present so the UI never shows a bare "no". */
  reason: string;
  /** The exact configuration/owner step that changes this, when unavailable. */
  ownerAction: string | null;
};

export type CreativeCapabilityMatrix = {
  capabilities: CreativeCapability[];
  /** True only when a connected vendor produces photographs (never for built-in artwork). */
  photorealistic: boolean;
  providerLabel: string;
  /** True when generated media can be durably saved in this deployment. */
  durableStorage: boolean;
};

const STORAGE_ACTION =
  "Approve and configure a durable media storage provider (see STORAGE_DECISION.md, e.g. Vercel Blob), then set JATA_STORAGE_PROVIDER. No provider has been approved yet, so uploads and generated images cannot be saved.";
const VENDOR_ACTION =
  "Set OPENAI_API_KEY or GEMINI_API_KEY (server-side) to enable photographic generation and AI photo editing. Until then only JATA's built-in branded artwork could be made — and it still needs durable storage to be saved.";

export function creativeCapabilities(): CreativeCapabilityMatrix {
  const status = providerStatus();
  const editor = resolveImageEditor();
  // Derived from the actually-configured provider: flips on its own the moment an approved
  // durable provider is configured behind `lib/storage` — false (fail-closed) until then.
  const durableStorage = hasDurableStorage();
  const vendorConnected = status.vendorConnected;
  const canGenerateAndSave = durableStorage && status.image.imageGeneration;
  const canEditWithAiAndSave = durableStorage && Boolean(editor);

  const generationReason = !durableStorage
    ? vendorConnected
      ? `${status.image.label} is connected, but there is nowhere durable to save what it creates yet, so JATA will not pretend to generate images.`
      : "No image provider is connected, and there is nowhere durable to save generated images yet. The ready category images and your own saved photos still work."
    : vendorConnected
      ? `${status.image.label} creates photographic images for your business.`
      : "JATA designs branded artwork from your colours. It is designed artwork, never presented as a photo of your real product.";

  const capabilities: CreativeCapability[] = [
    {
      key: "starter-gallery",
      label: "Ready category images",
      state: "available",
      reason: "Curated images for your kind of business — pick one and it is saved to your website draft or POS header straight away.",
      ownerAction: null,
    },
    {
      key: "image-generation",
      label: "Generate a new image or poster",
      state: canGenerateAndSave ? "available" : "unavailable",
      reason: generationReason,
      ownerAction: canGenerateAndSave ? null : !durableStorage ? STORAGE_ACTION : VENDOR_ACTION,
    },
    {
      key: "ai-photo-editing",
      label: "AI editing of your photo (background, relight)",
      state: canEditWithAiAndSave ? "available" : "unavailable",
      reason: canEditWithAiAndSave
        ? `${editor?.label} edits your photo and the result is saved next to your untouched original.`
        : !editor
          ? "No AI photo editor is connected in this deployment. On-phone improvement (lighting, colour, crop) below still previews instantly."
          : "An AI editor is connected, but edited images cannot be saved durably yet.",
      ownerAction: canEditWithAiAndSave ? null : !editor ? VENDOR_ACTION : STORAGE_ACTION,
    },
    {
      key: "on-device-enhance",
      label: "Improve a photo on your phone (light, colour, crop)",
      state: "browser-dependent",
      reason: durableStorage
        ? "Runs on your phone, keeps your product exactly as it is, and saves the improved copy beside the original."
        : "Runs on your phone and previews instantly, but saving the improved copy needs durable photo storage, which is not configured yet.",
      ownerAction: durableStorage ? null : STORAGE_ACTION,
    },
    {
      key: "upload-photo",
      label: "Upload and keep your own photo",
      state: durableStorage ? "available" : "unavailable",
      reason: durableStorage
        ? "Your photos are stored for your business only and can be reused anywhere."
        : "Photo uploads cannot be kept yet because no durable media storage provider is configured. Existing saved images remain readable.",
      ownerAction: durableStorage ? null : STORAGE_ACTION,
    },
    {
      key: "speech-input",
      label: "Speak your instruction",
      state: "browser-dependent",
      reason: "Works in browsers with speech recognition (for example Chrome on Android). Where it is not supported, type the same instruction instead.",
      ownerAction: null,
    },
    {
      key: "animation",
      label: "Animated graphics",
      state: "unavailable",
      reason: "No animation provider adapter exists in this deployment, so JATA does not offer animated graphics yet.",
      ownerAction: "Choose and configure an animation/video provider behind the same provider registry, with durable storage, before this can be offered.",
    },
    {
      key: "video",
      label: "Video adverts",
      state: "unavailable",
      reason: "No video generation provider is connected, so JATA cannot create video adverts (including WhatsApp Status videos) yet. A vertical poster is the closest available alternative.",
      ownerAction: "Choose and configure a video provider (with its per-video cost agreed) behind the provider registry, plus durable storage.",
    },
  ];

  return {
    capabilities,
    photorealistic: vendorConnected && status.image.photorealistic,
    providerLabel: status.image.label,
    durableStorage,
  };
}

/** The capability a parsed media type needs, or null for the always-available gallery. */
export function capabilityKeyForMediaType(mediaType: CreativeMediaType): string {
  switch (mediaType) {
    case "edit":
      return "ai-photo-editing";
    case "animation":
      return "animation";
    case "video":
      return "video";
    default:
      return "image-generation";
  }
}

export function capabilityForMediaType(mediaType: CreativeMediaType, matrix = creativeCapabilities()): CreativeCapability {
  const key = capabilityKeyForMediaType(mediaType);
  return matrix.capabilities.find((capability) => capability.key === key) ?? matrix.capabilities[0];
}
