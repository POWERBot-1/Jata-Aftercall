/**
 * Tailwind CSS v4 migration contract (owner-approved staged remediation, report §K).
 *
 * The v3 -> v4 upgrade is not only a version bump: v4 changed *defaults* that this codebase relied on
 * implicitly, and renamed three utilities whose v3 and v4 meanings differ. Those two things are the
 * silent-regression surface, so they are pinned here rather than left to review. The defaults come
 * from a full diff of the two shipped preflight files (tailwindcss 3.4.19 vs 4.3.3):
 *
 *   1. the universal border colour (v3 gray-200 -> v4 currentColor);
 *   2. the default `--tw-ring-color` (v3 blue-500/50 -> v4 currentColor);
 *   3. `button { cursor: pointer }` (present in v3 preflight, removed in v4 — a UX change);
 *   4. the placeholder colour (v3 gray-400 -> v4 a half-transparent currentColor);
 *   5. `button, select { text-transform: none }` (dropped by v4);
 *   6. `[type='search']` search-field normalisation (dropped by v4; three real inputs rely on it).
 *
 * All six are restored in `app/globals.css` inside `@layer base`. The layer matters: v4 emits
 * `@layer properties, theme, base, components, utilities`, so a `base` rule loses to every
 * utility — a bare `border`, `ring-1`, `placeholder-*` or `cursor-*` class still wins — and the
 * app's own unlayered `.jata-*` / `.eb-*` rules still win over both, exactly as in v3. If someone
 * later moves the shim out of the layer, or deletes it, this file fails.
 *
 * The rest of the preflight diff was checked and deliberately left alone because it is equivalent
 * in the emitted CSS (form-control margin/padding now come from the universal reset; `body` line
 * height/`html` font family are inherited; `list-style: none` is identical in both versions — which
 * is why there is deliberately no list shim). The `html` font family was verified end-to-end:
 * `--default-font-family: var(--font-sans)` and `--font-sans: Inter, …`, so the app still renders
 * in Inter.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const css = readFileSync("app/globals.css", "utf8");
const postcss = readFileSync("postcss.config.js", "utf8");
const manifest = JSON.parse(readFileSync("package.json", "utf8"));

/** Body of every `@layer <name> { ... }` block, found with brace matching (not a regex). */
function layerBodies(source: string, name: string): string[] {
  const bodies: string[] = [];
  const opener = `@layer ${name}`;
  for (let at = source.indexOf(opener); at !== -1; at = source.indexOf(opener, at + 1)) {
    const open = source.indexOf("{", at);
    if (open === -1) continue;
    let depth = 0;
    for (let i = open; i < source.length; i += 1) {
      if (source[i] === "{") depth += 1;
      else if (source[i] === "}") {
        depth -= 1;
        if (depth === 0) {
          bodies.push(source.slice(open + 1, i));
          break;
        }
      }
    }
  }
  return bodies;
}

/** Collapse whitespace so formatting changes cannot break a declaration assertion. */
const flat = (s: string) => s.replace(/\s+/g, " ").trim();

function sourceFiles(dir: string, found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, found);
    else if (/\.tsx?$/.test(entry)) found.push(full);
  }
  return found;
}

/** Bare class tokens used in `className` attributes only — never prose or object keys. */
function classTokens(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const file of [...sourceFiles("app"), ...sourceFiles("components"), ...sourceFiles("lib")]) {
    const text = readFileSync(file, "utf8");
    for (const attribute of text.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const value = attribute[1] ?? attribute[2] ?? "";
      // A template literal with an interpolation is a runtime-built class; it cannot be judged here.
      if (value.includes("${")) continue;
      for (const token of value.split(/\s+/)) {
        if (!token) continue;
        out.set(token, [...(out.get(token) ?? []), file]);
      }
    }
  }
  return out;
}

describe("Tailwind v4 migration contract", () => {
  it("loads v4 through the CSS entry point with the deleted config's exact content roots", () => {
    expect(css, "v4 is imported with automatic content detection disabled").toContain('@import "tailwindcss" source(none);');
    // `source(none)` is only safe if every root the old `content` array listed is re-declared here.
    for (const root of ["app", "components", "lib"]) {
      expect(css, `the ${root}/ content root from tailwind.config.ts is missing`).toContain(
        `@source "../${root}/**/*.{js,ts,jsx,tsx,mdx}";`,
      );
    }
    // The v3 directives must be gone: v4 errors on them, and their presence would mean a half-run migration.
    expect(css).not.toMatch(/@tailwind\s+(base|components|utilities)/);
    expect(existsSync("tailwind.config.ts"), "v4 is configured CSS-first; the v3 config was removed").toBe(false);
  });

  it("restores every v3 default that v4 changed or dropped, inside the base layer", () => {
    const baseLayers = layerBodies(css, "base").map(flat);
    expect(baseLayers.length, "the compatibility shim must live in an @layer base block").toBeGreaterThan(0);
    const shimmed = baseLayers.join(" ");
    const expectations: Array<[string, RegExp, string]> = [
      ["universal border colour", /\*,\s*::after,\s*::before[^{]*\{[^}]*border-color:\s*#e5e7eb/, "v3 gray-200; v4 resets border to `0 solid` (currentColor)"],
      ["default ring colour", /\*[^{]*\{[^}]*--tw-ring-color:\s*rgb\(59 130 246 \/ 0?\.5\)/, "v3 blue-500/50; v4 defaults the ring to currentColor"],
      ["button cursor", /button:not\(:disabled\)[^{]*\{[^}]*cursor:\s*pointer/, "v3 preflight set it; v4 removed it entirely"],
      ["disabled cursor", /:disabled\s*\{[^}]*cursor:\s*default/, "the v3 companion to the button cursor rule"],
      ["placeholder colour", /::placeholder\s*\{[^}]*color:\s*#9ca3af/, "v3 gray-400; v4 uses a half-transparent currentColor"],
      ["form-control text transform", /button,\s*select\s*\{[^}]*text-transform:\s*none/, "v3 reset it; v4 dropped it, so an uppercased ancestor would now leak into controls"],
      ["search-field normalisation", /\[type="search"\]\s*\{[^}]*-webkit-appearance:\s*textfield[^}]*outline-offset:\s*-2px/, "v3 normalised search inputs; v4 dropped it and the app has real search inputs"],
    ];
    for (const [label, pattern, why] of expectations) {
      expect(shimmed, `${label} is missing from @layer base — ${why}`).toMatch(pattern);
    }
    // The layer is what keeps every utility able to override the shim; unlayered would outrank them
    // (v4 emits `@layer properties, theme, base, components, utilities`).
    expect(layerBodies(css, "base").length, "the shim must not be moved out of a cascade layer").toBe(1);
  });

  it("keeps the v3 -> v4 class renames token-accurate in every className attribute", () => {
    const tokens = classTokens();
    // Bare `rounded`, `shadow-sm` and `outline-none` all still EXIST in v4, which is exactly why
    // they are dangerous: they compile, they just mean something else than they did in v3.
    const stale: Record<string, string> = {
      rounded: "v3 `.rounded` was 0.25rem; v4 `.rounded` is 0.5rem. Use `rounded-sm` for the old value.",
      "shadow-sm": "v3 `.shadow-sm` is v4's `.shadow-xs`. v4's `.shadow-sm` is the old `.shadow`.",
      "outline-none": "v3 `.outline-none` kept a 2px transparent offset ring. That is now `.outline-hidden`; v4's `.outline-none` removes the outline for keyboard users.",
    };
    const offenders = [...tokens.keys()]
      .filter((token) => token in stale)
      .map((token) => `${token} in ${[...new Set(tokens.get(token))].join(", ")}`);
    expect(offenders, `v3-meaning utility used after the migration:\n  ${offenders.join("\n  ")}`).toEqual([]);
    // And the replacements are actually in use, so this test cannot pass on an empty scan.
    expect(tokens.has("rounded-sm") || tokens.has("rounded-md") || tokens.has("rounded-lg")).toBe(true);
  });

  it("runs PostCSS through the v4 plugin alone, with Autoprefixer retired", () => {
    expect(postcss, "the v4 PostCSS plugin is the pipeline").toContain("@tailwindcss/postcss");
    expect(postcss, "Autoprefixer was removed after the v4 pipeline was verified").not.toContain("autoprefixer");
    expect(manifest.devDependencies["@tailwindcss/postcss"]).toBe("^4.3.3");
    expect(manifest.devDependencies.tailwindcss).toBe("^4.3.3");
    expect(manifest.devDependencies.autoprefixer, "a stray Autoprefixer would prefix v4 output twice").toBeUndefined();
  });
});
