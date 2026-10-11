/**
 * The experience document (§14–§16, §51)
 *
 * One normalized JSON document describes a website: brand, settings and an ordered list of
 * sections. Draft and published copies are stored separately, so owner edits can never leak
 * into live content until the owner publishes (§15).
 *
 * Everything that arrives from the browser is normalized here — never trusted as-is.
 */

import { sanitizeText } from "../validation";
import { MAX_STORED_CHARS } from "../media/imageFormat";
import { getExperienceProfile, isCategoryKey } from "./categories";
import { isValidThemeKey, resolveExperienceTheme } from "./themes";
import { addableSectionsFor, isSectionType, sectionDefinition } from "./sections";
import { PHOTOGRAPHY_STYLE_KEYS } from "./types";
import { isRenderPreference } from "./renderMode";
import { supportedExperienceVersion } from "./schemaVersion";
import { parseArtDirection, templateForDocument } from "./templateFamilies";
import type {
  CategoryKey,
  ExperienceDocument,
  ExperienceProfile,
  ExperienceSection,
  ExperienceSettings,
  ExperienceBrand,
  SectionType,
} from "./types";

/**
 * Only these URL shapes are ever stored. Blocks `javascript:`, `vbscript:`, `file:` and any
 * other scheme a browser could execute (§47).
 */
export function safeUrl(value: unknown): string {
  if (typeof value !== "string") return "";
  const trimmed = value.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!trimmed) return "";
  // Browsers normalize backslashes and protocol-relative URLs into foreign origins.
  if (trimmed.includes("\\")) return "";
  if (trimmed.startsWith("/")) return trimmed.startsWith("//") ? "" : trimmed.slice(0, 2048);
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.username || url.password || !url.hostname) return "";
      return trimmed.slice(0, 2048);
    } catch {
      return "";
    }
  }
  // Contact links are generated links, never executable content (§47).
  if (/^(mailto:|tel:)[^\s]{1,256}$/i.test(trimmed)) return trimmed;
  // Compressed uploads are stored as inline data URLs; only real raster images are allowed.
  if (/^data:image\/(png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    if (trimmed.length > MAX_STORED_CHARS) return "";
    return trimmed;
  }
  return "";
}

function safeText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? sanitizeText(value, maxLength) : "";
}

function safeInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

export function newSectionId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `sec_${random}`;
}

function normalizeImages(value: unknown, limit = 24): Array<{ url: string; alt?: string }> {
  if (!Array.isArray(value)) return [];
  const images: Array<{ url: string; alt?: string }> = [];
  for (const entry of value.slice(0, limit)) {
    if (!entry || typeof entry !== "object") continue;
    const url = safeUrl((entry as Record<string, unknown>).url);
    if (!url) continue;
    const alt = safeText((entry as Record<string, unknown>).alt, 160);
    images.push(alt ? { url, alt } : { url });
  }
  return images;
}

function normalizeItems(value: unknown, limit = 24): Array<Record<string, string>> {
  if (!Array.isArray(value)) return [];
  const items: Array<Record<string, string>> = [];
  for (const entry of value.slice(0, limit)) {
    if (!entry || typeof entry !== "object") continue;
    const record: Record<string, string> = {};
    for (const [key, raw] of Object.entries(entry as Record<string, unknown>)) {
      if (typeof raw !== "string") continue;
      const keySafe = key.replace(/[^a-zA-Z0-9_]/g, "").slice(0, 30);
      if (!keySafe) continue;
      record[keySafe] = sanitizeText(raw, 500);
    }
    if (Object.keys(record).length > 0) items.push(record);
  }
  return items;
}

export function normalizeSection(input: unknown, profile: ExperienceProfile, index: number): ExperienceSection | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  if (!isSectionType(raw.type)) return null;
  const definition = sectionDefinition(raw.type);
  if (!definition) return null;

  const section: ExperienceSection = {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim().slice(0, 60) : newSectionId(),
    type: raw.type,
    visible: raw.visible !== false,
  };

  if (raw.title !== undefined) section.title = safeText(raw.title, 90);
  if (raw.subtitle !== undefined) section.subtitle = safeText(raw.subtitle, 200);
  if (raw.body !== undefined) section.body = safeText(raw.body, 900);
  if (raw.imageUrl !== undefined) section.imageUrl = safeUrl(raw.imageUrl);
  if (raw.layout !== undefined && typeof raw.layout === "string") section.layout = safeText(raw.layout, 20);
  if (raw.filter !== undefined) section.filter = safeText(raw.filter, 60);
  if (raw.limit !== undefined) section.limit = safeInt(raw.limit, 6, 1, 24);
  if (Array.isArray(raw.images)) section.images = normalizeImages(raw.images);
  if (Array.isArray(raw.items)) section.items = normalizeItems(raw.items);

  if (raw.cta && typeof raw.cta === "object") {
    const cta = raw.cta as Record<string, unknown>;
    const label = safeText(cta.label, 40);
    const href = safeUrl(cta.href) || (typeof cta.href === "string" && cta.href.startsWith("#") ? `#${cta.href.replace(/[^a-zA-Z0-9-]/g, "")}` : "");
    if (label || href) section.cta = { label, href };
  }

  // Unknown section types for this category are kept but hidden if the category moved on.
  void profile;
  void index;
  return section;
}

export function normalizeBrand(input: unknown, fallbackName = ""): ExperienceBrand {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  return {
    businessName: safeText(raw.businessName, 80) || fallbackName,
    tagline: safeText(raw.tagline, 140),
    logoUrl: safeUrl(raw.logoUrl),
    heroImageUrl: safeUrl(raw.heroImageUrl),
    primaryColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.primaryColor || "")) ? String(raw.primaryColor).toUpperCase() : undefined,
    secondaryColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.secondaryColor || "")) ? String(raw.secondaryColor).toUpperCase() : undefined,
    accentColor: /^#[0-9a-fA-F]{6}$/.test(String(raw.accentColor || "")) ? String(raw.accentColor).toUpperCase() : undefined,
    buttonStyle: ["solid", "soft", "outline", "pill"].includes(String(raw.buttonStyle)) ? (raw.buttonStyle as ExperienceBrand["buttonStyle"]) : undefined,
    fontPairing: safeText(raw.fontPairing, 30) || undefined,
    description: safeText(raw.description, 400),
  };
}

export /** Keeps only characters that can appear in a phone number; rejects anything else. */
function safePhone(value: unknown): string {
  if (typeof value !== "string") return "";
  const cleaned = value.replace(/[^0-9+()\s-]/g, "").trim().slice(0, 30);
  if (cleaned.replace(/\D/g, "").length < 9) return "";
  return cleaned;
}

function normalizeSettings(input: unknown): ExperienceSettings {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const lat = raw.lat === null || raw.lat === "" ? NaN : Number(raw.lat);
  const lng = raw.lng === null || raw.lng === "" ? NaN : Number(raw.lng);
  const hours = raw.openingHours && typeof raw.openingHours === "object" && !Array.isArray(raw.openingHours)
    ? Object.fromEntries(
        Object.entries(raw.openingHours as Record<string, unknown>)
          .slice(0, 7)
          .map(([day, value]) => [day.replace(/[^a-zA-Z]/g, "").slice(0, 12), sanitizeText(String(value ?? ""), 40)]),
      )
    : null;
  return {
    // Contact fields are phone numbers, so anything that is not a plausible number is
    // dropped: no link, script or markup can ever be smuggled into a contact action (§47).
    phone: safePhone(raw.phone) || undefined,
    whatsapp: safePhone(raw.whatsapp) || undefined,
    email: safeText(raw.email, 120) || undefined,
    location: safeText(raw.location, 160) || undefined,
    lat: Number.isFinite(lat) ? lat : null,
    lng: Number.isFinite(lng) ? lng : null,
    openingHours: hours,
    deliveryFeeKES: raw.deliveryFeeKES === undefined ? 0 : safeInt(raw.deliveryFeeKES, 0, 0, 100000),
    deliveryEnabled: raw.deliveryEnabled !== false,
    pickupEnabled: raw.pickupEnabled !== false,
    deliveryNote: safeText(raw.deliveryNote, 200) || undefined,
    bookingEnabled: raw.bookingEnabled !== false,
    bookingSlotMinutes: safeInt(raw.bookingSlotMinutes ?? 30, 30, 15, 240),
    minOrderKES: raw.minOrderKES === undefined ? 0 : safeInt(raw.minOrderKES, 0, 0, 100000),
  };
}

/** Build the default website for a business that has just chosen a category. */
export function createExperienceDocument(params: {
  categoryKey: CategoryKey | string;
  businessName: string;
  description?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  location?: string | null;
  themeKey?: string | null;
}): ExperienceDocument {
  const profile = getExperienceProfile(params.categoryKey);
  const themeKey = params.themeKey && isValidThemeKey(params.themeKey) ? params.themeKey : profile.defaultThemeKey;
  const context = { businessName: params.businessName, location: params.location ?? null };
  const sections: ExperienceSection[] = profile.defaultSections
    .map((type) => sectionDefinition(type))
    .filter((definition): definition is NonNullable<typeof definition> => Boolean(definition))
    .map((definition) => ({ id: newSectionId(), ...definition.defaults(profile, context) }));

  return {
    version: 1,
    categoryKey: profile.key,
    themeKey,
    brand: normalizeBrand(
      { businessName: params.businessName, description: params.description || "" },
      params.businessName,
    ),
    settings: normalizeSettings({
      phone: params.phone || "",
      whatsapp: params.whatsapp || params.phone || "",
      location: params.location || "",
      deliveryEnabled: profile.capabilities.includes("delivery"),
      pickupEnabled: profile.capabilities.includes("pickup"),
      bookingEnabled: profile.capabilities.includes("booking"),
    }),
    sections,
  };
}

/** Parse and repair an untrusted document (API input, stored JSON, or a legacy shape). */
export function normalizeExperienceDocument(input: unknown, fallbackCategory?: CategoryKey | string): ExperienceDocument {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const categoryKey: CategoryKey = isCategoryKey(raw.categoryKey)
    ? raw.categoryKey
    : getExperienceProfile(fallbackCategory).key;
  const profile = getExperienceProfile(categoryKey);
  const fallbackName = safeText(raw.businessName, 80);
  const sections: ExperienceSection[] = Array.isArray(raw.sections)
    ? raw.sections
        .slice(0, 40)
        .map((section, index) => normalizeSection(section, profile, index))
        .filter((section): section is ExperienceSection => Boolean(section))
    : [];

  const document: ExperienceDocument = {
    version: supportedExperienceVersion(raw.version),
    categoryKey: profile.key,
    themeKey: typeof raw.themeKey === "string" && isValidThemeKey(raw.themeKey) ? raw.themeKey : profile.defaultThemeKey,
    brand: normalizeBrand(raw.brand, fallbackName),
    settings: normalizeSettings(raw.settings),
    sections: sections.length > 0 ? sections : createExperienceDocument({ categoryKey: profile.key, businessName: fallbackName }).sections,
  };

  if (document.version === 2) document.artDirection = parseArtDirection(raw.artDirection);
  else if (raw.artDirection !== undefined) throw new Error("Art direction needs experience format 2. Nothing was changed.");

  if (typeof raw.photographyStyle === "string" && (PHOTOGRAPHY_STYLE_KEYS as readonly string[]).includes(raw.photographyStyle)) {
    document.photographyStyle = raw.photographyStyle;
  }
  // Only a recognised preference is stored; "auto" is the implicit default and is not written,
  // so documents that never set it serialise exactly as they did before (backward compatible).
  if (isRenderPreference(raw.renderPreference) && raw.renderPreference !== "auto") {
    document.renderPreference = raw.renderPreference;
  }
  if (typeof raw.designDirectionKey === "string" && raw.designDirectionKey.trim()) {
    document.designDirectionKey = raw.designDirectionKey.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  }

  // Provenance of a seeded variant. Stored only when present, so older documents are unchanged.
  if (raw.generation && typeof raw.generation === "object") {
    const gen = raw.generation as Record<string, unknown>;
    const seed = typeof gen.seed === "string" ? gen.seed.replace(/[^a-zA-Z0-9:|#_-]/g, "").slice(0, 80) : "";
    if (seed) {
      document.generation = {
        seed,
        version: safeInt(gen.version, 1, 1, 1000),
        attempt: safeInt(gen.attempt, 0, 0, 1000),
      };
    }
  }

  if (raw.seo && typeof raw.seo === "object") {
    const seo = raw.seo as Record<string, unknown>;
    document.seo = {
      title: safeText(seo.title, 70) || undefined,
      description: safeText(seo.description, 180) || undefined,
      imageUrl: safeUrl(seo.imageUrl) || undefined,
    };
  }

  return document;
}

/** Immutable helpers used by the editor and by the API (never mutate in place). */
export function withSection(doc: ExperienceDocument, id: string, patch: Partial<ExperienceSection>): ExperienceDocument {
  return {
    ...doc,
    sections: doc.sections.map((section) => (section.id === id ? { ...section, ...patch } : section)),
  };
}

export function updateSection(doc: ExperienceDocument, id: string, patch: Partial<ExperienceSection>): ExperienceDocument {
  const merged = withSection(doc, id, patch);
  return normalizeExperienceDocument(merged, doc.categoryKey);
}

export function moveSection(doc: ExperienceDocument, id: string, direction: "up" | "down"): ExperienceDocument {
  const index = doc.sections.findIndex((section) => section.id === id);
  if (index < 0) return doc;
  const target = direction === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= doc.sections.length) return doc;
  const sections = [...doc.sections];
  const [moved] = sections.splice(index, 1);
  sections.splice(target, 0, moved);
  return { ...doc, sections };
}

export function duplicateSection(doc: ExperienceDocument, id: string): ExperienceDocument {
  const index = doc.sections.findIndex((section) => section.id === id);
  if (index < 0) return doc;
  const source = doc.sections[index];
  if (!sectionDefinition(source.type)?.removable) return doc;
  const copy: ExperienceSection = { ...structuredCloneSafe(source), id: newSectionId() };
  const sections = [...doc.sections];
  sections.splice(index + 1, 0, copy);
  return { ...doc, sections };
}

export function removeSection(doc: ExperienceDocument, id: string): ExperienceDocument {
  const section = doc.sections.find((entry) => entry.id === id);
  if (!section || !sectionDefinition(section.type)?.removable) return doc;
  return { ...doc, sections: doc.sections.filter((entry) => entry.id !== id) };
}

export function addSection(doc: ExperienceDocument, type: SectionType): ExperienceDocument {
  const definition = sectionDefinition(type);
  if (!definition || !definition.removable) return doc;
  const profile = getExperienceProfile(doc.categoryKey);
  if (definition.categories && definition.categories.length > 0 && !definition.categories.includes(profile.key)) return doc;
  const section: ExperienceSection = {
    id: newSectionId(),
    ...definition.defaults(profile, { businessName: doc.brand.businessName || "", location: doc.settings.location }),
  };
  return { ...doc, sections: [...doc.sections, section] };
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function visibleSections(doc: ExperienceDocument): ExperienceSection[] {
  return doc.sections.filter((section) => section.visible);
}

/** Navigation is generated from the visible sections, never hand-maintained (§6). */
export function navigationFor(doc: ExperienceDocument): Array<{ id: string; label: string; href: string }> {
  const profile = getExperienceProfile(doc.categoryKey);
  const labels: Partial<Record<SectionType, string>> = {
    featured: "Popular",
    menu: profile.catalogueLabel,
    services: profile.catalogueLabel,
    properties: "Listings",
    collections: "Collections",
    categories: "Categories",
    offers: "Offers",
    about: "About",
    gallery: "Gallery",
    contact: "Contact",
    location: "Find us",
    hours: "Hours",
    faq: "FAQ",
    testimonials: "Reviews",
  };
  return visibleSections(doc)
    .filter((section) => section.type !== "navigation" && section.type !== "hero" && labels[section.type])
    .map((section) => ({
      id: section.id,
      label: section.title || labels[section.type] || section.type,
      href: `#${section.id}`,
    }));
}

export function themeOf(doc: ExperienceDocument) {
  const theme = resolveExperienceTheme(doc.themeKey);
  const family = templateForDocument(doc);
  if (!family) return theme;
  return { ...theme, treatment: { ...theme.treatment, heroStyle: family.hero, navStyle: family.navigation, cardStyle: family.cards,
    mediaRatio: family.mediaRatio, sectionSpacing: doc.artDirection?.density === "compact" ? "3.5rem" : doc.artDirection?.density === "spacious" ? "7rem" : "5rem",
    heroMinHeight: family.heroTreatment === "poster" ? "88svh" : family.hero === "band" ? "45vh" : "76vh",
    motion: theme.treatment.motion === "none" ? "none" as const : family.motion } };
}

export function addableSections(doc: ExperienceDocument) {
  return addableSectionsFor(doc.categoryKey);
}

/** True when the draft differs from what is currently live (§16). */
export function hasUnpublishedChanges(draftJson: string | null | undefined, publishedJson: string | null | undefined): boolean {
  if (!draftJson) return false;
  if (!publishedJson) return true;
  return draftJson !== publishedJson;
}
