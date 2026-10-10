/**
 * Regression tests for the diversity gate as used by real generation (POST create, regeneration
 * preview, and the seeded draft). These check what the gate can and cannot claim. In particular, a
 * missing published history must be reported as a limitation, never as a guarantee.
 */
import { describe, expect, it } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";
import { DEFAULT_DIVERSITY_THRESHOLD, diversityReport, regenerationSeed } from "@/lib/experience/diversity";
import {
  buildVariant,
  generateGatedVariant,
  historyBasisFor,
  NO_PUBLISHED_HISTORY_LIMITATION,
  seedNewDocument,
} from "@/lib/experience/variant";
import type { ExperienceDocument } from "@/lib/experience/types";

function base(categoryKey = "food", businessName = "Mama Njeri Kitchen"): ExperienceDocument {
  return normalizeExperienceDocument(
    createExperienceDocument({ categoryKey, businessName, phone: "0712345678", location: "Westlands" }),
  );
}

describe("duplicate candidates are rejected", () => {
  it("flags a candidate that is an exact duplicate of a recent published layout", () => {
    const draft = base();
    const candidate = buildVariant(draft, "biz-dup:1").document;
    // The business previously published exactly this layout.
    const report = diversityReport(candidate, [candidate]);
    expect(report.ok).toBe(false);
    expect(report.maxSimilarity).toBeGreaterThanOrEqual(DEFAULT_DIVERSITY_THRESHOLD);
    expect(report.closestIndex).toBe(0);
  });

  it("does not accept attempt 0 when history contains that same layout, and retries with a new seed", () => {
    const draft = base();
    const seed = "biz-dup:2";
    const publishedBefore = buildVariant(draft, seed).document;
    const result = generateGatedVariant({ document: draft, baseSeed: seed, recent: [publishedBefore] });
    expect(result.attempts[0].ok).toBe(false);
    expect(result.attempts[0].seed).toBe(seed);
    if (result.accepted) {
      expect(result.seed).not.toBe(seed);
      expect(result.report.maxSimilarity).toBeLessThan(DEFAULT_DIVERSITY_THRESHOLD);
    }
  });

  it("never reports acceptance for a candidate identical to the current draft", () => {
    const draft = base();
    const report = diversityReport(draft, [draft]);
    expect(report.ok).toBe(false);
  });
});

describe("acceptable alternatives pass", () => {
  it("accepts a candidate that is clearly different from a recent published layout of another category", () => {
    const draft = base("food");
    const other = base("retail", "Duka Ya Mtaa");
    const report = diversityReport(buildVariant(draft, "biz-ok:1").document, [other]);
    expect(report.ok).toBe(true);
    expect(report.maxSimilarity).toBeLessThan(DEFAULT_DIVERSITY_THRESHOLD);
  });

  it("returns an accepted result with a checked similarity when history is available", () => {
    const draft = base();
    const older = base("food", "Another Kitchen");
    const result = generateGatedVariant({ document: draft, baseSeed: "biz-ok:2", recent: [older] });
    expect(result.history).toEqual({ publishedCompared: 1, limitation: null });
    if (result.accepted) {
      expect(result.report.ok).toBe(true);
    }
  });
});

describe("missing history fails safely and says so", () => {
  it("reports a limitation when there are no published versions", () => {
    expect(historyBasisFor(0)).toEqual({ publishedCompared: 0, limitation: NO_PUBLISHED_HISTORY_LIMITATION });
  });

  it("clears the limitation once published history exists", () => {
    expect(historyBasisFor(2)).toEqual({ publishedCompared: 2, limitation: null });
  });

  it("carries the limitation through generation when recent is empty", () => {
    const result = generateGatedVariant({ document: base(), baseSeed: "biz-hist:1", recent: [] });
    expect(result.history.limitation).toBe(NO_PUBLISHED_HISTORY_LIMITATION);
    expect(result.history.publishedCompared).toBe(0);
    // The draft is still compared, so the report is never a silent zero-comparison pass.
    expect(result.attempts.length).toBeGreaterThan(0);
  });

  it("treats a negative or fractional published count as zero history", () => {
    expect(historyBasisFor(-3).publishedCompared).toBe(0);
    expect(historyBasisFor(1.9).publishedCompared).toBe(1);
  });
});

describe("regeneration seeds", () => {
  it("keeps the base seed for attempt 0 and derives distinct seeds for retries", () => {
    expect(regenerationSeed("biz:1", 0)).toBe("biz:1");
    const seeds = [0, 1, 2, 3, 4].map((attempt) => regenerationSeed("biz:1", attempt));
    expect(new Set(seeds).size).toBe(seeds.length);
  });

  it("is deterministic: the same base seed yields the same attempt sequence", () => {
    const draft = base();
    const a = generateGatedVariant({ document: draft, baseSeed: "biz-det:9", recent: [] });
    const b = generateGatedVariant({ document: draft, baseSeed: "biz-det:9", recent: [] });
    expect(a.attempts.map((x) => x.seed)).toEqual(b.attempts.map((x) => x.seed));
    expect(JSON.stringify(a.document)).toBe(JSON.stringify(b.document));
  });

  it("uses a different seed for each attempt in a single generation", () => {
    const result = generateGatedVariant({ document: base(), baseSeed: "biz-uniq:1", recent: [base()] });
    const seeds = result.attempts.map((x) => x.seed);
    expect(new Set(seeds).size).toBe(seeds.length);
  });
});

describe("new draft seeding", () => {
  it("seeds a new draft with a sanitised business id and reports no-history", () => {
    const { document, diversity } = seedNewDocument(base(), "biz-#1 \u00e9:x");
    expect(document.generation?.seed).toBe("biz1x:1");
    expect(diversity.status).toBe("no-history");
    expect(diversity.limitation).toBe(NO_PUBLISHED_HISTORY_LIMITATION);
    expect(diversity.seed).toBe("biz1x:1");
  });

  it("does not change the default layout of the new draft", () => {
    const doc = base();
    const { document } = seedNewDocument(doc, "biz-keep");
    expect(document.themeKey).toBe(doc.themeKey);
    expect(document.sections.map((s) => s.type)).toEqual(doc.sections.map((s) => s.type));
  });
});
