/**
 * Raster image inspection (§19, §20, §41)
 *
 * One place, shared by the browser and the server, that answers the only questions that
 * matter for a phone photo upload:
 *
 *   • What *is* this file? (magic bytes, never the filename or the MIME the browser guessed)
 *   • Is it a format we can publish? (JPG / PNG / WebP / GIF — the ones every browser renders)
 *   • How big is it in pixels? (so the storefront can reserve space and avoid layout shift)
 *   • Is the EXIF orientation set? (so a photo taken in portrait is not stored sideways)
 *
 * Nothing here touches the DOM or the network: it takes bytes and returns facts, which is why
 * the mobile-upload regression suite can test it directly.
 */

export type ImageFormat = "jpeg" | "png" | "webp" | "gif" | "heic" | "avif" | "bmp" | "tiff";

export type UploadIssueCode =
  | "empty"
  | "not_image"
  | "unsupported_format"
  | "heic_unsupported"
  | "too_large"
  | "corrupt"
  | "decode_failed"
  | "wrong_extension";

export type UploadIssue = {
  code: UploadIssueCode;
  /** Plain, human sentence an owner can act on (§39). Never a raw error code. */
  message: string;
  /** True when retrying the same file after JATA compresses it may succeed. */
  recoverable: boolean;
};

export type ImageFacts = {
  format: ImageFormat;
  mime: string;
  bytes: number;
  width: number | null;
  height: number | null;
  /** 1 = upright. 3 = 180°, 6 = 90° CW, 8 = 270° CW (and 2/4/5/7 are mirrored variants). */
  exifOrientation: number | null;
};

/** Formats the public website can actually render on Android, iPhone and desktop. */
export const WEB_SAFE_FORMATS: readonly ImageFormat[] = ["jpeg", "png", "webp", "gif"];

/** Formats we accept as *input* to the upload pipeline (the browser normalizes the rest). */
export const ACCEPTED_INPUT_FORMATS: readonly ImageFormat[] = [
  "jpeg",
  "png",
  "webp",
  "gif",
  "heic",
  "avif",
];

export const MIME_FOR_FORMAT: Record<ImageFormat, string> = {
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
  heic: "image/heic",
  avif: "image/avif",
  bmp: "image/bmp",
  tiff: "image/tiff",
};

export const FORMAT_FOR_MIME: Record<string, ImageFormat> = {
  "image/jpeg": "jpeg",
  "image/jpg": "jpeg",
  "image/pjpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heic",
  "image/heic-sequence": "heic",
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

/** Hard ceiling on decoded bytes accepted by the API. The browser pipeline compresses first,
 * so this ceiling is only ever hit by a file that bypassed normalization entirely (§20). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Largest source file the Studio will read from a phone before normalizing it. */
export const MAX_SOURCE_BYTES = 24 * 1024 * 1024;

/**
 * Longest inline data URL the platform will store in a website document.
 *
 * `safeUrl` in the experience document accepts an inline image only up to this length, so an
 * image longer than this can be uploaded but could never be *used* — it would be silently
 * dropped when the owner set it as a product, hero or section image. The upload path therefore
 * shares the same ceiling: everything the Studio stores can also be published (§19, §47).
 */
export const MAX_STORED_CHARS = 4_000_000;

/** Longest data URL the API accepts. Kept equal to the storage ceiling so nothing is accepted
 * that the website could not then display. */
export const MAX_UPLOAD_CHARS = MAX_STORED_CHARS;

function ascii(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    out += String.fromCharCode(bytes[i]);
  }
  return out;
}

function hex(bytes: Uint8Array, start: number, length: number): string {
  let out = "";
  for (let i = start; i < start + length && i < bytes.length; i += 1) {
    out += bytes[i].toString(16).padStart(2, "0");
  }
  return out;
}

/**
 * Identifies the file by its content. A `.jpg` that is really a PDF, or a file the browser
 * labelled `image/png` but is actually HEIC, is caught here (§41).
 */
export function sniffImageFormat(bytes: Uint8Array | null | undefined): ImageFormat | null {
  if (!bytes || bytes.length < 12) {
    if (bytes && bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    return null;
  }

  // JPEG: FF D8 FF
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (hex(bytes, 0, 8) === "89504e470d0a1a0a") return "png";

  // GIF: "GIF87a" / "GIF89a"
  const gifHead = ascii(bytes, 0, 6);
  if (gifHead === "GIF87a" || gifHead === "GIF89a") return "gif";

  // RIFF container: WEBP or AVIF-in-RIFF are the only ones we care about.
  if (ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return "webp";

  // ISO-BMFF: "ftyp" at byte 4 with a brand we recognise (HEIC/HEIF/AVIF).
  if (ascii(bytes, 4, 4) === "ftyp") {
    const brand = ascii(bytes, 8, 4).toLowerCase();
    const compatible = ascii(bytes, 16, 12).toLowerCase();
    const isAvif = brand.startsWith("avif") || brand.startsWith("avis") || compatible.includes("avif");
    const isHeic =
      brand.startsWith("heic") ||
      brand.startsWith("heix") ||
      brand.startsWith("hevc") ||
      brand.startsWith("heim") ||
      brand.startsWith("heis") ||
      brand.startsWith("mif1") ||
      brand.startsWith("msf1") ||
      compatible.includes("heic") ||
      compatible.includes("mif1");
    if (isAvif) return "avif";
    if (isHeic) return "heic";
  }

  // BMP: "BM"
  if (bytes[0] === 0x42 && bytes[1] === 0x4d) return "bmp";

  // TIFF: II*\0 or MM\0*
  if (hex(bytes, 0, 4) === "49492a00" || hex(bytes, 0, 4) === "4d4d002a") return "tiff";

  return null;
}

/** Pixel dimensions straight from the file header — no decoding, no memory spike. */
export function readImageDimensions(bytes: Uint8Array, format?: ImageFormat | null): { width: number; height: number } | null {
  const kind = format ?? sniffImageFormat(bytes);
  if (!kind) return null;
  try {
    switch (kind) {
      case "png": {
        if (bytes.length < 24) return null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { width: view.getUint32(16), height: view.getUint32(20) };
      }
      case "gif": {
        if (bytes.length < 10) return null;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
      }
      case "jpeg":
        return jpegDimensions(bytes);
      case "webp":
        return webpDimensions(bytes);
      default:
        return null;
    }
  } catch {
    return null;
  }
}

function jpegDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // SOF0–SOF15 carry the frame size; C4/C8/CC are Huffman/arithmetic tables, not frames.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      return { height: view.getUint16(offset + 5), width: view.getUint16(offset + 7) };
    }
    // Standalone markers have no length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      offset += 2;
      continue;
    }
    const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset + 2);
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  const chunk = ascii(bytes, 12, 4);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (chunk === "VP8X" && bytes.length >= 30) {
    const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
    const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
    return { width, height };
  }
  if (chunk === "VP8 " && bytes.length >= 30) {
    // Lossy: frame header starts after the 3-byte start code at byte 23.
    return {
      width: view.getUint16(26, true) & 0x3fff,
      height: view.getUint16(28, true) & 0x3fff,
    };
  }
  if (chunk === "VP8L" && bytes.length >= 25) {
    const bits = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  return null;
}

/**
 * Reads the EXIF orientation tag (0x0112) from a JPEG. Orientation 6 and 8 mean the stored
 * pixels are rotated, so a portrait photo can otherwise end up sideways on the website.
 */
export function readExifOrientation(bytes: Uint8Array): number | null {
  if (sniffImageFormat(bytes) !== "jpeg") return null;
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset] !== 0xff) return null;
    const marker = bytes[offset + 1];
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const length = view.getUint16(offset + 2);
    if (marker === 0xe1) {
      const segmentStart = offset + 4;
      if (ascii(bytes, segmentStart, 6) !== "Exif\u0000\u0000") return null;
      const tiffStart = segmentStart + 6;
      const little = ascii(bytes, tiffStart, 2) === "II";
      const read16 = (at: number) => (little ? view.getUint16(at, true) : view.getUint16(at, false));
      const read32 = (at: number) => (little ? view.getUint32(at, true) : view.getUint32(at, false));
      const ifdOffset = read32(tiffStart + 4);
      const ifdStart = tiffStart + ifdOffset;
      if (ifdStart + 2 > bytes.length) return null;
      const entries = read16(ifdStart);
      for (let i = 0; i < entries; i += 1) {
        const entry = ifdStart + 2 + i * 12;
        if (entry + 12 > bytes.length) return null;
        if (read16(entry) === 0x0112) {
          const value = read16(entry + 8);
          return value >= 1 && value <= 8 ? value : null;
        }
      }
      return null;
    }
    if (marker === 0xda || marker === 0xd9) return null;
    if (length < 2) return null;
    offset += 2 + length;
  }
  return null;
}

/** True when the orientation tag swaps width and height (90°/270° rotations). */
export function orientationSwapsAxes(orientation: number | null): boolean {
  return orientation === 5 || orientation === 6 || orientation === 7 || orientation === 8;
}

export type Base64Image = {
  mime: string;
  format: ImageFormat;
  bytes: Uint8Array;
};

const DATA_URL = /^data:([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)((?:;[a-zA-Z0-9.+-]+=[^;,]+)*);base64,([A-Za-z0-9+/=\s]*)$/;

/**
 * Parses an inline image data URL, tolerating the whitespace and padding irregularities that
 * Android keyboards and clipboard paste produce. Returns `null` for anything that is not a
 * parseable base64 image — including SVG, which is deliberately unsupported (§41: no vectors,
 * no scripts, no external fetches).
 */
export function parseImageDataUrl(value: unknown): Base64Image | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length > MAX_UPLOAD_CHARS * 4) return null;
  const match = DATA_URL.exec(trimmed);
  if (!match) return null;
  const mime = match[1].toLowerCase();
  const stripped = match[3].replace(/\s+/g, "");
  if (!stripped) return null;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(stripped, "base64");
  } catch {
    return null;
  }
  if (buffer.length === 0) return null;
  const bytes = new Uint8Array(buffer);
  const sniffed = sniffImageFormat(bytes);
  if (!sniffed) return null;
  // The declared MIME and the real bytes must agree when the declared type is a raster image;
  // disagreement is exactly the kind of spoofing the API must reject (§41).
  const declared = FORMAT_FOR_MIME[mime];
  if (declared && declared !== sniffed && !(declared === "heic" && sniffed === "heic")) return null;
  return { mime, format: sniffed, bytes };
}

export function estimateBase64Bytes(chars: number): number {
  return Math.max(0, Math.floor((chars * 3) / 4));
}

/** Human size for progress and error copy — never a byte count in a customer sentence. */
export function humanFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 KB";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The single validation gate for uploaded bytes. The browser calls it before spending time on
 * a decode; the server calls it again on the bytes it actually received (§41: never trust the
 * client's verdict).
 */
export function validateImageBytes(
  bytes: Uint8Array,
  options: { declaredMime?: string | null; filename?: string | null; maxBytes?: number } = {},
): { status: "ok"; facts: ImageFacts } | { status: "error"; issue: UploadIssue } {
  const maxBytes = options.maxBytes ?? MAX_UPLOAD_BYTES;
  if (!bytes || bytes.length === 0) {
    return { status: "error", issue: { code: "empty", message: "That file is empty. Please choose the photo again.", recoverable: true } };
  }
  if (bytes.length > maxBytes) {
    return {
      status: "error",
      issue: {
        code: "too_large",
        message: `This photo is too large (${humanFileSize(bytes.length)}). JATA can shrink it automatically — try again and we will optimize it for you.`,
        recoverable: true,
      },
    };
  }

  const format = sniffImageFormat(bytes);
  if (!format) {
    return {
      status: "error",
      issue: {
        code: "not_image",
        message: "That file isn't a photo JATA can read. Choose a JPG, PNG or WebP image.",
        recoverable: true,
      },
    };
  }

  if (format === "heic") {
    return {
      status: "error",
      issue: {
        code: "heic_unsupported",
        message:
          "iPhone HEIC photos can't be shown on websites yet. Take a screenshot of the photo and upload that, or open Settings › Camera › Formats and choose “Most Compatible”.",
        recoverable: false,
      },
    };
  }

  if (!WEB_SAFE_FORMATS.includes(format)) {
    return {
      status: "error",
      issue: {
        code: "unsupported_format",
        message: `JATA can't publish ${format.toUpperCase()} images. Choose a JPG, PNG, WebP or GIF photo.`,
        recoverable: true,
      },
    };
  }

  const declared = options.declaredMime ? FORMAT_FOR_MIME[String(options.declaredMime).toLowerCase()] : null;
  if (declared && declared !== format && !(declared === "jpeg" && format === "jpeg")) {
    return {
      status: "error",
      issue: {
        code: "wrong_extension",
        message: `This file says it is ${declared.toUpperCase()} but it is really ${format.toUpperCase()}. Try saving it as a JPG and uploading again.`,
        recoverable: true,
      },
    };
  }

  const dimensions = readImageDimensions(bytes, format);
  if (!dimensions || dimensions.width <= 0 || dimensions.height <= 0) {
    return {
      status: "error",
      issue: {
        code: "corrupt",
        message: "This photo looks damaged and can't be opened. Try taking it again or choosing a different photo.",
        recoverable: true,
      },
    };
  }

  return {
    status: "ok",
    facts: {
      format,
      mime: MIME_FOR_FORMAT[format],
      bytes: bytes.length,
      width: dimensions.width,
      height: dimensions.height,
      exifOrientation: readExifOrientation(bytes),
    },
  };
}

/** Maps an exception from a decode attempt to something an owner can act on (§39). */
export function decodeFailureIssue(reason?: string | null): UploadIssue {
  const detail = String(reason || "").toLowerCase();
  if (detail.includes("heic") || detail.includes("heif")) {
    return {
      code: "heic_unsupported",
      message:
        "This looks like an iPhone HEIC photo that your browser can't open. Take a screenshot of it and upload that instead.",
      recoverable: false,
    };
  }
  return {
    code: "decode_failed",
    message: "We couldn't open that photo on your phone. Try choosing it again, or take a fresh photo with the camera.",
    recoverable: true,
  };
}

/** Formats accepted by an `<input type="file">`, ordered so phones offer the camera first. */
export const FILE_INPUT_ACCEPT =
  "image/jpeg,image/jpg,image/png,image/webp,image/gif,image/heic,image/heif,image/avif";

/** The upload contract the Studio's picker and the tests both read (§19, §41). */
export const MEDIA_RULES = {
  maxUploadBytes: MAX_UPLOAD_BYTES,
  formats: ["jpeg", "png", "webp", "gif"],
  sniffedByContent: true,
  svgAllowed: false,
} as const;
