/**
 * Landing page presentation contract.
 *
 * The landing page carries its own palette, so it must keep WCAG AA contrast on both of its
 * surfaces regardless of the saved product theme; its motion must be CSS-only and disabled under
 * reduced motion; its media must be lazy where it is not above the fold; and the demo harness that
 * makes the demo pages reviewable without a database must never exist in production.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(root, "app/globals.css"), "utf8");

function luminance(hex: string): number {
  const rgb = hex.replace("#", "").match(/.{2}/g)!.map((c) => parseInt(c, 16) / 255);
  const lin = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
/** Declarations of every rule whose selector exactly matches, merged in source order. */
function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g");
  const merged: Record<string, string> = {};
  let found = false;
  for (const match of css.matchAll(re)) {
    found = true;
    for (const declaration of match[2].split(";").map((entry) => entry.trim()).filter(Boolean)) {
      const index = declaration.indexOf(":");
      merged[declaration.slice(0, index).trim()] = declaration.slice(index + 1).trim();
    }
  }
  expect(found, `missing CSS rule ${selector}`).toBe(true);
  return merged;
}

const palette = rule(".lp-page");

describe("landing palette", () => {
  it("defines its own surface and text colours instead of inheriting the product theme", () => {
    for (const name of ["--lp-ink", "--lp-cream", "--lp-paper", "--lp-text", "--lp-text-muted", "--lp-amber"]) {
      expect(palette[name], name).toBeTruthy();
    }
    // The theme's `.jata-landing` colour rule outranks a plain `.lp-page` rule; the higher-specificity
    // selector below is what keeps section text readable on the cream surfaces.
    expect(css).toContain(".product-theme-root .jata-landing.lp-page");
  });

  it("meets WCAG AA for body and heading text on every landing surface", () => {
    const AA = 4.5;
    const pairs: [string, string, string][] = [
      ["heading on cream", palette["--lp-text"], palette["--lp-cream"]],
      ["muted copy on cream", palette["--lp-text-muted"], palette["--lp-cream"]],
      ["muted copy on paper", palette["--lp-text-muted"], palette["--lp-paper"]],
      ["heading on ink", palette["--lp-cream"], palette["--lp-ink"]],
      ["kicker on cream", palette["--lp-ember"], palette["--lp-cream"]],
      ["badge text on ink", palette["--lp-amber"], palette["--lp-ink"]],
      ["primary button label", "#1b1e24", palette["--lp-amber"]],
    ];
    for (const [label, foreground, background] of pairs) {
      expect(contrast(foreground, background), `${label} (${foreground} on ${background})`).toBeGreaterThanOrEqual(AA);
    }
  });

  it("keeps the demo band's copy readable over its photographs", () => {
    const AA = 4.5;
    // The band sits on graphite #101216 under a layered scrim; the brightest copy is the headline.
    expect(contrast("#f5f7f4", "#101216")).toBeGreaterThanOrEqual(AA);
    expect(contrast("#b6ff2e", "#101216")).toBeGreaterThanOrEqual(AA);
    // Service rows get their own darker plate so the price text stays legible over any photo.
    expect(css).toMatch(/\.jata-showcase__service \{[^}]*background: rgba\(16, 18, 22, 0\.62\)/);
  });
});

describe("landing motion", () => {
  const landing = readFileSync(path.join(root, "app/page.tsx"), "utf8");
  const hero = readFileSync(path.join(root, "components/landing/Hero.tsx"), "utf8");
  const showcase = readFileSync(path.join(root, "components/landing/DemoShowcase.tsx"), "utf8");
  const band = readFileSync(path.join(root, "components/storefront/DemoShowcaseBand.tsx"), "utf8");

  it("uses no video and no audio anywhere on the landing or the demo band", () => {
    for (const source of [landing, hero, showcase, band]) {
      expect(source).not.toMatch(/<video|<audio|autoPlay|autoplay/);
    }
  });

  it("ships only one client component, and it is the demo tab switcher", () => {
    const clientComponents = ["components/landing/Hero.tsx", "components/landing/Sections.tsx", "components/landing/FaqAndFooter.tsx", "components/landing/Icons.tsx", "components/landing/DemoShowcase.tsx"]
      .filter((file) => readFileSync(path.join(root, file), "utf8").startsWith('"use client"'));
    expect(clientComponents).toEqual(["components/landing/DemoShowcase.tsx"]);
    expect(band.startsWith('"use client"')).toBe(false);
  });

  it("disables every landing and band animation under reduced motion", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce) {\n  .lp-page *"));
    expect(reduced.slice(0, 700)).toContain("animation: none !important");
    expect(reduced.slice(0, 700)).toContain(".jata-showcase");
    // The entrance animation must not leave content hidden when it is switched off.
    expect(css).toContain(".lp-hero__copy > * { opacity: 1; transform: none; }");
  });

  it("lazy-loads everything except the hero and the band's first photograph", () => {
    // Cards: lazy. Band: the primary photo is eager (it is the LCP on the demo page), the second
    // property frame is lazy.
    expect(showcase.match(/loading="lazy"/g)?.length).toBeGreaterThanOrEqual(2);
    expect(band.match(/loading="lazy"/g)?.length).toBe(1);
    expect(hero).not.toContain('loading="lazy"');
  });

  it("keeps navigation and CTAs as plain links so they work without JavaScript", () => {
    const nav = readFileSync(path.join(root, "components/Navbar.tsx"), "utf8");
    expect(nav).not.toContain("onClick");
    expect(nav).not.toMatch(/useState|useEffect/);
    expect(hero).toContain('href="/register"');
    expect(hero).toContain('href="#demo"');
  });
});

describe("demo harness is development-only", () => {
  it("returns 404 in production", () => {
    const harness = readFileSync(path.join(root, "app/dev/demo-showcase/page.tsx"), "utf8");
    expect(harness).toContain('if (process.env.NODE_ENV === "production") notFound();');
    expect(harness).toContain("robots: { index: false, follow: false }");
    expect(harness).toContain("Development verification only");
  });

  it("reads no database and writes nothing", () => {
    const harness = readFileSync(path.join(root, "app/dev/demo-showcase/page.tsx"), "utf8");
    expect(harness).not.toContain("@/lib/db");
    expect(harness).not.toMatch(/method="post"|fetch\(/);
  });
});
