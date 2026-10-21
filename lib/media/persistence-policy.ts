/**
 * Media persistence policy.
 *
 * Neon may retain legacy image data URLs for read compatibility, but new application writes
 * must not put image bytes into text columns. No durable media provider has been approved or
 * configured, so writes that would introduce inline image data fail closed. Read/normalization
 * helpers intentionally do not use this policy: existing pages must continue to render.
 */

export const INLINE_MEDIA_PERSISTENCE_CODE = "inline_media_persistence_disabled";
export const INLINE_MEDIA_PERSISTENCE_MESSAGE =
  "Inline image data cannot be saved until an approved durable media provider is configured. Existing images remain readable. Remove this inline image or replace it with an approved image URL before saving or publishing.";

const INLINE_IMAGE_DATA_URL = /data:image(?:\\?\/)/i;
const INLINE_IMAGE_DATA_URL_EXACT = /^data:image\//i;
const INLINE_IMAGE_DATA_URL_VALUE = /data:image(?:\\?\/)[^\s"'<>)}\]]*/gi;
const MAX_JSON_SCAN_CHARS = 65_536;
const MAX_JSON_SCAN_DEPTH = 4;
const MAX_ESCAPE_SCAN_DEPTH = 8;

/** Decode one JSON-style escape layer without parsing or allocating an object graph. */
function decodeJsonEscapesOnce(value: string): string {
  const escape = String.fromCharCode(92);
  if (!value.includes(escape)) return value;
  const output: string[] = [];
  let changed = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== escape || index + 1 >= value.length) {
      output.push(value[index]);
      continue;
    }

    const escaped = value[index + 1];
    if (escaped === "u" && index + 5 < value.length) {
      const hex = value.slice(index + 2, index + 6);
      if (/^[0-9a-f]{4}$/i.test(hex)) {
        output.push(String.fromCharCode(Number.parseInt(hex, 16)));
        index += 5;
        changed = true;
        continue;
      }
    }

    const decoded: Record<string, string> = {
      '"': '"',
      [escape]: escape,
      "/": "/",
      b: String.fromCharCode(8),
      f: String.fromCharCode(12),
      n: String.fromCharCode(10),
      r: String.fromCharCode(13),
      t: String.fromCharCode(9),
    };
    if (Object.prototype.hasOwnProperty.call(decoded, escaped)) {
      output.push(decoded[escaped]);
      index += 1;
      changed = true;
    } else {
      output.push(escape);
    }
  }
  return changed ? output.join("") : value;
}

/**
 * Finds a data URL even when its prefix or slash is JSON-escaped, including in large serialized
 * columns that are deliberately not passed to JSON.parse. Repeated passes cover nested JSON text.
 */
function containsEscapedInlineImageDataUrl(value: string): boolean {
  let candidate = value;
  for (let depth = 0; depth <= MAX_ESCAPE_SCAN_DEPTH; depth += 1) {
    if (INLINE_IMAGE_DATA_URL.test(candidate)) return true;
    const decoded = decodeJsonEscapesOnce(candidate);
    if (decoded === candidate) return false;
    candidate = decoded;
  }
  return INLINE_IMAGE_DATA_URL.test(candidate);
}

/** True for an image data URL, regardless of MIME subtype or payload encoding. */
export function isInlineImageDataUrl(value: unknown): value is string {
  return typeof value === "string" && INLINE_IMAGE_DATA_URL_EXACT.test(value.trim());
}

/**
 * Recursively detects image data URL schemes, including SVG, non-base64 payloads, nested
 * objects, and serialized JSON. The image bytes are never returned, logged, or included in an
 * error response. A malformed `data:image/` prefix is rejected too rather than persisted as text.
 */
export function containsInlineImageDataUrl(value: unknown, jsonDepth = 0): boolean {
  if (typeof value === "string") {
    if (containsEscapedInlineImageDataUrl(value)) return true;
    const candidate = value.trim();
    // Parse only bounded JSON-looking values to inspect nested structures. The escape-aware scan
    // above also handles oversized strings, so encoded prefixes cannot bypass the guard.
    if (
      jsonDepth < MAX_JSON_SCAN_DEPTH &&
      candidate.length <= MAX_JSON_SCAN_CHARS &&
      (candidate.startsWith("{") || candidate.startsWith("[") || candidate.startsWith('"'))
    ) {
      try {
        return containsInlineImageDataUrl(JSON.parse(candidate), jsonDepth + 1);
      } catch {
        // The direct pattern above still catches malformed/partially serialized URL strings.
      }
    }
    return false;
  }
  if (Array.isArray(value)) return value.some((entry) => containsInlineImageDataUrl(entry, jsonDepth));
  if (value && typeof value === "object") {
    return Object.entries(value).some(([key, entry]) =>
      containsInlineImageDataUrl(key, jsonDepth) || containsInlineImageDataUrl(entry, jsonDepth),
    );
  }
  return false;
}

/** Serialize optional provider evidence only when it contains no inline image data. */
export function serializeJsonWithoutInlineImageData(value: unknown): string | undefined {
  if (containsInlineImageDataUrl(value)) return undefined;
  const serialized = JSON.stringify(value);
  return typeof serialized === "string" ? serialized : undefined;
}

/** Collects image-data URL strings only for an in-memory comparison at the write boundary. */
export function inlineImageDataUrlValues(value: unknown, jsonDepth = 0): string[] {
  if (typeof value === "string") {
    const matches = value.match(INLINE_IMAGE_DATA_URL_VALUE) ?? [];
    if (matches.length > 0) return matches;
    const candidate = value.trim();
    if (
      jsonDepth < MAX_JSON_SCAN_DEPTH &&
      candidate.length <= MAX_JSON_SCAN_CHARS &&
      (candidate.startsWith("{") || candidate.startsWith("[") || candidate.startsWith('"'))
    ) {
      try {
        return inlineImageDataUrlValues(JSON.parse(candidate), jsonDepth + 1);
      } catch {
        return [];
      }
    }
    return [];
  }
  if (Array.isArray(value)) return value.flatMap((entry) => inlineImageDataUrlValues(entry, jsonDepth));
  if (value && typeof value === "object") return Object.values(value).flatMap((entry) => inlineImageDataUrlValues(entry, jsonDepth));
  return [];
}

/**
 * A row-level error for persistence adapters that can safely expose a 503 without leaking data.
 * Routes should return the shared code/message directly when possible.
 */
export class InlineMediaPersistenceError extends Error {
  readonly code = INLINE_MEDIA_PERSISTENCE_CODE;
  readonly status = 503;

  constructor() {
    super(INLINE_MEDIA_PERSISTENCE_MESSAGE);
    this.name = "InlineMediaPersistenceError";
  }
}

/** Throws when a proposed write contains any inline image bytes. */
export function assertNoInlineImagePersistence(value: unknown): void {
  if (containsInlineImageDataUrl(value)) throw new InlineMediaPersistenceError();
}

/**
 * Order/catalogue snapshots are optional presentation data. Preserve external URLs, but do not
 * copy a legacy catalogue data URL into a newly created transaction row.
 */
export function imageUrlForNewRecord(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim() || containsInlineImageDataUrl(value)) return null;
  return value;
}
