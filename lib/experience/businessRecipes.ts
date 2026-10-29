/** Registered, presentation-only business recipes. No generated code, prices, IDs, URLs or capability overrides. */
import type { CategoryKey, ExperienceDocument, ExperienceSection, SectionType } from "./types";
import type { StorefrontData, StorefrontItem } from "./storefront";

export type BusinessRecipeKey = "retail-stock" | "farm-produce" | "food-menu" | "salon-booking" | "professional-enquiry" | "technical-enquiry";
export type BusinessRecipeDetail = "brand" | "variants" | "stock" | "ingredients" | "portion" | "prep" | "options" | "duration" | "staff" | "deposit";
/** Registered structural presentations only. A layout is presentation geometry — never content, prices or capability. */
export type BusinessRecipeLayout = "product-grid" | "product-list" | "menu-list" | "menu-board" | "service-list" | "service-grid";
export type BusinessRecipeConfig = { version: 1; key: BusinessRecipeKey; details: BusinessRecipeDetail[]; layout?: BusinessRecipeLayout };
export type BusinessRecipe = Readonly<{
  version: 1; key: BusinessRecipeKey; category: CategoryKey; label: string;
  primarySection: SectionType; sections: readonly SectionType[]; source: "products" | "services";
  layout: "product-grid" | "menu-list" | "service-list";
  /** Presentation used for list/compact section layouts (legacy mapping). */
  listLayout: BusinessRecipeLayout;
  /** Every structural presentation this recipe accepts in its config. `layout` is the canonical default. */
  layouts: readonly BusinessRecipeLayout[];
  details: readonly Readonly<{ key: BusinessRecipeDetail; label: string }>[];
  availabilityLabel?: string;
}>;
export const RECIPE_LAYOUT_LABELS: Readonly<Record<BusinessRecipeLayout, string>> = {
  "product-grid": "Product grid", "product-list": "Product list",
  "menu-list": "Menu list", "menu-board": "Menu board",
  "service-list": "Service list", "service-grid": "Service grid",
};
export const BUSINESS_RECIPES: readonly BusinessRecipe[] = [
  { version: 1, key: "retail-stock", category: "retail", label: "Retail stock & options", primarySection: "featured", sections: ["featured"],
    source: "products", layout: "product-grid", listLayout: "product-list", layouts: ["product-grid", "product-list"], availabilityLabel: "In stock only",
    details: [{ key: "brand", label: "Brand" }, { key: "variants", label: "Product options" }, { key: "stock", label: "Availability" }] },
  { version: 1, key: "farm-produce", category: "farm", label: "Produce & availability", primarySection: "featured", sections: ["featured"],
    source: "products", layout: "product-grid", listLayout: "product-list", layouts: ["product-grid", "product-list"], availabilityLabel: "Available produce only",
    details: [{ key: "stock", label: "Availability" }, { key: "variants", label: "Produce options" }] },
  { version: 1, key: "food-menu", category: "food", label: "Food menu & ordering", primarySection: "menu", sections: ["menu", "featured"],
    source: "products", layout: "menu-list", listLayout: "menu-list", layouts: ["menu-list", "menu-board"], availabilityLabel: "Available dishes only",
    details: [{ key: "ingredients", label: "Ingredients" }, { key: "portion", label: "Portion" }, { key: "prep", label: "Preparation time" }, { key: "options", label: "Extras" }] },
  { version: 1, key: "salon-booking", category: "salon", label: "Salon services & booking", primarySection: "services", sections: ["services", "featured"],
    source: "services", layout: "service-list", listLayout: "service-list", layouts: ["service-list", "service-grid"],
    details: [{ key: "duration", label: "Duration" }, { key: "staff", label: "Specialist" }, { key: "deposit", label: "Deposit information" }] },
  { version: 1, key: "professional-enquiry", category: "professional", label: "Professional services & enquiries", primarySection: "services", sections: ["services", "featured"],
    source: "services", layout: "service-list", listLayout: "service-list", layouts: ["service-list", "service-grid"],
    details: [{ key: "staff", label: "Professional" }, { key: "duration", label: "Consultation length" }, { key: "deposit", label: "Booking deposit information" }] },
  { version: 1, key: "technical-enquiry", category: "technical", label: "Technical services & quote requests", primarySection: "services", sections: ["services", "featured"],
    source: "services", layout: "service-list", listLayout: "service-list", layouts: ["service-list", "service-grid"],
    details: [{ key: "staff", label: "Technician" }, { key: "duration", label: "Estimated job length" }, { key: "deposit", label: "Deposit information" }] },
];
/** Recipes whose QUOTE services route to the durable enquiry form (never booking slots or carts). */
const ENQUIRY_RECIPE_KEYS: readonly BusinessRecipeKey[] = ["professional-enquiry", "technical-enquiry"];
export function isEnquiryRecipe(key: string): boolean {
  return (ENQUIRY_RECIPE_KEYS as readonly string[]).includes(key);
}

export function businessRecipeFor(category: string, sectionType?: string): BusinessRecipe | undefined {
  return BUSINESS_RECIPES.find((recipe) => recipe.category === category && (sectionType === undefined || recipe.sections.includes(sectionType as SectionType)));
}
export function defaultBusinessRecipe(recipe: BusinessRecipe): BusinessRecipeConfig {
  return { version: 1, key: recipe.key, details: recipe.details.map((detail) => detail.key) };
}
function plain(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null));
}
/** Exact parser for the ONLY implemented section config. Unknown versions/fields/category/section combinations fail closed. */
export function parseBusinessRecipeConfig(input: unknown, category: string, sectionType: string): BusinessRecipeConfig | null {
  if (!plain(input) || Object.keys(input).length !== 1 || !Object.hasOwn(input, "businessRecipe")) return null;
  const config = input.businessRecipe; const recipe = businessRecipeFor(category, sectionType);
  if (!recipe || !plain(config) || Object.keys(config).some((key) => !["version", "key", "details", "layout"].includes(key)) ||
    config.version !== 1 || config.key !== recipe.key || !Array.isArray(config.details) || config.details.length > recipe.details.length) return null;
  const allowed = recipe.details.map((detail) => detail.key);
  const details = config.details;
  if (config.details.some((key) => typeof key !== "string" || !allowed.includes(key as BusinessRecipeDetail)) || new Set(config.details).size !== config.details.length) return null;
  // Optional registered presentation. Absent means the canonical default; an unregistered value fails closed.
  if (config.layout !== undefined && (typeof config.layout !== "string" || !recipe.layouts.includes(config.layout as BusinessRecipeLayout))) return null;
  // Canonical field order makes preview, save, history and publication serialization faithful.
  return { version: 1, key: recipe.key, details: allowed.filter((key) => details.includes(key)), ...(typeof config.layout === "string" ? { layout: config.layout as BusinessRecipeLayout } : {}) };
}
/** Pure presentation resolution: explicit registered config first, then the unchanged legacy section-layout mapping. */
export function recipeLayoutFor(config: BusinessRecipeConfig, recipe: BusinessRecipe, sectionLayout?: string): BusinessRecipeLayout {
  if (config.layout && recipe.layouts.includes(config.layout)) return config.layout;
  if (sectionLayout === "grid") return "product-grid";
  if (sectionLayout === "list" || sectionLayout === "compact") return recipe.listLayout;
  return recipe.layout;
}
export function sectionBusinessRecipe(section: ExperienceSection, document: Pick<ExperienceDocument, "version" | "categoryKey">): BusinessRecipeConfig | null {
  return document.version === 2 ? parseBusinessRecipeConfig(section.config, document.categoryKey, section.type) : null;
}
export function documentBusinessRecipe(document: ExperienceDocument): BusinessRecipeConfig | null {
  const recipe = businessRecipeFor(document.categoryKey);
  if (!recipe || document.version !== 2) return null;
  for (const section of document.sections) {
    if (section.type !== recipe.primarySection) continue;
    const config = sectionBusinessRecipe(section, document);
    if (config) return config;
  }
  return null;
}
/** Explicit NEW v2 seed only; normalization of old documents never silently enrolls them. */
export function seedBusinessRecipe(document: ExperienceDocument): ExperienceDocument {
  const recipe = businessRecipeFor(document.categoryKey);
  if (!recipe || document.version !== 2) return document;
  let attached = false;
  return { ...document, sections: document.sections.map((section) => {
    if (attached || section.type !== recipe.primarySection) return section;
    attached = true;
    return { ...section, layout: recipe.source === "services" || recipe.category === "food" ? "list" : "grid", config: { businessRecipe: defaultBusinessRecipe(recipe) } };
  }) };
}
export function recipeCatalogue(data: Pick<StorefrontData, "items" | "services">, config: BusinessRecipeConfig): StorefrontItem[] {
  const recipe = BUSINESS_RECIPES.find((entry) => entry.key === config.key);
  if (!recipe) return [];
  const kind = recipe.source === "services" ? "service" : "product";
  return (recipe.source === "services" ? data.services : data.items).filter((item) => item.kind === kind);
}
/** Public presentation facts are copied from actual catalogue rows only; missing facts are omitted, never inferred. */
export function recipeFacts(item: StorefrontItem, config: BusinessRecipeConfig): Array<{ key: BusinessRecipeDetail; label: string; value: string }> {
  const values: Partial<Record<BusinessRecipeDetail, string>> = {
    brand: item.brand || undefined,
    variants: item.variants.length ? `${item.variants.length} options available` : undefined,
    stock: item.kind === "product" ? ["OUT_OF_STOCK", "DISCONTINUED"].includes(item.stockStatus) ? "Unavailable" : "Available" : undefined,
    ingredients: item.ingredients || undefined, portion: item.portionSize || undefined,
    prep: item.prepMinutes ? `${item.prepMinutes} min` : undefined,
    options: item.addOns.length ? `${item.addOns.length} extras available` : undefined,
    duration: item.durationMinutes ? `${item.durationMinutes} min` : undefined,
    staff: item.staffName || undefined,
    deposit: item.depositKES && item.depositKES > 0 ? `KES ${item.depositKES.toLocaleString("en-KE")}` : undefined,
  };
  const recipe = BUSINESS_RECIPES.find((entry) => entry.key === config.key);
  if (!recipe) return [];
  return recipe.details.filter((detail) => config.details.includes(detail.key) && values[detail.key]).map((detail) => ({ ...detail, value: values[detail.key]! }));
}
