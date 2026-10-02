/**
 * Colour utilities (§22, §48) — WCAG contrast maths for the theme engine.
 *
 * Business owners choose their own brand colours. A brand colour that would make text
 * unreadable is not simply accepted: the engine measures it and, where necessary,
 * preserves an accessible pairing instead of shipping low-contrast UI.
 */

export type Rgb = { r: number; g: number; b: number };

const HEX_PATTERN = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

export function parseHex(hex: string): Rgb | null {
  const match = HEX_PATTERN.exec((hex || "").trim());
  if (!match) return null;
  let value = match[1];
  if (value.length === 3) value = value.split("").map((c) => c + c).join("");
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

export function isHexColor(value: unknown): boolean {
  return typeof value === "string" && HEX_PATTERN.test(value.trim());
}

function channelLuminance(channel: number): number {
  const c = channel / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number | null {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  return 0.2126 * channelLuminance(rgb.r) + 0.7152 * channelLuminance(rgb.g) + 0.0722 * channelLuminance(rgb.b);
}

/** WCAG 2.1 contrast ratio, 1 → 21. Returns null for unparseable input. */
export function contrastRatio(a: string, b: string): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export const WCAG_AA_NORMAL = 4.5;
export const WCAG_AA_LARGE = 3;

export function meetsAA(foreground: string, background: string, large = false): boolean {
  const ratio = contrastRatio(foreground, background);
  return ratio !== null && ratio >= (large ? WCAG_AA_LARGE : WCAG_AA_NORMAL);
}

function toHex({ r, g, b }: Rgb): string {
  const hex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${hex(r)}${hex(g)}${hex(b)}`.toUpperCase();
}

function mix(a: Rgb, b: Rgb, amount: number): Rgb {
  return {
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  };
}

/**
 * Readable text colour for a background: black or white, whichever contrasts more.
 * Used whenever a brand colour is applied underneath text.
 */
export function readableTextOn(background: string): string {
  const rgb = parseHex(background);
  if (!rgb) return "#111111";
  return relativeLuminance(toHex(rgb))! > 0.45 ? "#121212" : "#FFFFFF";
}

/**
 * Nudge a colour toward an accessible pairing.
 *
 * If `foreground` already meets AA on `background` it is returned unchanged, so a business
 * owner's brand colour is never altered unnecessarily. Otherwise the colour is lightened or
 * darkened in small steps until it is readable, which keeps the brand recognisable while
 * protecting accessibility (§22).
 */
export function ensureAccessiblePair(foreground: string, background: string, minimum = WCAG_AA_NORMAL): string {
  if (!isHexColor(foreground) || !isHexColor(background)) return foreground;
  if (meetsAA(foreground, background, minimum === WCAG_AA_LARGE)) return foreground;

  const fg = parseHex(foreground)!;
  const bg = parseHex(background)!;
  const bgIsLight = relativeLuminance(toHex(bg))! > 0.4;
  const target = bgIsLight ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };

  for (let step = 1; step <= 20; step += 1) {
    const candidate = toHex(mix(fg, target, step / 20));
    if ((contrastRatio(candidate, background) ?? 0) >= minimum) return candidate;
  }
  return toHex(target);
}

/**
 * A solid button the customer can actually read.
 *
 * Some brand colours sit in the middle of the range, where neither black nor white text
 * reaches AA. In that case the *background* is nudged (never the brand hue — it keeps its
 * character) until the pairing is readable, so no owner choice can produce an unreadable
 * call-to-action (§21, §22).
 */
export function accessibleSolidPair(background: string, minimum = WCAG_AA_NORMAL): { background: string; text: string } {
  if (!isHexColor(background)) return { background, text: readableTextOn(background) };
  let bg = background;
  let text = readableTextOn(bg);
  if ((contrastRatio(text, bg) ?? 0) >= minimum) return { background: bg, text };

  // Light backgrounds lighten (so dark text passes); dark backgrounds darken (so white passes).
  const lighten = (relativeLuminance(bg) ?? 0) > 0.4;
  const target = lighten ? "#FFFFFF" : "#000000";
  for (let step = 1; step <= 20; step += 1) {
    const candidate = mixHex(bg, target, step / 20);
    const candidateText = readableTextOn(candidate);
    if ((contrastRatio(candidateText, candidate) ?? 0) >= minimum) {
      return { background: candidate, text: candidateText };
    }
  }
  return { background: target, text: lighten ? "#121212" : "#FFFFFF" };
}

/** Accessibility warning shown to the owner when a brand colour had to be adjusted (§22). */
export type ContrastWarning = {
  field: "primaryColor" | "secondaryColor" | "accentColor";
  requested: string;
  applied: string;
  message: string;
};

export function contrastWarning(field: ContrastWarning["field"], requested: string, applied: string): ContrastWarning | null {
  if (applied.toUpperCase() === requested.toUpperCase()) return null;
  return {
    field,
    requested,
    applied,
    message: `That ${field === "primaryColor" ? "primary" : field === "secondaryColor" ? "secondary" : "accent"} colour would be hard to read. We adjusted it slightly to keep text clear.`,
  };
}

/** Blend two hex colours. `amount` 0 → `a`, 1 → `b`. Used to derive muted text and borders. */
export function mixHex(a: string, b: string, amount: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  if (!ca || !cb) return a;
  return toHex(mix(ca, cb, Math.max(0, Math.min(1, amount))));
}

/** rgba() string from a hex colour, used for hero scrims and soft surfaces. */
export function withAlpha(hex: string, alpha: number): string {
  const rgb = parseHex(hex);
  if (!rgb) return hex;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${Math.max(0, Math.min(1, alpha))})`;
}
