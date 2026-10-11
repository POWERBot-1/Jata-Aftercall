/**
 * Motion engine tests (Immersive Website Engine, Phase 2 — §21, §39, §40, §51, §78, §82)
 *
 * The engine is a download, so these tests hold two things down at once: that the §21 preset
 * catalogue is genuinely wired rather than named, and that every refusal path — reduced motion,
 * Save-Data, Lite, a `subtle` theme, a chunk that never arrives — leaves the visitor on the CSS
 * reveal instead of on a hidden section.
 *
 * WebGL-free and browser-free by design: the decision layer is pure. Real-browser behaviour of
 * the `motion` runtime is covered by `scripts/browser/motion-engine.check.mjs`, which needs a
 * Chrome binary and is reported separately when it cannot run.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative } from "path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  LOW_POWER_RECIPE_KEYS,
  MOTION_ENGINE_RECIPES,
  MOTION_RECIPE_KEYS,
  MOTION_RECIPES,
  isLowPowerDevice,
  motionPlan,
  recipeFor,
  sectionMotionMarkup,
  sectionRecipesForPage,
  sectionRecipe,
} from "@/lib/experience/motion";
import { MotionReveal } from "@/components/storefront/MotionReveal";

const ROOT = join(__dirname, "..", "..");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const full = join(ROOT, dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      out.push(...sourceFiles(join(dir, entry)));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(relative(ROOT, full));
    }
  }
  return out;
}

const SOURCES = ["app", "components", "lib"].flatMap((dir) => sourceFiles(dir));
const RUNTIME = "components/storefront/motion/MotionRuntime.ts";
const MOUNT = "components/storefront/motion/MotionEngineMount.tsx";

describe("the §21 preset catalogue is real, not decorative", () => {
  const EXPECTED = [
    "fade",
    "slide",
    "scale",
    "reveal",
    "mask",
    "clip",
    "parallax",
    "stagger",
    "split",
    "blur-reveal",
    "image-pan",
    "text-reveal",
    "magnetic",
    "morph",
  ];

  it("declares every preset the specification names", () => {
    expect(MOTION_RECIPE_KEYS).toEqual(EXPECTED);
  });

  it("gives every preset a CSS fallback class that actually exists in the stylesheet", () => {
    const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    for (const recipe of MOTION_RECIPES) {
      for (const className of recipe.cssFallback.split(" ").filter(Boolean)) {
        expect(css, `${recipe.key} -> ${className}`).toContain(`.${className}`);
      }
    }
  });

  it("marks the hover-only and continuous presets so touch and low-power paths can drop them", () => {
    expect(recipeFor("magnetic")?.requiresHover).toBe(true);
    expect(recipeFor("parallax")?.continuous).toBe(true);
    expect(recipeFor("image-pan")?.continuous).toBe(true);
    expect(recipeFor("slide")?.requiresHover).toBe(false);
    expect(recipeFor("slide")?.continuous).toBe(false);
    expect(LOW_POWER_RECIPE_KEYS).not.toContain("parallax");
    expect(LOW_POWER_RECIPE_KEYS).not.toContain("magnetic");
    expect(LOW_POWER_RECIPE_KEYS).toContain("stagger");
  });

  it("only ever offers presets the runtime implements", () => {
    for (const key of MOTION_ENGINE_RECIPES) {
      expect(MOTION_RECIPE_KEYS, key).toContain(key);
    }
  });

  it("has a real animation for every preset the plan can offer", () => {
    const runtime = readFileSync(join(ROOT, RUNTIME), "utf8");
    for (const key of MOTION_ENGINE_RECIPES) {
      const covered =
        new RegExp(`\\b${key}:\\s*\\{`).test(runtime) || // entrance keyframes entry
        new RegExp(`recipe === "${key}"`).test(runtime) || // dedicated branch
        new RegExp(`"${key}"`).test(runtime); // named in a branch condition
      expect(covered, `no animation for recipe "${key}"`).toBe(true);
    }
  });
});

describe("motionPlan refuses the download on every path that must not pay for it", () => {
  it("never animates for a reduced-motion visitor, whatever else is true (§51)", () => {
    const plan = motionPlan({ renderMode: "immersive", motionLevel: "expressive", reducedMotion: true });
    expect(plan).toEqual({ engine: "css", recipes: [], reasons: ["reduced-motion"] });
  });

  it("never animates for a Save-Data visitor (§82)", () => {
    const plan = motionPlan({ renderMode: "motion", motionLevel: "expressive", reducedMotion: false, saveData: true });
    expect(plan.engine).toBe("css");
    expect(plan.recipes).toEqual([]);
    expect(plan.reasons).toEqual(["save-data"]);
  });

  it("never animates in Lite mode, because Lite never loads scripts it does not need (§39, §40)", () => {
    const plan = motionPlan({ renderMode: "lite", motionLevel: "expressive", reducedMotion: false });
    expect(plan).toEqual({ engine: "css", recipes: [], reasons: ["render-mode-lite"] });
  });

  it("never animates for a theme whose treatment is none (§28: motion must mean something)", () => {
    const plan = motionPlan({ renderMode: "motion", motionLevel: "none", reducedMotion: false });
    expect(plan).toEqual({ engine: "css", recipes: [], reasons: ["theme-motion-none"] });
  });

  it("keeps a subtle theme on CSS — one transition does not justify a library (§39)", () => {
    const plan = motionPlan({ renderMode: "motion", motionLevel: "subtle", reducedMotion: false });
    expect(plan.engine).toBe("css");
    expect(plan.recipes).toEqual(["reveal"]);
    expect(plan.reasons).toEqual(["subtle-uses-css"]);
  });

  it("upgrades only an expressive treatment on a Motion-or-better device", () => {
    const plan = motionPlan({ renderMode: "motion", motionLevel: "expressive", reducedMotion: false });
    expect(plan.engine).toBe("motion-js");
    expect(plan.recipes).toEqual([...MOTION_ENGINE_RECIPES]);
    expect(plan.recipes.length).toBeGreaterThan(5);
  });

  it("upgrades an immersive page too, and records low power as a reason rather than a refusal (§82)", () => {
    const immersive = motionPlan({ renderMode: "immersive", motionLevel: "expressive", reducedMotion: false });
    expect(immersive.engine).toBe("motion-js");
    const lowPower = motionPlan({ renderMode: "motion", motionLevel: "expressive", reducedMotion: false, lowPower: true });
    expect(lowPower.engine).toBe("motion-js");
    expect(lowPower.reasons).toContain("low-power-recipe-set");
  });

  it("falls back to CSS when the chunk never arrives, instead of waiting for it (§54, §78)", () => {
    const plan = motionPlan({
      renderMode: "motion",
      motionLevel: "expressive",
      reducedMotion: false,
      engineLoaded: false,
    });
    expect(plan).toEqual({ engine: "css", recipes: ["reveal"], reasons: ["engine-not-loaded"] });
  });
});

describe("choreography is deterministic per business and different across businesses (§7, §66, §68)", () => {
  const sections = [
    { id: "s1" },
    { id: "s2" },
    { id: "s3" },
    { id: "s4" },
    { id: "s5" },
    { id: "s6" },
  ];

  it("gives the same seed the same page every time", () => {
    const a = sectionRecipesForPage({ motionLevel: "expressive", seed: "restaurant:jata-grill", sections });
    const b = sectionRecipesForPage({ motionLevel: "expressive", seed: "restaurant:jata-grill", sections });
    expect(a).toEqual(b);
    expect(Object.keys(a).sort()).toEqual(sections.map((s) => s.id));
  });

  it("gives two businesses in the same category materially different choreography", () => {
    const a = sectionRecipesForPage({ motionLevel: "expressive", seed: "restaurant:jata-grill", sections });
    const b = sectionRecipesForPage({ motionLevel: "expressive", seed: "restaurant:mama-njeri", sections });
    expect(a).not.toEqual(b);
  });

  it("never assigns a hover-only recipe to a section, because touch is the primary target (§27)", () => {
    for (const seed of ["a", "b", "c", "d", "e", "f", "g", "h"]) {
      const map = sectionRecipesForPage({ motionLevel: "expressive", seed, sections });
      for (const key of Object.values(map)) {
        expect(recipeFor(key)?.requiresHover, String(key)).not.toBe(true);
      }
    }
  });

  it("drops continuous recipes for a low-power device instead of dropping the engine (§82)", () => {
    const key = sectionRecipe({
      recipes: MOTION_ENGINE_RECIPES,
      seed: "x",
      sectionId: "s1",
      index: 0,
      lowPower: true,
    });
    expect(recipeFor(key)?.continuous).toBe(false);
  });

  it("returns nothing at all for a theme that must not move", () => {
    expect(sectionRecipesForPage({ motionLevel: "none", seed: "x", sections })).toEqual({});
    expect(sectionMotionMarkup({ motionLevel: "none", recipe: "slide" })).toEqual({ className: "", recipe: null });
  });
});

describe("the server markup is complete without the engine (§52, §78)", () => {
  it("renders the section content with its CSS fallback class and the recipe as data", () => {
    const markup = renderToStaticMarkup(
      createElement(MotionReveal, { motionLevel: "expressive", recipe: "mask", children: createElement("h2", null, "Fresh tilapia, KES 650") }),
    );
    expect(markup).toContain("Fresh tilapia, KES 650");
    expect(markup).toContain('data-eb-motion="mask"');
    expect(markup).toContain("eb-reveal");
  });

  it("renders nothing hidden when there is no recipe", () => {
    const markup = renderToStaticMarkup(
      createElement(MotionReveal, { motionLevel: "subtle", recipe: null, children: createElement("p", null, "Open 8am to 9pm") }),
    );
    expect(markup).toContain("Open 8am to 9pm");
    expect(markup).toContain('class="eb-reveal"');
    expect(markup).not.toContain("data-eb-motion");
  });

  it("never renders an expressive fallback for a subtle theme", () => {
    const markup = renderToStaticMarkup(
      createElement(MotionReveal, { motionLevel: "subtle", recipe: "morph", children: createElement("p", null, "x") }),
    );
    expect(markup).toContain('class="eb-reveal"');
    expect(markup).not.toContain("eb-reveal--expressive");
  });
});

describe("the motion package is confined to one lazily loaded module", () => {
  it("only the runtime imports 'motion'", () => {
    const importers = SOURCES.filter((file) => /from\s+["']motion(\/|[\"'])/.test(readFileSync(join(ROOT, file), "utf8")));
    expect(importers).toEqual([RUNTIME]);
  });

  it("loads the runtime through a dynamic import, so Lite and subtle pages never fetch it (§40, §41)", () => {
    const mount = readFileSync(join(ROOT, MOUNT), "utf8");
    expect(mount).toMatch(/import\("\.\/MotionRuntime"\)/);
    expect(mount).not.toMatch(/from\s+["']motion/);
    // The gate is the plan, and the plan is computed before the import is even attempted.
    expect(mount).toContain('if (plan.engine !== "motion-js") return;');
  });

  it("keeps the CSS reveal standing when the engine is absent or has failed (§54, §78)", () => {
    const css = readFileSync(join(ROOT, "app/globals.css"), "utf8");
    // Under the JS engine the stylesheet leaves every reveal opaque; the engine hides what it owns.
    expect(css).toContain('html[data-motion-engine="js"] .eb-reveal');
    expect(css).toMatch(/html\[data-motion-engine="js"\] \.eb-reveal,\s*html\[data-motion-engine="js"\] \.eb-reveal--expressive \{\s*opacity: 1;/);
    // Reduced motion still gets an explicit CSS opt-out.
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*html\[data-motion-ready\] \.eb-reveal/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\[data-eb-magnetic\]/);
  });

  it("hands anything it hid back to the visitor if it never animates", () => {
    const runtime = readFileSync(join(ROOT, RUNTIME), "utf8");
    expect(runtime).toContain("SAFETY_REVEAL_MS");
    expect(runtime).toContain('target.style.opacity = ""');
  });

  it("never makes a hover interaction the only affordance (§26, §27)", () => {
    const runtime = readFileSync(join(ROOT, RUNTIME), "utf8");
    expect(runtime).toMatch(/allowed\.has\("magnetic"\) && options\.pointerFine/);
  });

  it("keeps the Lite storefront free of the engine", () => {
    for (const file of [
      "components/storefront/ExperienceSite.tsx",
      "components/storefront/MotionReveal.tsx",
      "components/storefront/RenderModeProbe.tsx",
      "components/storefront/StorefrontShell.tsx",
      "app/b/[slug]/page.tsx",
    ]) {
      const text = readFileSync(join(ROOT, file), "utf8");
      expect(text, file).not.toMatch(/from\s+["']motion/);
      expect(text, file).not.toMatch(/MotionRuntime/);
    }
  });
});

describe("low-power detection is signal-based, never model-name-based (§4, §82)", () => {
  it("reads memory first, cores only when memory is unknown, and never guesses from nothing", () => {
    expect(isLowPowerDevice({ deviceMemoryGB: 2, hardwareConcurrency: 8 })).toBe(true);
    expect(isLowPowerDevice({ deviceMemoryGB: 3.5, hardwareConcurrency: 8 })).toBe(true);
    expect(isLowPowerDevice({ deviceMemoryGB: 8, hardwareConcurrency: 2 })).toBe(false);
    expect(isLowPowerDevice({ deviceMemoryGB: null, hardwareConcurrency: 4 })).toBe(true);
    expect(isLowPowerDevice({ deviceMemoryGB: null, hardwareConcurrency: 8 })).toBe(false);
    expect(isLowPowerDevice({ deviceMemoryGB: null, hardwareConcurrency: null })).toBe(false);
  });

  it("never inspects a device name or user agent, because the specification forbids it (§4)", () => {
    // Comments are stripped first: the module's prose mentions `navigator.deviceMemory` while
    // explaining what a signal is, and a check that matched documentation would prove nothing.
    const code = readFileSync(join(ROOT, "lib/experience/motion.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    // The module is pure: it receives signals and returns a decision. It cannot reach a browser
    // global at all, so there is no user-agent string to sniff in the first place.
    expect(code).not.toMatch(/userAgent/);
    expect(code).not.toMatch(/\bnavigator\b/);
    expect(code).not.toMatch(/\bwindow\b/);
    expect(code).not.toMatch(/\bdocument\b/);
  });
});
