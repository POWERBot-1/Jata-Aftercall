/**
 * Deterministic PWA icon generator — no image dependency, no network, no AI-generated artwork.
 *
 * Draws the JATA AFTERCALL mark (espresso field, amber "J", cream dot) at the four sizes the
 * manifest / Apple touch icon reference. The artwork stays inside the central 80% safe zone so
 * the same file works as a maskable Android icon. Run: `node scripts/generate-pwa-icons.mjs`.
 */
import { deflateSync } from "node:zlib";
import { writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const OUT = path.join(process.cwd(), "public", "icons");
mkdirSync(OUT, { recursive: true });

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function png(size, paint) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  const pixels = (x, y, color) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const offset = y * (size * 4 + 1) + 1 + x * 4;
    raw[offset] = color[0];
    raw[offset + 1] = color[1];
    raw[offset + 2] = color[2];
    raw[offset + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, color) => {
    for (let y = Math.round(y0); y < Math.round(y1); y += 1) {
      for (let x = Math.round(x0); x < Math.round(x1); x += 1) pixels(x, y, color);
    }
  };
  paint(size, rect, pixels);
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const ESPRESSO = [20, 17, 15];
const AMBER = [240, 160, 60];
const CREAM = [247, 242, 232];

function mark(size, rect, pixels) {
  rect(0, 0, size, size, ESPRESSO);
  const s = size / 512;
  // A cream keyline inside the maskable safe area.
  const line = Math.max(2, Math.round(6 * s));
  rect(56 * s, 56 * s, 456 * s, 62 * s, CREAM);
  rect(56 * s, 450 * s, 456 * s, 456 * s, CREAM);
  rect(56 * s, 56 * s, 62 * s, 456 * s, CREAM);
  rect(450 * s, 56 * s, 456 * s, 456 * s, CREAM);
  // Bold "J": stem, top serif and foot.
  rect(292 * s, 112 * s, 366 * s, 344 * s, AMBER);
  rect(184 * s, 112 * s, 366 * s, 156 * s, AMBER);
  rect(148 * s, 300 * s, 366 * s, 344 * s, AMBER);
  rect(148 * s, 300 * s, 196 * s, 396 * s, AMBER);
  rect(148 * s, 352 * s, 300 * s, 396 * s, AMBER);
  // Small amber dot (the "after" in AFTERCALL).
  const cx = 382 * s, cy = 210 * s, r = 20 * s;
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y += 1) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x += 1) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) pixels(x, y, CREAM);
    }
  }
}

for (const [name, size] of [["icon-192.png", 192], ["icon-512.png", 512], ["apple-touch-icon.png", 180], ["icon-64.png", 64]]) {
  writeFileSync(path.join(OUT, name), png(size, mark));
  console.log(`wrote public/icons/${name} (${size}x${size})`);
}

// ICO container with the 64x64 PNG payload (browsers request /favicon.ico by default).
{
  const pngData = png(64, mark);
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = 64; entry[1] = 64; entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngData.length, 8); entry.writeUInt32LE(22, 12);
  writeFileSync(path.join(process.cwd(), "public", "favicon.ico"), Buffer.concat([header, entry, pngData]));
  console.log("wrote public/favicon.ico");
}
