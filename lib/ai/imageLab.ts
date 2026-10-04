/**
 * The AI image lab (§11–§17, §41, §42, §51)
 *
 * Everything the Studio needs to create and improve images for one business, in one place:
 * load the business's design context, meter the allowance, reuse an identical result instead of
 * paying a provider twice, call the configured provider through a hard timeout, store what came
 * back as real media assets with honest provenance, and — when something fails — return a
 * sentence an owner can act on.
 *
 * Three rules are enforced here rather than trusted to callers:
 *
 *   • Every query is scoped by the business the route already ownership-checked, and a subject id
 *     sent by the client is re-read from *that* business's catalogue (§41).
 *   • A generated image is never presented as a photograph of the owner's real product unless the
 *     provider is photographic: built-in artwork is labelled REPRESENTATIVE everywhere (§15).
 *   • Nothing generated is published or substituted for an existing photo. The owner chooses.
 */

import crypto from "crypto";
import prisma from "@/lib/db";
import { MAX_UPLOAD_CHARS } from "@/lib/media/imageFormat";
import { buildDesignContext, defaultStyleForCategory, photographyStyleOptions, resolvePhotographyStyle, type DesignContext } from "./designContext";
import { IMAGE_PRESETS, buildEnhancePrompt, buildImagePrompt, presetFor } from "./promptBuilder";
import { ProviderError, providerErrorMessage, type GeneratedImage, type ImageRequest } from "./provider";
import { providerStatus, resolveImageEditor, resolveProvider } from "./registry";
import { checkQuota, quotaForPlan, quotaSummaryLine, quotaUsage, type AiCapability, type QuotaDecision } from "./quota";
import {
  findCachedGeneration,
  finishGeneration,
  generationHistory,
  latestGeneration,
  promptHash,
  startGeneration,
  usageRecords,
} from "./generationStore";
import { validateGroundedText } from "./grounding";
import { PHOTOGRAPHY_STYLE_KEYS } from "../experience/types";

export type StudioImageRequest = {
  businessId: string;
  userId?: string | null;
  /** Owner-facing preset key from `IMAGE_PRESETS`. */
  preset: string;
  /** Photography language override chosen in the Studio picker. */
  style?: string | null;
  placement?: "product" | "service" | "hero" | "gallery" | "logo" | "background" | null;
  subjectType?: "PRODUCT" | "SERVICE" | "SECTION" | "LOGO" | "BUSINESS" | null;
  subjectId?: string | null;
  subjectName?: string | null;
  subjectDescription?: string | null;
  ownerNotes?: string | null;
  /** Owner's own image, when they want the result to follow their product. */
  referenceDataUrl?: string | null;
  count?: number;
  /** "Create another like this" deliberately bypasses the cache (§13). */
  refresh?: boolean;
};

export type StoredAsset = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  source: string;
  label: string | null;
  aiGenerationId: string | null;
};

export type GenerationOutcome = {
  status: "ok";
  generationId: string | null;
  provider: { key: string; label: string; modelKey: string; photorealistic: boolean };
  cached: boolean;
  assets: StoredAsset[];
  /** Owner-facing notes: what was made and what it is (or is not). */
  notes: string[];
  quota: { remainingImages: number; summary: string };
} | { status: "error"; httpStatus: number; error: string; code?: string; retryable?: boolean };

export type StudioEnhanceRequest = {
  businessId: string;
  userId?: string | null;
  /** The photo the owner wants improved. */
  imageDataUrl: string;
  /** "device" = improved on the phone; "provider" = an image model edited it. */
  mode: "device" | "provider";
  /** The library asset this improvement came from, kept as provenance. */
  assetId?: string | null;
  subjectType?: "PRODUCT" | "SERVICE" | "SECTION" | "LOGO" | "BUSINESS" | null;
  subjectId?: string | null;
  ownerNotes?: string | null;
  /** Which adjustments the on-device editor applied, for the audit trail. */
  applied?: string[];
  strength?: string | null;
};

export type ImageLabInfo = {
  presets: Array<{ key: string; label: string; description: string; placement: string }>;
  styles: Array<{ key: string; label: string }>;
  provider: ReturnType<typeof providerStatus>;
  editor: { key: string; label: string } | null;
  quota: {
    remainingImages: number;
    remainingEnhances: number;
    imagesPerMonth: number;
    planLabel: string;
    summary: string;
  };
  usage: { images: number; enhances: number; copy: number };
};

const CACHE_WINDOW_MS = 24 * 60 * 60 * 1000;

type BusinessContext = {
  businessId: string;
  name: string;
  categoryKey: string;
  design: DesignContext;
  brand: { primaryColor?: string; accentColor?: string; secondaryColor?: string };
  toneOfVoice: string | null;
  language: "en" | "sw" | "mixed";
  entitled: boolean;
  planKey: string | null;
  photographyStyle: string | null;
};

/**
 * Loads the business context a generation needs, scoped to the business passed in. The caller
 * has already verified ownership (route → `guardTenantMutation`), and every query below is
 * additionally filtered by `businessId`.
 */
export async function loadBusinessContext(businessId: string, photographyStyleOverride?: string | null): Promise<BusinessContext | null> {
  const business = await prisma.business
    .findUnique({
      where: { id: businessId },
      select: { id: true, name: true, category: true, location: true },
    })
    .catch(() => null);
  if (!business) return null;

  const [experience, entitlement] = await Promise.all([
    (prisma as any).businessExperience?.findUnique?.({ where: { businessId }, select: { categoryKey: true, themeKey: true, draftJson: true } }).catch(() => null) ?? Promise.resolve(null),
    (prisma as any).interactiveBusinessEntitlement?.findUnique?.({ where: { businessId }, select: { status: true, packageKey: true } }).catch(() => null) ?? Promise.resolve(null),
  ]);

  let brand: Record<string, unknown> = {};
  let themeKey: string | null = experience?.themeKey ?? null;
  let categoryKey: string | null = experience?.categoryKey ?? null;
  let photographyStyle: string | null = photographyStyleOverride ?? null;
  if (experience?.draftJson) {
    try {
      const document = JSON.parse(String(experience.draftJson));
      brand = (document?.brand as Record<string, unknown>) || {};
      themeKey = document?.themeKey || themeKey;
      categoryKey = document?.categoryKey || categoryKey;
      if (!photographyStyle && typeof document?.photographyStyle === "string") {
        photographyStyle = document.photographyStyle;
      }
    } catch {
      // A malformed draft must not block image generation: fall back to business defaults.
    }
  }

  const aiConfig = await (prisma as any).aIConfiguration
    ?.findUnique?.({ where: { businessId }, select: { toneOfVoice: true } })
    .catch(() => null);

  const entitled = String(entitlement?.status || "") === "ACTIVE";

  const design = buildDesignContext({
    businessName: business.name,
    categoryKey: categoryKey || business.category,
    brand: {
      primaryColor: brand.primaryColor as string | undefined,
      accentColor: brand.accentColor as string | undefined,
      secondaryColor: brand.secondaryColor as string | undefined,
    },
    themeKey,
    toneOfVoice: aiConfig?.toneOfVoice ?? null,
    language: "mixed",
    location: business.location,
    photographyStyle,
  });

  return {
    businessId,
    name: business.name,
    categoryKey: design.categoryKey,
    design,
    brand: {
      primaryColor: brand.primaryColor as string | undefined,
      accentColor: brand.accentColor as string | undefined,
      secondaryColor: brand.secondaryColor as string | undefined,
    },
    toneOfVoice: aiConfig?.toneOfVoice ?? null,
    language: "mixed",
    entitled,
    planKey: entitlement?.packageKey ? String(entitlement.packageKey) : null,
    photographyStyle,
  };
}

/** Quota + usage + provider state for the Studio UI. Never contains a key. */
export async function imageLabInfo(businessId: string): Promise<ImageLabInfo> {
  const context = await loadBusinessContext(businessId);
  const quota = quotaForPlan({ entitled: Boolean(context?.entitled) });
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const records = await usageRecords(businessId, periodStart);
  const usage = quotaUsage({ quota, records, now });
  const editor = resolveImageEditor();
  return {
    presets: IMAGE_PRESETS.map((preset) => ({ key: preset.key, label: preset.label, description: preset.description, placement: preset.placement })),
    styles: photographyStyleOptions().map((style) => ({ key: style.key, label: style.label })),
    provider: providerStatus(),
    editor: editor ? { key: editor.key, label: editor.label } : null,
    quota: {
      remainingImages: usage.remaining.images,
      remainingEnhances: usage.remaining.enhances,
      imagesPerMonth: usage.quota.imagesPerMonth,
      planLabel: usage.quota.label,
      summary: quotaSummaryLine(usage),
    },
    usage: usage.used,
  };
}

async function decide(capability: AiCapability, context: BusinessContext, businessId: string, requested: number): Promise<QuotaDecision> {
  const quota = quotaForPlan({ entitled: context.entitled });
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const [records, last] = await Promise.all([
    usageRecords(businessId, periodStart),
    latestGeneration(businessId, capability === "ENHANCE" ? "ENHANCE" : capability === "IMAGE" ? "IMAGE" : "COPY"),
  ]);
  const usage = quotaUsage({ quota, records, now });
  return checkQuota({ capability, usage, requested, lastGenerationAt: last?.createdAt ?? null, now });
}

/** Current allowance after a successful generation, for the reply the Studio shows. */
async function currentQuota(businessId: string, context: BusinessContext): Promise<{ remainingImages: number; summary: string }> {
  const quota = quotaForPlan({ entitled: context.entitled });
  const now = new Date();
  const periodStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const records = await usageRecords(businessId, periodStart);
  const usage = quotaUsage({ quota, records, now });
  return { remainingImages: usage.remaining.images, summary: quotaSummaryLine(usage) };
}

/** The provider description carried on every successful reply. */
function describeProvider(provider = resolveProvider("image")) {
  return {
    key: provider.key,
    label: provider.label,
    modelKey: provider.modelKey,
    photorealistic: provider.capabilities.photorealistic,
  };
}

/** Reuses an identical asset instead of storing a byte-identical second copy (§19). */
async function storeAsset(input: {
  businessId: string;
  image: GeneratedImage;
  alt: string | null;
  source: "AI_GENERATED" | "AI_ENHANCED" | "ENHANCED";
  label: string;
  generationId: string | null;
  parentAssetId?: string | null;
}): Promise<StoredAsset | null> {
  const delegate = (prisma as any)?.mediaAsset;
  if (!delegate?.create) return null;
  const match = /^data:([^;]+);base64,([\s\S]*)$/.exec(input.image.dataUrl);
  if (!match) return null;
  const bytes = Buffer.from(match[2], "base64");
  const hash = crypto.createHash("sha256").update(bytes).digest("hex").slice(0, 32);
  const existing = await delegate
    .findFirst?.({ where: { businessId: input.businessId, hash }, select: { id: true, url: true, width: true, height: true, alt: true, source: true, label: true, aiGenerationId: true } })
    .catch(() => null);
  if (existing?.id) return existing as StoredAsset;
  try {
    const created = await delegate.create({
      data: {
        businessId: input.businessId,
        url: input.image.dataUrl,
        kind: "IMAGE",
        mime: input.image.mime,
        alt: input.alt,
        width: input.image.width,
        height: input.image.height,
        bytes: bytes.length,
        hash,
        source: input.source,
        label: input.label,
        aiGenerationId: input.generationId,
        parentAssetId: input.parentAssetId ?? null,
      },
      select: { id: true, url: true, width: true, height: true, alt: true, source: true, label: true, aiGenerationId: true },
    });
    return created as StoredAsset;
  } catch {
    return null;
  }
}

/** Alt text for a generated image: from the owner's own words, never invented (§27, §55). */
function altFor(context: BusinessContext, request: StudioImageRequest, representative: boolean): string {
  const subject = (request.subjectName || "").trim();
  const base = subject ? `${subject} at ${context.name}` : `${context.name} — ${context.design.categoryLabel.toLowerCase()}`;
  return representative ? `${base} (JATA designed image)` : base;
}

export async function generateStudioImages(request: StudioImageRequest): Promise<GenerationOutcome> {
  const context = await loadBusinessContext(request.businessId, request.style || null);
  if (!context) return { status: "error", httpStatus: 404, error: "We couldn't find that business." };

  const preset = presetFor(request.preset);
  const placement = request.placement || preset.placement;
  const count = Math.max(1, Math.min(4, Math.round(request.count ?? 2)));

  const design =
    request.style && (PHOTOGRAPHY_STYLE_KEYS as readonly string[]).includes(request.style)
      ? { ...context.design, photography: resolvePhotographyStyle(request.style) }
      : context.design;

  // Subject is re-read from the database by id, scoped to this business: a client-supplied
  // name for another tenant's product can never become the subject (§41).
  let subjectName = request.subjectName ?? null;
  let subjectDescription = request.subjectDescription ?? null;
  if (request.subjectId && (request.subjectType === "PRODUCT" || request.subjectType === "SERVICE")) {
    const row =
      request.subjectType === "PRODUCT"
        ? await (prisma as any).product?.findFirst?.({ where: { id: request.subjectId, businessId: request.businessId }, select: { name: true, description: true } }).catch(() => null)
        : await (prisma as any).service?.findFirst?.({ where: { id: request.subjectId, businessId: request.businessId }, select: { title: true, description: true } }).catch(() => null);
    if (!row) return { status: "error", httpStatus: 404, error: "That item is not part of this business." };
    subjectName = row.name || row.title || subjectName;
    subjectDescription = row.description || subjectDescription;
  }
  if (!subjectName && request.subjectType === "BUSINESS") subjectName = context.name;

  const prompt = buildImagePrompt({
    design,
    placement,
    subjectName,
    subjectDescription,
    ownerNotes: request.ownerNotes,
    composition: preset.composition,
    hasReference: Boolean(request.referenceDataUrl),
  });

  // The cache key is the prompt itself (it already embeds the style seed, placement and every
  // fact used), which is also exactly what the generation record stores — one key, no drift.
  const hash = promptHash(prompt);

  // §51: the same request inside the cache window never reaches a provider twice — unless the
  // owner explicitly asked for another version.
  const cached = request.refresh
    ? null
    : await findCachedGeneration({ businessId: request.businessId, hash, kind: "IMAGE", withinMs: CACHE_WINDOW_MS });

  if (cached) {
    const assets = await loadAssets(request.businessId, cached.assetIds);
    if (assets.length > 0) {
      return {
        status: "ok",
        generationId: cached.id,
        provider: describeProvider(),
        cached: true,
        assets,
        notes: ["Reused the images JATA already created for this exact request — nothing was regenerated."],
        quota: await currentQuota(request.businessId, context),
      };
    }
  }

  // The allowance is only consulted when something is actually about to be generated: a repeat of
  // an identical request is served from cache and spends nothing, even inside the cooldown window.
  const decision = await decide("IMAGE", context, request.businessId, count);
  if (decision.status !== "ok") {
    const httpStatus = decision.code === "quota_exhausted" ? 402 : 429;
    return { status: "error", httpStatus, error: decision.message, code: decision.code, retryable: decision.code === "too_soon" };
  }

  const provider = resolveProvider("image");
  const started = Date.now();
  const record = await startGeneration({
    businessId: request.businessId,
    userId: request.userId ?? null,
    kind: "IMAGE",
    capability: request.preset,
    subjectType: request.subjectType ?? null,
    subjectId: request.subjectId ?? null,
    prompt,
    providerKey: provider.key,
    modelKey: provider.modelKey,
  });

  const imageRequest: ImageRequest = {
    prompt,
    placement,
    width: preset.size.width,
    height: preset.size.height,
    count,
    seed: design.styleSeed,
    design,
    referenceImage: request.referenceDataUrl ?? null,
    negativePrompt: design.artDirection.avoid,
  };

  try {
    const images = await provider.generateImage(imageRequest, {
      businessId: request.businessId,
      generationId: record?.id || `${request.businessId}-${hash}`,
      timeoutMs: 60_000,
    });
    if (images.length === 0) throw new ProviderError("blocked", "No image was produced", { retryable: false });

    const representative = images.some((image) => image.representative) || !provider.capabilities.photorealistic;
    const alt = altFor(context, { ...request, subjectName }, representative);
    const stored: StoredAsset[] = [];
    for (const image of images) {
      const asset = await storeAsset({
        businessId: request.businessId,
        image,
        alt,
        source: "AI_GENERATED",
        // Representative = designed artwork standing in for a photo the business does not have.
        label: representative ? "REPRESENTATIVE" : "AI_GENERATED",
        generationId: record?.id ?? null,
      });
      if (asset) stored.push(asset);
    }
    if (stored.length === 0) {
      await finishGeneration({ id: record?.id ?? null, status: "FAILED", errorCode: "storage_failed", durationMs: Date.now() - started });
      return { status: "error", httpStatus: 500, error: "We created the image but couldn't save it. Please try again.", code: "storage_failed", retryable: true };
    }

    await finishGeneration({ id: record?.id ?? null, status: "SUCCEEDED", assetIds: stored.map((asset) => asset.id), durationMs: Date.now() - started });

    const notes: string[] = [];
    if (representative) {
      notes.push("JATA designed this artwork from your brand colours and website style.");
      notes.push("It is a designed image, not a photo of your actual product — add your own photo any time and JATA will use it instead.");
    } else {
      notes.push(`Created ${stored.length} image${stored.length === 1 ? "" : "s"} with ${provider.label}.`);
      notes.push("Check the result: AI images can look close to real. If it is not right, create other options or use your own photo.");
    }
    notes.push("Nothing changes on your website until you choose an image and publish.");

    return {
      status: "ok",
      generationId: record?.id ?? null,
      provider: describeProvider(provider),
      cached: false,
      assets: stored,
      notes,
      quota: await currentQuota(request.businessId, context),
    };
  } catch (error) {
    const mapped = providerErrorMessage(error);
    await finishGeneration({
      id: record?.id ?? null,
      status: mapped.retryable ? "FAILED" : "BLOCKED",
      errorCode: mapped.code,
      durationMs: Date.now() - started,
    });
    return {
      status: "error",
      httpStatus: mapped.code === "rate_limited" ? 429 : 502,
      error: mapped.message,
      code: mapped.code,
      retryable: mapped.retryable,
    };
  }
}

export async function enhanceStudioImage(request: StudioEnhanceRequest): Promise<GenerationOutcome> {
  const context = await loadBusinessContext(request.businessId);
  if (!context) return { status: "error", httpStatus: 404, error: "We couldn't find that business." };
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([\s\S]*)$/.exec(String(request.imageDataUrl || ""));
  if (!match) return { status: "error", httpStatus: 400, error: "Choose a photo to improve." };
  if (String(request.imageDataUrl).length > MAX_UPLOAD_CHARS) {
    return {
      status: "error",
      httpStatus: 413,
      error: "That photo is too large to improve. JATA can optimize it on your phone first — try uploading it again.",
    };
  }

  const applied = (request.applied || []).filter(Boolean).slice(0, 6);

  if (request.mode === "device") {
    const record = await startGeneration({
      businessId: request.businessId,
      userId: request.userId ?? null,
      kind: "ENHANCE",
      capability: "device",
      subjectType: request.subjectType ?? null,
      subjectId: request.subjectId ?? null,
      prompt: `Improved on the owner's phone: ${applied.join(", ") || "lighting and contrast"}`,
      providerKey: "device-canvas",
      modelKey: "jata-photo-editor-v1",
    });
    const asset = await storeAsset({
      businessId: request.businessId,
      image: {
        dataUrl: request.imageDataUrl,
        mime: match[1],
        width: 0,
        height: 0,
        representative: false,
      },
      alt: null,
      source: "ENHANCED",
      // The pixels are the owner's own product photo, improved in place: identity is preserved.
      label: "ACTUAL",
      generationId: record?.id ?? null,
      parentAssetId: request.assetId ?? null,
    });
    if (!asset) {
      await finishGeneration({ id: record?.id ?? null, status: "FAILED", errorCode: "storage_failed" });
      return { status: "error", httpStatus: 500, error: "We couldn't save the improved photo. Please try again.", code: "storage_failed", retryable: true };
    }
    await finishGeneration({ id: record?.id ?? null, status: "SUCCEEDED", assetIds: [asset.id], selectedAssetId: asset.id });
    return {
      status: "ok",
      generationId: record?.id ?? null,
      provider: { key: "device-canvas", label: "Your phone", modelKey: "jata-photo-editor-v1", photorealistic: true },
      cached: false,
      assets: [asset],
      notes: [
        "Improved your photo on your phone.",
        `Applied: ${(applied.length ? applied : ["lighting", "contrast"]).join(", ")}.`,
        "Your product stays exactly the same product — only the presentation changed.",
        "Your original photo is untouched — this is a new image you choose whether to use.",
      ],
      quota: await currentQuota(request.businessId, context),
    };
  }

  const editor = resolveImageEditor();
  if (!editor) {
    return {
      status: "error",
      httpStatus: 409,
      error: "Photo improvement by AI isn't connected on this account yet. JATA can still improve the lighting, contrast and sharpness on your phone — try “Improve on my phone”.",
      code: "not_configured",
      retryable: false,
    };
  }

  const decision = await decide("ENHANCE", context, request.businessId, 1);
  if (decision.status !== "ok") {
    return { status: "error", httpStatus: decision.code === "quota_exhausted" ? 402 : 429, error: decision.message, code: decision.code };
  }

  const instructions = buildEnhancePrompt({ design: context.design, preserveIdentity: true, ownerNotes: request.ownerNotes });
  const record = await startGeneration({
    businessId: request.businessId,
    userId: request.userId ?? null,
    kind: "ENHANCE",
    capability: "provider",
    subjectType: request.subjectType ?? null,
    subjectId: request.subjectId ?? null,
    prompt: instructions,
    providerKey: editor.key,
    modelKey: editor.modelKey,
  });
  const started = Date.now();
  try {
    const images = await editor.enhanceImage(
      { image: request.imageDataUrl, instructions, width: 0, height: 0, design: context.design, preserveIdentity: true },
      { businessId: request.businessId, generationId: record?.id || "enhance", timeoutMs: 60_000 },
    );
    const stored: StoredAsset[] = [];
    for (const image of images) {
      const asset = await storeAsset({
        businessId: request.businessId,
        image,
        alt: null,
        // The provider edited the owner's own photo of a real product: keep it labelled ACTUAL.
        source: "AI_ENHANCED",
        label: "ACTUAL",
        generationId: record?.id ?? null,
        parentAssetId: request.assetId ?? null,
      });
      if (asset) stored.push(asset);
    }
    if (stored.length === 0) {
      await finishGeneration({ id: record?.id ?? null, status: "FAILED", errorCode: "storage_failed", durationMs: Date.now() - started });
      return { status: "error", httpStatus: 500, error: "We couldn't save the improved photo. Please try again.", code: "storage_failed", retryable: true };
    }
    await finishGeneration({ id: record?.id ?? null, status: "SUCCEEDED", assetIds: stored.map((asset) => asset.id), durationMs: Date.now() - started });
    return {
      status: "ok",
      generationId: record?.id ?? null,
      provider: describeProvider(editor),
      cached: false,
      assets: stored,
      notes: [
        `Improved by ${editor.label}.`,
        "Only the presentation changed — the product, its packaging and any label text stay the same.",
        "Your original photo is untouched, and nothing is replaced until you choose the new version.",
      ],
      quota: await currentQuota(request.businessId, context),
    };
  } catch (error) {
    const mapped = providerErrorMessage(error);
    await finishGeneration({
      id: record?.id ?? null,
      status: mapped.retryable ? "FAILED" : "BLOCKED",
      errorCode: mapped.code,
      durationMs: Date.now() - started,
    });
    return {
      status: "error",
      httpStatus: mapped.code === "rate_limited" ? 429 : 502,
      error: mapped.message,
      code: mapped.code,
      retryable: mapped.retryable,
    };
  }
}

/** Loads stored assets by id, scoped to the business that owns them. */
export async function loadAssets(businessId: string, ids: string[]): Promise<StoredAsset[]> {
  const clean = ids.map(String).filter(Boolean).slice(0, 12);
  if (clean.length === 0) return [];
  const delegate = (prisma as any)?.mediaAsset;
  if (!delegate?.findMany) return [];
  try {
    const rows = await delegate.findMany({
      where: { businessId, id: { in: clean } },
      select: { id: true, url: true, width: true, height: true, alt: true, source: true, label: true, aiGenerationId: true },
    });
    return Array.isArray(rows) ? (rows as StoredAsset[]) : [];
  } catch {
    return [];
  }
}

/**
 * Deterministic alt-text suggestions for a photo, built only from facts the business supplied and
 * filtered through the same grounding rules as any other copy (§27, §55).
 */
export function suggestAltText(context: BusinessContext, subjectName: string | null): { suggestions: string[]; rejected: number } {
  const name = (subjectName || "").trim();
  const place = context.design.location ? ` in ${context.design.location}` : "";
  const candidates = name
    ? [`${name} at ${context.name}${place}`, `${name} — ${context.design.categoryLabel.toLowerCase()} from ${context.name}`]
    : [`${context.name}${place}`, `${context.design.categoryLabel} at ${context.name}${place}`];
  const facts = [context.name, name, context.design.location || "", context.design.categoryLabel];
  const accepted: string[] = [];
  let rejected = 0;
  for (const candidate of candidates) {
    const verdict = validateGroundedText(candidate, facts);
    if (verdict.ok) accepted.push(candidate.slice(0, 140));
    else rejected += 1;
  }
  return { suggestions: accepted.slice(0, 3), rejected };
}

export { generationHistory };
export { defaultStyleForCategory };
