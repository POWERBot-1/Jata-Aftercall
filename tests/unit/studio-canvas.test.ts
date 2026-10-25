/**
 * Studio Canvas — pure editing logic (§4, §63, §64, §89)
 *
 * These tests drive the functions the Canvas actually calls. If reordering, hiding, the outline
 * wording, the preview URL or the save-status vocabulary regresses, the editing surface lies to
 * the owner — so each behaviour is pinned here rather than being asserted in prose.
 */

import { describe, expect, it } from "vitest";
import { createExperienceDocument } from "@/lib/experience/document";
import { designDirections } from "@/lib/studio/designDirections";
import {
  CANVAS_DEVICES,
  buildSummary,
  canvasOutline,
  canvasPreviewSrc,
  directionApplyPayload,
  directionSwatches,
  inspectorFieldsFor,
  isSaveShortcut,
  moveSectionTo,
  moveSectionToTop,
  resolveCanvasDevice,
  saveStatusText,
  saveStatusTone,
  setSectionTitle,
  setSectionVisible,
} from "@/lib/studio/canvas";

function sampleDocument() {
  return createExperienceDocument({
    categoryKey: "beauty",
    businessName: "Mary's Beauty Studio",
    description: "Braids and nails in Kitengela.",
    phone: "+254700000000",
    location: "Kitengela",
  });
}

describe("moveSectionTo", () => {
  it("moves a section to an absolute position and keeps every other section's order", () => {
    const document = sampleDocument();
    const original = document.sections.map((section) => section.id);
    const movedId = original[2];
    const result = moveSectionTo(document, movedId, 0);

    expect(result.sections[0].id).toBe(movedId);
    expect(result.sections.map((section) => section.id)).toHaveLength(original.length);
    // The remaining order is untouched apart from the moved item.
    expect(result.sections.slice(1).map((section) => section.id)).toEqual(
      original.filter((id) => id !== movedId),
    );
  });

  it("clamps an out-of-range index instead of dropping the section", () => {
    const document = sampleDocument();
    const first = document.sections[0].id;
    const result = moveSectionTo(document, first, 999);
    expect(result.sections).toHaveLength(document.sections.length);
    expect(result.sections[result.sections.length - 1].id).toBe(first);
  });

  it("clamps a negative index to the top", () => {
    const document = sampleDocument();
    const last = document.sections[document.sections.length - 1].id;
    const result = moveSectionTo(document, last, -5);
    expect(result.sections[0].id).toBe(last);
  });

  it("is a no-op for an unknown section or a non-numeric index", () => {
    const document = sampleDocument();
    expect(moveSectionTo(document, "does-not-exist", 0)).toBe(document);
    expect(moveSectionTo(document, document.sections[0].id, Number.NaN)).toBe(document);
  });

  it("never mutates the document it was given", () => {
    const document = sampleDocument();
    const snapshot = document.sections.map((section) => section.id);
    moveSectionTo(document, document.sections[3].id, 1);
    expect(document.sections.map((section) => section.id)).toEqual(snapshot);
  });

  it("moves to the top in one call", () => {
    const document = sampleDocument();
    const target = document.sections[4].id;
    expect(moveSectionToTop(document, target).sections[0].id).toBe(target);
  });
});

describe("visibility and title edits", () => {
  it("hides and shows a section without touching the others", () => {
    const document = sampleDocument();
    const id = document.sections[1].id;
    const hidden = setSectionVisible(document, id, false);
    expect(hidden.sections.find((section) => section.id === id)?.visible).toBe(false);
    expect(hidden.sections.filter((section) => section.visible === false)).toHaveLength(1);
    expect(setSectionVisible(hidden, id, true).sections.find((section) => section.id === id)?.visible).toBe(true);
  });

  it("returns the same document when visibility does not change", () => {
    const document = sampleDocument();
    expect(setSectionVisible(document, document.sections[0].id, true)).toBe(document);
  });

  it("caps an over-long title instead of storing an unbounded string", () => {
    const document = sampleDocument();
    const id = document.sections[0].id;
    const result = setSectionTitle(document, id, "x".repeat(500));
    expect(result.sections[0].title).toHaveLength(120);
  });
});

describe("canvasOutline", () => {
  it("describes every section with its real index and label", () => {
    const document = sampleDocument();
    const rows = canvasOutline(document);
    expect(rows).toHaveLength(document.sections.length);
    rows.forEach((row, index) => {
      expect(row.index).toBe(index);
      expect(row.label.length).toBeGreaterThan(0);
      expect(row.title.length).toBeGreaterThan(0);
    });
    // The first row is the navigation the site always needs, and the hero is present too.
    expect(rows[0].type).toBe("navigation");
    expect(rows.some((row) => row.type === "hero")).toBe(true);
    expect(rows.find((row) => row.type === "hero")?.label.toLowerCase()).toContain("hero");
  });

  it("says out loud that a hidden section is hidden", () => {
    const base = sampleDocument();
    const document = setSectionVisible(base, base.sections[1].id, false);
    const hiddenRow = canvasOutline(document).find((row) => !row.visible);
    expect(hiddenRow).toBeDefined();
    expect(hiddenRow?.hiddenNote).toMatch(/hidden/i);
  });

  it("marks data sections so the owner is not offered a copy field for live catalogue data", () => {
    const base = sampleDocument();
    const dataRow = canvasOutline(base).find((row) => row.source === "data");
    expect(dataRow).toBeDefined();
    expect(dataRow!.title.length).toBeGreaterThan(0);
    // With no owner-written title, the rail says where the content comes from.
    const cleared = canvasOutline(setSectionTitle(base, dataRow!.id, "")).find((row) => row.id === dataRow!.id);
    expect(cleared?.title).toMatch(/catalogue/i);
  });

  it("never reports the hero or navigation as removable", () => {
    const rows = canvasOutline(sampleDocument());
    expect(rows.find((row) => row.type === "hero")?.removable).toBe(false);
    expect(rows.find((row) => row.type === "navigation")?.removable).toBe(false);
  });
});

describe("inspectorFieldsFor", () => {
  it("returns the section's own fields and never a nested items editor", () => {
    const document = sampleDocument();
    const hero = document.sections.find((section) => section.type === "hero") ?? null;
    const fields = inspectorFieldsFor(hero);
    expect(fields.length).toBeGreaterThan(0);
    expect(fields.some((field) => field.type === "items")).toBe(false);
  });

  it("returns nothing for a missing section", () => {
    expect(inspectorFieldsFor(null)).toEqual([]);
  });
});

describe("canvasPreviewSrc", () => {
  it("asks for the draft and busts the cache with the revision", () => {
    expect(canvasPreviewSrc({ slug: "marys-beauty", mode: "draft", revision: 4 })).toBe("/b/marys-beauty?preview=draft&v=4");
  });

  it("shows the live site without the draft flag", () => {
    expect(canvasPreviewSrc({ slug: "marys-beauty", mode: "live", revision: 0 })).toBe("/b/marys-beauty?v=0");
  });

  it("encodes the slug so a bad value cannot break out of the path", () => {
    expect(canvasPreviewSrc({ slug: "a/../b", mode: "draft", revision: 1 })).toBe("/b/a%2F..%2Fb?preview=draft&v=1");
  });

  it("treats a non-numeric revision as zero", () => {
    expect(canvasPreviewSrc({ slug: "shop", mode: "draft", revision: Number.NaN })).toBe("/b/shop?preview=draft&v=0");
  });
});

describe("save status", () => {
  it("never claims a save is complete while it is still in flight", () => {
    expect(saveStatusText("saving", true)).toBe("Saving…");
    expect(saveStatusTone("saving", true)).toBe("busy");
  });

  it("distinguishes a draft save from a published state", () => {
    expect(saveStatusText("saved", true)).toBe("Saved to your draft");
    expect(saveStatusText("saved", false)).toBe("Saved — matches your live site");
  });

  it("makes an error visually distinct and honest", () => {
    expect(saveStatusTone("error", true)).toBe("error");
    expect(saveStatusText("error", true)).toMatch(/not saved/i);
  });

  it("flags unpublished work before anything is saved", () => {
    expect(saveStatusText("idle", true)).toBe("Unpublished changes");
    expect(saveStatusTone("idle", true)).toBe("warn");
    expect(saveStatusText("idle", false)).toBe("No changes yet");
  });
});

describe("devices", () => {
  it("starts on the phone width, which is what most customers use", () => {
    expect(resolveCanvasDevice(undefined).key).toBe("phone");
    expect(resolveCanvasDevice("nonsense").key).toBe("phone");
    expect(CANVAS_DEVICES[0].width).toBe(390);
  });

  it("resolves a known device", () => {
    expect(resolveCanvasDevice("desktop").width).toBe(1440);
  });
});

describe("design directions", () => {
  it("applies a direction as one coherent patch, not a colour swap", () => {
    const document = sampleDocument();
    const [direction] = designDirections({
      categoryKey: document.categoryKey,
      businessName: "Mary's Beauty Studio",
      brand: document.brand,
      themeKey: document.themeKey,
    });
    const payload = directionApplyPayload(direction);

    expect(payload.themeKey).toBe(direction.themeKey);
    expect(payload.designDirectionKey).toBe(direction.key);
    expect(payload.photographyStyle).toBe(direction.photographyStyle);
    expect(payload.brand).toMatchObject({
      primaryColor: direction.brand.primaryColor,
      secondaryColor: direction.brand.secondaryColor,
      accentColor: direction.brand.accentColor,
    });
    // The owner's own business name is never invented or overwritten by a direction.
    expect((payload.brand as Record<string, unknown>).businessName).toBeUndefined();
  });

  it("always provides exactly five swatches for the picker", () => {
    const document = sampleDocument();
    const directions = designDirections({
      categoryKey: document.categoryKey,
      businessName: "Mary's Beauty Studio",
      brand: document.brand,
      themeKey: document.themeKey,
    });
    expect(directions.length).toBeGreaterThan(0);
    for (const direction of directions) expect(directionSwatches(direction)).toHaveLength(5);
  });

  it("offers materially different directions for one business", () => {
    const document = sampleDocument();
    const directions = designDirections({
      categoryKey: document.categoryKey,
      businessName: "Mary's Beauty Studio",
      brand: document.brand,
      themeKey: document.themeKey,
    });
    const palettes = new Set(directions.map((direction) => direction.brand.primaryColor));
    expect(palettes.size).toBeGreaterThan(1);
  });
});

describe("buildSummary and shortcuts", () => {
  it("counts visible and hidden sections from the document itself", () => {
    const document = sampleDocument();
    const summary = buildSummary(document);
    expect(summary.sections).toBe(document.sections.length);
    expect(summary.visible + summary.hidden).toBe(summary.sections);
    expect(summary.hidden).toBe(0);
  });

  it("recognises the save shortcut on both platforms and nothing else", () => {
    expect(isSaveShortcut({ key: "s", metaKey: true })).toBe(true);
    expect(isSaveShortcut({ key: "S", ctrlKey: true })).toBe(true);
    expect(isSaveShortcut({ key: "s" })).toBe(false);
    expect(isSaveShortcut({ key: "p", metaKey: true })).toBe(false);
  });
});
