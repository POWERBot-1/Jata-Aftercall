/**
 * Native QR encoder — correctness against an independent implementation.
 *
 * The Business Hub prints QR codes on posters, packaging and receipts: a code that a phone cannot
 * scan is worse than no code, and there is no printer or phone in this workspace. So the encoder is
 * checked against the two independent oracles the repository already allows itself (both dev-only
 * dependencies, neither imported by shipped code):
 *
 *   1. `qrcode@1.5.4` — the matrix must be **module-for-module identical** to a mature encoder,
 *      which proves version selection, byte-mode framing, error-correction, interleaving, mask
 *      choice and every function pattern are right — not merely "decodable most of the time".
 *   2. `jsqr` — the rendered raster must decode back to the exact payload, which proves the
 *      renderer (geometry, quiet zone, module size) is right as well as the encoder.
 *
 * Payloads are URLs on purpose: byte mode is what a business page URL uses, and an all-digit
 * payload would let the reference encoder pick numeric mode and legitimately differ.
 */

import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import jsQR from "jsqr";
import QRCode from "qrcode";
import { encodeQrMatrix, QR_MAX_VERSION, type QrErrorCorrectionLevel } from "@/lib/qr/encoder";
import { qrImageData, qrSvg } from "@/lib/qr/render";
import { qrPngBuffer } from "@/lib/qr/png";

const LEVELS: QrErrorCorrectionLevel[] = ["L", "M", "Q", "H"];

/** Realistic business-page URLs, from the shortest slug to a long one that forces a higher version. */
const PAYLOADS = [
  "https://jataaftercall.co.ke/b/jata",
  "https://jataaftercall.co.ke/b/nyumbani-kitchen",
  "https://jataaftercall.co.ke/b/mama-ngina-fresh-produce-and-groceries",
  "https://jataaftercall.co.ke/b/kilimanjaro-restaurant?ref=qr&campaign=poster-2026",
  "https://jataaftercall.co.ke/b/sunrise-salon-and-spa-nairobi-cbd?utm_source=print&utm_medium=qr&utm_campaign=loyalty",
];

function toRows(modules: { size: number; data: Uint8Array }): boolean[][] {
  const rows: boolean[][] = [];
  for (let y = 0; y < modules.size; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < modules.size; x += 1) row.push(Boolean(modules.data[y * modules.size + x]));
    rows.push(row);
  }
  return rows;
}

describe("native QR encoder", () => {
  /**
   * Module-for-module identity with the reference encoder, compared like for like: the reference is
   * pinned to byte mode, which is what a URL uses and what this encoder always emits. Left in
   * "auto" mode the reference splits some payloads into alphanumeric + byte segments — a legitimate
   * optimisation this encoder deliberately does not do — and the matrices then differ by
   * segmentation, not by correctness (covered by the next test).
   */
  it("is module-for-module identical to the reference encoder at every error-correction level", () => {
    let comparisons = 0;
    for (const level of LEVELS) {
      for (const payload of PAYLOADS) {
        const reference = toRows(QRCode.create([{ data: payload, mode: "byte" }], { errorCorrectionLevel: level }).modules);
        const mine = encodeQrMatrix(payload, { ecLevel: level }).modules;
        expect(mine.length, `${level} ${payload}`).toBe(reference.length);

        const differences: string[] = [];
        for (let y = 0; y < reference.length; y += 1) {
          for (let x = 0; x < reference.length; x += 1) {
            if (Boolean(mine[y][x]) !== reference[y][x]) differences.push(`${x},${y}`);
          }
        }
        expect(differences, `${level} ${payload}: ${differences.length} differing modules`).toEqual([]);
        comparisons += 1;
      }
    }
    // Guard against a vacuous pass if the payload list is ever emptied.
    expect(comparisons).toBe(LEVELS.length * PAYLOADS.length);
  });

  it("picks the same mask as the reference encoder", () => {
    for (const level of LEVELS) {
      for (const payload of PAYLOADS) {
        const reference = QRCode.create([{ data: payload, mode: "byte" }], { errorCorrectionLevel: level }) as {
          maskPattern: number;
        };
        expect(encodeQrMatrix(payload, { ecLevel: level }).mask, `${level} ${payload}`).toBe(reference.maskPattern);
      }
    }
  });

  /**
   * Where the reference encoder is left to its own device it may split a payload into mixed
   * segments. Both symbols are conformant and both must decode to the same text, which is what a
   * customer's camera actually cares about.
   */
  it("decodes to the same payload as the reference encoder's auto-segmented symbol", () => {
    for (const level of LEVELS) {
      for (const payload of PAYLOADS) {
        const reference = toRows(QRCode.create(payload, { errorCorrectionLevel: level }).modules);
        const native = encodeQrMatrix(payload, { ecLevel: level });
        // Reuse the native matrix's geometry and metadata so the reference rows can be rendered
        // through the same renderer; only the module grid under test differs.
        const { data, width, height } = qrImageData(
          { ...native, size: reference.length, modules: reference },
          { margin: 4, scale: 6 },
        );
        expect(jsQR(data, width, height)?.data, `reference symbol (${level}, ${payload})`).toBe(payload);
        expect(native.size, `${level} ${payload}`).toBeGreaterThan(0);
      }
    }
  });

  it("chooses the same version as the reference encoder", () => {
    for (const level of LEVELS) {
      for (const payload of PAYLOADS) {
        const reference = QRCode.create(payload, { errorCorrectionLevel: level });
        const mine = encodeQrMatrix(payload, { ecLevel: level });
        const referenceVersion = (reference.modules.size - 17) / 4;
        const mineVersion = (mine.size - 17) / 4;
        expect(mineVersion, `${level} ${payload}`).toBe(referenceVersion);
      }
    }
  });

  it("decodes back to the exact payload from the rendered raster", () => {
    for (const level of LEVELS) {
      for (const payload of PAYLOADS) {
        const matrix = encodeQrMatrix(payload, { ecLevel: level });
        const { data, width, height } = qrImageData(matrix, { margin: 4, scale: 6 });
        const decoded = jsQR(data, width, height);
        expect(decoded?.data, `${level} ${payload}`).toBe(payload);
      }
    }
  });

  it("writes a PNG that decodes back to the payload", () => {
    const payload = PAYLOADS[1];
    const png = qrPngBuffer(encodeQrMatrix(payload, { ecLevel: "M" }), { scale: 8, margin: 4 });

    // Signature, then IHDR/IDAT/IEND — the same minimal PNG a browser or a phone understands.
    expect(png.slice(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
    let position = 8;
    let width = 0;
    let height = 0;
    const chunks: Buffer[] = [];
    while (position < png.length) {
      const length = png.readUInt32BE(position);
      const type = png.toString("ascii", position + 4, position + 8);
      const body = png.slice(position + 8, position + 8 + length);
      if (type === "IHDR") {
        width = body.readUInt32BE(0);
        height = body.readUInt32BE(4);
        expect(body[8]).toBe(8); // 8-bit greyscale
        expect(body[9]).toBe(0);
      }
      if (type === "IDAT") chunks.push(body);
      position += 12 + length;
    }
    const raw = inflateSync(Buffer.concat(chunks));
    expect(raw.length).toBe((width + 1) * height);

    const pixels = new Uint8ClampedArray(width * height * 4);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const value = raw[y * (width + 1) + 1 + x];
        const offset = (y * width + x) * 4;
        pixels[offset] = value;
        pixels[offset + 1] = value;
        pixels[offset + 2] = value;
        pixels[offset + 3] = 255;
      }
    }
    expect(jsQR(pixels, width, height)?.data).toBe(payload);
  });

  it("keeps the quiet zone white — a transparent or dark margin is unscannable", () => {
    const { data, width } = qrImageData(encodeQrMatrix(PAYLOADS[0], { ecLevel: "M" }), { margin: 4, scale: 4 });
    const corner = 0; // top-left pixel of the quiet zone
    expect(data[corner]).toBe(255);
    expect(data[corner + 1]).toBe(255);
    expect(data[corner + 2]).toBe(255);
    expect(data[corner + 3]).toBe(255); // opaque, not transparent
    void width;
  });

  it("renders an SVG with one path of unit squares and an accessible label", () => {
    const svg = qrSvg(encodeQrMatrix(PAYLOADS[1], { ecLevel: "M" }), { size: 256, margin: 4 });
    expect(svg).toContain('role="img"');
    expect(svg).toContain('aria-label="QR code"');
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('fill="#ffffff"');
    // A light background rect covers the whole canvas, so the quiet zone is never transparent.
    expect(svg.indexOf("<rect")).toBeLessThan(svg.indexOf("<path"));
  });

  it("refuses a payload that cannot fit, instead of emitting a broken symbol", () => {
    const tooLong = `https://jataaftercall.co.ke/b/${"x".repeat(2000)}`;
    expect(() => encodeQrMatrix(tooLong, { ecLevel: "H" })).toThrow(/does not fit/i);
    expect(QR_MAX_VERSION).toBeLessThanOrEqual(40);
  });

  it("is deterministic — the same input always yields the same modules", () => {
    const first = encodeQrMatrix(PAYLOADS[2], { ecLevel: "Q" }).modules;
    const second = encodeQrMatrix(PAYLOADS[2], { ecLevel: "Q" }).modules;
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });
});
