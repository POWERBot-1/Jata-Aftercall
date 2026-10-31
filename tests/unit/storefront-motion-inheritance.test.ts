import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { describe, expect, it } from "vitest";
import { TEMPLATE_FAMILY_KEYS } from "@/lib/experience/templateFamilies";
import { familyFixture } from "@/app/dev/motion-preview/fixture";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";

const router = { bfcacheId: "motion-test", push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
function pages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => entry.isDirectory() ? pages(join(dir, entry.name)) : entry.name === "page.tsx" ? [join(dir, entry.name)] : []);
}

describe("storefront motion integration contract (SSR, not browser evidence)", () => {
  it.each(TEMPLATE_FAMILY_KEYS)("%s retains its generated branding and exactly one shared controller", (family) => {
    const data = familyFixture(family, "motion");
    const original = JSON.stringify({ brand: data.document.brand, settings: data.document.settings, sections: data.document.sections });
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(ExperienceSite, { data })));
    expect((html.match(/data-motion-probe=""/g) || [])).toHaveLength(1);
    expect(html).toContain(`data-template-family="${family}"`);
    expect(html).toContain("Fresh coastal dishes");
    expect(html).toContain("KES 149");
    expect(JSON.stringify({ brand: data.document.brand, settings: data.document.settings, sections: data.document.sections })).toBe(original);
    if (data.theme.treatment.motion === "none") expect(html).not.toContain('data-motion-recipe=');
    else expect(html).toContain('data-motion-recipe=');
  });
  it("detects new business pages that bypass the shell or an explicitly audited exception", () => {
    const root = "app/b/[slug]";
    const exceptions: Record<string, string[]> = {
      "app/b/[slug]/page.tsx": ["ExperienceSite", "BusinessPage"],
      // AI uses a separate entitlement-gated renderer and does not yet inherit this controller.
      "app/b/[slug]/ai/page.tsx": ["AIFrontDeskCustomerClient"],
    };
    for (const file of pages(root)) {
      const source = readFileSync(file, "utf8");
      if (exceptions[file]) for (const required of exceptions[file]) expect(source, file).toContain(required);
      else {
        expect(source, `${file} bypasses StorefrontShell and requires explicit review`).toContain("<StorefrontShell");
        expect(source, `${file} must declare a restrained section recipe or be explicitly audited`).toContain('data-motion-recipe="fade"');
      }
    }
    const shell = readFileSync("components/storefront/StorefrontShell.tsx", "utf8");
    const classic = readFileSync("components/BusinessPage.tsx", "utf8");
    expect(shell).toContain("<RenderModeProbe");
    expect(classic).toContain("<RenderModeProbe");
    expect(classic).toContain('data-motion-recipe="fade"');
  });
});
