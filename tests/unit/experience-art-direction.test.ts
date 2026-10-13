import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { describe, expect, it } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument, themeOf } from "@/lib/experience/document";
import { validateExperienceDocument, validateExperienceJson } from "@/lib/experience/schema";
import { getExperienceProfile, EXPERIENCE_PROFILES } from "@/lib/experience/categories";
import { buildArtDirectedCandidate, rankTemplateFamilies, parseDesignBrief } from "@/lib/experience/artDirector";
import { buildVariant, generateGatedVariant } from "@/lib/experience/variant";
import { fingerprintOf, similarity } from "@/lib/experience/diversity";
import { TEMPLATE_FAMILIES, TEMPLATE_FAMILY_KEYS, familyGeometrySignature, templateForDocument, sectionLayout } from "@/lib/experience/templateFamilies";
import { ExperienceSite } from "@/components/storefront/ExperienceSite";
import { motionFixture } from "@/app/dev/motion-preview/fixture";

const router = { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
const base = () => createExperienceDocument({ categoryKey: "food", businessName: "Owner facts, never generated", phone: "0712345678", location: "Owner-supplied address" });
function factualSections(doc: ReturnType<typeof base>) { return doc.sections.map(({ layout, ...content }) => content).sort((a, b) => a.id.localeCompare(b.id)); }

describe("registered compositional library", () => {
  it("contains exactly all20 specified families with unique multi-axis geometry, not palette labels", () => {
    expect(TEMPLATE_FAMILIES).toHaveLength(20);
    expect(TEMPLATE_FAMILIES.map((family) => family.key)).toEqual([...TEMPLATE_FAMILY_KEYS]);
    expect(new Set(TEMPLATE_FAMILIES.map(familyGeometrySignature)).size).toBe(20);
    for (const family of TEMPLATE_FAMILIES) {
      expect(family.flow).not.toContain("hero"); expect(family.flow).not.toContain("navigation"); expect(family.flow).not.toContain("contact");
      expect(new Set(family.flow).size).toBe(family.flow.length);
    }
  });
  it.each(TEMPLATE_FAMILY_KEYS)("%s has a valid explicit v2 composition and SSR renderer without commercial rewrites", (family) => {
    const data = motionFixture("lite");
    const doc = buildArtDirectedCandidate(data.document, "fixture:exact", { family, brief: { goal: "enquire" }, counts: { products: 6, services: 0 } }).document;
    expect(validateExperienceDocument(doc).ok).toBe(true);
    expect(doc.brand).toEqual(data.document.brand); expect(doc.settings).toEqual(data.document.settings);
    expect(factualSections(doc)).toEqual(factualSections(data.document));
    expect(validateExperienceJson(JSON.stringify(doc)).ok).toBe(true);
    const restored = normalizeExperienceDocument(JSON.parse(JSON.stringify(doc)));
    expect(restored.artDirection).toEqual(doc.artDirection);
    const html = renderToStaticMarkup(createElement(AppRouterContext.Provider, { value: router }, createElement(ExperienceSite, { data: { ...data, document: doc } })));
    expect(html).toContain(`data-template-family="${family}"`);
    expect(html).toContain("Fresh coastal dishes"); expect(html).toContain("KES 149"); expect(html).toContain("/b/motion-fixture/shop");
    expect(html).toContain('href="tel:'); expect(html).toContain('href="https://wa.me/'); expect(html).not.toContain("<canvas");
    expect(html).not.toMatch(/style="[^"]*opacity:0(?:;|")/);
  });
  it("keeps v1/default legacy normalization unmodified and never silently upgrades it", () => {
    const doc = base(); expect(doc.version).toBe(1); expect(doc.artDirection).toBeUndefined();
    expect(normalizeExperienceDocument(doc)).toEqual(doc);
    expect(normalizeExperienceDocument({ ...doc, version: undefined }).version).toBe(1);
    expect(templateForDocument(doc)).toBeNull();
    expect(validateExperienceDocument({ ...doc, artDirection: { version: 1, family: "minimal" } }).ok).toBe(false);
  });
});

describe("raw v2 boundary is fail closed", () => {
  it("rejects missing recipe, unknown outer/recipe versions, invalid family/goal and executable/prototype fields", () => {
    const doc = buildArtDirectedCandidate(base(), "biz:boundary").document;
    for (const patch of [
      { version: 3 }, { artDirection: undefined }, { artDirection: { ...doc.artDirection, version: 2 } },
      { artDirection: { ...doc.artDirection, family: "unknown-canvas" } }, { artDirection: { ...doc.artDirection, goal: "run-js" } },
      { artDirection: { ...doc.artDirection, shader: "alert(1)" } }, { artDirection: { ...doc.artDirection, audience: "<script>" } },
      { sections: doc.sections.map((section) => ({ ...section, layout: "raw-css" })) },
    ]) expect(validateExperienceDocument({ ...doc, ...patch }).ok).toBe(false);
    const raw = JSON.parse(JSON.stringify(doc)); raw.artDirection.__proto__ = null;
    Object.defineProperty(raw.artDirection, "constructor", { value: "hostile", enumerable: true });
    expect(validateExperienceDocument(raw).ok).toBe(false);
    expect(() => normalizeExperienceDocument({ ...doc, version: 3 })).toThrow();
  });
  it("rejects unsupported goal flows for a category, regardless of a client plan", () => {
    const doc = buildArtDirectedCandidate(base(), "biz:goal").document;
    expect(validateExperienceDocument({ ...doc, artDirection: { ...doc.artDirection, goal: "book" } }).ok).toBe(false);
    expect(() => buildArtDirectedCandidate(base(), "biz:bad", { brief: { goal: "book" } })).toThrow();
  });
  it("cannot migrate missing defaults into a new/invalid v2 recipe", () => {
    expect(validateExperienceJson(JSON.stringify({ version: 2, categoryKey: "food" }), "food", { migrateLegacyDefaults: true }).ok).toBe(false);
  });
  it("only permits a bounded enum design brief, never executable instructions or client catalogue claims", () => {
    expect(parseDesignBrief({ goal: "sell", audience: "local" })).toEqual({ goal: "sell", audience: "local" });
    for (const input of ["script", null, { goal: "javascript:alert(1)" }, { products: [{ price: 1 }] }, { provider: "activate" }, JSON.parse('{"__proto__":{"owner":"foreign"}}')]) expect(() => parseDesignBrief(input)).toThrow();
  });
});

describe("content/intent-led reasoning and structural novelty", () => {
  it("reproduces the full document/reasons from identical safe inputs; source is never mutated", () => {
    const doc = base(), before = JSON.stringify(doc);
    const a = buildArtDirectedCandidate(doc, "owner:A", { brief: { personality: "premium", audience: "premium" }, counts: { products: 8, services: 0 } });
    expect(buildArtDirectedCandidate(doc, "owner:A", { brief: { personality: "premium", audience: "premium" }, counts: { products: 8, services: 0 } })).toEqual(a);
    expect(JSON.stringify(doc)).toBe(before);
  });
  it("changes actual structures for same-category seeds, not just generation labels", () => {
    const doc = base();
    const plans = Array.from({ length: 30 }, (_, index) => buildVariant(doc, `biz-${index}:1`).document);
    const geometries = new Set(plans.map((plan) => JSON.stringify(fingerprintOf(plan))));
    expect(geometries.size).toBeGreaterThan(3);
    expect(new Set(plans.map((plan) => plan.artDirection.family)).size).toBeGreaterThan(3);
  });
  it("food and salon objectives rank different coherent compositions", () => {
    const salon = createExperienceDocument({ categoryKey: "salon", businessName: "A" });
    expect(rankTemplateFamilies(salon, { goal: "book" }, { products: 0, services: 4 })[0].family.key).toBe("service-journey");
    expect(rankTemplateFamilies(base(), { goal: "sell" }, { products: 20, services: 0 })[0].family.key).not.toBe("service-journey");
  });
  it("uses existing image/location/product readiness instead of inventing content or calling providers", () => {
    const noMedia = base(); const gallery = rankTemplateFamilies(noMedia).find((entry) => entry.family.key === "gallery");
    expect(gallery.reasons.some((reason) => reason.code === "missing-gallery-content" && reason.contribution < 0)).toBe(true);
    const noLocation = { ...noMedia, settings: { ...noMedia.settings, location: undefined } };
    expect(rankTemplateFamilies(noLocation).find((entry) => entry.family.key === "map-driven").score).toBeLessThan(rankTemplateFamilies(noMedia).find((entry) => entry.family.key === "map-driven").score);
  });
  it("rejects exact/recolour-only duplicates; actual composition changes affect the metric", () => {
    const a = buildVariant(base(), "biz:one").document;
    const recolour = { ...a, brand: { ...a.brand, primaryColor: "#112233", accentColor: "#eedd44" } };
    expect(similarity(fingerprintOf(a), fingerprintOf(recolour))).toBe(1);
    const b = buildArtDirectedCandidate(a, "biz:two", { family: "experimental" }).document;
    expect(similarity(fingerprintOf(a), fingerprintOf(b))).toBeLessThan(0.85);
  });
  it("compares current and owner history with bounded retry; no-history is not a global uniqueness guarantee", () => {
    const doc = base(); const first = generateGatedVariant({ document: doc, baseSeed: "biz:same", recent: [] });
    const next = generateGatedVariant({ document: doc, baseSeed: "biz:same", recent: [first.document] });
    expect(next.attempts[0].ok).toBe(false); expect(next.attempts.length).toBeGreaterThan(1); expect(next.attempts.length).toBeLessThanOrEqual(5);
    expect(first.history.limitation).toBeTruthy(); expect(next.history.publishedCompared).toBe(1);
  });
  it("honours explicit editor layout overrides after choosing a family", () => {
    const plan = buildArtDirectedCandidate(base(), "biz:layout", { family: "cinematic" }).document;
    const section = plan.sections.find((item) => item.type === "featured");
    expect(sectionLayout(section, plan.artDirection)).toBe("spotlight");
    expect(sectionLayout({ ...section, layout: "list" }, plan.artDirection)).toBe("list");
  });
});
