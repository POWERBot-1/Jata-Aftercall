/**
 * Studio Canvas — pure editing logic (§4, §63, §64, §89)
 *
 * The Canvas is the single surface where an owner edits their website while looking at it.
 * Everything in this module is a pure function so the behaviour can be tested without a
 * browser, a database or a network: reordering, visibility, the outline the left rail draws,
 * the preview URL, the save-state vocabulary and the payload that applies a design direction.
 *
 * Nothing here invents content, prices, availability or contact details, and nothing here
 * writes to the database. Saves go through the existing `/api/experience` draft write path,
 * which is versioned, tenant-scoped and undoable.
 */

import { sectionDefinition, sectionLabel } from "../experience/sections";
import type { ExperienceDocument, ExperienceSection, SectionType } from "../experience/types";
import type { DesignDirection } from "./designDirections";

/** Devices the owner can preview in. Phone first: that is what most Kenyan customers use. */
export const CANVAS_DEVICES = [
  { key: "phone", label: "Phone", width: 390, height: 780, hint: "390 px — most customers" },
  { key: "tablet", label: "Tablet", width: 834, height: 900, hint: "834 px" },
  { key: "desktop", label: "Desktop", width: 1440, height: 900, hint: "1440 px" },
] as const;

export type CanvasDeviceKey = (typeof CANVAS_DEVICES)[number]["key"];

/** Falls back to the phone rather than throwing, so a bad URL parameter can never blank the editor. */
export function resolveCanvasDevice(value: unknown): (typeof CANVAS_DEVICES)[number] {
  const key = typeof value === "string" ? value : "";
  return CANVAS_DEVICES.find((device) => device.key === key) ?? CANVAS_DEVICES[0];
}

/**
 * Move one section to an absolute position.
 *
 * The existing `moveSection` only steps up or down, which is fine for a keyboard list but makes
 * "put the gallery right after the hero" a dozen clicks. The index is clamped instead of
 * rejected so a drag that ends past the last item lands on the last item.
 */
export function moveSectionTo(document: ExperienceDocument, sectionId: string, toIndex: number): ExperienceDocument {
  const from = document.sections.findIndex((section) => section.id === sectionId);
  if (from < 0) return document;
  const target = Math.max(0, Math.min(document.sections.length - 1, Math.trunc(Number(toIndex))));
  if (!Number.isFinite(target) || target === from) return document;
  const sections = [...document.sections];
  const [moved] = sections.splice(from, 1);
  sections.splice(target, 0, moved);
  return { ...document, sections };
}

/** A section can be moved off the top of the list in one action. */
export function moveSectionToTop(document: ExperienceDocument, sectionId: string): ExperienceDocument {
  return moveSectionTo(document, sectionId, 0);
}

/** Show/hide without the caller having to look the section up first. */
export function setSectionVisible(document: ExperienceDocument, sectionId: string, visible: boolean): ExperienceDocument {
  const found = document.sections.find((section) => section.id === sectionId);
  if (!found || found.visible === visible) return document;
  return {
    ...document,
    sections: document.sections.map((section) => (section.id === sectionId ? { ...section, visible } : section)),
  };
}

/** Edit the copy the outline shows and the preview renders. Title only, so prices are never touched. */
export function setSectionTitle(document: ExperienceDocument, sectionId: string, title: string): ExperienceDocument {
  // 90 is the server's own cap (normalizeSection → safeText(raw.title, 90)); matching it here
  // means the optimistic value and the saved value cannot disagree.
  const clean = title.slice(0, 90);
  return {
    ...document,
    sections: document.sections.map((section) => (section.id === sectionId ? { ...section, title: clean } : section)),
  };
}

export type CanvasOutlineRow = {
  id: string;
  type: SectionType;
  label: string;
  /** What the owner sees in the rail: their own title, or a plain-language reminder. */
  title: string;
  visible: boolean;
  /** Index in the full list, which is what a reorder sends. */
  index: number;
  /** "data" sections read live catalogue data; the owner cannot type over them. */
  source: "data" | "content" | "mixed";
  removable: boolean;
  hiddenNote: string | null;
};

/**
 * The left rail. Data sections announce that their content comes from the catalogue, and a
 * section the owner hid says so out loud instead of silently disappearing from the preview.
 */
export function canvasOutline(document: ExperienceDocument): CanvasOutlineRow[] {
  return document.sections.map((section, index) => {
    const definition = sectionDefinition(section.type);
    const label = sectionLabel(section.type);
    const source = definition?.source ?? "content";
    return {
      id: section.id,
      type: section.type,
      label,
      title: (section.title || "").trim() || fallbackTitle(section.type, source),
      visible: section.visible !== false,
      index,
      source,
      removable: Boolean(definition?.removable),
      hiddenNote: section.visible === false ? "Hidden — customers cannot see this section." : null,
    };
  });
}

function fallbackTitle(type: SectionType, source: "data" | "content" | "mixed"): string {
  if (type === "hero") return "Top of the page";
  if (type === "navigation") return "Menu links";
  if (source === "data") return `${sectionLabel(type)} — from your catalogue`;
  return `${sectionLabel(type)} — add your own words`;
}

/**
 * Which section fields the Canvas can actually persist.
 *
 * `normalizeSection` keeps a known set of top-level keys and the `cta` object. A field whose key
 * is not one of those would render an input that accepts typing and then saves nothing — the
 * worst kind of defect, because it looks like it worked. Only persistable fields are offered.
 */
const PERSISTABLE_TEXT_KEYS = new Set(["title", "subtitle", "body", "imageUrl", "layout", "filter", "limit"]);

/** Fields the inspector can edit in place, in the order an owner would fill them in. */
export function inspectorFieldsFor(section: ExperienceSection | null) {
  if (!section) return [];
  const definition = sectionDefinition(section.type);
  if (!definition) return [];
  return definition.fields.filter((field) => {
    // `items` is a repeatable sub-editor owned by the catalogue; images are managed in Photos.
    if (field.type === "items" || field.type === "image") return false;
    if (field.key === "cta.label") return true;
    return PERSISTABLE_TEXT_KEYS.has(field.key);
  });
}

/** Read a field for the inspector, including the nested CTA label. */
export function fieldValueFor(section: ExperienceSection, key: string): string | number | boolean {
  if (key === "cta.label") return section.cta?.label ?? "";
  const value = (section as unknown as Record<string, unknown>)[key];
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  return "";
}

/**
 * Build the patch for one edited field, or `null` when the key cannot be persisted.
 *
 * The CTA label lives at `section.cta.label`, so it must be written as a whole object; writing a
 * literal "cta.label" key is dropped by normalisation and the edit silently disappears.
 */
export function patchForField(section: ExperienceSection, key: string, value: unknown): Partial<ExperienceSection> | null {
  if (key === "cta.label") {
    const label = String(value ?? "").slice(0, 40);
    return { cta: { label, href: section.cta?.href ?? "" } };
  }
  if (!PERSISTABLE_TEXT_KEYS.has(key)) return null;
  return { [key]: value } as Partial<ExperienceSection>;
}

/** Whether an in-place edit of this section is worth offering at all. */
export function sectionIsEditable(section: ExperienceSection | null): boolean {
  return inspectorFieldsFor(section).length > 0;
}

/**
 * Preview URL. The draft preview needs a cache-busting revision so a save is visible
 * immediately on a phone that already cached the page — the single most common "I saved it
 * and nothing changed" complaint.
 */
export function canvasPreviewSrc(options: { slug: string; mode: "draft" | "live"; revision: number }): string {
  const slug = options.slug.trim();
  const revision = Number.isFinite(options.revision) ? Math.max(0, Math.trunc(options.revision)) : 0;
  const query = options.mode === "draft" ? `preview=draft&v=${revision}` : `v=${revision}`;
  return `/b/${encodeURIComponent(slug)}?${query}`;
}

/**
 * Normalise the `PATCH /api/experience` response.
 *
 * The route returns the new draft version at `experience.draftVersion`, not at the top level.
 * Reading the wrong field leaves the editor sending a stale `expectedDraftVersion`, so every
 * edit after the first is refused with a 409 and the owner's change is rolled back. This helper
 * exists so that contract is asserted by a test instead of being re-discovered in production,
 * and it accepts either shape so a future response change cannot reintroduce the bug.
 */
export type SaveResponse = {
  ok: boolean;
  document: ExperienceDocument | null;
  draftVersion: number | null;
  error: string | null;
  code: string | null;
};

export function readSaveResponse(httpOk: boolean, payload: unknown): SaveResponse {
  const body = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const experience = (body.experience && typeof body.experience === "object" ? body.experience : {}) as Record<string, unknown>;

  const candidates = [experience.draftVersion, body.draftVersion];
  const draftVersion = candidates.find((value): value is number => typeof value === "number" && Number.isInteger(value) && value > 0) ?? null;

  const document = body.document && typeof body.document === "object" ? (body.document as ExperienceDocument) : null;

  return {
    ok: httpOk,
    document,
    draftVersion,
    error: typeof body.error === "string" ? body.error : null,
    code: typeof body.code === "string" ? body.code : null,
  };
}

export type CanvasSaveState = "idle" | "saving" | "saved" | "error";

/** Plain-language save status. Never says "saved" while a request is still open. */
export function saveStatusText(state: CanvasSaveState, hasUnpublishedChanges: boolean): string {
  if (state === "saving") return "Saving…";
  if (state === "error") return "Not saved — your last change is still on screen";
  if (state === "saved") return hasUnpublishedChanges ? "Saved to your draft" : "Saved — matches your live site";
  return hasUnpublishedChanges ? "Unpublished changes" : "No changes yet";
}

/** Colour of the status pill, so a failure is never the same colour as a success. */
export function saveStatusTone(state: CanvasSaveState, hasUnpublishedChanges: boolean): "neutral" | "busy" | "ok" | "warn" | "error" {
  if (state === "error") return "error";
  if (state === "saving") return "busy";
  if (state === "saved") return "ok";
  return hasUnpublishedChanges ? "warn" : "neutral";
}

/**
 * The payload that applies a whole design direction through the existing draft write path.
 * One call changes the theme, the brand colours, the photography language and the recorded
 * direction, so the page cannot end up half-restyled.
 */
export function directionApplyPayload(direction: DesignDirection): Record<string, unknown> {
  return {
    themeKey: direction.themeKey,
    brand: { ...direction.brand },
    photographyStyle: direction.photographyStyle,
    designDirectionKey: direction.key,
  };
}

/** Swatch list for a direction, always five entries so the picker never shifts layout. */
export function directionSwatches(direction: DesignDirection): string[] {
  return direction.swatches.slice(0, 5);
}

/**
 * Everything the "Build my website" (§64) summary reports back, derived from the document the
 * server just saved — never assumed client-side.
 */
export function buildSummary(document: ExperienceDocument): { visible: number; hidden: number; sections: number } {
  const sections = document.sections.length;
  const visible = document.sections.filter((section) => section.visible !== false).length;
  return { sections, visible, hidden: sections - visible };
}

/** Keyboard shortcut map documented in the UI: Cmd/Ctrl+S saves, Escape closes the inspector. */
export function isSaveShortcut(event: { key: string; metaKey?: boolean; ctrlKey?: boolean }): boolean {
  return (event.metaKey === true || event.ctrlKey === true) && event.key.toLowerCase() === "s";
}
