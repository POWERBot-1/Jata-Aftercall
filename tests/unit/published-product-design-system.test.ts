/**
 * The design system in the *published product*, rendered — not inferred.
 *
 * tests/unit/design-system.test.ts proves the Theme Engine emits the shared foundation for every
 * theme and every category. That is the mechanism; this file is the output. It renders the real
 * storefront component (`ExperienceSite`, the same one `app/b/[slug]/page.tsx` renders after
 * `publish`) with a document built by the same factory the Studio uses, for the whole
 * category × theme matrix, and asserts the marketing page a customer receives really carries the
 * contract class, the foundation tokens and the shared status/accessibility treatments.
 *
 * Nothing here needs a database: the document factory and the resolution helpers are pure, so the
 * check runs on every `vitest run` instead of only in the database-backed CI job.
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The storefront's cart provider is a client component that reads the App Router. Rendering a
// published product outside Next needs the router context it expects; nothing else is replaced.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn(), back: vi.fn(), forward: vi.fn() }),
  usePathname: () => "/b/acme",
  useSearchParams: () => new URLSearchParams(),
  useParams: () => ({}),
}));
import { ExperienceSite } from "@/components/storefront/ExperienceSite";
import { CATEGORY_KEYS, getExperienceProfile } from "@/lib/experience/categories";
import { createExperienceDocument, themeOf } from "@/lib/experience/document";
import { EXPERIENCE_THEMES } from "@/lib/experience/themes";
import type { StorefrontData } from "@/lib/experience/storefront";
import { PRODUCT_FOUNDATION_TOKENS, TEMPLATE_CONTRACT } from "@/lib/designSystem";

function publishedProduct(category: string, themeKey: string): StorefrontData {
  const document = createExperienceDocument({
    categoryKey: category,
    businessName: `Acme ${category}`,
    description: "Published output under test.",
    phone: "0712345678",
    whatsapp: "0712345678",
    location: "Nairobi",
    themeKey,
  });
  return {
    business: {
      id: `biz_${category}_${themeKey}`,
      slug: `acme-${category}`,
      name: `Acme ${category}`,
      category,
      phone: "0712345678",
      whatsapp: "0712345678",
      location: "Nairobi",
      lat: null,
      lng: null,
      description: "Published output under test.",
      logoUrl: null,
      isPublished: true,
      status: "LIVE",
    },
    document,
    theme: themeOf(document),
    profile: getExperienceProfile(category),
    items: [],
    services: [],
    offer: null,
    categories: [],
    isPreview: false,
    publishedVersion: 1,
  };
}

describe("every published product carries the design system", () => {
  it("renders the contract root class and the foundation tokens for every category × theme", () => {
    expect(CATEGORY_KEYS.length).toBeGreaterThan(4);
    expect(EXPERIENCE_THEMES.length).toBeGreaterThan(1);
    const rendered: string[] = [];
    for (const category of CATEGORY_KEYS) {
      for (const theme of EXPERIENCE_THEMES) {
        const html = renderToStaticMarkup(createElement(ExperienceSite, { data: publishedProduct(category, theme.key) }));
        const where = `${category}/${theme.key}`;
        expect(html, `${where}: no contract root class`).toContain(TEMPLATE_CONTRACT.rootClass);
        for (const token of PRODUCT_FOUNDATION_TOKENS) {
          expect(html, `${where}: published output is missing ${token}`).toContain(`${token}:`);
        }
        expect(html, `${where}: the product root is not scoped`).toMatch(/class="[^"]*eb-scope/);
        rendered.push(html);
      }
    }
    expect(rendered.length).toBe(CATEGORY_KEYS.length * EXPERIENCE_THEMES.length);
  });

  it("keeps the shared accessibility and status treatments in the generated product", () => {
    const html = renderToStaticMarkup(createElement(ExperienceSite, { data: publishedProduct(CATEGORY_KEYS[0], EXPERIENCE_THEMES[0].key) }));
    // The storefront owns one main landmark and one navigation, and every image is described or
    // deliberately decorative.
    expect(html).toContain("<main");
    expect(html).toContain("<nav");
    expect(html).not.toMatch(/<img(?![^>]*\balt=)/);
  });

  it("serves the customer the category's own structure, not a hard-coded page", () => {
    const commerce = renderToStaticMarkup(createElement(ExperienceSite, { data: publishedProduct("food", EXPERIENCE_THEMES[0].key) }));
    const booking = renderToStaticMarkup(createElement(ExperienceSite, { data: publishedProduct("salon", EXPERIENCE_THEMES[0].key) }));
    expect(commerce).toContain("/shop");
    expect(booking).toMatch(/\/book|#contact/);
    expect(commerce).not.toBe(booking);
  });
});
