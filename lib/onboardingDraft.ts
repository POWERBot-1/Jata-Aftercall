/**
 * Onboarding draft model: pure helpers shared by the onboarding UI and its tests.
 *
 * Data-loss protection: the whole draft (answers, step, and the id of the business once it
 * exists) is autosaved to this device after every change and restored after a refresh.
 * Duplicate protection: every draft carries a random draftKey that the server turns into a
 * deterministic business id, and each service remembers the id it was saved under, so
 * retrying a step never creates a second business or a second copy of a service.
 */
import { validatePhone } from "./validation";
import { parseCoordinates } from "./location";

export const ONBOARDING_DRAFT_VERSION = 1;
export const ONBOARDING_STEP_COUNT = 7;
const MAX_DRAFT_AGE_MS = 30 * 86400000;

export type DraftForm = {
  name: string;
  category: string;
  phone: string;
  whatsapp: string;
  location: string;
  lat: string;
  lng: string;
  description: string;
  theme: string;
  aftercallMsg: string;
};

export type DraftService = { title: string; priceLabel: string; savedId?: string; savedSignature?: string };
export type DraftOffer = { title: string; subtitle: string; savedSignature?: string };
export type DraftBusiness = { id: string; slug: string; name: string };

export type OnboardingDraft = {
  version: typeof ONBOARDING_DRAFT_VERSION;
  draftKey: string;
  step: number;
  form: DraftForm;
  services: DraftService[];
  offer: DraftOffer;
  business: DraftBusiness | null;
  savedFormSignature: string | null;
  updatedAt: number;
};

export const EMPTY_FORM: DraftForm = {
  name: "",
  category: "Beauty",
  phone: "",
  whatsapp: "",
  location: "",
  lat: "",
  lng: "",
  description: "",
  theme: "clean",
  aftercallMsg: "Thanks for contacting us",
};

export function draftStorageKey(scope: string): string {
  return `jata-onboarding-draft:${scope}`;
}

export function createDraft(draftKey: string, now = Date.now()): OnboardingDraft {
  return {
    version: ONBOARDING_DRAFT_VERSION,
    draftKey,
    step: 1,
    form: { ...EMPTY_FORM },
    services: [{ title: "", priceLabel: "" }],
    offer: { title: "", subtitle: "" },
    business: null,
    savedFormSignature: null,
    updatedAt: now,
  };
}

const str = (v: unknown, max = 1000) => (typeof v === "string" ? v.slice(0, max) : "");
const optStr = (v: unknown, max = 200) => (typeof v === "string" && v ? v.slice(0, max) : undefined);

/** Parses a stored draft defensively. Anything malformed, from another version, or stale is discarded. */
export function parseDraft(raw: string | null | undefined, now = Date.now()): OnboardingDraft | null {
  if (!raw) return null;
  let data: unknown;
  try { data = JSON.parse(raw); } catch { return null; }
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (d.version !== ONBOARDING_DRAFT_VERSION || typeof d.draftKey !== "string" || !d.draftKey) return null;
  const updatedAt = typeof d.updatedAt === "number" ? d.updatedAt : 0;
  if (!updatedAt || now - updatedAt > MAX_DRAFT_AGE_MS) return null;

  const f = (d.form && typeof d.form === "object" ? d.form : {}) as Record<string, unknown>;
  const form: DraftForm = {
    name: str(f.name, 80), category: str(f.category, 40) || EMPTY_FORM.category, phone: str(f.phone, 30), whatsapp: str(f.whatsapp, 30),
    location: str(f.location, 160), lat: str(f.lat, 30), lng: str(f.lng, 30), description: str(f.description, 1000),
    theme: str(f.theme, 20) || EMPTY_FORM.theme, aftercallMsg: str(f.aftercallMsg, 120),
  };
  const services: DraftService[] = Array.isArray(d.services)
    ? d.services.slice(0, 20).filter((s) => s && typeof s === "object").map((s) => {
        const r = s as Record<string, unknown>;
        return { title: str(r.title, 80), priceLabel: str(r.priceLabel, 40), savedId: optStr(r.savedId), savedSignature: optStr(r.savedSignature, 200) };
      })
    : [];
  const o = (d.offer && typeof d.offer === "object" ? d.offer : {}) as Record<string, unknown>;
  const b = d.business && typeof d.business === "object" ? (d.business as Record<string, unknown>) : null;
  const business = b && typeof b.id === "string" && b.id && typeof b.slug === "string" ? { id: b.id, slug: b.slug, name: str(b.name, 80) } : null;
  const rawStep = typeof d.step === "number" && Number.isInteger(d.step) ? d.step : 1;

  return {
    version: ONBOARDING_DRAFT_VERSION,
    draftKey: d.draftKey.slice(0, 64),
    // Without a saved business there is nothing to resume past step 1.
    step: business ? Math.min(Math.max(rawStep, 1), ONBOARDING_STEP_COUNT) : 1,
    form,
    services: services.length ? services : [{ title: "", priceLabel: "" }],
    offer: { title: str(o.title, 120), subtitle: str(o.subtitle, 120), savedSignature: optStr(o.savedSignature, 300) },
    business,
    savedFormSignature: typeof d.savedFormSignature === "string" ? d.savedFormSignature : null,
    updatedAt,
  };
}

/** Signature of the business fields that are saved to the server. */
export function formSignature(form: DraftForm): string {
  return JSON.stringify([form.name.trim(), form.category, form.phone.trim(), form.whatsapp.trim(), form.location.trim(), form.lat.trim(), form.lng.trim(), form.description.trim(), form.theme, form.aftercallMsg.trim()]);
}

export function serviceSignature(s: Pick<DraftService, "title" | "priceLabel">): string {
  return JSON.stringify([s.title.trim(), s.priceLabel.trim()]);
}

export function offerSignature(o: Pick<DraftOffer, "title" | "subtitle">): string {
  return JSON.stringify([o.title.trim(), o.subtitle.trim()]);
}

export type ServiceSyncPlan = { deleteIds: string[]; createIndexes: number[] };

/**
 * What must be sent to the server to make it match the draft's service rows.
 * Rows that are already saved and unchanged are left alone — so a retry after a
 * partial failure only sends the rows that did not save.
 */
export function planServiceSync(services: DraftService[]): ServiceSyncPlan {
  const deleteIds: string[] = [];
  const createIndexes: number[] = [];
  services.forEach((s, index) => {
    const filled = s.title.trim().length >= 2;
    const unchanged = s.savedId && s.savedSignature === serviceSignature(s);
    if (s.savedId && (!filled || !unchanged)) deleteIds.push(s.savedId);
    if (filled && !unchanged) createIndexes.push(index);
  });
  return { deleteIds, createIndexes };
}

export type OfferSyncPlan = "none" | "save" | "delete";

export function planOfferSync(offer: DraftOffer): OfferSyncPlan {
  const filled = offer.title.trim().length > 0;
  if (!filled) return offer.savedSignature ? "delete" : "none";
  return offer.savedSignature === offerSignature(offer) ? "none" : "save";
}

/** Validation for a step before moving forward. Returns a plain-language message or "". */
export function validateStep(step: number, form: DraftForm, services: DraftService[] = []): string {
  if (step === 1) {
    if (form.name.trim().length < 2) return "Enter your business name (at least 2 characters).";
  }
  if (step === 2) {
    if (form.phone.trim() && !validatePhone(form.phone)) return "Enter a valid phone number, for example 0712 345 678.";
    if (form.whatsapp.trim() && !validatePhone(form.whatsapp)) return "Enter a valid WhatsApp number, for example 0712 345 678.";
  }
  if (step === 3) {
    if (form.location.trim().length > 160) return "Location must be 160 characters or fewer.";
    const coordinates = parseCoordinates(form.lat, form.lng);
    if (coordinates.valid === false) return coordinates.error;
  }
  if (step === 4) {
    const short = services.findIndex((s) => s.title.trim().length === 1);
    if (short >= 0) return `Service ${short + 1} needs a name of at least 2 characters, or leave it empty.`;
  }
  return "";
}

/** Body for creating the business. The draftKey makes the request safe to retry. */
export function createBusinessPayload(form: DraftForm, draftKey: string) {
  return { ...trimmedForm(form), draftKey };
}

/** Body for saving later edits to an existing business. */
export function updateBusinessPayload(form: DraftForm, businessId: string) {
  const f = trimmedForm(form);
  return { businessId, ...f, whatsapp: f.whatsapp || f.phone };
}

function trimmedForm(form: DraftForm): DraftForm {
  return {
    name: form.name.trim(), category: form.category, phone: form.phone.trim(), whatsapp: form.whatsapp.trim(),
    location: form.location.trim(), lat: form.lat.trim(), lng: form.lng.trim(), description: form.description.trim(),
    theme: form.theme, aftercallMsg: form.aftercallMsg.trim(),
  };
}

/** RFC 4122 v4 id using Web Crypto (available in every supported browser and in Node). */
export function newDraftKey(cryptoImpl: Pick<Crypto, "getRandomValues"> & { randomUUID?: () => string } = globalThis.crypto): string {
  if (typeof cryptoImpl.randomUUID === "function") return cryptoImpl.randomUUID();
  const bytes = cryptoImpl.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
