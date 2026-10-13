import { describe, expect, it } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";
import { designContextForDocument } from "@/lib/ai/designContext";
import { buildCopyPrompt } from "@/lib/ai/promptBuilder";
import type { ExperienceDocument } from "@/lib/experience/types";

function draft(seed?: string): ExperienceDocument {
  const doc = normalizeExperienceDocument(
    createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen", phone: "0712345678", location: "Westlands" }),
  );
  if (seed) doc.generation = { seed, version: 1, attempt: 2 };
  return doc;
}

describe("copy writing uses the draft's structural variation (prebuilt designContext path)", () => {
  it("carries the seeded variation from the document into the design context", () => {
    const design = designContextForDocument(draft("biz-1:7"), { businessName: "Mama Njeri Kitchen" });
    expect(design.variation?.seed).toBe("biz-1:7");
    expect(design.variation?.layout).toBeTruthy();
  });

  it("reaches the copy prompt, so suggestions take a fresh angle for that layout", () => {
    const design = designContextForDocument(draft("biz-1:7"), { businessName: "Mama Njeri Kitchen" });
    const built = buildCopyPrompt({ kind: "HEADLINE", design, facts: ["Open daily"] });
    expect(built.prompt).toContain("WRITING VARIATION biz-1:7");
    expect(built.prompt).toContain("Variation never permits inventing facts");
  });

  it("leaves the context unchanged for a draft with no seeded generation", () => {
    const design = designContextForDocument(draft(), { businessName: "Mama Njeri Kitchen" });
    expect(design.variation ?? null).toBeNull();
    const built = buildCopyPrompt({ kind: "HEADLINE", design, facts: ["Open daily"] });
    expect(built.prompt).not.toContain("WRITING VARIATION");
  });

  it("is reproducible: the same stored draft always yields the same variation", () => {
    const stored = draft("biz-1:7");
    const a = designContextForDocument(stored, { businessName: "Mama Njeri Kitchen" });
    const b = designContextForDocument(stored, { businessName: "Mama Njeri Kitchen" });
    expect(a.variation).toEqual(b.variation);
  });
});
