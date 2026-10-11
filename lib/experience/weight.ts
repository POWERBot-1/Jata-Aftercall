/**
 * Published-experience weight (Immersive Website Engine — §39, §83, §84)
 *
 * §83 asks for a weight calculation before publishing: asset weight, image weight, 3D weight,
 * number of requests, the experience mode, and whether a fallback exists. This module computes
 * it from the experience document alone, with no database query and no network call, so it can
 * run on every health read and in a unit test.
 *
 * It is deliberately **advisory**. It never blocks publishing, never touches the payment or
 * entitlement gate, and never changes the readiness score: an owner on a slow connection is
 * better served by a heavy-but-live website than by a refusal. The budgets are the §39
 * engineering targets, and exceeding one produces a recommendation, not an error.
 *
 * Bytes are only claimed when they are known. A data URL is measured from its own payload; a
 * remote URL has an unknown size until something fetches it, and this module says so rather
 * than guessing. `verdict: "unknown"` is a real answer.
 */

import { estimateBase64Bytes, humanFileSize } from "@/lib/media/imageFormat";

/** §39 targets. Tunable: callers may pass their own, and the defaults are named, not magic. */
export const EXPERIENCE_BUDGETS = {
  /** Total measured image weight the first view should carry. §39: "~1 MB target". */
  initialImagesBytes: 1_000_000,
  /** One image this large should have been resized on the phone before upload (§18). */
  singleImageBytes: 600_000,
  /** §39: a 3D hero of roughly 2–4 MB. Below the floor is not a failure, just a note. */
  modelBytesFloor: 2_000_000,
  modelBytesCeiling: 4_000_000,
  /** Mirrors `IMMERSIVE_LIMITS` in lib/experience/immersive/policy.ts — the hard refusal point. */
  modelBytesHardMax: 8_000_000,
  /** How many separate asset requests the first view should need. */
  initialRequests: 24,
} as const;

/** Widened from the `as const` object so a caller may override any budget with a plain number. */
export type ExperienceBudgets = { [K in keyof typeof EXPERIENCE_BUDGETS]: number };

export type WeightedAsset = {
  kind: "image" | "model";
  /** Where in the document it was found, e.g. `brand.heroImageUrl` or `sections[3].imageUrl`. */
  path: string;
  url: string;
  /** Null when the size cannot be known without fetching it. */
  bytes: number | null;
  measured: boolean;
};

export type ExperienceWeight = {
  assets: WeightedAsset[];
  imageCount: number;
  /** Sum of measured image bytes only. Unmeasured assets contribute nothing. */
  imageBytes: number;
  /** Assets whose size could not be determined — reported, never silently counted as zero. */
  unmeasuredCount: number;
  largestImageBytes: number;
  modelCount: number;
  modelBytes: number;
  initialRequests: number;
  /** Budget keys that were exceeded. Empty means nothing to optimise. */
  overBudget: string[];
  /** Plain-language, owner-facing. Never a byte count in a customer sentence. */
  recommendations: string[];
  /** True when a Lite/Motion presentation exists, so a heavy asset cannot blank the page (§78). */
  fallbackAvailable: boolean;
  verdict: "within-budget" | "optimise" | "unknown";
};

export type ExperienceWeightInput = {
  /** The experience document. Walked generically, so new fields are picked up without a change here. */
  document: unknown;
  /** Known model sizes, when the caller has them (for example from an upload record). */
  models?: ReadonlyArray<{ url: string; bytes: number | null }>;
  budgets?: Partial<ExperienceBudgets>;
  /** Guard against a pathological document. Generous, because a real one is a few hundred nodes. */
  maxNodes?: number;
};

const IMAGE_URL_PATTERN = /\.(jpe?g|png|webp|gif|avif)(\?|#|$)/i;
const MODEL_URL_PATTERN = /\.(glb|gltf)(\?|#|$)/i;
const DEFAULT_MAX_NODES = 5000;

function looksLikeImage(value: string): boolean {
  return value.startsWith("data:image/") || IMAGE_URL_PATTERN.test(value);
}

function looksLikeModel(value: string): boolean {
  return MODEL_URL_PATTERN.test(value);
}

function bytesOf(url: string): number | null {
  if (!url.startsWith("data:")) return null;
  const comma = url.indexOf(",");
  if (comma < 0) return null;
  return estimateBase64Bytes(url.length - comma - 1);
}

/**
 * Collects every image and model reference in the document, with the path it was found at.
 *
 * A generic walk rather than a field list: the document grows (galleries, variants, campaigns),
 * and a hard-coded list would silently stop counting new fields — which is how a budget check
 * quietly becomes a lie.
 */
function collectAssets(input: { document: unknown; maxNodes: number }): WeightedAsset[] {
  const out: WeightedAsset[] = [];
  let nodes = 0;

  const walk = (value: unknown, path: string): void => {
    if (nodes >= input.maxNodes) return;
    nodes += 1;
    if (typeof value === "string") {
      if (looksLikeModel(value)) {
        out.push({ kind: "model", path, url: value, bytes: bytesOf(value), measured: bytesOf(value) !== null });
        return;
      }
      if (looksLikeImage(value)) {
        const bytes = bytesOf(value);
        out.push({ kind: "image", path, url: value, bytes, measured: bytes !== null });
      }
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        walk(entry, path ? `${path}.${key}` : key);
      }
    }
  };

  walk(input.document, "");
  return out;
}

/**
 * Computes the experience's weight and what to do about it.
 *
 * Never throws: a malformed document yields an empty report with `verdict: "unknown"`, because a
 * health read must not be able to fail the Studio page it is displayed on.
 */
export function experienceWeight(input: ExperienceWeightInput): ExperienceWeight {
  const budgets = { ...EXPERIENCE_BUDGETS, ...(input.budgets || {}) };
  const empty: ExperienceWeight = {
    assets: [],
    imageCount: 0,
    imageBytes: 0,
    unmeasuredCount: 0,
    largestImageBytes: 0,
    modelCount: 0,
    modelBytes: 0,
    initialRequests: 0,
    overBudget: [],
    recommendations: [],
    fallbackAvailable: true,
    verdict: "unknown",
  };

  try {
    const known = new Map((input.models || []).map((model) => [model.url, model.bytes]));
    const collected = collectAssets({ document: input.document, maxNodes: input.maxNodes ?? DEFAULT_MAX_NODES });

    const assets: WeightedAsset[] = collected.map((asset) => {
      if (asset.kind !== "model") return asset;
      const knownBytes = known.get(asset.url);
      if (asset.bytes !== null) return asset;
      if (typeof knownBytes === "number" && Number.isFinite(knownBytes)) {
        return { ...asset, bytes: knownBytes, measured: true };
      }
      return asset;
    });

    const images = assets.filter((asset) => asset.kind === "image");
    const models = assets.filter((asset) => asset.kind === "model");
    const measuredImages = images.filter((asset) => asset.bytes !== null);

    const imageBytes = measuredImages.reduce((total, asset) => total + (asset.bytes ?? 0), 0);
    const largestImageBytes = measuredImages.reduce((max, asset) => Math.max(max, asset.bytes ?? 0), 0);
    const modelBytes = models.reduce((total, asset) => total + (asset.bytes ?? 0), 0);
    const unmeasuredCount = assets.filter((asset) => asset.bytes === null).length;

    const overBudget: string[] = [];
    const recommendations: string[] = [];

    if (imageBytes > budgets.initialImagesBytes) {
      overBudget.push("initialImagesBytes");
      recommendations.push(
        `Your photos add up to ${humanFileSize(imageBytes)}. JATA can shrink them for phones without changing how they look.`,
      );
    }
    if (largestImageBytes > budgets.singleImageBytes) {
      overBudget.push("singleImageBytes");
      recommendations.push(
        `One photo is ${humanFileSize(largestImageBytes)}. Resizing it will make the page load faster on mobile data.`,
      );
    }
    if (models.length > 0 && modelBytes > budgets.modelBytesCeiling) {
      overBudget.push("modelBytesCeiling");
      recommendations.push(
        `The 3D model is ${humanFileSize(modelBytes)}, above the ${humanFileSize(budgets.modelBytesCeiling)} target. Compressing it keeps the 3D view and cuts the download.`,
      );
    }
    if (modelBytes > budgets.modelBytesHardMax) {
      overBudget.push("modelBytesHardMax");
      recommendations.push("That 3D model is too large to publish. Replace it with a smaller one, or use a photo instead.");
    }
    if (assets.length > budgets.initialRequests) {
      overBudget.push("initialRequests");
      recommendations.push(
        `The page asks for ${assets.length} images. Using fewer on the first screen loads faster on a phone.`,
      );
    }
    if (unmeasuredCount > 0) {
      recommendations.push(
        `${unmeasuredCount} image${unmeasuredCount === 1 ? "" : "s"} are stored outside JATA, so their size could not be checked here.`,
      );
    }

    const verdict: ExperienceWeight["verdict"] =
      overBudget.length > 0 ? "optimise" : unmeasuredCount === assets.length && assets.length > 0 ? "unknown" : "within-budget";

    return {
      assets,
      imageCount: images.length,
      imageBytes,
      unmeasuredCount,
      largestImageBytes,
      modelCount: models.length,
      modelBytes,
      initialRequests: assets.length,
      overBudget,
      recommendations,
      // The document always renders as HTML with CSS-only reveals, so a heavy asset degrades the
      // presentation rather than the page (§78). Stated here so a reader of the report can see it.
      fallbackAvailable: true,
      verdict,
    };
  } catch {
    return empty;
  }
}

/** One line for the Studio, in the same voice as `healthSummaryLine`. */
export function weightSummaryLine(weight: ExperienceWeight): string {
  if (weight.assets.length === 0) return "No images yet.";
  if (weight.verdict === "optimise") {
    return `Page weight ${humanFileSize(weight.imageBytes + weight.modelBytes)} · worth optimising`;
  }
  if (weight.verdict === "unknown") return "Page weight could not be measured.";
  return `Page weight ${humanFileSize(weight.imageBytes + weight.modelBytes)} · within budget`;
}
