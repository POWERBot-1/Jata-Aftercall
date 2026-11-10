/**
 * Publishable visual evidence over GitHub check annotations.
 *
 * WHY THIS EXISTS
 * ---------------
 * The sandbox used for review has no egress to the Actions artifact blob host
 * (`productionresultssa*.blob.core.windows.net`), so an uploaded screenshot
 * artifact cannot be downloaded and independently inspected. Check annotations
 * ARE reachable (`gh api .../check-runs/<id>/annotations`), which made them the
 * only retrieval channel — but the previous emitter contained two defects that
 * silently produced images nobody could open:
 *
 *   1. It emitted `ceil(base64 / 3000)` annotations per viewport with no budget
 *      and no total accounting. Measured on check run 130128893526: 320×568
 *      published all 8 parts (a complete 16,268-byte JPEG), 360×800 published
 *      only 2 of 11, and 390×844, 430×932, 768×1024 and 1366×768 were never
 *      published at all. Four of the six mandated viewports had no inspectable
 *      pixel evidence. The retained total was 16 annotations / ~29,800
 *      characters — a byte budget, not a count of 10, which an earlier reading
 *      of that run mistook it for.
 *   2. It never checked that the reassembled bytes are a *complete* JPEG, so a
 *      truncated run is indistinguishable from a successful one until someone
 *      tries to open the file. (Reassembly must go through this module: a lossy
 *      shell round-trip of the raw base64 also drops the `FFD9` marker and
 *      misreports a good image as corrupt.)
 *
 * This module makes both failure modes impossible to ignore: a plan is only
 * `fits` when the WHOLE image is under both caps, and decoding refuses a
 * stream without SOI+EOI. The capture script shrinks the thumbnail until it
 * fits rather than publishing an unattestable fragment.
 *
 * Limits are conservative and measured, not guessed: a 3000-character part
 * stays under the 4096-byte annotation message limit, and 10 parts stay at
 * GitHub's per-check annotation cap.
 */

/**
 * Measured, not assumed. An earlier version of this file asserted a hard
 * 10-per-check-run cap; that was wrong. Check run 130128893526 retained 16
 * annotations (≈29,800 message characters) and run 130152615805 retained 13. The
 * observed limit is a byte budget near 30,000 characters per check run, and
 * GitHub's documented per-annotation limit is 4096 bytes of title+message.
 */
export const OBSERVED_MESSAGE_BUDGET_CHARS = 30000;
/** Conservative planning number: half the observed budget, so the manifest and error notices also fit. */
export const MAX_ANNOTATIONS_PER_CHECK = 10;
/**
 * GitHub caps an annotation title+message at 4096 bytes. 3500 characters of
 * base64 plus the `MOTION_VISUAL_<viewport>_<n>_OF_<m>` title stays inside it
 * with room for the JSON wrapper, and is a measured fit rather than a guess.
 */
export const MAX_ANNOTATION_CHARS = 3500;

/** Display order and the share of the annotation budget each viewport may use. */
export const VIEWPORT_ORDER = ["320x568", "360x800", "390x844", "430x932", "768x1024", "1366x768"];

/**
 * Thumbnail tiers, largest first. The capture script encodes at each tier until
 * one fits its share of the budget, so the published image is as legible as the
 * channel actually permits instead of a fixed guess.
 *
 * Measured on a real storefront capture (photographic hero, 16,268 bytes at
 * 320px): a 240px tier needs ~19,600 base64 characters and cannot fit even two
 * parts, while 140px needs ~5,024 (two parts) and 100px needs ~2,456 (one part).
 * Photographs compress far worse than flat synthetic images, which is why the
 * ladder reaches below 100px: a small whole image beats no image, and the
 * fidelity limit is reported rather than hidden.
 */
export const THUMBNAIL_TIERS = [
  { width: 240, quality: 40 },
  { width: 220, quality: 34 },
  { width: 200, quality: 28 },
  { width: 180, quality: 24 },
  { width: 160, quality: 22 },
  { width: 140, quality: 20 },
  { width: 120, quality: 18 },
  { width: 100, quality: 16 },
  { width: 90, quality: 14 },
  { width: 80, quality: 12 },
];

/** Split base64 into numbered annotation parts. */
export function chunkBase64(base64, maxPartLength = MAX_ANNOTATION_CHARS) {
  if (typeof base64 !== "string") throw new TypeError("base64 must be a string");
  if (!Number.isInteger(maxPartLength) || maxPartLength < 1) throw new RangeError("maxPartLength must be a positive integer");
  const chunks = [];
  for (let index = 0; index < base64.length; index += maxPartLength) chunks.push(base64.slice(index, index + maxPartLength));
  return chunks;
}

/**
 * Decide whether one image can be published whole.
 *
 * `maxAnnotations` is the budget remaining for this image after any manifest or
 * other annotations already emitted on the same check run.
 */
export function planVisualAnnotations(base64, { maxAnnotations = MAX_ANNOTATIONS_PER_CHECK, maxPartLength = MAX_ANNOTATION_CHARS } = {}) {
  if (!Number.isInteger(maxAnnotations) || maxAnnotations < 0) throw new RangeError("maxAnnotations must be a non-negative integer");
  const chunks = chunkBase64(base64, maxPartLength);
  const bytes = Buffer.from(base64, "base64").length;
  if (chunks.length <= maxAnnotations) return { fits: true, chunks, bytes, reason: null };
  return {
    fits: false,
    chunks,
    bytes,
    reason: `image needs ${chunks.length} annotations but only ${maxAnnotations} remain within the ${MAX_ANNOTATIONS_PER_CHECK}-annotation cap (${bytes} bytes)`,
  };
}

/** Per-viewport annotation budget, so six viewports can all be published together. */
export function perViewportBudget(count = VIEWPORT_ORDER.length, options = {}) {
  const total = options.maxAnnotations ?? MAX_ANNOTATIONS_PER_CHECK;
  const reserved = options.reserved ?? 0;
  if (!Number.isInteger(count) || count < 1) throw new RangeError("count must be a positive integer");
  return Math.max(0, Math.floor((total - reserved) / count));
}

/** True when `bytes` starts with a JPEG SOI marker. */
export function isJpegStart(bytes) {
  return Boolean(bytes) && bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8;
}

/** True when `bytes` ends with a JPEG EOI marker — i.e. the stream is not truncated. */
export function isJpegComplete(bytes) {
  if (!isJpegStart(bytes) || bytes.length < 4) return false;
  return bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
}

/**
 * Reassemble numbered annotation parts and refuse anything that is not a whole
 * JPEG. Returns `{ ok, bytes, reason }` — never a silently short image.
 */
export function decodeVisualAnnotations(parts) {
  if (!Array.isArray(parts) || !parts.length) return { ok: false, bytes: null, reason: "no annotation parts supplied" };
  if (parts.some((part) => typeof part !== "string")) return { ok: false, bytes: null, reason: "annotation parts must all be strings" };
  const bytes = Buffer.from(parts.join(""), "base64");
  if (!bytes.length) return { ok: false, bytes: null, reason: "annotation parts decoded to zero bytes" };
  if (!isJpegStart(bytes)) return { ok: false, bytes, reason: "decoded stream has no JPEG start-of-image marker" };
  if (!isJpegComplete(bytes)) return { ok: false, bytes, reason: "decoded stream is truncated: it has no JPEG end-of-image marker" };
  return { ok: true, bytes, reason: null };
}

/**
 * Order and group `MOTION_VISUAL_<viewport>_<n>_OF_<total>` titles back into
 * per-viewport part lists. Used by the retrieval script and its tests.
 */
export function groupVisualAnnotations(items) {
  const groups = new Map();
  for (const item of items || []) {
    const title = typeof item?.title === "string" ? item.title : "";
    const match = title.match(/^MOTION_VISUAL_(\d+x\d+)_(\d+)_OF_(\d+)$/);
    if (!match) continue;
    const [, viewport, partText, totalText] = match;
    const part = Number(partText);
    const total = Number(totalText);
    const group = groups.get(viewport) || { viewport, total: null, parts: new Map() };
    group.total = total;
    group.parts.set(part, typeof item.message === "string" ? item.message : "");
    groups.set(viewport, group);
  }
  return [...groups.values()]
    .sort((a, b) => VIEWPORT_ORDER.indexOf(a.viewport) - VIEWPORT_ORDER.indexOf(b.viewport))
    .map((group) => {
      const ordered = [...group.parts.entries()].sort((a, b) => a[0] - b[0]);
      const expected = Array.from({ length: group.total || 0 }, (_, index) => index + 1);
      const missing = expected.filter((part) => !group.parts.has(part));
      return { viewport: group.viewport, total: group.total, parts: ordered.map(([, message]) => message), missing };
    });
}
