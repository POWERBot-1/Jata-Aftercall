import { describe, expect, it } from "vitest";
import { createExperienceDocument, normalizeExperienceDocument, safeUrl } from "@/lib/experience/document";
import { validateExperienceDocument, validateExperienceJson } from "@/lib/experience/schema";
import { seedNewDocument } from "@/lib/experience/variant";

const base = () => createExperienceDocument({ categoryKey: "food", businessName: "Mama Njeri Kitchen", phone: "0712345678" });
const codes = (input: unknown) => validateExperienceDocument(input).issues.map((issue) => issue.code);

describe("supported safe experience schema", () => {
  it("validates every existing category and keeps source immutable", () => {
    for (const categoryKey of ["food", "salon", "beauty", "fashion", "retail", "electronics", "automotive", "realestate", "furniture", "fitness", "creative", "professional", "hospitality", "education", "technical", "other"]) {
      const input = createExperienceDocument({ categoryKey, businessName: "Business" });
      const before = JSON.stringify(input);
      expect(validateExperienceDocument(input).ok, categoryKey).toBe(true);
      expect(JSON.stringify(input)).toBe(before);
    }
  });

  it.each([0, 3, -1, 100000, "1", null, 1.2])("refuses explicit unsupported version %s instead of clamping/guessing", (version) => {
    expect(codes({ ...base(), version })).toContain("unsupported_version");
    expect(() => normalizeExperienceDocument({ ...base(), version })).toThrow(/unsupported experience format/);
  });

  it("requires a version from AI/new configuration but explicitly supports stored legacy v1", () => {
    const { version, ...legacy } = base();
    void version;
    expect(codes(legacy)).toContain("unsupported_version");
    const parsed = validateExperienceJson(JSON.stringify(legacy), "food");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.document.version).toBe(1);
  });

  it.each([null, [], "function render() {}", 12])("rejects non-configuration input %s", (input) => {
    expect(validateExperienceDocument(input).ok).toBe(false);
  });

  it("rejects unsupported components, duplicate identifiers and missing sections", () => {
    expect(codes({ ...base(), sections: [] })).toContain("invalid_sections");
    expect(codes({ ...base(), sections: [{ id: "x", type: "arbitrary-react", visible: true }] })).toContain("unsupported_section");
    const document = base();
    document.sections[1].id = document.sections[0].id;
    expect(codes(document)).toContain("invalid_section_id");
  });

  it("refuses executable fields, raw HTML, unimplemented interaction config and tenant/catalogue injection", () => {
    expect(codes({ ...base(), javascript: "alert(1)", tenantId: "other-tenant", products: [{ price: 1 }] })).toContain("unsupported_field");
    const document = base();
    document.sections[1].body = "<script>alert(1)</script>";
    document.sections[1].config = { onTap: "javascript:alert(1)" };
    expect(codes(document)).toEqual(expect.arrayContaining(["html_not_allowed", "unsupported_config"]));
  });

  it("rejects prototype keys without executing or echoing them", () => {
    const raw = JSON.parse(JSON.stringify(base()).replace('"version":1', '"version":1,"__proto__":{"secret":"tenant-private"}'));
    const result = validateExperienceDocument(raw);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result.issues)).not.toContain("tenant-private");
    expect(({} as Record<string, unknown>).secret).toBeUndefined();
  });

  it.each(["javascript:alert(1)", "//other.example/image.jpg", "/\\other.example/a", "https://user:password@example.com/a", "tel:0722000000", "data:text/html;base64,AAAA"])("rejects unsafe media URL %s", (heroImageUrl) => {
    expect(codes({ ...base(), brand: { ...base().brand, heroImageUrl } })).toContain("unsafe_url");
  });

  it("checks strings, numeric ranges, flags, gallery arrays, themes and generation seeds", () => {
    const document = base();
    const input = {
      ...document, themeKey: "nonexistent", renderPreference: "magic", generation: { seed: "<sql>", version: 1, attempt: 0 },
      settings: { ...document.settings, lat: 91, lng: -181, deliveryEnabled: "yes" },
      sections: [{ ...document.sections[1], title: "X".repeat(91), images: [{ url: "javascript:alert(1)", onError: "bad" }] }],
    };
    expect(codes(input)).toEqual(expect.arrayContaining(["invalid_number", "unsupported_theme", "unsupported_mode", "invalid_seed", "invalid_text", "unsafe_url", "unsupported_field"]));
  });

  it("handles malformed JSON and only migrates missing pre-v1 history defaults explicitly", () => {
    expect(validateExperienceJson("{broken", "food").ok).toBe(false);
    const legacy = JSON.stringify({ categoryKey: "food" });
    expect(validateExperienceJson(legacy, "food").ok).toBe(false);
    const restored = validateExperienceJson(legacy, "food", { migrateLegacyDefaults: true });
    expect(restored.ok).toBe(true);
    if (restored.ok) expect(restored.document.sections.length).toBeGreaterThan(0);
    expect(validateExperienceJson(JSON.stringify({ categoryKey: "food", version: 2 }), "food", { migrateLegacyDefaults: true }).ok).toBe(false);
    expect(validateExperienceJson(JSON.stringify({ categoryKey: "food", sql: "bad" }), "food", { migrateLegacyDefaults: true }).ok).toBe(false);
  });

  it.each(["retail", "food", "salon"])("publishes every reviewed v2 %s content field identically, omitting only draft updatedAt", (categoryKey) => {
    const seeded = seedNewDocument(createExperienceDocument({ categoryKey, businessName: "Owner facts", phone: "0712345678", location: "Nairobi" }), "QA-REVIEW-SEED").document;
    const reviewed = normalizeExperienceDocument({ ...seeded, renderPreference: "lite", brand: { ...seeded.brand, description: "Reviewed wording", heroImageUrl: "/favicon.svg" } });
    const draftJson = JSON.stringify({ ...reviewed, updatedAt: "2026-10-12T05:35:00.000Z" });
    const result = validateExperienceJson(draftJson, categoryKey);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Reviewed fixture must validate");
    // Full serialized equality covers structure, ordering, settings, media, contact and SEO, not just one label.
    expect(JSON.stringify(result.document)).toBe(JSON.stringify(reviewed));
    expect(result.document.updatedAt).toBeUndefined();
    expect(JSON.parse(draftJson).updatedAt).toBe("2026-10-12T05:35:00.000Z");
  });

  it("does not invent coordinates from null/empty settings", () => {
    const document = normalizeExperienceDocument(base());
    expect(document.settings.lat).toBeNull();
    expect(document.settings.lng).toBeNull();
  });

  it("safeUrl blocks protocol-relative/backslash URLs and embedded credentials but keeps existing contact actions", () => {
    expect(safeUrl("//evil.example/a")).toBe("");
    expect(safeUrl("/\\evil.example/a")).toBe("");
    expect(safeUrl("https://user:pass@example.com/a")).toBe("");
    expect(safeUrl("https://wa.me/254712345678")).toContain("wa.me");
    expect(safeUrl("tel:+254712345678")).toBe("tel:+254712345678");
    expect(safeUrl("/photos/a.jpg")).toBe("/photos/a.jpg");
  });
});
