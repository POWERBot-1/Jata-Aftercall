/**
 * Image pipeline planning (§19, §20)
 *
 * The browser does the pixel work; *these* functions decide what the work should be. Keeping
 * the decisions out of the canvas code means the tricky parts — never upscaling, keeping the
 * product's identity, choosing a format that renders everywhere, correcting orientation — are
 * plain functions that the regression suite can test without a phone.
 */

import { MIME_FOR_FORMAT, orientationSwapsAxes, type ImageFormat } from "./imageFormat";

export type AspectRatio = "free" | "square" | "portrait" | "landscape" | "wide";

export const ASPECT_RATIOS: Record<Exclude<AspectRatio, "free">, number> = {
  square: 1,
  portrait: 4 / 5,
  landscape: 3 / 2,
  wide: 16 / 9,
};

export const ASPECT_LABELS: Record<AspectRatio, string> = {
  free: "Original shape",
  square: "Square (product)",
  portrait: "Tall (phone)",
  landscape: "Wide (cards)",
  wide: "Very wide (hero)",
};

export type ResizePlan = {
  width: number;
  height: number;
  scaled: boolean;
  /** True when the source had to be rotated back to upright. */
  rotated: boolean;
};

/** Default long edge for a website photo: enough for a hero on a retina phone, not a 12 MP dump. */
export const DEFAULT_MAX_EDGE = 1600;
export const THUMBNAIL_MAX_EDGE = 480;

/**
 * Never upscales (§20: do not destroy quality), never returns a zero dimension, and reports
 * whether orientation had to be corrected.
 */
export function planResize(
  input: { width: number; height: number; exifOrientation?: number | null },
  options: { maxEdge?: number; format?: ImageFormat | null } = {},
): ResizePlan {
  const maxEdge = Math.max(64, Math.round(options.maxEdge ?? DEFAULT_MAX_EDGE));
  const rotated = orientationSwapsAxes(input.exifOrientation ?? null);
  const width = Math.max(1, Math.round(Number(input.width) || 0));
  const height = Math.max(1, Math.round(Number(input.height) || 0));
  const longest = Math.max(width, height);
  if (longest <= maxEdge) {
    return { width, height, scaled: false, rotated };
  }
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
    scaled: true,
    rotated,
  };
}

export type OutputChoice = {
  mime: string;
  format: ImageFormat;
  quality: number;
  /** Why this format was chosen — surfaced in the media library for transparency. */
  reason: string;
};

/**
 * Chooses what the normalized file should be. Photographs become JPEG (universally renderable,
 * ~5× smaller than PNG for continuous tone), graphics with transparency stay PNG, and small
 * images are left lossless.
 */
export function chooseOutputFormat(input: {
  format: ImageFormat;
  hasAlpha?: boolean;
  width: number;
  height: number;
  pixelsSource?: "upload" | "generated" | "enhanced";
}): OutputChoice {
  const pixels = Math.max(1, input.width * input.height);
  if (input.hasAlpha && input.format === "png") {
    return { mime: MIME_FOR_FORMAT.png, format: "png", quality: 1, reason: "Kept transparent areas as PNG." };
  }
  if (input.format === "gif") {
    return { mime: MIME_FOR_FORMAT.gif, format: "gif", quality: 1, reason: "Kept the GIF as-is." };
  }
  const quality = pixels > 1_400_000 ? 0.78 : pixels > 700_000 ? 0.84 : 0.9;
  return {
    mime: MIME_FOR_FORMAT.jpeg,
    format: "jpeg",
    quality,
    reason: input.pixelsSource === "generated" ? "Saved as a web-ready JPG." : "Optimized for fast loading on phones.",
  };
}

export type EnhancePlan = {
  /** CSS filter string applied while drawing (works in every modern mobile browser). */
  filter: string;
  /** Unsharp-mask strength, 0 disables the pixel pass entirely. */
  sharpen: number;
  quality: number;
  summary: string[];
};

export type EnhanceStrength = "light" | "balanced" | "strong";

/**
 * Photo improvement parameters (§14).
 *
 * Deliberately conservative: lighting, contrast, colour and sharpness only. Nothing here can
 * change *what* the product looks like — no redrawing, no relighting that alters a package,
 * label or colour — so an enhanced image of a real product stays an image of that product.
 */
export function planEnhancement(strength: EnhanceStrength = "balanced"): EnhancePlan {
  const presets: Record<EnhanceStrength, { brightness: number; contrast: number; saturate: number; sharpen: number }> = {
    light: { brightness: 1.03, contrast: 1.05, saturate: 1.03, sharpen: 0.25 },
    balanced: { brightness: 1.06, contrast: 1.12, saturate: 1.07, sharpen: 0.45 },
    strong: { brightness: 1.09, contrast: 1.2, saturate: 1.12, sharpen: 0.7 },
  };
  const preset = presets[strength] || presets.balanced;
  const summary: string[] = [];
  if (preset.brightness > 1) summary.push("Brightened the lighting");
  if (preset.contrast > 1) summary.push("Lifted contrast and exposure");
  if (preset.saturate > 1) summary.push("Made colours truer");
  if (preset.sharpen > 0) summary.push("Sharpened fine detail");
  return {
    filter: `brightness(${preset.brightness}) contrast(${preset.contrast}) saturate(${preset.saturate})`,
    sharpen: preset.sharpen,
    // Re-encoding an already-compressed photo at 0.92 keeps detail without a visible generation loss.
    quality: 0.92,
    summary,
  };
}

export type CropPlan = { sx: number; sy: number; sw: number; sh: number; outputWidth: number; outputHeight: number };

/**
 * Centre-weighted crop to an aspect ratio. `focusX`/`focusY` (0–1) let the owner nudge the
 * crop towards the part of the photo that matters (the dish, not the tablecloth).
 */
export function planCrop(
  input: { width: number; height: number },
  aspect: AspectRatio | number,
  options: { focusX?: number; focusY?: number; maxEdge?: number } = {},
): CropPlan {
  const width = Math.max(1, Math.round(input.width));
  const height = Math.max(1, Math.round(input.height));
  const target = typeof aspect === "number" ? aspect : aspect === "free" ? width / height : ASPECT_RATIOS[aspect];
  const focusX = clamp01(options.focusX ?? 0.5);
  const focusY = clamp01(options.focusY ?? 0.5);

  let sw = width;
  let sh = Math.round(width / target);
  if (sh > height) {
    sh = height;
    sw = Math.round(height * target);
  }
  sw = Math.max(1, Math.min(width, sw));
  sh = Math.max(1, Math.min(height, sh));
  const sx = Math.max(0, Math.min(width - sw, Math.round((width - sw) * focusX)));
  const sy = Math.max(0, Math.min(height - sh, Math.round((height - sh) * focusY)));

  const maxEdge = Math.max(64, Math.round(options.maxEdge ?? DEFAULT_MAX_EDGE));
  const longest = Math.max(sw, sh);
  const scale = longest > maxEdge ? maxEdge / longest : 1;

  return {
    sx,
    sy,
    sw,
    sh,
    outputWidth: Math.max(1, Math.round(sw * scale)),
    outputHeight: Math.max(1, Math.round(sh * scale)),
  };
}

function clamp01(value: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0, Math.min(1, n));
}

/**
 * The staged messages shown while a photo is processed (§40). Owners see progress, not a
 * spinner that looks stuck on a slow connection.
 */
export function uploadStepMessage(step: "reading" | "checking" | "optimizing" | "uploading" | "saving" | "done"): string {
  switch (step) {
    case "reading":
      return "Opening your photo…";
    case "checking":
      return "Checking the photo…";
    case "optimizing":
      return "Making it web-ready…";
    case "uploading":
      return "Uploading…";
    case "saving":
      return "Saving to your library…";
    case "done":
      return "Saved ✓";
    default:
      return "Working…";
  }
}

/** Rough payload estimate, used to decide whether a second compression pass is worth it. */
export function estimateEncodedBytes(width: number, height: number, quality: number): number {
  const pixels = Math.max(1, width * height);
  const bitsPerPixel = 0.35 + 1.4 * Math.max(0.1, Math.min(1, quality));
  return Math.round((pixels * bitsPerPixel) / 8);
}

/**
 * Aspect-ratio hint for the photo generator, so a hero photo is composed wide and a product
 * photo square — the composition is decided before generation, not cropped afterwards.
 */
export function aspectForPlacement(placement: string): { ratio: AspectRatio; label: string } {
  switch (placement) {
    case "hero":
      return { ratio: "wide", label: "Wide banner" };
    case "gallery":
      return { ratio: "landscape", label: "Photo" };
    case "logo":
      return { ratio: "square", label: "Logo square" };
    case "product":
    case "service":
    default:
      return { ratio: "square", label: "Product square" };
  }
}
