/**
 * JATA Interactive Business — shared experience types (§4, §6, §51)
 *
 * One platform, many business experiences. A business experience is composed from:
 *
 *   Business  +  Category (ExperienceProfile)  +  Theme  +  Sections  +  Business data
 *   +  enabled capabilities
 *
 * There are no per-category applications and no template lock-in: a single renderer
 * consumes one normalized experience document, and a single editor edits it.
 */

import type { RenderPreference } from "./renderMode";

/** Photography languages a website can use (§8, §30, §44). Shared so the document, the AI
 *  design context and the Studio picker cannot drift apart. */
export const PHOTOGRAPHY_STYLE_KEYS = [
  "clean-studio",
  "premium",
  "natural",
  "warm",
  "luxury",
  "modern",
  "rustic",
  "minimal",
] as const;

export type PhotographyStyleKey = (typeof PHOTOGRAPHY_STYLE_KEYS)[number];

export type CategoryKey =
  | "food"
  | "beauty"
  | "salon"
  | "fashion"
  | "retail"
  | "electronics"
  | "automotive"
  | "realestate"
  | "furniture"
  | "fitness"
  | "creative"
  | "professional"
  | "hospitality"
  | "education"
  | "technical"
  | "other";

export type Capability =
  /** Product catalogue with a cart and checkout. */
  | "commerce"
  /** Bookable services with date/time selection. */
  | "booking"
  /** Browse-only catalogue (no cart). */
  | "catalogue"
  /** "Request a quote" instead of a fixed price. */
  | "quote"
  /** Enquiry form / lead capture. */
  | "enquiry"
  | "delivery"
  | "pickup";

export type SectionType =
  | "navigation"
  | "hero"
  | "featured"
  | "categories"
  | "menu"
  | "services"
  | "collections"
  | "properties"
  | "gallery"
  | "offers"
  | "about"
  | "hours"
  | "location"
  | "testimonials"
  | "faq"
  | "steps"
  | "why"
  | "contact"
  | "cta";

/** Which catalogue fields the product form exposes for a category (§17). */
export type ProductFieldFlags = {
  price: boolean;
  salePrice: boolean;
  images: boolean;
  category: boolean;
  stock: boolean;
  variants: boolean;
  sizes: boolean;
  colours: boolean;
  shades: boolean;
  ingredients: boolean;
  portion: boolean;
  addOns: boolean;
  prepTime: boolean;
  brand: boolean;
  tags: boolean;
  featured: boolean;
  sku: boolean;
};

/** Which fields the service form exposes for a category (§18). */
export type ServiceFieldFlags = {
  price: boolean;
  quote: boolean;
  duration: boolean;
  staff: boolean;
  deposit: boolean;
  availability: boolean;
  image: boolean;
  category: boolean;
  featured: boolean;
};

export type ExperienceProfile = {
  key: CategoryKey;
  label: string;
  /** Short line shown to the owner while choosing a category. */
  blurb: string;
  /** Words a customer should associate with this experience. */
  mood: string;
  /** Legacy JATA category strings that resolve to this profile (§39 compatibility). */
  aliases: string[];
  /** What the business sells: "Dish", "Product", "Property", "Service". */
  itemNoun: string;
  itemNounPlural: string;
  /** Label for the catalogue page: "Menu", "Shop", "Listings". */
  catalogueLabel: string;
  capabilities: Capability[];
  cta: {
    /** Hero primary action — "Order now", "Book now", "Enquire". */
    primary: string;
    secondary?: string;
    /** Add-to-cart label — "Add to order", "Add to bag". */
    add: string;
    /** Cart noun — "Your order", "Your bag". */
    cart: string;
    /** Contact action — "Enquire", "Request viewing". */
    enquire: string;
    /** Confirmation heading — "Order confirmed", "Booking requested". */
    confirmation: string;
  };
  nav: string[];
  defaultSections: SectionType[];
  recommendedSections: SectionType[];
  productFields: ProductFieldFlags;
  serviceFields: ServiceFieldFlags;
  /** Option group labels, e.g. { sizes: "Size", colours: "Colour" }. */
  variantLabels: Partial<Record<"sizes" | "colours" | "shades", string>>;
  themeKeys: string[];
  defaultThemeKey: string;
  /** Customer-facing filters rendered on the catalogue page (§11). */
  filters: Array<"category" | "price" | "availability" | "location" | "type" | "duration">;
  searchPlaceholder: string;
  /** Order statuses exposed to this business type (§28). */
  orderStatuses: string[];
  /** schema.org type used for structured data (§33). */
  structuredDataType: string;
  /** Events this category is expected to emit (§32). */
  analyticsEvents: string[];
};

/** One editable block on the page (§14). */
export type ExperienceSection = {
  id: string;
  type: SectionType;
  visible: boolean;
  title?: string;
  subtitle?: string;
  body?: string;
  imageUrl?: string;
  images?: Array<{ url: string; alt?: string }>;
  layout?: string;
  limit?: number;
  filter?: string;
  items?: Array<Record<string, string>>;
  cta?: { label: string; href: string };
  config?: Record<string, unknown>;
};

export type ExperienceBrand = {
  businessName?: string;
  tagline?: string;
  logoUrl?: string;
  heroImageUrl?: string;
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  buttonStyle?: "solid" | "soft" | "outline" | "pill";
  fontPairing?: string;
  description?: string;
};

export type ExperienceSettings = {
  /** Contact + fulfilment configuration used by checkout and the action bar (§25, §43). */
  phone?: string;
  whatsapp?: string;
  email?: string;
  location?: string;
  lat?: number | null;
  lng?: number | null;
  openingHours?: Record<string, string> | null;
  deliveryFeeKES?: number;
  deliveryEnabled?: boolean;
  pickupEnabled?: boolean;
  deliveryNote?: string;
  bookingEnabled?: boolean;
  bookingSlotMinutes?: number;
  minOrderKES?: number;
};

/** The full versioned document. Stored as JSON; edited by the section editor (§15). */
export type ExperienceDocument = {
  version: number;
  categoryKey: CategoryKey;
  themeKey: string;
  brand: ExperienceBrand;
  settings: ExperienceSettings;
  sections: ExperienceSection[];
  seo?: {
    title?: string;
    description?: string;
    imageUrl?: string;
  };
  /** The photography language JATA uses when it creates or improves images for this website. */
  photographyStyle?: PhotographyStyleKey | string;
  /** Owner's rendering preference. Absent in v1 documents, which behave as "auto" (Immersive Website Engine, Phase 1). */
  renderPreference?: RenderPreference;
  /** Provenance of a seeded structural variant (Phase 3). Absent for hand-built documents. */
  generation?: { seed: string; version: number; attempt: number };
  /** The design direction the owner chose, kept for the Studio's "current direction" state. */
  designDirectionKey?: string;
  updatedAt?: string;
};

export type ExperienceStatus = "DRAFT" | "PUBLISHED" | "UNPUBLISHED";
