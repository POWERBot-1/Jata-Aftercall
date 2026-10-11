/**
 * Strict configuration boundary for AI output, whole-document writes and publication.
 *
 * The existing normalizer remains useful for harmless legacy defaults and manual partial edits.
 * It is NOT a validator: it must not turn malformed generated/published configuration into an
 * apparent success. This gate checks the raw input first, then returns only approved v1 fields.
 * Business/product/service/payment data and tenant identity remain in JATA's server data layer,
 * never in client-authored executable code or client-authoritative catalogue copies.
 */
import { normalizeExperienceDocument, safeUrl } from "./document";
import { isCategoryKey } from "./categories";
import { isSectionType } from "./sections";
import { isValidThemeKey } from "./themes";
import { isRenderPreference } from "./renderMode";
import { EXPERIENCE_SCHEMA_VERSION } from "./schemaVersion";
import { PHOTOGRAPHY_STYLE_KEYS, type ExperienceDocument } from "./types";

export type ExperienceSchemaIssue = { path: string; code: string; message: string };
export type ExperienceSchemaResult =
  | { ok: true; document: ExperienceDocument; issues: [] }
  | { ok: false; issues: ExperienceSchemaIssue[] };
export const MAX_EXPERIENCE_JSON_CHARS = 16 * 1024 * 1024;
const MAX_ISSUES = 24;
const FORBIDDEN_KEYS = new Set(["__proto__", "prototype", "constructor"]);
const ROOT_KEYS = ["version", "categoryKey", "themeKey", "brand", "settings", "sections", "seo", "photographyStyle", "renderPreference", "generation", "designDirectionKey", "updatedAt"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}

export function validateExperienceDocument(input: unknown, options: { allowLegacy?: boolean; fallbackCategory?: string } = {}): ExperienceSchemaResult {
  const issues: ExperienceSchemaIssue[] = [];
  const issue = (path: string, code: string, message: string) => {
    if (issues.length < MAX_ISSUES) issues.push({ path, code, message });
  };
  const record = (value: unknown, path: string): Record<string, unknown> => {
    if (isRecord(value)) return value;
    issue(path, "object_required", "Use an experience configuration object.");
    return {};
  };
  const keys = (value: Record<string, unknown>, allowed: readonly string[], path: string) => {
    for (const key of Object.keys(value)) {
      if (!allowed.includes(key) || FORBIDDEN_KEYS.has(key)) {
        // Do not echo a possibly private/hostile key or its value into a public error.
        issue(path, "unsupported_field", "This configuration contains a field the renderer does not support.");
      }
    }
  };
  const text = (value: unknown, path: string, max: number) => {
    if (value === undefined) return;
    if (typeof value !== "string" || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
      issue(path, "invalid_text", "Use plain text within the supported length.");
    } else if (/<\/?[a-z!][^>]*>/i.test(value)) {
      issue(path, "html_not_allowed", "Use plain text, not HTML or executable code.");
    }
  };
  const enumValue = (value: unknown, allowed: readonly unknown[], path: string) => {
    if (value !== undefined && !allowed.includes(value)) issue(path, "unsupported_value", "Choose a supported configuration option.");
  };
  const number = (value: unknown, path: string, min: number, max: number, integer = false, nullable = false) => {
    if (value === undefined || (nullable && value === null)) return;
    if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max || (integer && !Number.isSafeInteger(value))) {
      issue(path, "invalid_number", "Use a number within the supported range.");
    }
  };
  const url = (value: unknown, path: string, media = false) => {
    if (value === undefined || value === "") return;
    const clean = safeUrl(value);
    const mediaShape = /^(\/[^/]|\/$|https?:\/\/|data:image\/(png|jpe?g|webp|gif);base64,)/i;
    if (typeof value !== "string" || !clean || clean !== value.trim() || (media && !mediaShape.test(clean))) {
      issue(path, "unsafe_url", "Use a safe image or business-action URL.");
    }
  };

  const raw = record(input, "$" );
  keys(raw, ROOT_KEYS, "$");
  if (raw.version !== EXPERIENCE_SCHEMA_VERSION && !(options.allowLegacy === true && raw.version === undefined)) {
    issue("version", "unsupported_version", "This experience format is not supported. Nothing was published or changed.");
  }
  if (!isCategoryKey(raw.categoryKey) && !(options.allowLegacy && raw.categoryKey === undefined && isCategoryKey(options.fallbackCategory))) {
    issue("categoryKey", "unsupported_category", "Choose a supported business category.");
  }
  if (raw.themeKey !== undefined && !isValidThemeKey(raw.themeKey)) issue("themeKey", "unsupported_theme", "Choose a supported design theme.");
  if (raw.renderPreference !== undefined && !isRenderPreference(raw.renderPreference)) issue("renderPreference", "unsupported_mode", "Choose a supported rendering mode.");
  enumValue(raw.photographyStyle, PHOTOGRAPHY_STYLE_KEYS, "photographyStyle");
  text(raw.designDirectionKey, "designDirectionKey", 40);
  text(raw.updatedAt, "updatedAt", 40);

  const brand = raw.brand === undefined && options.allowLegacy ? {} : record(raw.brand, "brand");
  keys(brand, ["businessName", "tagline", "logoUrl", "heroImageUrl", "primaryColor", "secondaryColor", "accentColor", "buttonStyle", "fontPairing", "description"], "brand");
  for (const [key, max] of Object.entries({ businessName: 80, tagline: 140, fontPairing: 30, description: 400 })) text(brand[key], `brand.${key}`, max);
  for (const key of ["primaryColor", "secondaryColor", "accentColor"]) {
    if (brand[key] !== undefined && !/^#[0-9a-f]{6}$/i.test(String(brand[key]))) issue(`brand.${key}`, "invalid_color", "Use a six-digit brand colour.");
  }
  enumValue(brand.buttonStyle, ["solid", "soft", "outline", "pill"], "brand.buttonStyle");
  url(brand.logoUrl, "brand.logoUrl", true);
  url(brand.heroImageUrl, "brand.heroImageUrl", true);

  const settings = raw.settings === undefined && options.allowLegacy ? {} : record(raw.settings, "settings");
  keys(settings, ["phone", "whatsapp", "email", "location", "lat", "lng", "openingHours", "deliveryFeeKES", "deliveryEnabled", "pickupEnabled", "deliveryNote", "bookingEnabled", "bookingSlotMinutes", "minOrderKES"], "settings");
  for (const [key, max] of Object.entries({ phone: 30, whatsapp: 30, email: 120, location: 160, deliveryNote: 200 })) text(settings[key], `settings.${key}`, max);
  for (const key of ["phone", "whatsapp"]) {
    if (settings[key] !== undefined && settings[key] !== "" && (typeof settings[key] !== "string" || !/^[+0-9()\s-]{9,30}$/.test(String(settings[key])))) {
      issue(`settings.${key}`, "invalid_phone", "Use a phone number, not a link or executable content.");
    }
  }
  number(settings.lat, "settings.lat", -90, 90, false, true);
  number(settings.lng, "settings.lng", -180, 180, false, true);
  number(settings.deliveryFeeKES, "settings.deliveryFeeKES", 0, 100000, true);
  number(settings.minOrderKES, "settings.minOrderKES", 0, 100000, true);
  number(settings.bookingSlotMinutes, "settings.bookingSlotMinutes", 15, 240, true);
  for (const key of ["deliveryEnabled", "pickupEnabled", "bookingEnabled"]) enumValue(settings[key], [true, false], `settings.${key}`);
  if (settings.openingHours !== undefined && settings.openingHours !== null) {
    const hours = record(settings.openingHours, "settings.openingHours");
    if (Object.keys(hours).length > 7) issue("settings.openingHours", "too_many_items", "Use at most seven days of opening hours.");
    for (const [day, value] of Object.entries(hours).slice(0, 7)) {
      if (!/^[a-z]{1,12}$/i.test(day) || FORBIDDEN_KEYS.has(day)) issue("settings.openingHours", "invalid_day", "Use a supported day label.");
      text(value, "settings.openingHours", 40);
    }
  }

  if (!Array.isArray(raw.sections) || raw.sections.length === 0 || raw.sections.length > 40) {
    issue("sections", "invalid_sections", "Use between one and forty supported sections.");
  }
  const ids = new Set<string>();
  for (const [index, entry] of (Array.isArray(raw.sections) ? raw.sections.slice(0, 40) : []).entries()) {
    const path = `sections.${index}`;
    const section = record(entry, path);
    keys(section, ["id", "type", "visible", "title", "subtitle", "body", "imageUrl", "images", "layout", "limit", "filter", "items", "cta", "config"], path);
    if (typeof section.id !== "string" || !/^[a-z0-9_-]{1,60}$/i.test(section.id) || ids.has(section.id)) issue(`${path}.id`, "invalid_section_id", "Every section needs a unique, safe identifier.");
    else ids.add(section.id);
    if (!isSectionType(section.type)) issue(`${path}.type`, "unsupported_section", "This section is not supported by the renderer.");
    enumValue(section.visible, [true, false], `${path}.visible`);
    for (const [key, max] of Object.entries({ title: 90, subtitle: 200, body: 900, layout: 20, filter: 60 })) text(section[key], `${path}.${key}`, max);
    number(section.limit, `${path}.limit`, 1, 24, true);
    url(section.imageUrl, `${path}.imageUrl`, true);
    // There are no executable interactions/scenes in v1. An empty legacy config is harmless.
    if (section.config !== undefined && (!isRecord(section.config) || Object.keys(section.config).length > 0)) {
      issue(`${path}.config`, "unsupported_config", "Only implemented, validated experience recipes may be configured.");
    }
    if (section.images !== undefined) {
      if (!Array.isArray(section.images) || section.images.length > 24) issue(`${path}.images`, "invalid_images", "Use at most twenty-four section images.");
      for (const [position, entry] of (Array.isArray(section.images) ? section.images.slice(0, 24) : []).entries()) {
        const image = record(entry, `${path}.images.${position}`);
        keys(image, ["url", "alt"], `${path}.images.${position}`);
        if (!image.url) issue(`${path}.images.${position}.url`, "missing_url", "Every image needs a safe URL.");
        url(image.url, `${path}.images.${position}.url`, true);
        text(image.alt, `${path}.images.${position}.alt`, 160);
      }
    }
    if (section.items !== undefined) {
      if (!Array.isArray(section.items) || section.items.length > 24) issue(`${path}.items`, "invalid_items", "Use at most twenty-four text entries.");
      for (const entry of (Array.isArray(section.items) ? section.items.slice(0, 24) : [])) {
        const item = record(entry, `${path}.items`);
        if (Object.keys(item).length > 12) issue(`${path}.items`, "too_many_fields", "Keep each text entry small.");
        for (const [key, value] of Object.entries(item).slice(0, 12)) {
          if (!/^[a-z0-9_]{1,30}$/i.test(key) || FORBIDDEN_KEYS.has(key)) issue(`${path}.items`, "unsupported_field", "Use supported text-entry fields.");
          text(value, `${path}.items`, 500);
        }
      }
    }
    if (section.cta !== undefined) {
      const cta = record(section.cta, `${path}.cta`);
      keys(cta, ["label", "href"], `${path}.cta`);
      text(cta.label, `${path}.cta.label`, 40);
      if (typeof cta.href === "string" && /^#[a-z0-9_-]{1,60}$/i.test(cta.href)) {
        // Same-page anchor; renderer still resolves business/catalogue actions server-side.
      } else url(cta.href, `${path}.cta.href`);
    }
  }

  if (raw.generation !== undefined) {
    const generation = record(raw.generation, "generation");
    keys(generation, ["seed", "version", "attempt"], "generation");
    if (typeof generation.seed !== "string" || !/^[a-z0-9:|#_-]{1,80}$/i.test(generation.seed)) issue("generation.seed", "invalid_seed", "Use a supported reproducible generation seed.");
    number(generation.version, "generation.version", 1, 1000, true);
    number(generation.attempt, "generation.attempt", 0, 1000, true);
  }
  if (raw.seo !== undefined) {
    const seo = record(raw.seo, "seo");
    keys(seo, ["title", "description", "imageUrl"], "seo");
    text(seo.title, "seo.title", 70);
    text(seo.description, "seo.description", 180);
    url(seo.imageUrl, "seo.imageUrl", true);
  }
  // URL cap is separate from total JSON cap so data URLs cannot bypass document safety limits.
  try {
    const json = JSON.stringify(raw);
    if (json.length > MAX_EXPERIENCE_JSON_CHARS) issue("$", "configuration_too_large", "This experience is too large. Reduce its images before saving.");
  } catch {
    issue("$", "not_json", "The experience must be safe JSON configuration.");
  }
  if (issues.length) return { ok: false, issues };
  return { ok: true, document: normalizeExperienceDocument(raw, options.fallbackCategory), issues: [] };
}

/** Validate stored/raw publication JSON without allowing JSON.parse errors to become a 500 or blank page. */
export function validateExperienceJson(
  json: string,
  fallbackCategory?: string,
  options: { migrateLegacyDefaults?: boolean } = {},
): ExperienceSchemaResult {
  if (typeof json !== "string" || json.length > MAX_EXPERIENCE_JSON_CHARS) {
    return { ok: false, issues: [{ path: "$", code: "configuration_too_large", message: "This experience is too large to publish safely." }] };
  }
  try {
    let raw: unknown = JSON.parse(json);
    if (options.migrateLegacyDefaults && isRecord(raw) && raw.version === undefined) {
      // Explicit compatibility migration for PRE-v1 history snapshots that only stored a
      // category. Add missing defaults, never replace supplied fields or strip unsafe ones.
      // Only restore-to-draft uses this path; AI, whole-document writes and publish do not.
      const defaults = normalizeExperienceDocument({ categoryKey: raw.categoryKey }, fallbackCategory);
      raw = {
        ...raw,
        brand: raw.brand === undefined ? defaults.brand : raw.brand,
        settings: raw.settings === undefined ? defaults.settings : raw.settings,
        sections: raw.sections === undefined ? defaults.sections : raw.sections,
      };
    }
    return validateExperienceDocument(raw, { allowLegacy: true, fallbackCategory });
  } catch {
    return { ok: false, issues: [{ path: "$", code: "invalid_json", message: "This experience could not be read. Restore a supported draft before publishing." }] };
  }
}
