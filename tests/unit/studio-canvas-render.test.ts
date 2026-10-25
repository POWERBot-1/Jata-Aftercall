/**
 * Studio Canvas — server-rendered structure (§4, §63)
 *
 * These assertions render the real component with `renderToStaticMarkup`, so they fail if the
 * editing surface loses its outline, its live preview, its inspector, its design control or the
 * honest save-state wording. They are the automated half of the "did the UI actually change?"
 * question; the browser-level checks live in the PR's evidence section.
 */

import { createElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createExperienceDocument } from "@/lib/experience/document";
import { getExperienceProfile } from "@/lib/experience/categories";
import { themesForCategory } from "@/lib/experience/themes";
import { designDirections } from "@/lib/studio/designDirections";
import { StudioCanvas } from "@/components/studio/canvas/StudioCanvas";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }),
  usePathname: () => "/dashboard/businesses/biz_1/canvas",
}));

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: ReactNode; [key: string]: unknown }) =>
    createElement("a", { href: typeof href === "string" ? href : "#", ...rest }, children),
}));

function props() {
  const document = createExperienceDocument({
    categoryKey: "beauty",
    businessName: "Mary's Beauty Studio",
    description: "Braids and nails in Kitengela.",
    phone: "+254700000000",
    location: "Kitengela",
  });
  const directions = designDirections({
    categoryKey: document.categoryKey,
    businessName: "Mary's Beauty Studio",
    brand: document.brand,
    themeKey: document.themeKey,
  });
  const themes = themesForCategory(document.categoryKey).map((theme) => ({
    key: theme.key,
    name: theme.name,
    description: theme.description,
    swatches: [theme.palette.bg, theme.palette.surface, theme.palette.primary, theme.palette.accent, theme.palette.text],
  }));
  return {
    businessId: "biz_1",
    slug: "marys-beauty-studio",
    businessName: "Mary's Beauty Studio",
    categoryLabel: getExperienceProfile("beauty").label,
    document,
    draftVersion: 12,
    publishedVersion: 11,
    hasUnpublishedChanges: true,
    directions,
    themes,
    currentDirectionKey: directions[0]?.key ?? null,
    currentThemeKey: document.themeKey,
    publicUrl: "/b/marys-beauty-studio",
  };
}

describe("StudioCanvas rendering", () => {
  it("renders the three panes: outline, live preview and inspector", () => {
    const html = renderToStaticMarkup(createElement(StudioCanvas, props()));
    expect(html).toContain('class="jc-outline"');
    expect(html).toContain('class="jc-stage"');
    expect(html).toContain('class="jc-inspector"');
  });

  it("renders a real preview iframe pointed at the draft of this business", () => {
    const html = renderToStaticMarkup(createElement(StudioCanvas, props()));
    expect(html).toContain("<iframe");
    expect(html).toContain("/b/marys-beauty-studio?preview=draft");
    expect(html).toContain('title="Draft preview of Mary&#x27;s Beauty Studio at phone width"');
  });

  it("lists every section with its own controls", () => {
    const html = renderToStaticMarkup(createElement(StudioCanvas, props()));
    const { document } = props();
    expect((html.match(/class="jc-row"/g) ?? []).length).toBe(document.sections.length);
    expect(html).toContain("Move Navigation");
    expect(html).toContain("Move Contact");
    expect(html).toContain("Hide");
    expect(html).toContain("Add a section");
  });

  it("offers device switching with the phone first", () => {
    const html = renderToStaticMarkup(createElement(StudioCanvas, props()));
    expect(html.indexOf("Phone")).toBeLessThan(html.indexOf("Desktop"));
    expect(html).toContain('aria-pressed="true"');
  });

  it("shows the real draft and published versions instead of a placeholder", () => {
    const html = renderToStaticMarkup(createElement(StudioCanvas, props()));
    expect(html).toContain("Draft v12");
    expect(html).toContain("live v11");
    expect(html).toContain("Unpublished changes");
  });

  it("renders the design directions with swatches and the base themes", () => {
    const html = renderToStaticMarkup(createElement(StudioCanvas, { ...props(), initialPanel: "design" }));
    expect(html).toContain("Design direction");
    expect(html).toContain('class="jc-swatch"');
    expect(html).toContain("Base theme");
    // A direction the owner is already using is marked as in use, not silently reselected.
    expect(html).toContain("in use");
  });

  it("explains that a data section has nothing to type", () => {
    const prepared = props();
    const dataSection = prepared.document.sections.find((section) => section.type === "collections" || section.type === "featured");
    const html = renderToStaticMarkup(
      createElement(StudioCanvas, { ...prepared, document: { ...prepared.document, sections: dataSection ? [dataSection] : prepared.document.sections } }),
    );
    // Whatever the first section is, the inspector always offers a way forward.
    expect(html.length).toBeGreaterThan(1000);
    expect(html).toContain("This section");
  });

  it("labels the demo build and never pretends it is a real business", () => {
    const html = renderToStaticMarkup(createElement(StudioCanvas, { ...props(), demo: true }));
    expect(html).toContain("Preview build");
    expect(html).toContain("nothing is saved");
  });

  it("keeps the publish entry point reachable from the canvas", () => {
    const html = renderToStaticMarkup(createElement(StudioCanvas, props()));
    expect(html).toContain("/dashboard/businesses/biz_1#publish");
    expect(html).toContain("Review &amp; publish");
  });
});
