/**
 * QR PNG encoding — server only.
 *
 * This module is deliberately separate from `render.ts`. It imports `node:zlib`, and anything a
 * client component imports ends up in the browser bundle: keeping the PNG writer here means the
 * public Business Page (a client component that inlines the QR artwork) never pulls node built-ins
 * into the bundle, while the download route on the server still gets a real PNG.
 */

import { deflateSync } from "node:zlib";
import type { QrMatrix } from "./encoder";

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buffer.length; i += 1) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, body: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  const typeAndBody = Buffer.concat([Buffer.from(type, "ascii"), body]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(typeAndBody), 0);
  return Buffer.concat([length, typeAndBody, crc]);
}

/**
 * Encodes the symbol as an 8-bit greyscale PNG. Print-ready at `scale` pixels per module:
 * the default (12 px/module, 4-module quiet zone) puts a version-3 code at ~444 px, well above
 * the ~2 px/module a phone camera needs at arm's length on an A4 poster.
 */
export function qrPngBuffer(matrix: QrMatrix, options: { margin?: number; scale?: number; invert?: boolean } = {}): Buffer {
  const margin = Math.max(0, Math.floor(options.margin ?? 4));
  const scale = Math.max(1, Math.floor(options.scale ?? 12));
  const width = (matrix.size + margin * 2) * scale;
  const height = width;

  const raw = Buffer.alloc((width + 1) * height); // one filter byte per scanline
  // Light background: the quiet zone must be white, not the zero value Buffer.alloc writes.
  raw.fill(options.invert ? 0 : 255);
  let offset = 0;
  for (let y = 0; y < height; y += 1) {
    raw[offset] = 0; // filter type 0 (None)
    offset += 1;
    const moduleRow = Math.floor(y / scale) - margin;
    for (let x = 0; x < width; x += 1) {
      const moduleCol = Math.floor(x / scale) - margin;
      const inside = moduleRow >= 0 && moduleRow < matrix.size && moduleCol >= 0 && moduleCol < matrix.size;
      const dark = inside ? matrix.modules[moduleRow][moduleCol] : false;
      const light = options.invert ? 0 : 255;
      const darkValue = options.invert ? 255 : 0;
      const value = dark ? darkValue : light;
      raw[offset] = value;
      offset += 1;
    }
  }

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
