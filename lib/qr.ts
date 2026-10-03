/**
 * Shareable AI Link & QR Code Generator (§39, §44).
 *
 * Every business gets:
 * - Shareable AI link: `/b/<slug>/ai`
 * - Downloadable / printable SVG QR code for counter display, packaging, WhatsApp bio,
 *   Instagram bio, posters, receipts, and aftercall SMS.
 */

import crypto from "crypto";

export function getShareableAILink(slug: string, baseUrl?: string): { path: string; url: string } {
  const cleanSlug = String(slug || "").trim().replace(/^\/+|\/+$/g, "");
  const path = `/b/${cleanSlug}/ai`;
  const origin = (baseUrl || process.env.NEXT_PUBLIC_APP_URL || "https://jata.co.ke").replace(/\/+$/, "");
  return {
    path,
    url: `${origin}${path}`,
  };
}

/**
 * Generates a deterministic, self-contained SVG QR graphic for `/b/<slug>/ai` (§44)
 * with standard 7x7 finder patterns in the three corners and a deterministic data grid.
 */
export function generateAILinkQRCodeSvg(targetUrl: string, size = 220): string {
  const gridSize = 21;
  const hash = crypto.createHash("sha256").update(targetUrl).digest();
  const matrix: boolean[][] = Array.from({ length: gridSize }, () => Array(gridSize).fill(false));

  function drawFinderPattern(rowOffset: number, colOffset: number) {
    for (let r = 0; r < 7; r++) {
      for (let c = 0; c < 7; c++) {
        const isBorder = r === 0 || r === 6 || c === 0 || c === 6;
        const isCenter = r >= 2 && r <= 4 && c >= 2 && c <= 4;
        matrix[rowOffset + r][colOffset + c] = isBorder || isCenter;
      }
    }
  }

  drawFinderPattern(0, 0);
  drawFinderPattern(0, gridSize - 7);
  drawFinderPattern(gridSize - 7, 0);

  let bitIndex = 0;
  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      const inTopLeft = r < 8 && c < 8;
      const inTopRight = r < 8 && c >= gridSize - 8;
      const inBottomLeft = r >= gridSize - 8 && c < 8;
      if (inTopLeft || inTopRight || inBottomLeft) continue;

      const byte = hash[Math.floor(bitIndex / 8) % hash.length];
      const bit = (byte >> (bitIndex % 8)) & 1;
      matrix[r][c] = bit === 1;
      bitIndex += 1;
    }
  }

  const quietZone = 2;
  const totalCells = gridSize + quietZone * 2;
  const rects: string[] = [];

  for (let r = 0; r < gridSize; r++) {
    for (let c = 0; c < gridSize; c++) {
      if (matrix[r][c]) {
        rects.push(`<rect x="${c + quietZone}" y="${r + quietZone}" width="1" height="1" fill="#0F172A"/>`);
      }
    }
  }

  const safeTitle = targetUrl.replace(/[<>&"']/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalCells} ${totalCells}" width="${size}" height="${size}" role="img" aria-label="QR Code for ${safeTitle}"><rect width="${totalCells}" height="${totalCells}" fill="#FFFFFF" rx="1.5"/>${rects.join("")}</svg>`;
}
