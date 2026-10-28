/**
 * Class-name helpers for shared UI components.
 *
 * Deliberately dependency-free: a `clsx` + `tailwind-merge` pair would add two runtime
 * packages for behaviour this one function already provides, and the design system below is
 * built on component classes (`.jata-*`), not on conflicting utility strings that need merging.
 */

export type ClassValue = string | number | null | undefined | false | ClassValue[];

/** Joins truthy class names. Nested arrays are flattened one level at a time. */
export function cn(...values: ClassValue[]): string {
  const out: string[] = [];
  for (const value of values) {
    if (!value) continue;
    if (Array.isArray(value)) {
      const nested = cn(...value);
      if (nested) out.push(nested);
    } else {
      out.push(String(value));
    }
  }
  return out.join(" ");
}

export type Tone = "neutral" | "info" | "success" | "warning" | "danger";

const TONES: readonly Tone[] = ["neutral", "info", "success", "warning", "danger"];

/** Aliases so the tones produced by `lib/statusLabels` ("error") map onto this palette. */
const TONE_ALIASES: Record<string, Tone> = { error: "danger", danger: "danger", warn: "warning" };

/** Accepts the tone strings used by `lib/statusLabels` and falls back to `neutral`. */
export function asTone(value: string | null | undefined): Tone {
  if (!value) return "neutral";
  const alias = TONE_ALIASES[value];
  if (alias) return alias;
  return TONES.includes(value as Tone) ? (value as Tone) : "neutral";
}

/** The `data-tone` attribute shared by pills, alerts and status surfaces. */
export function toneAttrs(value: string | null | undefined): { "data-tone": Tone } {
  return { "data-tone": asTone(value) };
}
