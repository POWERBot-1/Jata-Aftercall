import { describe, expect, it } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";
import { themesForCategory } from "@/lib/experience/themes";
import { buildVariant, generateGatedVariant, layoutSummaryOf, MAX_VARIANT_ATTEMPTS } from "@/lib/experience/variant";
import type { ExperienceDocument } from "@/lib/experience/types";

function base(categoryKey = "food"): ExperienceDocument {
  const doc = createExperienceDocument({ categoryKey, businessName: "Mama Njeri Kitchen", phone: "0712345678", location: "Westlands" });
  return normalizeExperienceDocument(doc);
}

const PINNED = ["navigation", "hero", "contact"];

describe("seeded structural variants", () => {
  it("is deterministic: the same document and seed always produce the same candidate", () => {
    const doc = base();
    const first = buildVariant(doc, "biz-1:7").document;
    const second = buildVariant(doc, "biz-1:7").document;
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("changes the theme to another theme of the same category", () => {
    const doc = base();
    const themes = themesForCategory(doc.categoryKey).map((theme) => theme.key);
    expect(themes.length).toBeGreaterThan(1);
    const { document, change } = buildVariant(doc, "biz-1:7");
    expect(change.themeChanged).toBe(true);
    expect(document.themeKey).not.toBe(doc.themeKey);
    expect(themes).toContain(document.themeKey);
  });

  it("never changes business facts: brand, settings, category and every section's content", () => {
    const doc = base();
    const { document } = buildVariant(doc, "biz-2:3");
    expect(document.brand).toEqual(doc.brand);
    expect(document.settings).toEqual(doc.settings);
    expect(document.categoryKey).toBe(doc.categoryKey);
    const byId = (sections: typeof doc.sections) => new Map(sections.map((section) => [section.id, JSON.stringify(section)]));
    expect(byId(document.sections)).toEqual(byId(doc.sections));
    expect(document.sections.map((s) => s.id).sort()).toEqual(doc.sections.map((s) => s.id).sort());
  });

  it("keeps pinned sections in their slots", () => {
    const doc = base();
    const { document } = buildVariant(doc, "biz-3:9");
    doc.sections.forEach((section, index) => {
      if (PINNED.includes(section.type)) expect(document.sections[index].type).toBe(section.type);
    });
  });

  it("records provenance in a generation field, and that field survives normalisation", () => {
    const { document } = buildVariant(base(), "biz-4:1", 2);
    expect(document.generation).toEqual({ seed: "biz-4:1", version: 1, attempt: 2 });
    const reloaded = normalizeExperienceDocument(JSON.parse(JSON.stringify(document)));
    expect(reloaded.generation).toEqual(document.generation);
  });

  it("documents without a generation field are unchanged by normalisation (backward compatible)", () => {
    const legacy = base();
    expect(legacy.generation).toBeUndefined();
    expect("generation" in normalizeExperienceDocument(JSON.parse(JSON.stringify(legacy)))).toBe(false);
  });

  it("drops a malformed generation field instead of storing it", () => {
    const doc = normalizeExperienceDocument({ ...base(), generation: { seed: "<script>alert(1)</script>", version: "x" } });
    expect(doc.generation?.seed).toBe("scriptalert1script");
    const dropped = normalizeExperienceDocument({ ...base(), generation: { seed: 42 } });
    expect(dropped.generation).toBeUndefined();
  });

  it("does not mutate the input document", () => {
    const doc = base();
    const snapshot = JSON.stringify(doc);
    generateGatedVariant({ document: doc, baseSeed: "biz-5:2", recent: [] });
    expect(JSON.stringify(doc)).toBe(snapshot);
  });

  it("produces a readable layout summary without business facts", () => {
    const summary = layoutSummaryOf(base());
    expect(summary.startsWith("theme ")).toBe(true);
    expect(summary).not.toContain("Mama Njeri");
    expect(summary.length).toBeLessThanOrEqual(160);
  });
});

describe("diversity-gated generation", () => {
  it("accepts the first candidate when there is no recent history to clash with", () => {
    const result = generateGatedVariant({ document: base(), baseSeed: "biz-6:1", recent: [] });
    expect(result.accepted).toBe(true);
    expect(result.attempts).toHaveLength(1);
    expect(result.seed).toBe("biz-6:1");
  });

  it("is reproducible: the same stored draft and inputs return the same accepted candidate", () => {
    // One stored draft (section ids are fixed once saved), generated twice.
    const doc = base();
    const recent = [buildVariant(doc, "old-1").document];
    const a = generateGatedVariant({ document: doc, baseSeed: "biz-7:4", recent });
    const b = generateGatedVariant({ document: doc, baseSeed: "biz-7:4", recent });
    expect(a.accepted).toBe(b.accepted);
    expect(a.seed).toBe(b.seed);
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document));
  });

  it("regenerates with a derived seed when the first candidate is too similar", () => {
    const doc = base();
    const first = generateGatedVariant({ document: doc, baseSeed: "biz-8:1", recent: [] });
    // Recent history contains exactly the first candidate's structure, so the first attempt must be rejected.
    const result = generateGatedVariant({ document: doc, baseSeed: "biz-8:1", recent: [first.document], threshold: 0.99 });
    expect(result.attempts[0].ok).toBe(false);
    expect(result.attempts.length).toBeGreaterThan(1);
    expect(result.seed).not.toBe("biz-8:1");
  });

  it("stops after the bounded attempt budget and never loops forever", () => {
    const result = generateGatedVariant({ document: base(), baseSeed: "biz-9:1", recent: [], threshold: 0 });
    expect(result.accepted).toBe(false);
    expect(result.attempts).toHaveLength(MAX_VARIANT_ATTEMPTS);
    expect(result.document).toBeTruthy();
  });

  it("returns the least-similar candidate when nothing passes", () => {
    const result = generateGatedVariant({ document: base(), baseSeed: "biz-10:1", recent: [], threshold: 0 });
    const lowest = Math.min(...result.attempts.map((attempt) => attempt.maxSimilarity));
    expect(result.report.maxSimilarity).toBe(lowest);
  });

  it("never returns the current draft's structure as the accepted candidate (it is compared too)", () => {
    const doc = base();
    const result = generateGatedVariant({ document: doc, baseSeed: "biz-11:1", recent: [] });
    expect(result.report.maxSimilarity).toBeLessThan(result.report.threshold);
    expect(result.document.themeKey).not.toBe(doc.themeKey);
  });

  it("two businesses in the same category receive different seeds and therefore different structures", () => {
    const a = generateGatedVariant({ document: base(), baseSeed: "biz-A:1", recent: [] });
    const b = generateGatedVariant({ document: base(), baseSeed: "biz-B:1", recent: [] });
    expect(a.seed).not.toBe(b.seed);
    expect(a.document.generation?.seed).not.toBe(b.document.generation?.seed);
  });
});
