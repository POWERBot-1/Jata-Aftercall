/** Local preparation only. No storage, provider, network or original-persistence authority. */
import { MAX_SOURCE_BYTES, readExifOrientation, validateImageBytes, type ImageFacts, type UploadIssue } from "./imageFormat";

export const MAX_SOURCE_PIXELS = 32_000_000;
export const MAX_SOURCE_EDGE = 16_384;
export const MAX_DERIVATIVE_EDGE = 4096;
const extensions: Record<string, string[]> = { jpeg: ["jpg", "jpeg", "jpe"], png: ["png"], webp: ["webp"], gif: ["gif"] };
const issue = (code: UploadIssue["code"], message: string): { status: "error"; issue: UploadIssue } => ({ status: "error", issue: { code, message, recoverable: true } });
const u32 = (b: Uint8Array, o: number, little = false) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(o, little);

/** Reject hostile dimensions/container boundaries before a browser decoder allocates pixels. Decode still verifies actual pixels. */
export function inspectLocalSource(bytes: Uint8Array, file: { name?: string; type?: string }) : { status: "ok"; facts: ImageFacts } | { status: "error"; issue: UploadIssue } {
  const verdict = validateImageBytes(bytes, { declaredMime: file.type, filename: file.name, maxBytes: MAX_SOURCE_BYTES });
  if (verdict.status !== "ok") return verdict;
  const { width, height, format } = verdict.facts;
  if (!width || !height || width > MAX_SOURCE_EDGE || height > MAX_SOURCE_EDGE || width * height > MAX_SOURCE_PIXELS) {
    return issue("too_large", "This photo has too many pixels to prepare safely on a phone. Export a smaller JPG, PNG or WebP first.");
  }
  const ext = /\.([^.]+)$/.exec(file.name || "")?.[1]?.toLowerCase();
  if (ext && !extensions[format]?.includes(ext)) return issue("wrong_extension", `This filename does not match its ${format.toUpperCase()} photo bytes. Rename or re-export the photo and retry.`);
  if (file.type && !/^(image\/(jpeg|jpg|pjpeg|png|webp|gif)|application\/octet-stream|binary\/octet-stream)$/i.test(file.type)) return issue("wrong_extension", "The declared file type does not match a supported photo. Re-export it as JPG, PNG or WebP.");
  if (format === "jpeg" && (bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9)) return issue("corrupt", "This JPG photo is incomplete. Choose the original file again.");
  if (format === "gif" && bytes[bytes.length - 1] !== 0x3b) return issue("corrupt", "This GIF photo is incomplete. Choose the original file again.");
  if (format === "png") {
    let offset = 8, ended = false, chunks = 0;
    while (offset + 12 <= bytes.length && ++chunks <= 4096) {
      const size = u32(bytes, offset), type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
      if (size > bytes.length - offset - 12 || (offset === 8 && (type !== "IHDR" || size !== 13))) break;
      offset += size + 12;
      if (type === "IEND") { ended = size === 0 && offset === bytes.length; break; }
    }
    if (!ended) return issue("corrupt", "This PNG photo has damaged or incomplete chunks. Choose the original file again.");
  }
  if (format === "webp") {
    if (bytes.length < 20 || u32(bytes, 4, true) + 8 !== bytes.length) return issue("corrupt", "This WebP photo is incomplete. Choose the original file again.");
    let offset = 12, chunks = 0;
    while (offset + 8 <= bytes.length && ++chunks <= 4096) {
      const size = u32(bytes, offset + 4, true);
      if (size > bytes.length - offset - 8) break;
      offset += 8 + size + (size % 2);
    }
    if (offset !== bytes.length) return issue("corrupt", "This WebP photo has damaged chunks. Choose the original file again.");
  }
  return verdict;
}

/** Remove EXIF only from a temporary JPEG decode copy, never from the caller's original bytes/File.
 * This avoids orientation-by-aspect-ratio guessing and browser-specific automatic double rotation.
 * Colour profiles/non-EXIF segments and scan pixels are preserved. Invalid markers refuse preparation.
 */
export function jpegDecodeCopy(bytes: Uint8Array): { bytes: Uint8Array; orientation: number } {
  const orientation = readExifOrientation(bytes) || 1;
  const parts: Uint8Array[] = [bytes.subarray(0, 2)];
  let offset = 2, size = 2, count = 0;
  while (offset < bytes.length && ++count <= 4096) {
    const start = offset;
    if (bytes[offset++] !== 0xff) throw new Error("corrupt_jpeg_marker");
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) { const rest = bytes.subarray(start); parts.push(rest); size += rest.length; offset = bytes.length; break; }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { const part = bytes.subarray(start, offset); parts.push(part); size += part.length; continue; }
    if (offset + 2 > bytes.length) throw new Error("corrupt_jpeg_length");
    const length = (bytes[offset] << 8) | bytes[offset + 1];
    if (length < 2 || length > bytes.length - offset) throw new Error("corrupt_jpeg_length");
    const exif = marker === 0xe1 && String.fromCharCode(...bytes.subarray(offset + 2, offset + 8)) === "Exif\u0000\u0000";
    offset += length;
    if (!exif) { const part = bytes.subarray(start, offset); parts.push(part); size += part.length; }
  }
  if (offset !== bytes.length) throw new Error("jpeg_marker_budget");
  const copy = new Uint8Array(size); let target = 0;
  for (const part of parts) { copy.set(part, target); target += part.length; }
  return { bytes: copy, orientation };
}

/** Canvas matrix maps un-oriented pixels to the exact EXIF1–8 result, including mirrored cases. */
export function orientationMatrix(value: number, width: number, height: number): [number, number, number, number, number, number] {
  const matrices: Record<number, [number, number, number, number, number, number]> = {
    1: [1, 0, 0, 1, 0, 0], 2: [-1, 0, 0, 1, width, 0], 3: [-1, 0, 0, -1, width, height], 4: [1, 0, 0, -1, 0, height],
    5: [0, 1, 1, 0, 0, 0], 6: [0, 1, -1, 0, height, 0], 7: [0, -1, -1, 0, height, width], 8: [0, -1, 1, 0, 0, width],
  };
  return matrices[value] || matrices[1];
}
