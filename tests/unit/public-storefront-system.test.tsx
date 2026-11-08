import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import BusinessPage from "@/components/BusinessPage";
import { THEMES } from "@/lib/themes";
import {
  AA_LARGE_MINIMUM,
  CATEGORY_ART,
  PLATFORM_IDENTITY,
  businessAccent,
  categoryArt,
  contrastRatio,
} from "@/lib/storefront/tokens";
import { accentForLegacyTheme, resolveHeroImage, storefrontThemeFor } from "@/lib/storefront/theme";
import { themeStyleVars } from "@/lib/experience/themes";
import { resolveExperienceTheme } from "@/lib/experience/themes";

const root = path.resolve(__dirname, "../..");

function renderPage(business: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return renderToStaticMarkup(
    createElement(BusinessPage, {
      business: {
        id: "b1",
        slug: "nyumbani-kitchen",
        name: "Nyumbani Kitchen",
        category: "Restaurant",
        theme: "clean",
        ...business,
      } as any,
      services: [],
      offer: null,
      theme: THEMES.clean,
      ...extra,
    } as any),
  );
}

describe("public storefront design system (§2, §3)", () => {
  it("keeps the JATA AFTERCALL identity — graphite structure, lime highlight, high-contrast type", () => {
    expect(PLATFORM_IDENTITY.graphite.toLowerCase()).toBe("#16181d");
    expect(PLATFORM_IDENTITY.lime.toLowerCase()).toBe("#b6ff2e");
    // Lime on graphite is the platform's own contrast promise; it must stay legible as large text.
    expect(contrastRatio(PLATFORM_IDENTITY.lime, PLATFORM_IDENTITY.graphite)).toBeGreaterThan(AA_LARGE_MINIMUM);
    expect(contrastRatio(PLATFORM_IDENTITY.text, PLATFORM_IDENTITY.graphite)).toBeGreaterThan(7);
  });

  it("honours a business accent only while it stays legible, and records why it did not", () => {
    expect(businessAccent("#ff8a3d").accepted).toBe(true);
    expect(businessAccent("#ff8a3d").accent).toBe("#ff8a3d");
    // Near-black on graphite: a real owner could pick this, and it must not be honoured.
    expect(businessAccent("#1a1a1a").accepted).toBe(false);
    expect(businessAccent("#1a1a1a").accent.toLowerCase()).toBe(PLATFORM_IDENTITY.lime.toLowerCase());
    // The reason is surfaced so a page can be honest about the substitution.
    expect(storefrontThemeFor({ accentHex: "#1a1a1a" }).accentFallbackReason).toBe("low-contrast");
    expect(storefrontThemeFor({ accentHex: "chartreuse" }).accentFallbackReason).toBe("invalid");
    expect(storefrontThemeFor({ accentHex: null }).accentFallbackReason).toBe("absent");
    expect(storefrontThemeFor({ accentHex: "#ff8a3d" }).accentFallbackReason).toBe("none");
    // Garbage, gradient strings and named colours are never trusted.
    for (const bad of ["", null, undefined, "red", "url(#gradient)", "#12345", "#gggggg"]) {
      expect(businessAccent(bad as string | null | undefined).accepted, String(bad)).toBe(false);
    }
  });

  it("gives each category its own art direction without leaving the platform", () => {
    const keys = ["restaurant", "beauty", "automotive"] as const;
    const tones = keys.map((key) => CATEGORY_ART[key].tone);
    expect(new Set(tones).size).toBe(keys.length); // not identical …
    const theme = storefrontThemeFor({ businessName: "Nyumbani Kitchen", category: "Restaurant" });
    expect(theme.tokens.colors.bg).toContain(PLATFORM_IDENTITY.graphite);
    expect(theme.art.key).toBe("restaurant");
    // … but every category still resolves onto the same graphite/lime foundation.
    for (const key of keys) {
      const t = storefrontThemeFor({ businessName: "Fixture", category: key });
      expect(t.tokens.colors.bg).toContain(PLATFORM_IDENTITY.graphite);
      expect(t.accent.toLowerCase()).toBe(PLATFORM_IDENTITY.lime.toLowerCase());
    }
    expect(categoryArt("Salon & Spa").key).toBe("beauty");
    expect(categoryArt("Auto garage").key).toBe("automotive");
    expect(categoryArt("Something else").key).toBe("general");
  });

  it("inherits a legacy business theme as an accent, never as a whole second design language", () => {
    expect(accentForLegacyTheme("warm")).toBe("#F0A04B");
    // clean/dark carry no accent of their own — they take the platform lime rather than inventing one.
    expect(accentForLegacyTheme("clean")).toBeNull();
    expect(accentForLegacyTheme("dark")).toBeNull();
    expect(storefrontThemeFor({ businessName: "X", category: "Retail", accentHex: accentForLegacyTheme("warm")! }).accent)
      .toBe("#f0a04b");
  });
});

describe("IMAGE IS EVERYTHING (§4)", () => {
  it("shows the business's own photography when the business supplied it", () => {
    const hero = resolveHeroImage({ coverUrl: "/uploads/nyumbani.jpg" })!;
    expect(hero.kind).toBe("business");
    const html = renderPage({}, { hero });
    expect(html).toContain("/uploads/nyumbani.jpg");
    // A business asset is the business's own: no illustrative-photography disclosure.
    expect(html).not.toContain("Illustrative photograph");
  });

  it("labels illustrative imagery as illustrative, never as the business's own", () => {
    const hero = resolveHeroImage({
      demoImage: { path: "/landing/nyumbani-kitchen.webp", alt: "A platter of grilled tilapia and ugali — illustrative photograph, not the restaurant's own." },
    })!;
    expect(hero.kind).toBe("illustrative");
    const html = renderPage({}, { hero });
    expect(html).toContain("/landing/nyumbani-kitchen.webp");
    expect(html).toContain("Illustrative photograph");
    // React escapes the apostrophe, so assert on the surrounding plain words.
    expect(html).toContain("not the business");
    expect(html).toContain("own. No payment is taken on this page.");
    expect(html).toContain("No payment is taken on this page");
  });

  it("renders an intentional identity fallback when there is no image at all — never an empty frame", () => {
    const html = renderPage({});
    expect(resolveHeroImage({ coverUrl: null, demoImage: null })).toBeNull();
    expect(html).toContain("st-hero__fallback");
    expect(html).toContain("NK"); // monogram
    expect(html).toContain("JATA AFTERCALL");
  });

  it("never accepts an unsafe or off-origin image URL", () => {
    for (const bad of ["javascript:alert(1)", "data:image/png;base64,AAAA", "http://example.com/x.jpg", "//evil.example/x.jpg", ""]) {
      expect(resolveHeroImage({ coverUrl: bad }), bad).toBeNull();
    }
    expect(resolveHeroImage({ coverUrl: "https://cdn.example.com/x.jpg" })?.path).toBe("https://cdn.example.com/x.jpg");
  });
});

describe("one cohesive page (§5, §7)", () => {
  it("renders every section through the shared shell, with one storefront stylesheet", () => {
    const html = renderPage({ phone: "0712345678", whatsapp: "0712345678" });
    expect(html).toContain("st-root");
    expect(html).toContain("st-hero");
    const sections = html.match(/class="st-section[ "]/g) || [];
    expect(sections.length).toBeGreaterThanOrEqual(3);
    // Loyalty 2.0 inherits the same system rather than shipping its own palette.
    expect(html).toContain("st-loyalty");
    expect(html).toContain("Loyalty Rewards");
    expect(html).toContain("Shop. Earn. Enjoy rewards.");
    expect(html).toContain("Powered by JATA AFTERCALL");
    // One stylesheet, imported once by the layout — not per-page CSS patches.
    const layout = readFileSync(path.join(root, "app/layout.tsx"), "utf8");
    expect(layout).toContain('import "./storefront.css"');
    expect(readFileSync(path.join(root, "app/globals.css"), "utf8")).not.toContain("--st-canvas");
  });

  it("keeps the contact and conversion actions on the storefront skin, with the business's own details", () => {
    const html = renderPage({ phone: "0712345678", whatsapp: "0712345678" });
    expect(html).toContain("st-action--whatsapp");
    expect(html).toContain("https://wa.me/254712345678");
    expect(html).toContain("tel:+254712345678");
    // No fixture contact details are baked into the shared components.
    for (const file of ["components/storefront/public/StoreHero.tsx", "components/storefront/public/StoreFooter.tsx"]) {
      expect(readFileSync(path.join(root, file), "utf8")).not.toMatch(/07\d{8}|2547\d{8}/);
    }
  });
});

describe("one source of truth across both public engines (§8)", () => {
  it("publishes the storefront tokens from the Experience theme too, with the same accent guard", () => {
    for (const key of ["ember", "clean", "noir", "lagoon"] as const) {
      const style = themeStyleVars(resolveExperienceTheme(key), null);
      expect(style["--st-canvas"], key).toBeTruthy();
      expect(style["--st-text"], key).toBeTruthy();
      // Whatever the palette, the published accent keeps at least large-text contrast on the page.
      const ratio = contrastRatio(style["--st-accent"], style["--st-canvas"]);
      expect(ratio === null || ratio >= AA_LARGE_MINIMUM, `${key} ${style["--st-accent"]}`).toBe(true);
    }
  });
});
