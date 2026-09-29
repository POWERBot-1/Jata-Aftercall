import { describe, expect, it } from "vitest";
import {
  ONBOARDING_STEP_COUNT,
  createBusinessPayload,
  createDraft,
  draftStorageKey,
  newDraftKey,
  offerSignature,
  parseDraft,
  planOfferSync,
  planServiceSync,
  serviceSignature,
  updateBusinessPayload,
  validateStep,
  type OnboardingDraft,
} from "@/lib/onboardingDraft";

// Regression: onboarding held everything in React state. A refresh lost the form after the
// business already existed, and resubmitting step 1 or retrying step 2 created duplicates.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function memoryStorage() {
  const values = new Map<string, string>();
  return { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => void values.set(k, v), values };
}

describe("onboarding draft persistence (refresh / data loss)", () => {
  it("survives a refresh: a saved draft round-trips with answers, step and the created business", () => {
    const storage = memoryStorage();
    const key = draftStorageKey("user-a");
    const draft: OnboardingDraft = {
      ...createDraft("3f2504e0-4f89-41d3-9a0c-0305e82c3301"),
      step: 4,
      form: { ...createDraft("x").form, name: "Wanjiru Salon", phone: "0712345678", location: "Ngong Road", lat: "-1.29", lng: "36.78" },
      business: { id: "biz-1", slug: "wanjiru-salon", name: "Wanjiru Salon" },
      services: [{ title: "Braids", priceLabel: "KES 1,500", savedId: "svc-1", savedSignature: serviceSignature({ title: "Braids", priceLabel: "KES 1,500" }) }],
    };
    storage.setItem(key, JSON.stringify(draft));
    const restored = parseDraft(storage.getItem(key));
    expect(restored).not.toBeNull();
    expect(restored!.step).toBe(4);
    expect(restored!.form.name).toBe("Wanjiru Salon");
    expect(restored!.form.lat).toBe("-1.29");
    expect(restored!.business).toEqual({ id: "biz-1", slug: "wanjiru-salon", name: "Wanjiru Salon" });
    expect(restored!.services[0].savedId).toBe("svc-1");
    expect(restored!.draftKey).toBe(draft.draftKey);
  });

  it("drafts are scoped per signed-in account", () => {
    expect(draftStorageKey("user-a")).not.toBe(draftStorageKey("user-b"));
  });

  it("cannot resume past step 1 without a created business, and clamps bad steps", () => {
    const noBusiness = { ...createDraft("k"), step: 6 };
    expect(parseDraft(JSON.stringify(noBusiness))!.step).toBe(1);
    const withBusiness = { ...createDraft("k"), step: 99, business: { id: "b", slug: "s", name: "n" } };
    expect(parseDraft(JSON.stringify(withBusiness))!.step).toBe(ONBOARDING_STEP_COUNT);
  });

  it("discards malformed, foreign-version and stale drafts instead of crashing", () => {
    expect(parseDraft(null)).toBeNull();
    expect(parseDraft("not json")).toBeNull();
    expect(parseDraft(JSON.stringify({ version: 99, draftKey: "k", updatedAt: Date.now() }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...createDraft("k"), updatedAt: Date.now() - 31 * 86400000 }))).toBeNull();
    expect(parseDraft(JSON.stringify({ ...createDraft("k"), business: { id: 5 } }))!.business).toBeNull();
  });
});

describe("onboarding duplicate-creation protection", () => {
  it("every draft carries a random v4 draft key that is sent with the create request", () => {
    const a = newDraftKey();
    const b = newDraftKey();
    expect(a).toMatch(UUID);
    expect(a).not.toBe(b);
    const fallback = newDraftKey({ getRandomValues: <T extends ArrayBufferView | null>(arr: T) => { new Uint8Array((arr as unknown as Uint8Array).buffer).fill(7); return arr; } } as any);
    expect(fallback).toMatch(UUID);
    const draft = createDraft(a);
    expect(createBusinessPayload(draft.form, draft.draftKey)).toMatchObject({ draftKey: a });
  });

  it("updates to an existing business are sent as edits, never as a second create", () => {
    const payload = updateBusinessPayload({ ...createDraft("k").form, name: " Cafe ", phone: "0712345678", whatsapp: "" }, "biz-1");
    expect(payload).toMatchObject({ businessId: "biz-1", name: "Cafe", whatsapp: "0712345678" });
    expect(payload).not.toHaveProperty("draftKey");
  });

  it("a retry after a partial service failure only sends the rows that did not save", () => {
    const services = [
      { title: "Braids", priceLabel: "KES 1,500" },
      { title: "Nails", priceLabel: "KES 800" },
      { title: "", priceLabel: "" },
    ];
    expect(planServiceSync(services)).toEqual({ deleteIds: [], createIndexes: [0, 1] });
    // First attempt: row 0 saved, then the network failed before row 1.
    const afterPartial = services.map((s, i) => (i === 0 ? { ...s, savedId: "svc-1", savedSignature: serviceSignature(s) } : s));
    expect(planServiceSync(afterPartial)).toEqual({ deleteIds: [], createIndexes: [1] });
    // Second attempt succeeds: nothing left to send, so pressing Continue again is a no-op.
    const allSaved = afterPartial.map((s, i) => (i === 1 ? { ...s, savedId: "svc-2", savedSignature: serviceSignature(s) } : s));
    expect(planServiceSync(allSaved)).toEqual({ deleteIds: [], createIndexes: [] });
  });

  it("editing or clearing a saved service replaces or removes it rather than duplicating it", () => {
    const saved = { title: "Braids", priceLabel: "KES 1,500", savedId: "svc-1", savedSignature: serviceSignature({ title: "Braids", priceLabel: "KES 1,500" }) };
    expect(planServiceSync([{ ...saved, priceLabel: "KES 1,800" }])).toEqual({ deleteIds: ["svc-1"], createIndexes: [0] });
    expect(planServiceSync([{ ...saved, title: "" }])).toEqual({ deleteIds: ["svc-1"], createIndexes: [] });
  });

  it("the offer is only re-sent when it changed and is removed when cleared", () => {
    expect(planOfferSync({ title: "", subtitle: "" })).toBe("none");
    expect(planOfferSync({ title: "10% off", subtitle: "" })).toBe("save");
    const saved = { title: "10% off", subtitle: "", savedSignature: offerSignature({ title: "10% off", subtitle: "" }) };
    expect(planOfferSync(saved)).toBe("none");
    expect(planOfferSync({ ...saved, title: "" })).toBe("delete");
  });
});

describe("onboarding step validation", () => {
  const form = createDraft("k").form;
  it("explains what is missing instead of silently disabling Continue", () => {
    expect(validateStep(1, form)).toMatch(/business name/i);
    expect(validateStep(1, { ...form, name: "Cafe" })).toBe("");
    expect(validateStep(2, { ...form, phone: "12" })).toMatch(/valid phone/i);
    expect(validateStep(2, { ...form, phone: "0712345678" })).toBe("");
    expect(validateStep(3, { ...form, lat: "1", lng: "" })).toMatch(/both latitude and longitude/i);
    expect(validateStep(3, { ...form, lat: "95", lng: "36" })).toMatch(/between -90 and 90/i);
    expect(validateStep(3, { ...form, location: "Ngong Road" })).toBe("");
    expect(validateStep(4, form, [{ title: "B", priceLabel: "" }])).toMatch(/Service 1/);
  });
});
