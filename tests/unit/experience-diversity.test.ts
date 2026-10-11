import { describe, expect, it } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument, moveSection } from "@/lib/experience/document";
import { themesForCategory } from "@/lib/experience/themes";
import {
  DEFAULT_DIVERSITY_THRESHOLD,
  diversityReport,
  fingerprintOf,
  hashSeed,
  regenerationSeed,
  seededChoice,
  similarity,
} from "@/lib/experience/diversity";
import type { ExperienceDocument } from "@/lib/experience/types";

function docFor(categoryKey: string, name: string, themeIndex = 0): ExperienceDocument {
  const doc = createExperienceDocument({ categoryKey, businessName: name, phone: "0712345678" });
  const theme = themesForCategory(categoryKey)[themeIndex] ?? themesForCategory(categoryKey)[0];
  return normalizeExperienceDocument({ ...doc, themeKey: theme.key });
}

describe("experience fingerprint and similarity", () => {
  it("an experience is identical to itself", () => {
    const doc = docFor("food", "Mama Njeri");
    expect(similarity(fingerprintOf(doc), fingerprintOf(doc))).toBe(1);
  });

  it("the same business data with a different theme and section order is materially different", () => {
    const a = docFor("food", "Mama Njeri", 0);
    const b = docFor("food", "Mama Njeri", 1);
    const reordered = moveSection(moveSection(b, b.sections[2].id, "up"), b.sections[3].id, "down");
    const score = similarity(fingerprintOf(a), fingerprintOf(reordered));
    expect(score).toBeLessThan(1);
    expect(score).toBeLessThan(DEFAULT_DIVERSITY_THRESHOLD);
  });

  it("is symmetric", () => {
    const a = fingerprintOf(docFor("food", "A", 0));
    const b = fingerprintOf(docFor("beauty", "B", 0));
    expect(similarity(a, b)).toBe(similarity(b, a));
  });

  it("scores a different category lower than the same category", () => {
    const food = fingerprintOf(docFor("food", "A"));
    const sameCategory = fingerprintOf(docFor("food", "B"));
    const otherCategory = fingerprintOf(docFor("beauty", "C"));
    expect(similarity(food, otherCategory)).toBeLessThan(similarity(food, sameCategory));
  });
});

describe("diversity gate", () => {
  it("passes when there is no recent experience to compare against", () => {
    const report = diversityReport(docFor("food", "A"), []);
    expect(report.ok).toBe(true);
    expect(report.closestIndex).toBe(-1);
    expect(report.maxSimilarity).toBe(0);
  });

  it("rejects an exact structural duplicate and reports the closest recent experience", () => {
    const candidate = docFor("food", "A");
    const recent = [docFor("beauty", "Other"), docFor("food", "A")];
    const report = diversityReport(candidate, recent);
    expect(report.ok).toBe(false);
    expect(report.closestIndex).toBe(1);
    expect(report.maxSimilarity).toBe(1);
  });

  it("accepts a candidate with a different structure from every recent experience", () => {
    const candidate = docFor("food", "A", 2);
    const recent = [docFor("food", "A", 0)];
    const report = diversityReport(candidate, recent);
    expect(report.maxSimilarity).toBeLessThan(1);
  });
});

describe("deterministic seeds", () => {
  it("hashes the same seed to the same value", () => {
    expect(hashSeed("biz-123:v1")).toBe(hashSeed("biz-123:v1"));
    expect(hashSeed("biz-123:v1")).not.toBe(hashSeed("biz-124:v1"));
  });

  it("makes the same choice for the same seed and different choices across retries", () => {
    const options = ["editorial", "luxury", "magazine", "minimal", "cinematic"];
    expect(seededChoice("seed-a", options)).toBe(seededChoice("seed-a", options));
    const attempts = new Set([0, 1, 2, 3, 4, 5].map((n) => seededChoice(regenerationSeed("seed-a", n), options)));
    expect(attempts.size).toBeGreaterThan(1);
  });

  it("returns undefined for an empty option list", () => {
    expect(seededChoice("x", [])).toBeUndefined();
  });

  it("attempt 0 keeps the base seed so the first generation is reproducible", () => {
    expect(regenerationSeed("base", 0)).toBe("base");
    expect(regenerationSeed("base", 2)).toBe("base#2");
  });
});
