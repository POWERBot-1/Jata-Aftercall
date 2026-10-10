/**
 * Responsive derivatives and format negotiation (Phase 4)
 *
 * Planning only. These functions decide which sizes and formats an image should have. They do not
 * encode anything and they do not store anything. Storing derivatives requires a durable provider
 * (see lib/storage), so until one is configured the engine keeps a single optimised image.
 *
 * Rules:
 *  - never upscale; a derivative is planned only if it is meaningfully smaller than the original
 *  - keep the original's aspect ratio
 *  - choose AVIF, then WebP, then JPEG, using only formats the browser can encode (probed, not assumed)
 *  - transparent images keep an alpha-capable format (WebP, else PNG)
 */

export const DERIVATIVE_ROLES = {
  thumbnail: 480,
  mobile: 768,
  desktop: 1440,
  hero: 1920,
} as const;

export type DerivativeRole = keyof typeof DERIVATIVE_ROLES;
export type DerivativeFormat = "avif" | "webp" | "jpeg" | "png";

export type DerivativePlan = {
  role: DerivativeRole;
  width: number;
  height: number;
  planned: boolean;
  reason: string;
};

/** Plans each role for a source of the given pixel size. Pure. */
export function planDerivatives(source: { width: number; height: number }): DerivativePlan[] {
  const sourceLong = Math.max(source.width, source.height);
  const plans: DerivativePlan[] = [];
  for (const role of Object.keys(DERIVATIVE_ROLES) as DerivativeRole[]) {
    const target = DERIVATIVE_ROLES[role];
    if (!Number.isFinite(sourceLong) || sourceLong <= 0) {
      plans.push({ role, width: 0, height: 0, planned: false, reason: "unknown-source-size" });
      continue;
    }
    // Never upscale, and skip a size that would barely differ from the original.
    if (target >= sourceLong * 0.9) {
      plans.push({ role, width: source.width, height: source.height, planned: false, reason: "not-smaller-than-source" });
      continue;
    }
    const scale = target / sourceLong;
    plans.push({
      role,
      width: Math.max(1, Math.round(source.width * scale)),
      height: Math.max(1, Math.round(source.height * scale)),
      planned: true,
      reason: "smaller-than-source",
    });
  }
  return plans;
}

/** What the current browser can encode, from probing canvas output (see probeEncodeSupport). */
export type EncodeSupport = { avif: boolean; webp: boolean };

/**
 * Picks the best encoding the browser can produce. Alpha needs a format that keeps transparency.
 * Never returns a format the browser could not encode.
 */
export function chooseDerivativeFormat(input: { support: EncodeSupport; hasAlpha: boolean }): DerivativeFormat {
  if (input.hasAlpha) return input.support.webp ? "webp" : "png";
  if (input.support.avif) return "avif";
  if (input.support.webp) return "webp";
  return "jpeg";
}

/**
 * Probes encoding support. `encode` should call canvas.toDataURL(mime). A browser that does not
 * support a type silently returns PNG, so support is true only when the returned prefix matches.
 */
export function probeEncodeSupport(encode: (mime: string) => string): EncodeSupport {
  const check = (mime: string) => {
    try {
      return encode(mime).startsWith(`data:${mime}`);
    } catch {
      return false;
    }
  };
  return { avif: check("image/avif"), webp: check("image/webp") };
}

const TYPE_FOR: Record<DerivativeFormat, string> = {
  avif: "image/avif",
  webp: "image/webp",
  jpeg: "image/jpeg",
  png: "image/png",
};

export type PictureSource = { type: string; format: DerivativeFormat; url: string };

/**
 * Orders <picture> sources from most to least preferred, so a browser takes the first one it can
 * decode and the JPEG/PNG fallback is always last. Only the variants actually supplied are used.
 */
export function pictureSourcesFor(variants: Array<{ format: DerivativeFormat; url: string }>): PictureSource[] {
  const order: DerivativeFormat[] = ["avif", "webp", "jpeg", "png"];
  return order
    .flatMap((format) => variants.filter((variant) => variant.format === format).map((variant) => ({ format, url: variant.url })))
    .map((variant) => ({ type: TYPE_FOR[variant.format], format: variant.format, url: variant.url }));
}
