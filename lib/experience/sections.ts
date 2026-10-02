/**
 * Section registry (§14, §49)
 *
 * A website is a list of sections. Each section declares the fields the editor exposes —
 * the owner never sees HTML, class names or code. Data sections render live business data
 * (products, services, properties); content sections hold what the owner typed.
 *
 * Adding a new section type is additive: add its definition here and its renderer.
 */

import type { CategoryKey, ExperienceProfile, ExperienceSection, SectionType } from "./types";

export type SectionFieldType = "text" | "textarea" | "image" | "number" | "select" | "toggle" | "items";

export type SectionField = {
  key: string;
  label: string;
  type: SectionFieldType;
  placeholder?: string;
  help?: string;
  maxLength?: number;
  min?: number;
  max?: number;
  options?: Array<{ value: string; label: string }>;
  itemFields?: SectionField[];
  itemLabel?: string;
};

export type SectionDefinition = {
  type: SectionType;
  label: string;
  description: string;
  /** "data" renders live catalogue data, "content" renders owner copy, "mixed" both. */
  source: "data" | "content" | "mixed";
  fields: SectionField[];
  /** False for sections every site needs (navigation, hero). */
  removable: boolean;
  /** Categories where the section is offered; empty means every category. */
  categories?: CategoryKey[];
  defaults: (profile: ExperienceProfile, context: { businessName: string; location?: string | null }) => Omit<ExperienceSection, "id">;
};

const LAYOUT_OPTIONS = [
  { value: "grid", label: "Grid" },
  { value: "list", label: "List" },
  { value: "compact", label: "Compact" },
];

export const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    type: "navigation",
    label: "Navigation",
    description: "Links are generated from your visible sections.",
    source: "mixed",
    removable: false,
    fields: [],
    defaults: () => ({ type: "navigation", visible: true }),
  },
  {
    type: "hero",
    label: "Hero",
    description: "The first thing customers see: your name, tagline and main action.",
    source: "mixed",
    removable: false,
    fields: [
      { key: "title", label: "Headline", type: "text", maxLength: 80, placeholder: "Your business name" },
      { key: "subtitle", label: "Tagline", type: "text", maxLength: 120, placeholder: "One line customers remember" },
      { key: "imageUrl", label: "Hero image", type: "image", help: "A wide photo works best." },
      { key: "cta.label", label: "Button text", type: "text", maxLength: 30 },
    ],
    defaults: (profile, context) => ({
      type: "hero",
      visible: true,
      title: context.businessName,
      subtitle: "",
      cta: { label: profile.cta.primary, href: "#featured" },
    }),
  },
  {
    type: "featured",
    label: "Featured",
    description: "Your featured items, pulled live from your catalogue.",
    source: "data",
    removable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      { key: "subtitle", label: "Subheading", type: "text", maxLength: 120 },
      { key: "layout", label: "Layout", type: "select", options: LAYOUT_OPTIONS },
      { key: "limit", label: "How many to show", type: "number", min: 2, max: 12 },
    ],
    defaults: (profile) => ({
      type: "featured",
      visible: true,
      title: `Popular ${profile.itemNounPlural.toLowerCase()}`,
      subtitle: "",
      layout: "grid",
      limit: 6,
    }),
  },
  {
    type: "menu",
    label: "Menu",
    description: "Your full catalogue, grouped by category.",
    source: "data",
    removable: true,
    categories: ["food", "hospitality"],
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      { key: "subtitle", label: "Subheading", type: "text", maxLength: 120 },
      { key: "layout", label: "Layout", type: "select", options: LAYOUT_OPTIONS },
    ],
    defaults: (profile) => ({
      type: "menu",
      visible: true,
      title: profile.catalogueLabel,
      subtitle: "",
      layout: "list",
    }),
  },
  {
    type: "services",
    label: "Services",
    description: "Services with prices, durations and booking.",
    source: "data",
    removable: true,
    categories: ["salon", "automotive", "fitness", "professional", "technical", "education", "creative", "hospitality", "other"],
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      { key: "subtitle", label: "Subheading", type: "text", maxLength: 120 },
      { key: "layout", label: "Layout", type: "select", options: LAYOUT_OPTIONS },
      { key: "filter", label: "Only show category", type: "text", maxLength: 40, help: "Optional. Leave blank for all." },
    ],
    defaults: (profile) => ({
      type: "services",
      visible: true,
      title: `Our ${profile.itemNounPlural.toLowerCase()}`,
      subtitle: "",
      layout: "list",
    }),
  },
  {
    type: "categories",
    label: "Categories",
    description: "Shop by category — generated from your catalogue.",
    source: "data",
    removable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      { key: "layout", label: "Layout", type: "select", options: LAYOUT_OPTIONS },
    ],
    defaults: (profile) => ({
      type: "categories",
      visible: true,
      title: `Shop by category`,
      layout: "grid",
    }),
  },
  {
    type: "collections",
    label: "Collections",
    description: "Editorial cards for each of your collections.",
    source: "data",
    removable: true,
    categories: ["beauty", "fashion", "retail", "furniture", "electronics", "other"],
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      { key: "subtitle", label: "Subheading", type: "text", maxLength: 120 },
      { key: "limit", label: "How many to show", type: "number", min: 2, max: 8 },
    ],
    defaults: () => ({
      type: "collections",
      visible: true,
      title: "Collections",
      subtitle: "",
      limit: 4,
    }),
  },
  {
    type: "properties",
    label: "Listings",
    description: "Properties with price, location and enquiry actions.",
    source: "data",
    removable: true,
    categories: ["realestate"],
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      { key: "subtitle", label: "Subheading", type: "text", maxLength: 120 },
      { key: "limit", label: "How many to show", type: "number", min: 1, max: 24 },
    ],
    defaults: () => ({
      type: "properties",
      visible: true,
      title: "Available properties",
      subtitle: "",
      limit: 12,
    }),
  },
  {
    type: "offers",
    label: "Offers",
    description: "Your current promotion, with an optional note.",
    source: "mixed",
    removable: true,
    fields: [
      { key: "title", label: "Offer title", type: "text", maxLength: 80 },
      { key: "subtitle", label: "Offer detail", type: "textarea", maxLength: 240 },
      { key: "imageUrl", label: "Offer image", type: "image" },
    ],
    defaults: () => ({
      type: "offers",
      visible: true,
      title: "",
      subtitle: "",
    }),
  },
  {
    type: "about",
    label: "About",
    description: "Your story, in your words.",
    source: "content",
    removable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      { key: "body", label: "Your story", type: "textarea", maxLength: 700 },
      { key: "imageUrl", label: "Photo", type: "image" },
    ],
    defaults: () => ({
      type: "about",
      visible: true,
      title: "About us",
      body: "",
    }),
  },
  {
    type: "gallery",
    label: "Gallery",
    description: "A grid of your best photos.",
    source: "content",
    removable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      {
        key: "images", label: "Photos", type: "items", itemLabel: "Photo",
        itemFields: [
          { key: "url", label: "Image", type: "image" },
          { key: "alt", label: "Description", type: "text", maxLength: 120, help: "Describes the photo for screen readers." },
        ],
      },
    ],
    defaults: () => ({
      type: "gallery",
      visible: true,
      title: "Gallery",
      images: [],
    }),
  },
  {
    type: "testimonials",
    label: "Testimonials",
    description: "Short quotes from happy customers.",
    source: "content",
    removable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      {
        key: "items", label: "Quotes", type: "items", itemLabel: "Quote",
        itemFields: [
          { key: "quote", label: "Quote", type: "textarea", maxLength: 220 },
          { key: "author", label: "Name", type: "text", maxLength: 60 },
        ],
      },
    ],
    defaults: () => ({
      type: "testimonials",
      visible: true,
      title: "What customers say",
      items: [],
    }),
  },
  {
    type: "faq",
    label: "Questions",
    description: "Answer the questions customers ask most.",
    source: "content",
    removable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      {
        key: "items", label: "Questions", type: "items", itemLabel: "Question",
        itemFields: [
          { key: "question", label: "Question", type: "text", maxLength: 140 },
          { key: "answer", label: "Answer", type: "textarea", maxLength: 400 },
        ],
      },
    ],
    defaults: () => ({
      type: "faq",
      visible: true,
      title: "Common questions",
      items: [],
    }),
  },
  {
    type: "hours",
    label: "Opening hours",
    description: "When you are open, pulled from your settings.",
    source: "mixed",
    removable: true,
    fields: [{ key: "title", label: "Heading", type: "text", maxLength: 60 }],
    defaults: () => ({ type: "hours", visible: true, title: "Opening hours" }),
  },
  {
    type: "location",
    label: "Location",
    description: "Where to find you, with a directions button.",
    source: "mixed",
    removable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      { key: "body", label: "Directions note", type: "textarea", maxLength: 240 },
    ],
    defaults: () => ({ type: "location", visible: true, title: "Find us", body: "" }),
  },
  {
    type: "contact",
    label: "Contact",
    description: "Call, WhatsApp and email buttons.",
    source: "mixed",
    removable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 60 },
      { key: "body", label: "Note", type: "textarea", maxLength: 240 },
    ],
    defaults: () => ({ type: "contact", visible: true, title: "Get in touch", body: "" }),
  },
  {
    type: "cta",
    label: "Call to action",
    description: "One clear action at the end of the page.",
    source: "content",
    removable: true,
    fields: [
      { key: "title", label: "Heading", type: "text", maxLength: 80 },
      { key: "body", label: "Supporting line", type: "textarea", maxLength: 200 },
      { key: "cta.label", label: "Button text", type: "text", maxLength: 30 },
    ],
    defaults: (profile) => ({
      type: "cta",
      visible: true,
      title: "Ready when you are",
      body: "",
      cta: { label: profile.cta.primary, href: "#contact" },
    }),
  },
];

const DEFINITION_BY_TYPE = new Map(SECTION_DEFINITIONS.map((definition) => [definition.type, definition]));

export function sectionDefinition(type: SectionType): SectionDefinition | undefined {
  return DEFINITION_BY_TYPE.get(type);
}

export function sectionLabel(type: SectionType): string {
  return DEFINITION_BY_TYPE.get(type)?.label || type;
}

export function isSectionType(value: unknown): value is SectionType {
  return typeof value === "string" && DEFINITION_BY_TYPE.has(value as SectionType);
}

/** Sections a category can add: its defaults, then anything else that suits it. */
export function addableSectionsFor(categoryKey: CategoryKey): SectionDefinition[] {
  return SECTION_DEFINITIONS.filter((definition) => {
    if (!definition.removable) return false;
    if (!definition.categories || definition.categories.length === 0) return true;
    return definition.categories.includes(categoryKey);
  });
}
