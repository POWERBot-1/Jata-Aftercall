/**
 * Original JATA AFTERCALL design restoration contract (owner correction, 2026-10-27).
 *
 * The rejected graphite/electric-lime rebrand was withdrawn; this test pins the ORIGINAL design
 * decisions from main @ b716247 so a later edit cannot silently reintroduce the substitute
 * identity. It asserts the original espresso/cream/amber palette, the editorial serif display
 * face, the original plan-icon identities/order, the ember chart colour and the retained phone
 * overflow fix — source assertions, not screenshots; visual evidence is the separate CI capture.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { HOMEPAGE_PLAN_ORDER } from "@/lib/pricing";
import { PLAN_ICONS, POS_PLAN_CARD, AUTOPILOT_PLAN_CARD } from "@/lib/landing";

const root = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(root, "app/globals.css"), "utf8");
const pageTsx = readFileSync(path.join(root, "app/page.tsx"), "utf8");
const dashboardClient = readFileSync(path.join(root, "components/DashboardClient.tsx"), "utf8");

function rule(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`(^|\\n)${escaped}\\s*\\{([^}]*)\\}`, "g");
  const merged: Record<string, string> = {};
  let found = false;
  for (const match of css.matchAll(re)) {
    found = true;
    const body = match[2].replace(/\/\*[\s\S]*?\*\//g, "");
    for (const d of body.split(";").map((x) => x.trim()).filter(Boolean)) {
      const i = d.indexOf(":");
      merged[d.slice(0, i).trim()] = d.slice(i + 1).trim();
    }
  }
  if (!found) throw new Error(`selector not found: ${selector}`);
  return merged;
}

// Relative luminance per WCAG 2.x, so the original brand pairs stay AA even after future edits.
function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const channels = [h.slice(0, 2), h.slice(2, 4), h.slice(4, 6)].map((v) => {
    const srgb = parseInt(v, 16) / 255;
    return srgb <= 0.03928 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
const contrast = (a: string, b: string) => {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
};
const AA = 4.5;

describe("original landing design (espresso / cream / amber)", () => {
  const lp = rule(".lp-page");

  it("keeps the original espresso, cream and amber token values", () => {
    expect(lp["--lp-ink"]).toBe("#14110f");
    expect(lp["--lp-cream"]).toBe("#f7f2e8");
    expect(lp["--lp-cream-2"]).toBe("#efe7d7");
    expect(lp["--lp-paper"]).toBe("#fffdf8");
    expect(lp["--lp-amber"]).toBe("#f0a03c");
    expect(lp["--lp-amber-deep"]).toBe("#b45309");
    expect(lp["--lp-ember"]).toBe("#c2410c");
    expect(lp["--lp-jade"]).toBe("#0f766e");
  });

  it("keeps the editorial serif display face", () => {
    expect(lp["--lp-display"]).toContain("ui-serif");
    expect(lp["--lp-display"]).toContain("Georgia");
    expect(css).not.toMatch(/--lp-display:\s*Inter/);
  });

  it("contains none of the rejected graphite/electric-lime literals anywhere in the stylesheet", () => {
    for (const banned of ["#b6ff2e", "#4d6b12", "#16181d", "#1b1e24"]) {
      expect(css.toLowerCase()).not.toContain(banned);
    }
  });

  it("keeps the original root accent amber", () => {
    const rootTokens = rule(":root");
    expect(rootTokens["--jata-accent"]).toBe("#d97706");
  });

  it("keeps AA-contrast original pairs on the dark espresso hero band", () => {
    expect(contrast("#f7f2e8", "#14110f")).toBeGreaterThanOrEqual(AA);
    expect(contrast("#f0a03c", "#14110f")).toBeGreaterThanOrEqual(AA);
  });
});

describe("original workspace design", () => {
  const ws = rule(".ws-shell");

  it("keeps the original workspace espresso/cream/amber tokens", () => {
    expect(ws["--ws-ink"]).toBe("#14110f");
    expect(ws["--ws-cream"]).toBe("#f7f2e8");
    expect(ws["--ws-amber"]).toBe("#f0a03c");
    expect(ws["--ws-amber-deep"]).toBe("#b45309");
    // Pinned by the pre-existing workspace design test; foreground-on-ink must never be repointed.
    expect(ws["--ws-on-ink"]).toBe("#f7f2e8");
  });

  it("keeps the verified phone-overflow protection on top of the original layout", () => {
    const stack = rule(".ws-stack");
    expect(stack["grid-template-columns"]).toBe("minmax(0, 1fr)");
    const railWrap = rule(".ws-rail-wrap");
    expect(railWrap["overflow-x"]).toBe("clip");
  });
});

describe("original plan-card icon identities and positions", () => {
  it("keeps the exact plan-to-icon mapping from main", () => {
    expect(PLAN_ICONS).toEqual({
      MONTHLY: "phone",
      ANNUAL: "calendar",
      AI_BUSINESS_FRONT_DESK: "bot",
      INTERACTIVE_BUSINESS: "wand",
    });
    expect(POS_PLAN_CARD.icon).toBe("store");
    expect(AUTOPILOT_PLAN_CARD.icon).toBe("spark");
  });

  it("renders the icon in the original top-of-card slot via LandingIcon", () => {
    expect(pageTsx).toContain('<span className="lp-plan__icon" aria-hidden="true">');
    expect(pageTsx).toContain("<LandingIcon name={icon} />");
    // The icon row is declared before the plan name in the card markup.
    expect(pageTsx.indexOf("lp-plan__icon")).toBeLessThan(pageTsx.indexOf("lp-plan__name"));
    // Annual remains the single featured card, as on main.
    expect(pageTsx).toContain('const featured = p.key === "ANNUAL";');
  });

  it("keeps the owner-mandated 2026-10-27 homepage sequence while restoring original visuals", () => {
    expect([...HOMEPAGE_PLAN_ORDER]).toEqual([
      "MONTHLY",
      "ANNUAL",
      "AI_BUSINESS_FRONT_DESK",
      "JATA_AUTOPILOT",
      "INTERACTIVE_BUSINESS",
      "BUSINESS_POS",
    ]);
  });
});

describe("original component colour decisions", () => {
  it("keeps the Overview chart Directions series in ember, not the rejected deep lime", () => {
    expect(dashboardClient).toContain('colour: "#c2410c"');
    expect(dashboardClient).not.toContain("#4d6b12");
  });
});
