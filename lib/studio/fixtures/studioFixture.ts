/**
 * Website Studio fixture data and simulators — DEVELOPMENT ONLY.
 *
 * Every business, name, phone, address and image here is fictional. The simulators below never perform
 * I/O: they return `Response` objects shaped like the real endpoints so the REAL Studio components run
 * their normal code paths. Nothing is saved, published, uploaded or sent. Each simulated result is labelled
 * FICTIONAL FIXTURE on screen.
 *
 * Imported only by the development-only Studio fixture routes, which return 404 in production.
 */
import { createExperienceDocument, themeOf } from "@/lib/experience/document";
import { getExperienceProfile } from "@/lib/experience/categories";
import { themesForCategory } from "@/lib/experience/themes";
import { designDirections } from "@/lib/studio/designDirections";
import type { StorefrontData } from "@/lib/experience/storefront";

export const FIXTURE_NOTICE = "FICTIONAL FIXTURE — no website is changed, saved, uploaded or published. Outcomes are simulated.";

export const FIXTURE_BUSINESS = {
  id: "fixture-studio-business",
  slug: "fixture-salon",
  name: "Fixture Salon Studio",
  category: "beauty",
  location: "Fixture Town",
  description: "Fictional braids, nails and grooming for the Studio fixture.",
  phone: "+254700000000",
  whatsapp: "+254700000000",
};

export const FIXTURE_OUTCOMES = ["success", "failure"] as const;
export type FixtureOutcome = (typeof FIXTURE_OUTCOMES)[number];
export function isFixtureOutcome(value: unknown): value is FixtureOutcome {
  return typeof value === "string" && (FIXTURE_OUTCOMES as readonly string[]).includes(value);
}

export const FIXTURE_STATES = ["dashboard", "category", "editor", "image", "publish", "preview"] as const;
export type FixtureState = (typeof FIXTURE_STATES)[number];
export function isFixtureState(value: unknown): value is FixtureState {
  return typeof value === "string" && (FIXTURE_STATES as readonly string[]).includes(value);
}

/** Studio index rows (fictional). Mirrors the shape the real Studio index receives. */
export const FIXTURE_INDEX_BUSINESSES = [
  { id: "fixture-studio-business", name: "Fixture Salon Studio", slug: "fixture-salon", category: "beauty", location: "Fixture Town", coverUrl: null, isPublished: true },
  { id: "fixture-studio-cafe", name: "Fixture Cafe", slug: "fixture-cafe", category: "restaurant", location: "Fixture Market", coverUrl: null, isPublished: false },
];

export function fixtureIndexExperience(): Map<string, { businessId: string; status: string; draftVersion: number; publishedVersion: number; draftJson: string | null; publishedJson: string | null }> {
  const document = fixtureDocument();
  const json = JSON.stringify(document);
  return new Map([
    ["fixture-studio-business", { businessId: "fixture-studio-business", status: "LIVE", draftVersion: 7, publishedVersion: 6, draftJson: json, publishedJson: null }],
    ["fixture-studio-cafe", { businessId: "fixture-studio-cafe", status: "DRAFT", draftVersion: 2, publishedVersion: 0, draftJson: null, publishedJson: null }],
  ]);
}

export function fixtureEntitlements(): Map<string, string> {
  return new Map([
    ["fixture-studio-business", "ACTIVE"],
    ["fixture-studio-cafe", "NONE"],
  ]);
}

export function fixtureDocument() {
  return createExperienceDocument({
    categoryKey: "beauty",
    businessName: FIXTURE_BUSINESS.name,
    description: FIXTURE_BUSINESS.description,
    phone: FIXTURE_BUSINESS.phone,
    whatsapp: FIXTURE_BUSINESS.whatsapp,
    location: FIXTURE_BUSINESS.location,
  });
}

export function fixtureDirections() {
  const document = fixtureDocument();
  return designDirections({ categoryKey: document.categoryKey, businessName: FIXTURE_BUSINESS.name, brand: document.brand, themeKey: document.themeKey });
}

export function fixtureThemes() {
  const document = fixtureDocument();
  return themesForCategory(document.categoryKey).map((theme) => ({
    key: theme.key,
    name: theme.name,
    description: theme.description,
    swatches: [theme.palette.bg, theme.palette.surface, theme.palette.primary, theme.palette.accent, theme.palette.text],
  }));
}

/** Storefront data for the real `ExperienceSite` renderer. Plain values only, no database. */
export function fixtureStorefrontData(opts: { isPreview: boolean }): StorefrontData {
  const document = fixtureDocument();
  return {
    business: {
      id: FIXTURE_BUSINESS.id,
      slug: FIXTURE_BUSINESS.slug,
      name: FIXTURE_BUSINESS.name,
      category: FIXTURE_BUSINESS.category,
      phone: FIXTURE_BUSINESS.phone,
      whatsapp: FIXTURE_BUSINESS.whatsapp,
      location: FIXTURE_BUSINESS.location,
      lat: null,
      lng: null,
      description: FIXTURE_BUSINESS.description,
      logoUrl: null,
      isPublished: !opts.isPreview,
      status: "LIVE",
    },
    document,
    theme: themeOf(document),
    profile: getExperienceProfile(FIXTURE_BUSINESS.category),
    items: [],
    services: [],
    offer: null,
    categories: [],
    isPreview: opts.isPreview,
    publishedVersion: 6,
  };
}

export const FIXTURE_PUBLISH_CHECKS = [
  { id: "opening-image", label: "Opening image chosen", status: "pass" as const },
  { id: "contact", label: "Phone or WhatsApp added", status: "pass" as const },
  { id: "plan", label: "Website Studio plan", status: "pass" as const, hint: "FICTIONAL FIXTURE: plan status is simulated." },
];

const SIMULATED_LATENCY_MS = 700;
export { SIMULATED_LATENCY_MS };

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** Simulated `PATCH /api/experience` (draft save). Success keeps the optimistic document; no data is stored. */
export function simulateDraftWrite(outcome: FixtureOutcome, body: Record<string, unknown>): Response {
  if (outcome === "failure") {
    return json(422, { error: "FICTIONAL FIXTURE: simulated save failure. Nothing was saved and the live site is unchanged." });
  }
  const expected = typeof body.expectedDraftVersion === "number" ? body.expectedDraftVersion : 0;
  return json(200, { experience: { draftVersion: expected + 1 }, simulated: true });
}

/** Simulated `POST /api/experience/publish`. Never publishes anything. */
export function simulatePublish(outcome: FixtureOutcome): Response {
  if (outcome === "failure") {
    return json(422, { error: "FICTIONAL FIXTURE: simulated publish failure. The live site is unchanged." });
  }
  return json(200, {
    published: true,
    message: "FICTIONAL FIXTURE: simulated publish. No customer website was changed.",
    url: `/dev/studio-fixture/site?preview=live`,
    simulated: true,
  });
}

/** Simulated `POST /api/experience` (choose a category). Stores nothing. */
export function simulateCreate(outcome: FixtureOutcome): Response {
  if (outcome === "failure") {
    return json(422, { error: "FICTIONAL FIXTURE: simulated set-up failure. Nothing was created." });
  }
  return json(200, { ok: true, simulated: true });
}
