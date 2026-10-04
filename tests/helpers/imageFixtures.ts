/**
 * Byte-level photo fixtures (§18, §19, §43)
 *
 * The mobile-upload regression suite has to prove what happens for a real JPEG with EXIF
 * orientation, a WebP straight out of an Android camera, a PNG from a screenshot, a truncated
 * download and an iPhone HEIC — without shipping megabytes of binary into the repository. Each
 * builder below writes a structurally valid header (signature + dimensions + orientation) that
 * the sniffers, the dimension reader and the validation gate all parse exactly as they would a
 * file from a phone.
 */

export function concat(parts: Array<Uint8Array | number[]>): Uint8Array {
  const arrays = parts.map((part) => (part instanceof Uint8Array ? part : new Uint8Array(part)));
  const total = arrays.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of arrays) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

export function bytesFromBase64(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

/** A JPEG with a real SOF0 frame header, optional EXIF orientation, and a tail of pixel data. */
export function jpegBytes(options: { width?: number; height?: number; exifOrientation?: number; padding?: number } = {}): Uint8Array {
  const width = options.width ?? 1200;
  const height = options.height ?? 1600;

  const app1 = (() => {
    if (!options.exifOrientation) return new Uint8Array(0);
    // APP1 / Exif / TIFF (big endian) / IFD0 with one tag: 0x0112 Orientation (SHORT).
    const payload = [
      0x45, 0x78, 0x69, 0x66, 0x00, 0x00, // "Exif\0\0"
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM", 42, offset 8
      0x00, 0x01, // 1 entry
      0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, 0x00, options.exifOrientation, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x00, // next IFD
    ];
    const length = payload.length + 2;
    return new Uint8Array([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff, ...payload]);
  })();

  const sof = new Uint8Array([
    0xff, 0xc0, 0x00, 0x11, 0x08, // SOF0, length 17, precision 8
    (height >> 8) & 0xff, height & 0xff,
    (width >> 8) & 0xff, width & 0xff,
    0x03, // 3 components
    0x01, 0x11, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01,
  ]);

  const padding = new Uint8Array(options.padding ?? 4096).fill(0x20);
  return concat([[0xff, 0xd8], app1, sof, padding, [0xff, 0xd9]]);
}

/** A PNG with a valid IHDR (dimensions, colour type, CRCs not verified by our reader). */
export function pngBytes(options: { width?: number; height?: number; padding?: number } = {}): Uint8Array {
  const width = options.width ?? 800;
  const height = options.height ?? 600;
  const ihdr = [
    (width >> 24) & 0xff, (width >> 16) & 0xff, (width >> 8) & 0xff, width & 0xff,
    (height >> 24) & 0xff, (height >> 16) & 0xff, (height >> 8) & 0xff, height & 0xff,
    0x08, 0x06, 0x00, 0x00, 0x00, // bit depth 8, RGBA
    0x00, 0x00, 0x00, 0x00, // CRC placeholder
  ];
  return concat([
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
    [0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52],
    ihdr,
    new Uint8Array(options.padding ?? 2048).fill(0x00),
  ]);
}

/** A WebP as produced by "Save for web" on Android and by Google Photos. */
export function webpBytes(options: { width?: number; height?: number } = {}): Uint8Array {
  const width = options.width ?? 1600;
  const height = options.height ?? 1200;
  const size = 30;
  const header = [
    0x52, 0x49, 0x46, 0x46, // RIFF
    (size >> 24) & 0xff, (size >> 16) & 0xff, (size >> 8) & 0xff, size & 0xff,
    0x57, 0x45, 0x42, 0x50, // WEBP
    0x56, 0x50, 0x38, 0x58, 0x0a, 0x00, 0x00, 0x00, // VP8X, length 10
    0x00, 0x00, 0x00, 0x00, // flags + reserved
    (width - 1) & 0xff, ((width - 1) >> 8) & 0xff, ((width - 1) >> 16) & 0xff,
    (height - 1) & 0xff, ((height - 1) >> 8) & 0xff, ((height - 1) >> 16) & 0xff,
  ];
  return concat([header, new Uint8Array(1024).fill(0x11)]);
}

export function gifBytes(options: { width?: number; height?: number } = {}): Uint8Array {
  const width = options.width ?? 320;
  const height = options.height ?? 240;
  return concat([
    new TextEncoder().encode("GIF89a"),
    [width & 0xff, (width >> 8) & 0xff, height & 0xff, (height >> 8) & 0xff],
    [0x00, 0x00, 0x00],
    new Uint8Array(64).fill(0x21),
    [0x3b],
  ]);
}

/** An iPhone HEIC file (ISO-BMFF with the heic brand). */
export function heicBytes(): Uint8Array {
  return concat([
    [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70], // size 24, "ftyp"
    new TextEncoder().encode("heic"),
    [0x00, 0x00, 0x00, 0x00],
    new TextEncoder().encode("mif1heic"),
    new Uint8Array(512).fill(0x00),
  ]);
}

/** A file that looks like a photo by name but is not an image at all. */
export function textBytes(text = "not an image at all"): Uint8Array {
  return new TextEncoder().encode(text);
}

export function dataUrlFor(bytes: Uint8Array, mime: string): string {
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

/** A tiny valid PNG for tests that only need "an image exists". */
export function tinyPngDataUrl(): string {
  return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
}
