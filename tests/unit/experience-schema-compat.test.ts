import { describe, expect, it } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument } from "@/lib/experience/document";

const base = createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen", phone: "0712345678" });

describe("experience schema backward compatibility (Phase 1)", () => {
  it("a v1 document without renderPreference normalises unchanged", () => {
    const legacy = JSON.parse(JSON.stringify(base));
    const normalised = normalizeExperienceDocument(legacy);
    expect(normalised.renderPreference).toBeUndefined();
    expect(JSON.stringify(normalised)).toBe(JSON.stringify(normalizeExperienceDocument(normalised)));
    expect(normalised.sections.map((s) => s.type)).toEqual(base.sections.map((s) => s.type));
  });

  it("stores a recognised non-auto render preference", () => {
    const doc = normalizeExperienceDocument({ ...base, renderPreference: "lite" });
    expect(doc.renderPreference).toBe("lite");
  });

  it("does not write 'auto' explicitly, so existing sites produce no diff", () => {
    const doc = normalizeExperienceDocument({ ...base, renderPreference: "auto" });
    expect(doc.renderPreference).toBeUndefined();
    expect("renderPreference" in doc).toBe(false);
  });

  it("drops an unknown or hostile render preference instead of storing it", () => {
    expect(normalizeExperienceDocument({ ...base, renderPreference: "<script>" }).renderPreference).toBeUndefined();
    expect(normalizeExperienceDocument({ ...base, renderPreference: 42 }).renderPreference).toBeUndefined();
  });
});
