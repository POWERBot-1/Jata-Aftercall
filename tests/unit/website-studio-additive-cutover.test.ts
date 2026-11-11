import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Additive Website Studio invariant.
 *
 * OpenPage is the primary AI generation experience, but it is not yet a proven
 * replacement for the owner's existing design, recipe, publishing, health and
 * enquiry controls. The legacy owner surfaces therefore stay mounted until an
 * independently evidenced parity review authorises their removal.
 *
 * These assertions deliberately check the mounted components, not only links:
 * a redirect to /studio would satisfy a navigation-only test while silently
 * deleting the owner's editing workflow.
 */
function source(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

describe("Website Studio additive cutover", () => {
  it("keeps the owner home panels and the publish anchor mounted", () => {
    const home = source("app/dashboard/businesses/[id]/page.tsx");
    expect(home).toContain('id="publish"');
    expect(home).toContain("<PublishPanel");
    expect(home).toContain("<WebsiteHealth");
    expect(home).toContain("<EnquiryBoard");
    expect(home).toContain("<CreateExperienceForm");
    expect(home).toContain("AI Website Studio");
  });

  it("keeps the legacy Design editor with its brand controls mounted", () => {
    const design = source("app/dashboard/businesses/[id]/design/page.tsx");
    expect(design).toContain("<DesignPanel");
    expect(design).not.toMatch(/redirect\(`\/dashboard\/businesses\/\$\{id\}\/studio`\)/);
    const panel = source("components/dashboard/DesignPanel.tsx");
    expect(panel).toContain("One line about your business");
    expect(panel).toContain('type="color"');
  });

  it("keeps the legacy Sections editor and business-recipe controls mounted", () => {
    const sections = source("app/dashboard/businesses/[id]/sections/page.tsx");
    expect(sections).toContain("<SectionEditor");
    expect(sections).not.toMatch(/redirect\(`\/dashboard\/businesses\/\$\{id\}\/studio`\)/);
    const editor = source("components/dashboard/SectionEditor.tsx");
    expect(editor).toContain('aria-label="Recipe layout"');
    expect(editor).toContain("businessRecipe");
  });

  it("keeps every supported legacy Studio tab and the OpenPage tab", () => {
    const tabs = source("components/dashboard/StudioTabs.tsx");
    for (const path of ["${base}/studio", "${base}/canvas", "${base}/sections", "${base}/create", "${base}/design", "${base}#publish"]) {
      expect(tabs).toContain(path);
    }
  });

  it("makes OpenPage the primary entry without removing the classic workspace", () => {
    const chooser = source("app/dashboard/studio/page.tsx");
    expect(chooser).toContain("Open AI Website Studio");
    expect(chooser).toContain("Business home &amp; classic tools");
    const openPage = source("components/studio/openpage/WebsiteStudio.tsx");
    expect(openPage).toContain("Classic editor");
  });
});
