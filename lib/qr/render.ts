/**
 * QR rendering: crisp SVG for print and screen, and a real PNG for download.
 *
 * The SVG path is emitted in module units (one `<path>` of unit squares) so a poster, a receipt
 * and a phone screen all render the same symbol from the same bytes — no raster blur at any size,
 * and no canvas or image library anywhere in the stack.
 *
 * The PNG writer lives in `png.ts`, which is server-only (`node:zlib`). Everything in THIS file
 * is browser-safe, because the public Business Page is a client component and inlines the artwork
 * directly: splitting the two is what keeps node built-ins out of the browser bundle.
 */

import type { QrMatrix } from "./encoder";

export type QrRenderOptions = {
  /** Quiet zone in modules. The specification requires 4; print layouts must not go below it. */
  margin?: number;
  dark?: string;
  light?: string;
  /** Rendered size in CSS pixels (SVG) or output pixels (PNG). */
  size?: number;
};

function withDefaults(options: QrRenderOptions = {}) {
  const margin = Math.max(0, Math.floor(options.margin ?? 4));
  return {
    margin,
    dark: options.dark ?? "#111827",
    light: options.light ?? "#ffffff",
    size: Math.max(64, Math.floor(options.size ?? 512)),
  };
}

/** Escapes text that goes into SVG markup (business names are owner-controlled). */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * A standalone, self-contained SVG of the symbol. `title` becomes the accessible name and is
 * also printed under the code in the poster layout (`qrPosterSvg`).
 */
export function qrSvg(matrix: QrMatrix, options: QrRenderOptions = {}): string {
  const { margin, dark, light, size } = withDefaults(options);
  const extent = matrix.size + margin * 2;
  const path: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      if (!matrix.modules[row][col]) continue;
      const x = col + margin;
      const y = row + margin;
      path.push(`M${x} ${y}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${extent} ${extent}" shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${extent}" height="${extent}" fill="${light}"/><path d="${path.join("")}" fill="${dark}"/></svg>`;
}

/** Raw RGBA pixels (greyscale) — used by the automated scannability tests and by nothing else. */
export function qrImageData(
  matrix: QrMatrix,
  options: { margin?: number; scale?: number } = {},
): { data: Uint8ClampedArray; width: number; height: number } {
  const margin = Math.max(0, Math.floor(options.margin ?? 4));
  const scale = Math.max(1, Math.floor(options.scale ?? 4));
  const extent = (matrix.size + margin * 2) * scale;
  const data = new Uint8ClampedArray(extent * extent * 4);
  // White, opaque background. A zero-filled buffer is *black and transparent*: the quiet zone
  // would read as dark modules and no scanner could find the symbol.
  data.fill(255);
  for (let row = 0; row < matrix.size; row += 1) {
    for (let col = 0; col < matrix.size; col += 1) {
      const dark = matrix.modules[row][col];
      const value = dark ? 0 : 255;
      const originX = (col + margin) * scale;
      const originY = (row + margin) * scale;
      for (let dy = 0; dy < scale; dy += 1) {
        for (let dx = 0; dx < scale; dx += 1) {
          const offset = ((originY + dy) * extent + (originX + dx)) * 4;
          data[offset] = value;
          data[offset + 1] = value;
          data[offset + 2] = value;
          data[offset + 3] = 255;
        }
      }
    }
  }
  return { data, width: extent, height: extent };
}

/**
 * The printable identity poster: QR + business name + a short instruction line, laid out for
 * A4 at 300 dpi (2480 × 3508) but authored in a 620 × 877 viewBox so it scales to any paper.
 * Only public information goes in here — the page URL, the business name — never a dashboard
 * link, an internal id, or any customer detail.
 */
export function qrPosterSvg(
  matrix: QrMatrix,
  options: { businessName: string; url: string; caption?: string; size?: number; width?: number; height?: number },
): string {
  const width = options.width ?? 620;
  const height = options.height ?? 877;
  const qrSize = Math.round(width * 0.62);
  const qrX = Math.round((width - qrSize) / 2);
  const qrY = Math.round(height * 0.2);
  const name = escapeXml(String(options.businessName || "").slice(0, 60));
  const url = escapeXml(String(options.url || "").slice(0, 120));
  const caption = escapeXml(
    (options.caption || "Scan to open this business page").slice(0, 90),
  );

  const symbol = qrSvg(matrix, { size: qrSize, margin: 4, dark: "#111827", light: "#ffffff" })
    .replace(/^<svg[^>]*>/, "")
    .replace(/<\/svg>$/, "");

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="QR code for ${name}">
  <rect width="${width}" height="${height}" fill="#ffffff"/>
  <text x="${width / 2}" y="${Math.round(height * 0.09)}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="30" font-weight="700" fill="#111827">${name}</text>
  <g transform="translate(${qrX} ${qrY})">${symbol}</g>
  <text x="${width / 2}" y="${qrY + qrSize + 46}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="24" font-weight="600" fill="#111827">${caption}</text>
  <text x="${width / 2}" y="${qrY + qrSize + 82}" text-anchor="middle" font-family="Inter, system-ui, sans-serif" font-size="15" fill="#52525b">${url}</text>
</svg>`;
}
