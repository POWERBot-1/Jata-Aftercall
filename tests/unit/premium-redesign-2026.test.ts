/**
 * Premium 2026 redesign contract (owner directive, 2026-10-27).
 *
 * Locks the "restrained graphite + electric lime, premium-light" art direction at the token
 * level so a later edit cannot silently reintroduce the warm espresso/amber palette, and proves
 * the new foreground/background pairs still meet WCAG AA. These are source assertions, not
 * screenshots: visual verification remains a separate, explicitly-labelled activity.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOMEPAGE_PLAN_ORDER } from "@/lib/pricing";

const root = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(root, "app/globals.css"), "utf8");

function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g");
  const merged: Record<string, string> = {};
  let found = false;
  for (const match of css.matchAll(re)) {
    found = true;
    // Strip comments first: their prose can contain colons/semicolons that corrupt declaration parsing.
    const body = match[2].replace(/\/\*[\s\S]*?\*\//g, "");
    for (const d of body.split(";").map((x) => x.trim()).filter(Boolean)) {
      const i = d.indexOf(":");
      merged[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  expect(found, `missing CSS rule ${selector}`).toBe(true);
  return merged;
}

function luminance(hex: string): number {
  const rgb = hex.replace("#", "").match(/.{2}/g)!.map((c) => parseInt(c, 16) / 255);
  const lin = rgb.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** The landing stylesheet span, from the section banner to the Studio Canvas banner. */
const landingBlock = css.slice(
  css.indexOf("JATA AFTERCALL — 2026 landing page and demo showcase"),
  css.indexOf("Studio Canvas — the Website Studio editing surface"),
);
const workspaceBlock = css.slice(css.indexOf("WORKSPACE DESIGN SYSTEM"));

describe("premium brand tokens", () => {
  it("defines the graphite + electric-lime contract at :root", () => {
    const rootTokens = rule(":root");
    expect(rootTokens["--jata-lime"]).toBe("#b6ff2e");
    expect(rootTokens["--jata-lime-deep"]).toBe("#4d6b12");
    expect(rootTokens["--jata-graphite"]).toBe("#16181d");
    expect(rootTokens["--jata-on-lime"]).toBe("#1b1e24");
    // The old warm amber accent is retired in favour of AA-safe deep lime.
    expect(rootTokens["--jata-accent"]).toBe("#4d6b12");
    // Semantic warning amber is deliberately retained for alerts/notices.
    expect(rootTokens["--jata-warning"]).toBe("#92400e");
  });

  it("repoints the landing palette at graphite, lime and neutral light paper", () => {
    const lp = rule(".lp-page");
    expect(lp["--lp-graphite"]).toBe("#16181d");
    expect(lp["--lp-lime"]).toBe("#b6ff2e");
    expect(lp["--lp-lime-deep"]).toBe("#4d6b12");
    expect(lp["--lp-lime-tint"]).toBe("#eefad2");
    expect(lp["--lp-on-lime"]).toBe("#1b1e24");
    expect(lp["--lp-cream"]).toBe("#f5f7f4");
    expect(lp["--lp-paper"]).toBe("#ffffff");
    // Legacy aliases still resolve so every existing .lp-* rule and test keep working.
    expect(lp["--lp-amber"]).toBe("#b6ff2e");
  });

  it("replaces the landing serif display face with Inter", () => {
    const lp = rule(".lp-page");
    expect(lp["--lp-display"]).toMatch(/^Inter,/);
    expect(landingBlock).not.toContain("ui-serif");
  });

  it("leaves no warm espresso/amber literal anywhere in the landing stylesheet block", () => {
    for (const literal of ["#f0a03c", "#14110f", "#f7f2e8", "#1a140d", "#b45309", "#c2410c", "#fffdf8"]) {
      expect(landingBlock, literal).not.toContain(literal);
    }
  });

  it("keeps the owner-mandated 2026-10-27 homepage plan order", () => {
    expect([...HOMEPAGE_PLAN_ORDER]).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "JATA_AUTOPILOT",
      "INTERACTIVE_BUSINESS",
      "BUSINESS_POS",
    ]);
    expect(landingBlock).toContain(".lp-plan[data-featured=\"true\"]");
  });
});

describe("premium workspace tokens", () => {
  it("retunes the default light shell to cool paper + lime, keeping the pinned on-ink literal", () => {
    const shell = rule(".ws-shell");
    expect(shell["--ws-ink"]).toBe("#16181d");
    expect(shell["--ws-cream"]).toBe("#f5f7f4");
    expect(shell["--ws-paper"]).toBe("#ffffff");
    expect(shell["--ws-amber"]).toBe("#b6ff2e");
    expect(shell["--ws-amber-deep"]).toBe("#4d6b12");
    expect(shell["--ws-on-amber"]).toBe("#1b1e24");
    // Pinned by workspace-design.test.ts: light text on ink surfaces never follows --ws-cream.
    expect(shell["--ws-on-ink"]).toBe("#f7f2e8");
    expect(shell["--ws-display"]).toMatch(/^Inter,/);
  });

  it("makes the lime-spark graphite variant cool graphite with a lime primary, not warm amber", () => {
    const marker = 'html[data-jata-theme="lime-spark"] .ws-shell {';
    const start = css.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("--ws-cream: #23262f;");
    expect(block).toContain("--ws-paper: #2d313b;");
    expect(block).toContain("--ws-amber: #b6ff2e;");
    expect(block).toContain("--ws-on-amber: #23262f;");
    // The dark variant must never redefine the shared on-ink foreground.
    expect(block).not.toContain("--ws-on-ink:");
    for (const literal of ["#f0a03c", "#1a140d", "#171412", "#201c19"]) {
      expect(block, literal).not.toContain(literal);
    }
  });

  it("styles lime-spark primary actions graphite-on-lime", () => {
    const marker = ".product-theme-root[data-product-theme=\"lime-spark\"] .ws-shell .jata-btn-primary,";
    const start = css.indexOf(marker);
    expect(start).toBeGreaterThan(-1);
    const block = css.slice(start, css.indexOf("}", start));
    expect(block).toContain("background: var(--ws-amber);");
    expect(block).toContain("color: var(--ws-on-amber);");
  });

  it("keeps the whole workspace block free of the retired warm brand literals", () => {
    for (const literal of ["#f0a03c", "#1a140d", "#b45309", "#14110f", "#fffdf8"]) {
      expect(workspaceBlock, literal).not.toContain(literal);
    }
    // Semantic warning surfaces stay amber by design (alerts/notices, not brand accent).
    expect(css).toContain("--jata-warning: #92400e");
  });
});

describe("premium contrast (WCAG AA, 4.5:1 body text)", () => {
  it("landing: text and controls clear AA on paper, cream and graphite", () => {
    const lp = rule(".lp-page");
    const pairs: [string, string, string][] = [
      ["body on cream", lp["--lp-text"], lp["--lp-cream"]],
      ["muted on paper", lp["--lp-text-muted"], lp["--lp-paper"]],
      ["deep lime on cream", lp["--lp-lime-deep"], lp["--lp-cream"]],
      ["lime on graphite", lp["--lp-lime"], lp["--lp-graphite"]],
      ["graphite on lime", lp["--lp-on-lime"], lp["--lp-lime"]],
    ];
    for (const [label, fg, bg] of pairs) {
      expect(contrast(fg, bg), label).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("light workspace shell: text, muted and accent clear AA on paper and cream", () => {
    const shell = rule(".ws-shell");
    const pairs: [string, string, string][] = [
      ["body on paper", shell["--ws-text"], shell["--ws-paper"]],
      ["muted on cream", shell["--ws-muted"], shell["--ws-cream"]],
      ["accent on paper", shell["--ws-amber-deep"], shell["--ws-paper"]],
      ["on-ink on graphite", shell["--ws-on-ink"], shell["--ws-ink"]],
    ];
    for (const [label, fg, bg] of pairs) {
      expect(contrast(fg, bg), label).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("premium refinement mechanics", () => {
  it("gives the featured pricing card the lime treatment and a hover lift", () => {
    expect(landingBlock).toMatch(/\.lp-plan:hover \{[^}]*translateY\(-4px\)/);
    expect(landingBlock).toMatch(/\.lp-plan\[data-featured="true"\] \{\s*border-color: var\(--lp-lime\)/);
  });

  it("upgrades display headings to weight 700 for the Inter face", () => {
    const refinement = css.slice(css.indexOf("Premium 2026 workspace refinement"));
    expect(refinement).toContain(".ws-hero__title,");
    expect(refinement).toMatch(/font-weight: 700;/);
  });

  it("covers every new transition with the reduced-motion guard", () => {
    const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain(".ws-stat");
    expect(reduced).toContain(".jata-card");
    // The landing guard disables transitions wholesale for every .lp-page descendant.
    expect(landingBlock).toMatch(/\.lp-page \*,[\s\S]*transition: none !important/);
  });

  it("keeps the focus ring on a token in both shells", () => {
    expect(css).toContain(".ws-shell :focus-visible");
    expect(rule(".ws-shell")["--ws-amber-deep"]).toBeTruthy();
    expect(landingBlock).toContain(".lp-page :focus-visible");
  });
});
