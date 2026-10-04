/**
 * Minimal PNG encoder (§12, §17)
 *
 * The built-in JATA provider composes designed artwork server-side and needs to return a real
 * raster image: something every browser renders on every phone, with no native dependency and
 * no remote service. PNG (deflate + per-scanline filters) is the smallest code path that gives
 * that, and `node:zlib` does the compression.
 *
 * Deliberately narrow: 8-bit truecolour output only. It is an encoder, not an image library.
 */

import { deflateSync, inflateSync } from "node:zlib";

export type RasterImage = {
  width: number;
  height: number;
  /** RGBA, row-major, 4 bytes per pixel. */
  data: Uint8Array;
};

export function createRaster(width: number, height: number): RasterImage {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return { width: w, height: h, data: new Uint8Array(w * h * 4) };
}

export function setPixel(image: RasterImage, x: number, y: number, r: number, g: number, b: number, a = 255): void {
  const px = Math.round(x);
  const py = Math.round(y);
  if (px < 0 || py < 0 || px >= image.width || py >= image.height) return;
  const index = (py * image.width + px) * 4;
  const alpha = Math.max(0, Math.min(255, a)) / 255;
  if (alpha <= 0) return;
  if (alpha >= 1) {
    image.data[index] = clamp255(r);
    image.data[index + 1] = clamp255(g);
    image.data[index + 2] = clamp255(b);
    image.data[index + 3] = 255;
    return;
  }
  image.data[index] = clamp255(image.data[index] * (1 - alpha) + r * alpha);
  image.data[index + 1] = clamp255(image.data[index + 1] * (1 - alpha) + g * alpha);
  image.data[index + 2] = clamp255(image.data[index + 2] * (1 - alpha) + b * alpha);
  image.data[index + 3] = clamp255(Math.max(image.data[index + 3], 255 * alpha));
}

export function blendPixel(image: RasterImage, x: number, y: number, r: number, g: number, b: number, alpha: number): void {
  setPixel(image, x, y, r, g, b, Math.max(0, Math.min(1, alpha)) * 255);
}

/** Fills a vertical gradient, which is the backbone of every generated backdrop. */
export function fillVerticalGradient(
  image: RasterImage,
  stops: Array<{ at: number; color: [number, number, number] }>,
): void {
  const sorted = [...stops].sort((a, b) => a.at - b.at);
  if (sorted.length === 0) return;
  for (let y = 0; y < image.height; y += 1) {
    const t = image.height <= 1 ? 0 : y / (image.height - 1);
    const color = sampleStops(sorted, t);
    for (let x = 0; x < image.width; x += 1) {
      setPixel(image, x, y, color[0], color[1], color[2], 255);
    }
  }
}

export function fillRadialGlow(
  image: RasterImage,
  centre: { x: number; y: number },
  radius: number,
  color: [number, number, number],
  strength = 0.5,
): void {
  const r = Math.max(1, radius);
  const minX = Math.max(0, Math.floor(centre.x - r));
  const maxX = Math.min(image.width - 1, Math.ceil(centre.x + r));
  const minY = Math.max(0, Math.floor(centre.y - r));
  const maxY = Math.min(image.height - 1, Math.ceil(centre.y + r));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = (x - centre.x) / r;
      const dy = (y - centre.y) / r;
      const distance = Math.sqrt(dx * dx + dy * dy);
      if (distance >= 1) continue;
      const falloff = (1 - distance) * (1 - distance);
      blendPixel(image, x, y, color[0], color[1], color[2], falloff * strength);
    }
  }
}

export function fillCircle(
  image: RasterImage,
  centre: { x: number; y: number },
  radius: number,
  color: [number, number, number],
  alpha = 1,
): void {
  const r = Math.max(1, radius);
  const minX = Math.max(0, Math.floor(centre.x - r));
  const maxX = Math.min(image.width - 1, Math.ceil(centre.x + r));
  const minY = Math.max(0, Math.floor(centre.y - r));
  const maxY = Math.min(image.height - 1, Math.ceil(centre.y + r));
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x - centre.x;
      const dy = y - centre.y;
      if (dx * dx + dy * dy <= r * r) blendPixel(image, x, y, color[0], color[1], color[2], alpha);
    }
  }
}

export function fillRoundedRect(
  image: RasterImage,
  rect: { x: number; y: number; width: number; height: number; radius: number },
  color: [number, number, number],
  alpha = 1,
): void {
  const { x, y, width, height, radius } = rect;
  const r = Math.max(0, Math.min(radius, Math.min(width, height) / 2));
  const minX = Math.max(0, Math.floor(x));
  const maxX = Math.min(image.width - 1, Math.ceil(x + width));
  const minY = Math.max(0, Math.floor(y));
  const maxY = Math.min(image.height - 1, Math.ceil(y + height));
  for (let py = minY; py <= maxY; py += 1) {
    for (let px = minX; px <= maxX; px += 1) {
      const inside = isInsideRoundedRect(px, py, x, y, width, height, r);
      if (inside) blendPixel(image, px, py, color[0], color[1], color[2], alpha);
    }
  }
}

function isInsideRoundedRect(px: number, py: number, x: number, y: number, width: number, height: number, radius: number): boolean {
  if (px < x || py < y || px > x + width || py > y + height) return false;
  if (radius <= 0) return true;
  const corners: Array<[number, number]> = [
    [x + radius, y + radius],
    [x + width - radius, y + radius],
    [x + radius, y + height - radius],
    [x + width - radius, y + height - radius],
  ];
  const nearLeft = px < x + radius;
  const nearRight = px > x + width - radius;
  const nearTop = py < y + radius;
  const nearBottom = py > y + height - radius;
  if ((nearLeft || nearRight) && (nearTop || nearBottom)) {
    const corner = corners[nearTop ? (nearLeft ? 0 : 1) : nearLeft ? 2 : 3];
    const dx = px - corner[0];
    const dy = py - corner[1];
    return dx * dx + dy * dy <= radius * radius;
  }
  return true;
}

function sampleStops(stops: Array<{ at: number; color: [number, number, number] }>, t: number): [number, number, number] {
  if (t <= stops[0].at) return stops[0].color;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const current = stops[i];
    const next = stops[i + 1];
    if (t >= current.at && t <= next.at) {
      const span = next.at - current.at || 1;
      const local = (t - current.at) / span;
      return [
        Math.round(current.color[0] + (next.color[0] - current.color[0]) * local),
        Math.round(current.color[1] + (next.color[1] - current.color[1]) * local),
        Math.round(current.color[2] + (next.color[2] - current.color[2]) * local),
      ];
    }
  }
  return stops[stops.length - 1].color;
}

function clamp255(value: number): number {
  const n = Math.round(value);
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 255 ? 255 : n;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const typeBuffer = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, payload])), 0);
  return Buffer.concat([length, typeBuffer, payload, crc]);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i += 1) {
    crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Encodes an RGBA raster (or an opaque RGB raster) as a PNG buffer. */
export function encodePng(image: RasterImage, options: { compressionLevel?: number } = {}): Buffer {
  const { width, height, data } = image;
  const stride = width * 4;
  // Filter type 1 (Sub) predicts from the pixel to the left; for the smooth gradients and flat
  // shapes this generator produces it compresses noticeably better than no filter.
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 1;
    const sourceStart = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const left = x >= 4 ? data[sourceStart + x - 4] : 0;
      raw[rowStart + 1 + x] = (data[sourceStart + x] - left) & 0xff;
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: options.compressionLevel ?? 6 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** Decodes a PNG this module produced (used to verify output and to re-open stored artwork). */
export function decodePng(buffer: Buffer): RasterImage | null {
  if (buffer.length < 8 || !buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  let offset = 8;
  let width = 0;
  let height = 0;
  let colourType = 6;
  const idat: Buffer[] = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString("ascii");
    const payload = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IHDR") {
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
      colourType = payload[9];
    } else if (type === "IDAT") {
      idat.push(Buffer.from(payload));
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + length;
  }
  if (!width || !height || colourType !== 6) return null;

  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * 4;
  const image = createRaster(width, height);
  const previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const row = Buffer.from(raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride));
    unfilterRow(row, previous, filter);
    row.copy(image.data, y * stride);
    row.copy(previous);
  }
  return image;
}

function unfilterRow(row: Buffer, previous: Buffer, filter: number): void {
  switch (filter) {
    case 0:
      return;
    case 1:
      for (let i = 4; i < row.length; i += 1) row[i] = (row[i] + row[i - 4]) & 0xff;
      return;
    case 2:
      for (let i = 0; i < row.length; i += 1) row[i] = (row[i] + previous[i]) & 0xff;
      return;
    case 3:
      for (let i = 0; i < row.length; i += 1) {
        const left = i >= 4 ? row[i - 4] : 0;
        row[i] = (row[i] + ((left + previous[i]) >> 1)) & 0xff;
      }
      return;
    case 4:
      for (let i = 0; i < row.length; i += 1) {
        const left = i >= 4 ? row[i - 4] : 0;
        const up = previous[i];
        const upLeft = i >= 4 ? previous[i - 4] : 0;
        row[i] = (row[i] + paeth(left, up, upLeft)) & 0xff;
      }
      return;
    default:
      return;
  }
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function toDataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString("base64")}`;
}
