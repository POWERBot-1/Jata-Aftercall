/**
 * Experience document (§14, §15, §16, §47)
 *
 * The document is untrusted input from the editor: it is normalised server-side, dangerous
 * URLs are rejected, and section edits are pure operations on the draft only.
 */

import { describe, expect, it } from "vitest";
import {
  addSection,
  createExperienceDocument,
  duplicateSection,
  hasUnpublishedChanges,
  moveSection,
  normalizeExperienceDocument,
  removeSection,
  safeUrl,
  updateSection,
  visibleSections,
} from "@/lib/experience/document";
import { isSectionType } from "@/lib/experience/sections";

describe("safe urls", () => {
  it("accepts http(s), mailto, tel and whatsapp links", () => {
    expect(safeUrl("https://example.com/a")).toBe("https://example.com/a");
    expect(safeUrl("/images/photo.jpg")).toBe("/images/photo.jpg");
    expect(safeUrl("mailto:hi@example.com")).toBe("mailto:hi@example.com");
    expect(safeUrl("tel:+254712345678")).toBe("tel:+254712345678");
    expect(safeUrl("https://wa.me/254712345678")).toContain("wa.me");
  });

  it("rejects scripts and other dangerous schemes", () => {
    expect(safeUrl("javascript:alert(1)")).toBe("");
    expect(safeUrl("  JavaScript:alert(1)")).toBe("");
    expect(safeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBe("");
    expect(safeUrl("vbscript:msgbox(1)")).toBe("");
    expect(safeUrl(null)).toBe("");
    expect(safeUrl(123 as unknown as string)).toBe("");
  });
});

describe("document normalisation", () => {
  it("creates a complete document for every category", () => {
    for (const key of ["food", "salon", "realestate", "other", "nonsense"]) {
      const document = createExperienceDocument({ categoryKey: key, businessName: "Test Business" });
      expect(document.sections.length).toBeGreaterThan(3);
      expect(document.brand.businessName).toBe("Test Business");
      expect(isSectionType(document.sections[0].type)).toBe(true);
    }
  });

  it("strips dangerous content from untrusted editor input", () => {
    const document = normalizeExperienceDocument(
      {
        categoryKey: "food",
        themeKey: "food-grill",
        brand: { businessName: "Café <script>alert(1)</script>", logoUrl: "javascript:alert(1)", primaryColor: "not-a-colour" },
        settings: { whatsapp: "javascript:alert(1)", phone: "+254712345678", deliveryFeeKES: 999999 },
        sections: [{ id: "a", type: "hero", visible: true, title: "<img onerror=alert(1)>" }],
      },
      "food",
    );
    expect(document.brand.logoUrl || "").toBe("");
    expect(document.brand.primaryColor || "").toBe("");
    expect(document.settings.whatsapp).toBeUndefined();
    expect(document.sections[0].title).not.toContain("<img");
    expect(document.settings.phone).toBe("+254712345678");
  });

  it("clamps absurd numbers instead of trusting them", () => {
    const document = normalizeExperienceDocument(
      {
        categoryKey: "food",
        sections: [],
        settings: { deliveryFeeKES: 99999999, bookingSlotMinutes: 99999, minOrderKES: -50 },
      },
      "food",
    );
    expect(document.settings.deliveryFeeKES).toBeLessThanOrEqual(1_000_000);
    expect(document.settings.bookingSlotMinutes).toBeLessThanOrEqual(1440);
    expect(document.settings.minOrderKES).toBeGreaterThanOrEqual(0);
  });
});

describe("section operations stay on the draft", () => {
  const base = createExperienceDocument({ categoryKey: "food", businessName: "Biz" });

  it("adds, moves, duplicates, hides and removes sections", () => {
    const added = addSection(base, "faq");
    expect(added.sections.length).toBe(base.sections.length + 1);
    expect(added.sections[added.sections.length - 1].type).toBe("faq");

    const firstId = added.sections[0].id;
    const moved = moveSection(added, firstId, "down");
    expect(moved.sections[1].id).toBe(firstId);

    // A section that every site needs (navigation) cannot be duplicated; a content section can.
    const contentSection = added.sections.find((section) => section.type === "about")!;
    const duplicated = duplicateSection(added, contentSection.id);
    expect(duplicated.sections.length).toBe(added.sections.length + 1);
    expect(duplicateSection(added, added.sections[0].id).sections.length).toBe(added.sections.length);

    const hidden = updateSection(added, firstId, { visible: false });
    expect(visibleSections(hidden).some((section) => section.id === firstId)).toBe(false);

    const removed = removeSection(added, contentSection.id);
    expect(removed.sections.length).toBe(added.sections.length - 1);
  });

  it("never removes a section the site cannot render without", () => {
    const navigation = base.sections.find((section) => section.type === "navigation")!;
    const after = removeSection(base, navigation.id);
    expect(after.sections.some((section) => section.type === "navigation")).toBe(true);
  });

  it("detects unpublished changes by comparing documents", () => {
    const published = JSON.stringify(base);
    expect(hasUnpublishedChanges(published, published)).toBe(false);
    expect(hasUnpublishedChanges(JSON.stringify(addSection(base, "faq")), published)).toBe(true);
    expect(hasUnpublishedChanges(JSON.stringify(base), null)).toBe(true);
    expect(hasUnpublishedChanges(null, published)).toBe(false);
  });
});
