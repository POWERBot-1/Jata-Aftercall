/**
 * Built-in JATA provider (§12, §15, §17, §42)
 *
 * What it is: a deterministic image *designer*. It composes branded artwork from the business's
 * own palette, category and photography style — a studio backdrop, a category motif, a soft
 * light pool and, where it helps, the business initials rendered with a small built-in bitmap
 * font. It always returns a real PNG.
 *
 * What it is not: a photographer. It never invents a picture of a specific product, so every
 * image it produces is marked `representative: true` and the Studio labels it as JATA artwork
 * rather than a photo of the owner's dish, dress or machine (§15).
 *
 * Because it needs no network and no key, "Create with JATA" works the moment a business is
 * created — and when an image provider *is* configured, this provider steps back and the
 * vendor adapter takes over.
 */

import { resolvePhotographyStyle } from "../designContext";
import { createRaster, encodePng, fillCircle, fillRadialGlow, fillRoundedRect, fillVerticalGradient, setPixel, toDataUrl, type RasterImage } from "../png";
import { ProviderError, type AiProvider, type EnhanceRequest, type GeneratedImage, type ImageRequest, type ProviderCapabilities, type ProviderContext, type TextRequest, type TextResult } from "../provider";

const CAPABILITIES: ProviderCapabilities = {
  imageGeneration: true,
  imageEditing: false,
  textGeneration: true,
  photorealistic: false,
  configured: true,
};

function hexToRgb(hex: string): [number, number, number] {
  const value = /^#?[0-9a-fA-F]{6}$/.test(hex) ? hex.replace("#", "") : "333333";
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

function mix(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  const ratio = Math.max(0, Math.min(1, t));
  return [
    Math.round(a[0] + (b[0] - a[0]) * ratio),
    Math.round(a[1] + (b[1] - a[1]) * ratio),
    Math.round(a[2] + (b[2] - a[2]) * ratio),
  ];
}

function lighten(color: [number, number, number], amount: number): [number, number, number] {
  return mix(color, [255, 255, 255], amount);
}

function darken(color: [number, number, number], amount: number): [number, number, number] {
  return mix(color, [16, 16, 20], amount);
}

/** Deterministic PRNG: the same business, subject and preset always produce the same artwork. */
function makeRandom(seed: string): () => number {
  let state = 0;
  for (let i = 0; i < seed.length; i += 1) {
    state = (state * 31 + seed.charCodeAt(i)) >>> 0;
  }
  if (state === 0) state = 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

// ── A 5×7 bitmap font for initials and short words ─────────────────────────────────────────
// Enough to render a monogram or a three-word mark legibly at large sizes, with no font
// dependency and no network request.
const GLYPHS: Record<string, string[]> = {
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "11110", "10001", "10001", "10001", "11110"],
  C: ["01110", "10001", "10000", "10000", "10000", "10001", "01110"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "11110", "10000", "10000", "10000", "11111"],
  F: ["11111", "10000", "11110", "10000", "10000", "10000", "10000"],
  G: ["01110", "10001", "10000", "10111", "10001", "10001", "01111"],
  H: ["10001", "10001", "11111", "10001", "10001", "10001", "10001"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  K: ["10001", "10010", "10100", "11000", "10100", "10010", "10001"],
  L: ["10000", "10000", "10000", "10000", "10000", "10000", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
  N: ["10001", "11001", "10101", "10011", "10001", "10001", "10001"],
  O: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  P: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  Q: ["01110", "10001", "10001", "10001", "10101", "10011", "01111"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  S: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  T: ["11111", "00100", "00100", "00100", "00100", "00100", "00100"],
  U: ["10001", "10001", "10001", "10001", "10001", "10001", "01110"],
  V: ["10001", "10001", "10001", "10001", "10001", "01010", "00100"],
  W: ["10001", "10001", "10001", "10101", "10101", "11011", "10001"],
  X: ["10001", "10001", "01010", "00100", "01010", "10001", "10001"],
  Y: ["10001", "10001", "01010", "00100", "00100", "00100", "00100"],
  Z: ["11111", "00001", "00010", "00100", "01000", "10000", "11111"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00110", "01000", "10000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "11110", "00001", "00001", "10001", "01110"],
  "6": ["00110", "01000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00010", "01100"],
  "&": ["01100", "10010", "10100", "01000", "10101", "10010", "01101"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000"],
};

function drawText(
  image: RasterImage,
  text: string,
  options: { x: number; y: number; scale: number; color: [number, number, number]; alpha?: number; letterSpacing?: number; align?: "left" | "center" },
): void {
  const spacing = options.letterSpacing ?? 1;
  const chars = text.toUpperCase().slice(0, 24).split("");
  const glyphWidth = (5 + spacing) * options.scale;
  const totalWidth = chars.length * glyphWidth - spacing * options.scale;
  const startX = options.align === "center" ? options.x - totalWidth / 2 : options.x;
  chars.forEach((char, charIndex) => {
    const glyph = GLYPHS[char] || GLYPHS[" "];
    glyph.forEach((row, rowIndex) => {
      row.split("").forEach((cell, colIndex) => {
        if (cell !== "1") return;
        const px = startX + charIndex * glyphWidth + colIndex * options.scale;
        const py = options.y + rowIndex * options.scale;
        for (let dy = 0; dy < options.scale; dy += 1) {
          for (let dx = 0; dx < options.scale; dx += 1) {
            setPixel(image, px + dx, py + dy, options.color[0], options.color[1], options.color[2], options.alpha === undefined ? 255 : options.alpha * 255);
          }
        }
      });
    });
  });
}

function initialsOf(name: string): string {
  const words = String(name || "")
    .split(/[\s\-_&.]+/)
    .filter(Boolean);
  if (words.length === 0) return "JATA";
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

/** The scene motifs: abstract, category-aware, never a fake photograph of a specific product. */
function drawMotif(image: RasterImage, categoryKey: string, random: () => number, palette: { primary: [number, number, number]; accent: [number, number, number] }): void {
  const cx = image.width / 2;
  const cy = image.height / 2;
  const unit = Math.min(image.width, image.height);
  const soft = lighten(palette.primary, 0.55);
  const deep = darken(palette.primary, 0.25);

  switch (categoryKey) {
    case "food": {
      // A plate, a garnish ring and a warm glow: hospitality without pretending to be a dish.
      fillCircle(image, { x: cx, y: cy + unit * 0.02 }, unit * 0.3, deep, 0.35);
      fillCircle(image, { x: cx, y: cy }, unit * 0.29, soft, 0.9);
      fillCircle(image, { x: cx, y: cy }, unit * 0.2, lighten(palette.accent, 0.6), 0.75);
      fillCircle(image, { x: cx - unit * 0.08, y: cy - unit * 0.05 }, unit * 0.05, palette.primary, 0.55);
      fillCircle(image, { x: cx + unit * 0.07, y: cy + unit * 0.04 }, unit * 0.035, deep, 0.45);
      break;
    }
    case "beauty":
    case "salon": {
      fillCircle(image, { x: cx, y: cy }, unit * 0.26, soft, 0.85);
      for (let i = 0; i < 7; i += 1) {
        const angle = (i / 7) * Math.PI * 2;
        fillCircle(
          image,
          { x: cx + Math.cos(angle) * unit * 0.17, y: cy + Math.sin(angle) * unit * 0.17 },
          unit * 0.035,
          lighten(palette.accent, 0.35),
          0.8,
        );
      }
      break;
    }
    case "fashion": {
      fillRoundedRect(image, { x: cx - unit * 0.18, y: cy - unit * 0.24, width: unit * 0.36, height: unit * 0.48, radius: unit * 0.12 }, soft, 0.9);
      fillRoundedRect(image, { x: cx - unit * 0.05, y: cy - unit * 0.3, width: unit * 0.1, height: unit * 0.12, radius: unit * 0.03 }, deep, 0.6);
      break;
    }
    case "realestate":
    case "hospitality": {
      fillRoundedRect(image, { x: cx - unit * 0.26, y: cy - unit * 0.02, width: unit * 0.52, height: unit * 0.3, radius: unit * 0.03 }, soft, 0.9);
      const roof = Array.from({ length: Math.round(unit * 0.24) }, (_, row) => row);
      roof.forEach((row) => {
        const halfWidth = (unit * 0.3 * (row / roof.length)) / 1;
        for (let x = -halfWidth; x <= halfWidth; x += 1) {
          setPixel(image, cx + x, cy - unit * 0.02 - (roof.length - row), lighten(palette.accent, 0.25)[0], lighten(palette.accent, 0.25)[1], lighten(palette.accent, 0.25)[2], 235);
        }
      });
      fillRoundedRect(image, { x: cx - unit * 0.05, y: cy + unit * 0.13, width: unit * 0.1, height: unit * 0.15, radius: unit * 0.02 }, deep, 0.75);
      break;
    }
    case "technical":
    case "automotive": {
      // Interlocking hexagons: tools, parts, dependable service.
      for (let row = 0; row < 3; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          const radius = unit * 0.08;
          const offsetX = cx + (col - 1) * radius * 1.75 + (row % 2 === 1 ? radius * 0.9 : 0);
          const offsetY = cy + (row - 1) * radius * 1.6;
          fillCircle(image, { x: offsetX, y: offsetY }, radius, row % 2 === 1 ? soft : lighten(palette.accent, 0.3), 0.75);
        }
      }
      break;
    }
    case "electronics": {
      fillRoundedRect(image, { x: cx - unit * 0.24, y: cy - unit * 0.16, width: unit * 0.48, height: unit * 0.32, radius: unit * 0.04 }, soft, 0.9);
      fillRoundedRect(image, { x: cx - unit * 0.2, y: cy - unit * 0.12, width: unit * 0.4, height: unit * 0.24, radius: unit * 0.02 }, deep, 0.8);
      break;
    }
    case "furniture": {
      fillRoundedRect(image, { x: cx - unit * 0.28, y: cy - unit * 0.1, width: unit * 0.56, height: unit * 0.12, radius: unit * 0.03 }, soft, 0.9);
      fillRoundedRect(image, { x: cx - unit * 0.24, y: cy + unit * 0.02, width: unit * 0.06, height: unit * 0.16, radius: unit * 0.02 }, deep, 0.85);
      fillRoundedRect(image, { x: cx + unit * 0.18, y: cy + unit * 0.02, width: unit * 0.06, height: unit * 0.16, radius: unit * 0.02 }, deep, 0.85);
      break;
    }
    default: {
      // A calm composition of brand shapes — usable behind any headline, claiming nothing.
      for (let i = 0; i < 5; i += 1) {
        const radius = unit * (0.08 + random() * 0.14);
        const x = cx + (random() - 0.5) * unit * 0.5;
        const y = cy + (random() - 0.5) * unit * 0.4;
        fillCircle(image, { x, y }, radius, i % 2 === 0 ? soft : lighten(palette.accent, 0.4), 0.55);
      }
      break;
    }
  }
}

function compose(request: ImageRequest, variantSeed: string): GeneratedImage {
  const width = Math.max(320, Math.min(2048, Math.round(request.width)));
  const height = Math.max(320, Math.min(2048, Math.round(request.height)));
  const design = request.design;
  const primary = hexToRgb(design.palette.primary);
  const accent = hexToRgb(design.palette.accent);
  const background = hexToRgb(design.palette.background);
  const style = resolvePhotographyStyle(design.photography.key);
  const random = makeRandom(`${design.styleSeed}|${request.placement}|${variantSeed}`);
  const image = createRaster(width, height);

  // Backdrop: a soft vertical wash built from the site's own palette, with the light direction
  // taken from the chosen photographic style so every image on the site agrees.
  const top = lighten(mix(background, primary, 0.16), 0.18);
  const bottom = darken(mix(background, accent, 0.18), 0.12);
  fillVerticalGradient(image, [
    { at: 0, color: top },
    { at: 0.55, color: mix(top, bottom, 0.55) },
    { at: 1, color: bottom },
  ]);

  const lightFromLeft = !/right/i.test(style.lighting);
  const glowCentre = {
    x: width * (lightFromLeft ? 0.32 : 0.68),
    y: height * 0.3,
  };
  fillRadialGlow(image, glowCentre, Math.max(width, height) * 0.55, lighten(primary, 0.75), 0.35);
  fillRadialGlow(image, { x: width * 0.5, y: height * 0.78 }, Math.min(width, height) * 0.6, [0, 0, 0], 0.18);

  drawMotif(image, design.categoryKey, random, { primary, accent });

  // Contact shadow, so objects sit on the surface rather than float.
  fillRadialGlow(image, { x: width * 0.5, y: height * 0.66 }, Math.min(width, height) * 0.36, [0, 0, 0], 0.22);

  // Monogram: the owner's own initials, never invented words.
  if (request.placement !== "background") {
    const initials = initialsOf(design.businessName);
    const scale = Math.max(2, Math.round(Math.min(width, height) / 90));
    drawText(image, initials, {
      x: width * 0.5,
      y: height * 0.82,
      scale,
      color: lighten(design.palette.text ? hexToRgb(design.palette.text) : [30, 30, 30], 0.85),
      alpha: 0.55,
      align: "center",
    });
  }

  const png = encodePng(image, { compressionLevel: 7 });
  return {
    dataUrl: toDataUrl(png),
    mime: "image/png",
    width,
    height,
    representative: true,
  };
}

function composeText(request: TextRequest): TextResult {
  // The built-in copywriter is the deterministic composer used by the field assistant: facts in,
  // wording out, nothing invented (§55).
  const facts = request.facts.filter(Boolean);
  const subject = facts[0] || "this";
  const detail = facts.slice(1).join(", ");
  const texts = [
    detail ? `${subject} — ${detail}.` : `${subject}.`,
    `${subject}. Ask us for more details or place your order directly on this website.`,
  ];
  return { texts: texts.slice(0, Math.max(1, request.count)), deterministic: true };
}

export const localProvider: AiProvider = {
  key: "jata-local",
  label: "JATA built-in",
  modelKey: "jata-artwork-v1",
  capabilities: CAPABILITIES,
  async generateImage(request, context) {
    const count = Math.max(1, Math.min(4, request.count));
    const images: GeneratedImage[] = [];
    for (let index = 0; index < count; index += 1) {
      images.push(compose(request, `${context.generationId}-${index}`));
    }
    return images;
  },
  async enhanceImage(): Promise<GeneratedImage[]> {
    // The built-in provider does not pretend to edit photographs. On-device enhancement handles
    // that case and is always available (§14).
    throw new ProviderError("not_configured", "The built-in provider cannot edit photos", { retryable: false });
  },
  async generateText(request) {
    return composeText(request);
  },
};
