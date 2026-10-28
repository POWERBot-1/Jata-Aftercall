/**
 * Workspace design-system enforcement.
 *
 * The authenticated half of JATA AFTERCALL (dashboard, subscription, studio, POS, AI, account
 * and setup screens) has its own `ws-*` layer on top of the shared primitives. These tests make
 * that layer real rather than documented:
 *
 *   - every workspace token the components read is defined in app/globals.css;
 *   - the workspace palette is scoped to `.ws-shell`, so generated customer websites and the
 *     public landing page keep their own themes;
 *   - every photograph the dashboard can choose actually exists on disk, so no owner ever sees
 *     a broken image;
 *   - owner-supplied image URLs are validated before they are rendered;
 *   - the accessibility and reduced-motion contracts survive;
 *   - the pricing screen reads plans from the database instead of hard-coding a price.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CATEGORY_PHOTOS,
  WORKSPACE_HERO_PHOTO,
  WORKSPACE_PHOTOS,
  businessInitials,
  categoryLabel,
  photoForCategory,
  safeImageUrl,
} from "@/lib/workspaceImagery";

const root = path.resolve(__dirname, "../..");
const css = readFileSync(path.join(root, "app/globals.css"), "utf8");

function read(relative: string) {
  return readFileSync(path.join(root, relative), "utf8");
}

/** Files that make up the workspace presentation layer. */
const WORKSPACE_COMPONENTS = [
  "components/workspace/WorkspaceUI.tsx",
  "components/workspace/WorkspaceAuthShell.tsx",
  "components/DashboardNav.tsx",
  "components/DashboardClient.tsx",
  "app/dashboard/layout.tsx",
  "app/dashboard/page.tsx",
  "app/dashboard/subscription/page.tsx",
  "app/dashboard/studio/page.tsx",
  "app/dashboard/pos/page.tsx",
  "app/dashboard/ai/page.tsx",
  "app/login/page.tsx",
  "app/register/page.tsx",
  "app/onboarding/page.tsx",
];

describe("workspace design tokens", () => {
  const tokens = [
    "--ws-ink",
    "--ws-cream",
    "--ws-paper",
    "--ws-text",
    "--ws-muted",
    "--ws-line",
    "--ws-amber",
    "--ws-amber-deep",
    "--ws-jade",
    "--ws-on-ink",
    "--ws-display",
    "--ws-radius-sm",
    "--ws-radius-md",
    "--ws-radius-lg",
    "--ws-radius-xl",
    "--ws-elev-1",
    "--ws-elev-2",
    "--ws-elev-3",
    "--ws-dur",
    "--ws-ease",
  ];

  it("defines every workspace token in the stylesheet", () => {
    for (const token of tokens) {
      expect(css, token).toMatch(new RegExp(`${token}\\s*:`));
    }
  });

  it("scopes the workspace palette to .ws-shell instead of :root", () => {
    // The storefront, checkout and public business pages own their palettes. A global
    // `--ws-*` declaration would leak the workspace look into them.
    const rootBlocks = css.match(/:root\s*\{[^}]*\}/g) ?? [];
    for (const block of rootBlocks) expect(block).not.toContain("--ws-ink");
    expect(css).toMatch(/\.ws-shell\s*\{[^}]*--ws-ink/);
  });

  it("keeps the shared primitives bridged onto the workspace palette", () => {
    const shell = css.match(/\.ws-shell\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    for (const bridge of ["--jata-paper: var(--ws-cream)", "--jata-card: var(--ws-paper)", "--jata-line: var(--ws-line)", "--jata-ink: var(--ws-text)"]) {
      expect(shell, bridge).toContain(bridge);
    }
  });

  it("defines the workspace surfaces the components use", () => {
    for (const selector of [".ws-chrome", ".ws-rail", ".ws-hero", ".ws-biz", ".ws-stat", ".ws-plan", ".ws-door", ".ws-editor", ".ws-auth", ".ws-empty", ".ws-skel"]) {
      expect(css, selector).toContain(selector);
    }
  });

  it("follows the owner's appearance choice with a graphite workspace variant", () => {
    // The default product theme is graphite; the workspace must not contradict a choice the
    // owner already made in the appearance picker.
    expect(css).toContain('.product-theme-root[data-product-theme="lime-spark"] .ws-shell');
    expect(css).toContain('html[data-jata-theme="lime-spark"] .ws-shell');
    const dark = css.slice(css.indexOf('The workspace has one art direction'));
    for (const token of ["--ws-cream:", "--ws-paper:", "--ws-text:", "--ws-muted:", "--ws-line:", "--ws-solid:"]) {
      expect(dark, token).toContain(token);
    }
    // Nothing in the dark variant may fall back to a light card background.
    expect(dark).not.toContain("--ws-paper: #fff");
  });

  it("never paints ink-surface text with the page-background token", () => {
    // Regression guard: `--ws-cream` is the *background* and the graphite variant repoints it to
    // #171412. Using it as a foreground made the dashboard hero render its headline dark-on-dark.
    // Light text on an ink surface must go through `--ws-on-ink`, which no variant redefines.
    const shell = css.match(/\.ws-shell\s*\{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(shell).toContain("--ws-on-ink: #f7f2e8;");
    const graphite = css.slice(css.indexOf('The workspace has one art direction'));
    expect(graphite.slice(0, graphite.indexOf("/* Semantic fills"))).not.toContain("--ws-on-ink:");
    for (const selector of [".ws-hero", ".ws-hero__title", ".ws-panel--graphite", ".ws-biz__name", ".ws-auth__aside"]) {
      const block = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{[^}]*\\}`))?.[0] ?? "";
      expect(block, selector).not.toMatch(/color:\s*var\(--ws-cream\)/);
    }
  });

  it("keeps every surface colour on a token so both variants share one rule set", () => {
    const shell = css.slice(css.indexOf("WORKSPACE DESIGN SYSTEM"));
    for (const literal of ["background: #fff;", "background: #ffffff;", "background: #fffdf8;"]) {
      expect(shell, literal).not.toContain(literal);
    }
    for (const token of ["--ws-solid", "--ws-wash", "--ws-skel-shine", "--ws-plan-tint"]) {
      expect(shell, token).toContain(token);
    }
  });

  it("keeps motion opt-out for every workspace transition", () => {
    const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)", css.indexOf(".ws-shell")));
    expect(reduced).toContain(".ws-hero__media img");
    expect(reduced).toContain(".ws-skel::after");
  });

  it("keeps the section rail scrollable rather than overflowing the page", () => {
    const rail = css.match(/\.ws-rail\s*\{[^}]*\}/)?.[0] ?? "";
    expect(rail).toContain("overflow-x: auto");
    expect(css).toContain(".ws-shell :where(ul, ol) { padding: 0; list-style: none; }");
  });

  it("keeps the workspace stack and rail wrapper from widening the page on phones", () => {
    // Real-Chrome evidence (PR #69 six-viewport capture, 320–430px): the implicit auto grid
    // track on .ws-stack honoured the min-content of hero surfaces and the AI Front Desk snap
    // stepper, pushing documentElement.scrollWidth past the viewport. The track needs a zero
    // minimum; the rail wrapper must clip rather than propagate the rail's scroll overflow.
    const stack = css.match(/\.ws-stack\s*\{[^}]*\}/)?.[0] ?? "";
    expect(stack).toContain("grid-template-columns: minmax(0, 1fr)");
    const railWrap = css.match(/\.ws-rail-wrap\s*\{[^}]*\}/)?.[0] ?? "";
    expect(railWrap).toContain("overflow-x: clip");
  });
});

describe("workspace imagery", () => {
  const all: Array<[string, { src: string; srcSet?: string; webp?: string; webpSrcSet?: string }]> = [
    ...Object.entries(CATEGORY_PHOTOS),
    ...Object.entries(WORKSPACE_PHOTOS),
    ["hero", WORKSPACE_HERO_PHOTO],
  ];

  it("ships every photograph it can render", () => {
    for (const [name, photo] of all) {
      for (const url of [photo.src, photo.webp]) {
        if (!url) continue;
        expect(existsSync(path.join(root, "public", url)), `${name}: ${url}`).toBe(true);
      }
      for (const set of [photo.srcSet, photo.webpSrcSet]) {
        if (!set) continue;
        for (const entry of set.split(",")) {
          const url = entry.trim().split(/\s+/)[0];
          expect(existsSync(path.join(root, "public", url)), `${name}: ${url}`).toBe(true);
        }
      }
    }
  });

  it("offers a WebP and a JPEG for every photograph, so no browser is left without one", () => {
    for (const [name, photo] of all) {
      expect(photo.src, name).toMatch(/\.jpg$/);
      expect(photo.webp, name).toMatch(/\.webp$/);
    }
  });

  it("gives every photograph an honest, non-empty description", () => {
    for (const [name, photo] of all) {
      const alt = (photo as { alt?: string }).alt;
      expect(alt, name).toBeTruthy();
      expect((alt ?? "").length, name).toBeGreaterThan(15);
      // A category illustration must not pretend to be the owner's own photograph or a result.
      expect(alt, name).toMatch(/illustrative|Nairobi/i);
    }
  });

  it("maps stored categories, aliases and free text without ever failing", () => {
    expect(photoForCategory("beauty").src).toBe(CATEGORY_PHOTOS.beauty.src);
    expect(photoForCategory("Beauty & Salon").src).toBe(CATEGORY_PHOTOS.beauty.src);
    expect(photoForCategory("Restaurant").src).toBe(CATEGORY_PHOTOS.food.src);
    expect(photoForCategory("Hardware & electrical").src).toBe(CATEGORY_PHOTOS.technical.src);
    expect(photoForCategory("").src).toBe(CATEGORY_PHOTOS.other.src);
    expect(photoForCategory(null).src).toBe(CATEGORY_PHOTOS.other.src);
    expect(photoForCategory("Something nobody has ever categorised").src).toBe(CATEGORY_PHOTOS.other.src);
  });

  it("rejects unsafe owner-supplied image URLs", () => {
    expect(safeImageUrl("https://res.cloudinary.com/x/y.jpg")).toBe("https://res.cloudinary.com/x/y.jpg");
    expect(safeImageUrl("/uploads/cover.webp")).toBe("/uploads/cover.webp");
    expect(safeImageUrl("data:image/png;base64,iVBORw0KGgo=")).toBe("data:image/png;base64,iVBORw0KGgo=");
    expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    expect(safeImageUrl("//evil.example/x.jpg")).toBeNull();
    expect(safeImageUrl("http://insecure.example/x.jpg")).toBeNull();
    expect(safeImageUrl("")).toBeNull();
    expect(safeImageUrl(null)).toBeNull();
  });

  it("derives a stable monogram and a human category label", () => {
    expect(businessInitials("Mary's Beauty Studio")).toBe("MB");
    expect(businessInitials("Nyumbani")).toBe("NY");
    expect(businessInitials("")).toBe("JA");
    expect(businessInitials("  ")).toBe("JA");
    expect(categoryLabel("beauty salon")).toBe("Beauty Salon");
    expect(categoryLabel(null)).toBe("Business");
  });
});

describe("workspace screens", () => {
  it("renders the shared workspace primitives on every owner surface", () => {
    expect(read("components/DashboardClient.tsx")).toContain("WorkspaceHero");
    for (const page of ["app/dashboard/subscription/page.tsx", "app/dashboard/studio/page.tsx", "app/dashboard/pos/page.tsx", "app/dashboard/ai/page.tsx"]) {
      const source = read(page);
      expect(source, page).toContain("WorkspaceHero");
      expect(source, page).toContain("workspaceImagery");
    }
  });

  it("shows every business state through the shared pill, never a raw enum", () => {
    const studio = read("app/dashboard/studio/page.tsx");
    const pos = read("app/dashboard/pos/page.tsx");
    for (const source of [read("components/DashboardClient.tsx"), studio, pos]) {
      expect(source).toContain("<StatusPill");
      expect(source).not.toMatch(/<td>\{[^}]*\.status\}/);
    }
  });

  it("keeps the account and setup screens on one shell", () => {
    for (const page of ["app/login/page.tsx", "app/register/page.tsx"]) {
      expect(read(page), page).toContain("WorkspaceAuthShell");
    }
    expect(read("app/onboarding/page.tsx")).toContain("WorkspaceSetupShell");
    expect(read("components/workspace/WorkspaceAuthShell.tsx")).toContain('<main id="main"');
  });

  it("keeps one main landmark and no nested navigation inside the AI cockpit", () => {
    const aiPage = read("app/dashboard/ai/page.tsx");
    expect(aiPage).not.toContain('<main id="main">');
    const cockpit = read("components/AIDashboardClient.tsx");
    expect(cockpit).not.toContain("DashboardNav");
    expect(cockpit).not.toContain("min-h-screen");
  });

  it("reads plan prices from the database and never writes one into the page", () => {
    const subscription = read("app/dashboard/subscription/page.tsx");
    expect(subscription).toContain("publiclyListedPlans");
    expect(subscription).toContain("plan.priceKES");
    for (const price of ["149", "999", "499"]) {
      expect(subscription, `hard-coded price ${price}`).not.toMatch(new RegExp(`KES\\s*${price}\\b`));
    }
  });

  it("keeps the dashboard free of fabricated performance figures", () => {
    const dashboard = read("components/DashboardClient.tsx");
    // Metrics arrive from the server; the client never seeds a number of its own.
    expect(dashboard).toContain("EMPTY_METRICS");
    expect(dashboard).toContain("metricsMap[business.id]");
    expect(dashboard).not.toMatch(/views:\s*[1-9]/);
  });

  it("keeps the shell's skip link, single main landmark and toast surface", () => {
    const layout = read("app/dashboard/layout.tsx");
    expect(layout).toContain('href="#main"');
    expect(layout).toContain('<main id="main"');
    expect(layout).toContain("<Toaster />");
    expect(layout).toContain("ws-shell");
  });

  it("keeps the design-preview route development-only and clearly labelled", () => {
    const preview = read("app/dev/workspace-preview/page.tsx");
    // Same convention as the repository's other /dev previews: a production build 404s it.
    expect(preview).toContain('if (process.env.NODE_ENV === "production") notFound();');
    expect(preview).toContain("synthetic sample data");
    expect(preview).toContain("robots: { index: false, follow: false }");
    // It renders the real components, never a parallel hand-built mockup.
    for (const primitive of ["DashboardClient", "PlanCard", "WorkspaceDoor", "WorkspaceHero"]) {
      expect(preview, primitive).toContain(primitive);
    }
  });

  it("does not reintroduce alert() dialogs or full-page reloads in the workspace", () => {
    for (const file of WORKSPACE_COMPONENTS) {
      const source = read(file);
      expect(source, file).not.toMatch(/\balert\(/);
      expect(source, file).not.toContain("location.reload");
    }
  });
});
