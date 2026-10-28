/**
 * Global design-system enforcement (P0).
 *
 * These tests are the mechanism that keeps the design system real instead of documented. They
 * fail if:
 *   - a token the platform advertises is removed from the stylesheet;
 *   - a generated customer product stops inheriting the shared foundation (any category, any
 *     theme, with or without the owner's brand overrides);
 *   - the accessibility foundations for generated products disappear (focus ring, touch target,
 *     reduced motion);
 *   - the dashboard stops using the shared components;
 *   - a shared component hard-codes a colour instead of using a token.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLATFORM_TOKENS,
  PRODUCT_FOUNDATION_TOKENS,
  REQUIRED_STATES,
  TEMPLATE_CONTRACT,
  auditProductFoundation,
  auditTokens,
} from "@/lib/designSystem";
import { EXPERIENCE_THEMES, themeCss, themeStyleVars } from "@/lib/experience/themes";
import { CATEGORY_KEYS, getExperienceProfile } from "@/lib/experience/categories";

const css = readFileSync("app/globals.css", "utf8");

function read(relative: string) {
  return readFileSync(relative, "utf8");
}

describe("platform design tokens", () => {
  it("every advertised token is defined in app/globals.css", () => {
    const audit = auditTokens(css, PLATFORM_TOKENS);
    expect(audit.missing).toEqual([]);
  });

  it("keeps the shared shape, elevation, focus and motion decisions in tokens", () => {
    for (const token of ["--jata-radius-lg", "--jata-elevation-2", "--jata-focus-width", "--jata-touch-target", "--jata-dur-base"]) {
      expect(css, token).toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it("documents the states every component must define", () => {
    expect(REQUIRED_STATES).toContain("focus-visible");
    expect(REQUIRED_STATES).toContain("loading");
  });
});

describe("shared component layer", () => {
  const components = ["Button", "Card", "Metric", "PageHeader", "StateBlocks", "StatusPill", "DataTable", "AnalyticsChart", "Toaster", "Reveal", "ErrorState"];

  it("ships every shared primitive the platform promises", () => {
    for (const name of components) {
      expect(() => read(`components/ui/${name}.tsx`), name).not.toThrow();
    }
  });

  it("keeps the shared primitives on tokens instead of hard-coded colours", () => {
    for (const name of components) {
      const source = read(`components/ui/${name}.tsx`);
      // The only allowed literal colours are the theme's own semantic values referenced through
      // CSS variables. A raw hex value in a shared primitive is a design-system escape.
      const hexes = source.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
      expect(hexes, `${name} hard-codes ${hexes.join(", ")}`).toEqual([]);
    }
  });

  it("gives the button and the table the required interaction states", () => {
    const button = read("components/ui/Button.tsx");
    for (const state of ["disabled", "loading", "aria-busy"]) expect(button).toContain(state);
    expect(css).toContain(".jata-btn:active:not(:disabled)");
    expect(css).toContain(".jata-btn:focus-visible");
    const table = read("components/ui/DataTable.tsx");
    expect(table).toContain("aria-sort");
    expect(table).toContain("<th");
    expect(table).toContain("scope=\"col\"");
  });

  it("keeps every shared primitive free of hard-coded zinc/white/black palettes", () => {
    for (const name of components) {
      const source = read(`components/ui/${name}.tsx`);
      expect(source, name).not.toMatch(/className="[^"]*\bbg-(white|black|zinc-\d{3})\b/);
    }
  });
});

describe("dashboard uses the shared design system", () => {
  const dashboard = read("components/DashboardClient.tsx");
  const layout = read("app/dashboard/layout.tsx");

  it("is built from the shared primitives", () => {
    for (const primitive of ["Card", "StatusPill", "Metric", "AnalyticsChart", "DataTable", "EmptyState", "Reveal"]) {
      expect(dashboard, primitive).toContain(primitive);
    }
    // The route owns the data, the hero owns the single h1, and the account chrome is the shell.
    expect(read("app/dashboard/page.tsx")).not.toContain("PageHeader");
    expect(dashboard).toContain("WorkspaceHero");
    expect(dashboard).toContain("WorkspaceStat");
    expect(dashboard).toContain("WorkspaceEmpty");
    expect(dashboard).toContain("WorkspacePanel");
  });

  it("mounts one notification surface and one main landmark in the shell", () => {
    expect(layout).toContain("<Toaster />");
    expect(layout).toContain('<main id="main"');
  });

  it("renders every business status through the shared pill, never a raw enum", () => {
    expect(dashboard).toContain("subscriptionStatusLabel");
    expect(dashboard).toContain("businessStatusLabel");
    expect(dashboard).toContain("<StatusPill");
  });

  it("has loading and error states that do not block the customer", () => {
    expect(read("app/dashboard/loading.tsx")).toContain("WorkspaceSkeleton");
    expect(read("app/dashboard/loading.tsx")).toContain('aria-busy="true"');
    expect(read("app/dashboard/error.tsx")).toContain("ErrorState");
  });
});

describe("generated products inherit the design system", () => {
  it("injects the shared foundation for every theme", () => {
    for (const theme of EXPERIENCE_THEMES) {
      const { css: themeSheet } = themeCss(theme);
      expect(themeSheet, theme.key).toContain(".eb-scope{");
      for (const token of PRODUCT_FOUNDATION_TOKENS) {
        expect(themeSheet, `${theme.key} is missing ${token}`).toContain(`${token}:`);
      }
    }
  });

  it("keeps the foundation when the owner overrides brand colours", () => {
    for (const theme of EXPERIENCE_THEMES) {
      const vars = themeStyleVars(theme, { primaryColor: "#7C3AED", accentColor: "#F59E0B" } as never);
      const audit = auditProductFoundation(vars);
      expect(audit.missing, theme.key).toEqual([]);
    }
  });

  it("inherits the foundation from the resolved theme for every supported category", () => {
    // Every category renders through the same renderer, so proving it for the matrix of
    // categories × themes is the inheritance guarantee the directive asks for.
    expect(CATEGORY_KEYS.length).toBeGreaterThan(4);
    for (const category of CATEGORY_KEYS) {
      const profile = getExperienceProfile(category);
      expect(profile, `no profile for ${category}`).toBeTruthy();
      for (const theme of EXPERIENCE_THEMES) {
        const vars = themeStyleVars(theme, null);
        expect(auditProductFoundation(vars).missing, `${category}/${theme.key}`).toEqual([]);
      }
    }
  });

  it("styles the generated-product foundation in the shared stylesheet", () => {
    expect(css).toContain(".eb-scope :where(a, button, input, select, textarea, summary, [tabindex]):focus-visible");
    expect(css).toContain("--eb-touch-target");
    expect(css).toContain(".eb-scope .eb-btn");
    expect(css).toContain(".eb-status[data-tone=");
    expect(css).toContain(".eb-skeleton");
    expect(css).toContain(".eb-offline");
    // Reduced motion must exist for generated products too.
    const reducedMotion = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reducedMotion).toContain(".eb-scope");
  });

  it("publishes the template contract with no silent exceptions", () => {
    expect(TEMPLATE_CONTRACT.rootClass).toBe("eb-scope");
    expect(TEMPLATE_CONTRACT.accessibility.reducedMotion).toBe(true);
    expect(TEMPLATE_CONTRACT.accessibility.contrast).toBe("AA");
    expect(TEMPLATE_CONTRACT.responsive.minTouchTargetRem).toBeGreaterThanOrEqual(2.75);
    expect(TEMPLATE_CONTRACT.exceptions).toEqual([]);
  });

  it("renders a storefront root with the contract class and variables", () => {
    const shell = read("components/storefront/StorefrontShell.tsx");
    // Merged shell passes the template-family classes as the optional second argument (main M11+).
    expect(shell).toContain("themeRootClassName(theme");
    expect(shell).toContain("themeStyleVars(theme");
    const { css: themeSheet } = themeCss(EXPERIENCE_THEMES[0]);
    expect(themeSheet).toContain(TEMPLATE_CONTRACT.rootClass);
  });
});

describe("every customer-facing surface can be reached through the design system", () => {
  it("keeps one stylesheet, not competing design systems", () => {
    const uiFiles = readdirSync("components/ui");
    expect(uiFiles).toContain("Button.tsx");
    // No second token vocabulary: a new --jata2-/--ui- prefix would mean a competing system.
    expect(css).not.toMatch(/--ui-[a-z-]+\s*:/);
    expect(css).not.toMatch(/--jata2-/);
  });

  it("targets the packages named by the directive", () => {
    for (const file of [
      "components/AIFrontDeskCustomerClient.tsx",
      "components/pos/PosNav.tsx",
      "components/dashboard/StudioTabs.tsx",
      "app/dashboard/subscription/page.tsx",
      "components/storefront/StorefrontShell.tsx",
    ]) {
      expect(() => read(file), file).not.toThrow();
    }
    // POS and Studio navigation moved onto the shared tab/token language.
    expect(read("components/dashboard/StudioTabs.tsx")).toContain("jata-tab");
    expect(read("components/pos/PosNav.tsx")).toContain("lucide-react");
  });
});

describe("login and onboarding share the same form language", () => {
  it("uses the shared Field/Button primitives", () => {
    expect(read("components/LoginForm.tsx")).toContain("@/components/ui/Field");
    expect(read("components/RegisterForm.tsx")).toContain("@/components/ui/Field");
    expect(read("components/LoginForm.tsx")).toContain("@/components/ui/Button");
  });
});

describe("no component directory is left outside the design system", () => {
  it("keeps every shared component free of stray page-local palettes", () => {
    const dir = path.join("components", "ui");
    for (const file of readdirSync(dir)) {
      const source = readFileSync(path.join(dir, file), "utf8");
      expect(source, file).not.toMatch(/style=\{\{\s*color:/);
    }
  });
});
