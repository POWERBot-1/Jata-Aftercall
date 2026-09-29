"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { LocationFields } from "@/components/LocationFields";
import { OnboardingPreview } from "@/components/OnboardingPreview";
import { SAFE_ERRORS } from "@/lib/safeError";
import { getCheckoutUrl } from "@/lib/subscriptionFlow";
import {
  ONBOARDING_STEP_COUNT,
  createBusinessPayload,
  createDraft,
  draftStorageKey,
  formSignature,
  newDraftKey,
  offerSignature,
  parseDraft,
  planOfferSync,
  planServiceSync,
  serviceSignature,
  updateBusinessPayload,
  validateStep,
  type DraftForm,
  type OnboardingDraft,
} from "@/lib/onboardingDraft";

type Plan = { id: string; name: string; priceKES: number; durationDays: number };
const CATEGORIES = ["Restaurant", "Salon", "Barber", "Mechanic", "Real Estate", "Professional Services", "Retail", "Home Services", "Beauty", "Food", "Events", "Other"];

/** Seven short steps, grouped into the four phases owners already know. */
const PHASES = ["Business & location", "Services & offer", "Choose plan", "Publish"] as const;
const STEPS: { title: string; phase: (typeof PHASES)[number]; intro: string }[] = [
  { title: "Business name", phase: "Business & location", intro: "Start with the name customers know you by." },
  { title: "Contact", phase: "Business & location", intro: "How customers reach you with one tap." },
  { title: "Location", phase: "Business & location", intro: "Help customers find you. Everything here is optional." },
  { title: "Services", phase: "Services & offer", intro: "Add what you sell. You can skip and add these later." },
  { title: "Look & message", phase: "Services & offer", intro: "Describe your business and pick a style." },
  { title: "Choose plan", phase: "Choose plan", intro: "Pick a plan now, or publish first and pay later." },
  { title: "Publish", phase: "Publish", intro: "Your page stays a private draft until you publish it." },
];

type SaveState = "idle" | "saving" | "saved-device" | "saved" | "error";

function storage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; } catch { return null; }
}

/** Business create/update. Retries are safe: creation is keyed by the draft's draftKey. */
async function businessRequest(method: "POST" | "PATCH", body: unknown) {
  const res = await fetch("/api/business", { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data: data as Record<string, unknown> };
}

async function send(url: string, method: string, body?: unknown): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const res = await fetch(url, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export default function OnboardingForm({ plans, draftScope }: { plans: Plan[]; draftScope: string }) {
  const router = useRouter();
  const key = draftStorageKey(draftScope);
  const [draft, setDraft] = useState<OnboardingDraft | null>(null);
  const [restored, setRestored] = useState(false);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const inFlight = useRef(false);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // Restore an unfinished draft (data-loss protection) or start a new one.
  useEffect(() => {
    const saved = parseDraft(storage()?.getItem(key) ?? null);
    if (saved) { setDraft(saved); setRestored(true); }
    else setDraft(createDraft(newDraftKey()));
  }, [key]);

  // Autosave every change on this device, so a refresh or lost connection loses nothing.
  useEffect(() => {
    if (!draft) return;
    try { storage()?.setItem(key, JSON.stringify(draft)); } catch { /* storage full or blocked */ }
  }, [draft, key]);

  const update = useCallback((fn: (d: OnboardingDraft) => OnboardingDraft) => {
    setDraft((d) => (d ? { ...fn(d), updatedAt: Date.now() } : d));
    setSaveState((s) => (s === "saving" ? s : "saved-device"));
  }, []);

  function setForm(patch: Partial<DraftForm>) { update((d) => ({ ...d, form: { ...d.form, ...patch } })); }

  function goTo(step: number) {
    setErr("");
    update((d) => ({ ...d, step: Math.min(Math.max(step, 1), ONBOARDING_STEP_COUNT) }));
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  function startOver() {
    try { storage()?.removeItem(key); } catch { /* ignore */ }
    setDraft(createDraft(newDraftKey()));
    setRestored(false);
    setErr("");
    setSaveState("idle");
  }

  /** Creates the business once (idempotent via draftKey) or saves changed fields to it. */
  async function saveBusiness(d: OnboardingDraft): Promise<OnboardingDraft | null> {
    const signature = formSignature(d.form);
    if (d.business && d.savedFormSignature === signature) return d;
    if (!d.business) {
      const res = await businessRequest("POST", createBusinessPayload(d.form, d.draftKey));
      if (!res.ok) { setErr(String(res.data.error || SAFE_ERRORS.businessFailed)); return null; }
      const b = res.data.business as { id: string; slug: string; name: string };
      return { ...d, business: { id: b.id, slug: b.slug, name: b.name }, savedFormSignature: signature };
    }
    const res = await businessRequest("PATCH", updateBusinessPayload(d.form, d.business.id));
    if (res.status === 404) {
      setErr("This business no longer exists. Start over to create it again.");
      return null;
    }
    if (!res.ok) { setErr(String(res.data.error || SAFE_ERRORS.saveFailed)); return null; }
    const b = res.data.business as { name?: string } | undefined;
    return { ...d, business: { ...d.business, name: b?.name || d.form.name.trim() }, savedFormSignature: signature };
  }

  /** Saves only the service rows and offer that changed since the last successful save. */
  async function saveServicesAndOffer(d: OnboardingDraft): Promise<OnboardingDraft | null> {
    if (!d.business) return d;
    const businessId = d.business.id;
    let next = d;
    const commit = (n: OnboardingDraft) => { next = n; setDraft({ ...n, updatedAt: Date.now() }); };
    const plan = planServiceSync(next.services);
    for (const id of plan.deleteIds) {
      const res = await send(`/api/services?id=${encodeURIComponent(id)}`, "DELETE");
      if (!res.ok && res.status !== 404) { setErr(String(res.data.error || SAFE_ERRORS.serviceFailed)); return null; }
      commit({ ...next, services: next.services.map((s) => (s.savedId === id ? { ...s, savedId: undefined, savedSignature: undefined } : s)) });
    }
    for (const index of plan.createIndexes) {
      const s = next.services[index];
      const res = await send("/api/services", "POST", { businessId, title: s.title.trim(), priceLabel: s.priceLabel.trim() || undefined, sortOrder: index });
      if (!res.ok) { setErr(String(res.data.error || SAFE_ERRORS.serviceFailed)); return null; }
      const saved = res.data.service as { id: string };
      // Record each saved row immediately, so a retry after a later failure never re-creates it.
      commit({ ...next, services: next.services.map((row, i) => (i === index ? { ...row, savedId: saved.id, savedSignature: serviceSignature(row) } : row)) });
    }
    const offerPlan = planOfferSync(next.offer);
    if (offerPlan === "save") {
      const res = await send("/api/offer", "POST", { businessId, title: next.offer.title.trim(), subtitle: next.offer.subtitle.trim() });
      if (!res.ok) { setErr(String(res.data.error || SAFE_ERRORS.offerFailed)); return null; }
      commit({ ...next, offer: { ...next.offer, savedSignature: offerSignature(next.offer) } });
    } else if (offerPlan === "delete") {
      const res = await send(`/api/offer?businessId=${encodeURIComponent(businessId)}`, "DELETE");
      if (!res.ok) { setErr(String(res.data.error || SAFE_ERRORS.offerFailed)); return null; }
      commit({ ...next, offer: { ...next.offer, savedSignature: undefined } });
    }
    return next;
  }

  async function continueFrom(step: number) {
    if (!draft || inFlight.current) return;
    const problem = validateStep(step, draft.form, draft.services);
    if (problem) { setErr(problem); return; }
    inFlight.current = true;
    setErr("");
    setLoading(true);
    setSaveState("saving");
    try {
      let next: OnboardingDraft | null = draft;
      if (step <= 3 || step === 5) next = await saveBusiness(draft);
      else if (step === 4) next = await saveServicesAndOffer(draft);
      if (!next) { setSaveState("error"); return; }
      setDraft({ ...next, step: step + 1, updatedAt: Date.now() });
      setSaveState("saved");
      requestAnimationFrame(() => headingRef.current?.focus());
    } catch {
      setErr("We couldn’t save — check your connection and try again. Your answers are kept on this device.");
      setSaveState("error");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  async function publish() {
    if (!draft?.business || inFlight.current) return;
    inFlight.current = true;
    setErr("");
    setLoading(true);
    try {
      const res = await businessRequest("PATCH", { businessId: draft.business.id, isPublished: true });
      if (!res.ok) { setErr(String(res.data.error || SAFE_ERRORS.publishFailed)); return; }
      try { storage()?.removeItem(key); } catch { /* ignore */ }
      router.push(`/b/${draft.business.slug}`);
      router.refresh();
    } catch {
      setErr(SAFE_ERRORS.publishFailed);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }

  function finishLater() {
    try { storage()?.removeItem(key); } catch { /* ignore */ }
    router.push("/dashboard");
  }

  if (!draft) {
    return <div className="jata-card mt-6 p-5" aria-busy="true"><p role="status" className="text-sm">Loading your setup…</p></div>;
  }

  const { step, form, services, offer, business } = draft;
  const meta = STEPS[step - 1];
  const statusText = saveState === "saving" ? "Saving…" : saveState === "saved" ? (business ? "All changes saved" : "Saved") : saveState === "saved-device" ? "Draft saved on this device" : saveState === "error" ? "Not saved to your account yet — your answers are kept on this device" : "";

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="jata-card p-5">
        {restored && (
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-zinc-50 p-3 text-sm" role="status">
            <span>We restored your unfinished setup{business ? ` for ${business.name}` : ""}.</span>
            <button type="button" className="jata-btn jata-btn-ghost underline" onClick={startOver}>Start over</button>
          </div>
        )}

        <nav aria-label="Setup progress">
          <p className="text-sm font-semibold">Step {step} of {ONBOARDING_STEP_COUNT} · {meta.phase}</p>
          <div className="jata-stepper-bar mt-2" aria-hidden="true"><span style={{ width: `${(step / ONBOARDING_STEP_COUNT) * 100}%` }} /></div>
          <ol className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {PHASES.map((phase) => {
              const phaseSteps = STEPS.map((s, i) => ({ ...s, n: i + 1 })).filter((s) => s.phase === phase);
              const first = phaseSteps[0].n;
              const current = meta.phase === phase;
              const reachable = first < step;
              return (
                <li key={phase}>
                  {reachable && !current ? (
                    <button type="button" className="jata-nav-link underline" onClick={() => goTo(first)}>{phase} ✓</button>
                  ) : (
                    <span className="jata-nav-link" aria-current={current ? "step" : undefined} style={current ? { color: "inherit", textDecoration: "underline", textUnderlineOffset: 6 } : undefined}>{phase}</span>
                  )}
                </li>
              );
            })}
          </ol>
        </nav>

        <h2 ref={headingRef} tabIndex={-1} className="mt-4 text-lg font-bold outline-none">{meta.title}</h2>
        <p className="mt-1 text-sm text-zinc-600">{meta.intro}</p>
        <div className="mt-3"><FormError>{err}</FormError></div>

        {step === 1 && (
          <div className="mt-4 space-y-3">
            <Field id="onboard-name" label="Business name" hint="This is the name customers will see.">
              <input value={form.name} maxLength={80} autoComplete="organization" onChange={(e) => setForm({ name: e.target.value })} required aria-required="true" />
            </Field>
            <Field id="onboard-category" label="Category">
              <select value={form.category} onChange={(e) => setForm({ category: e.target.value })}>
                {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </Field>
            {business && <p className="text-sm text-zinc-600">Your page address: <strong>/b/{business.slug}</strong></p>}
          </div>
        )}

        {step === 2 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field id="onboard-phone" label="Phone" hint="Customers tap this to call. Example: 0712 345 678.">
              <input value={form.phone} onChange={(e) => setForm({ phone: e.target.value })} inputMode="tel" autoComplete="tel" />
            </Field>
            <Field id="onboard-whatsapp" label="WhatsApp" hint="Leave blank to use the phone number.">
              <input value={form.whatsapp} onChange={(e) => setForm({ whatsapp: e.target.value })} inputMode="tel" />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="mt-4">
            <LocationFields
              idPrefix="onboard"
              ids={{ location: "onboard-location", lat: "onboard-lat", lng: "onboard-lng" }}
              value={{ location: form.location, lat: form.lat, lng: form.lng }}
              onChange={(v) => setForm(v)}
            />
          </div>
        )}

        {step === 4 && (
          <div className="mt-4 space-y-3">
            {services.map((s, i) => (
              <fieldset key={i} className="grid gap-2 rounded-xl border p-3 sm:grid-cols-2">
                <legend className="px-1 text-sm font-semibold">Service {i + 1}{s.savedId ? " · saved" : ""}</legend>
                <Field id={`service-title-${i}`} label="Name" hint="For example Braiding.">
                  <input value={s.title} maxLength={80} onChange={(e) => update((d) => ({ ...d, services: d.services.map((row, j) => (j === i ? { ...row, title: e.target.value } : row)) }))} />
                </Field>
                <Field id={`service-price-${i}`} label="Price" hint="For example From KES 1,500.">
                  <input value={s.priceLabel} maxLength={40} onChange={(e) => update((d) => ({ ...d, services: d.services.map((row, j) => (j === i ? { ...row, priceLabel: e.target.value } : row)) }))} />
                </Field>
                {services.length > 1 && (
                  <button type="button" className="jata-btn jata-btn-ghost justify-self-start underline sm:col-span-2" onClick={() => update((d) => ({ ...d, services: d.services.map((row, j) => (j === i ? { ...row, title: "", priceLabel: "" } : row)) }))}>
                    Clear this service
                  </button>
                )}
              </fieldset>
            ))}
            {services.length < 20 && (
              <button type="button" onClick={() => update((d) => ({ ...d, services: [...d.services, { title: "", priceLabel: "" }] }))} className="jata-btn jata-btn-secondary">+ Add another service</button>
            )}
            <p className="jata-section-title pt-2">Services & offer</p>
            <Field id="offer-title" label="Today's offer" hint="Optional. Shown above your services.">
              <input value={offer.title} maxLength={120} onChange={(e) => update((d) => ({ ...d, offer: { ...d.offer, title: e.target.value } }))} />
            </Field>
            <Field id="offer-subtitle" label="Offer detail">
              <input value={offer.subtitle} maxLength={120} onChange={(e) => update((d) => ({ ...d, offer: { ...d.offer, subtitle: e.target.value } }))} />
            </Field>
          </div>
        )}

        {step === 5 && (
          <div className="mt-4 space-y-3">
            <Field id="onboard-description" label="Short description" hint="One or two sentences about what you do.">
              <textarea rows={3} maxLength={1000} value={form.description} onChange={(e) => setForm({ description: e.target.value })} />
            </Field>
            <Field id="onboard-banner" label="After-call message" hint="Shown at the top of your page, e.g. “Asante for calling!”">
              <input value={form.aftercallMsg} maxLength={120} onChange={(e) => setForm({ aftercallMsg: e.target.value })} />
            </Field>
            <fieldset>
              <legend className="jata-label">Page style</legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                {[
                  { k: "clean", l: "Clean", d: "White minimal" },
                  { k: "dark", l: "Dark", d: "Premium dark" },
                  { k: "warm", l: "Warm", d: "Kenyan warm" },
                ].map((t) => (
                  <button key={t.k} type="button" aria-pressed={form.theme === t.k} onClick={() => setForm({ theme: t.k })} className="min-h-11 rounded-xl border p-3 text-left">
                    <span className="block text-sm font-bold">{t.l}{form.theme === t.k ? " ✓" : ""}</span>
                    <span className="block text-sm text-zinc-600">{t.d}</span>
                  </button>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        {step === 6 && business && (
          <div className="mt-4 space-y-3">
            <p className="jata-section-title">Choose a subscription plan</p>
            <div className="rounded-xl bg-zinc-50 p-4 text-sm">
              <p className="font-bold">{business.name}</p>
              <p className="text-sm text-zinc-600">Business saved · /b/{business.slug}</p>
            </div>
            {plans.length ? <div className="grid gap-3 sm:grid-cols-2">{plans.map((plan) => (
              <a key={plan.id} href={getCheckoutUrl(business.id, plan.id)} className="rounded-xl border bg-white p-4 hover:bg-zinc-50">
                <p className="font-semibold">{plan.name}</p>
                <p className="mt-1 text-sm text-zinc-600">KES {plan.priceKES.toLocaleString()} · {plan.durationDays} days</p>
                <span className="mt-3 inline-flex rounded-full bg-zinc-900 px-4 py-2 text-sm font-semibold text-white">Continue to secure checkout</span>
              </a>
            ))}</div> : <p className="rounded-lg bg-amber-50 p-3 text-sm">No active plans are available right now. You can publish now and choose a plan later.</p>}
            <p className="text-sm text-zinc-600">Your setup is saved. After paying you can come back here to publish.</p>
          </div>
        )}

        {step === 7 && business && (
          <div className="mt-4 space-y-3">
            <div className="rounded-xl bg-zinc-50 p-4 text-sm">
              <p className="font-bold">{business.name}</p>
              <p className="text-sm text-zinc-600">/b/{business.slug}</p>
              <p className="mt-2 text-sm">Publishing is optional and does not require payment. Your page stays a draft until you publish it.</p>
            </div>
            <a href={`/b/${business.slug}`} target="_blank" rel="noopener noreferrer" className="jata-btn jata-btn-secondary w-full">Preview draft (opens in a new tab)</a>
            <Button disabled={loading} onClick={publish} className="w-full">{loading ? "Publishing…" : "Publish page"}</Button>
            <p className="text-center text-sm text-zinc-600">Put /b/{business.slug} on WhatsApp, social posts, posters, and receipts.</p>
            <button type="button" onClick={finishLater} className="jata-btn jata-btn-ghost w-full underline">Finish later — go to dashboard</button>
          </div>
        )}

        <div className="mt-6 flex flex-wrap items-center gap-2 border-t pt-4">
          {step > 1 && <Button variant="secondary" onClick={() => goTo(step - 1)} disabled={loading}>← Back</Button>}
          {step <= 5 && (
            <Button className="flex-1" disabled={loading} onClick={() => void continueFrom(step)}>
              {loading ? "Saving…" : step === 1 && !business ? "Save and continue" : "Continue"}
            </Button>
          )}
          {step === 6 && <Button className="flex-1" variant="secondary" onClick={() => goTo(7)}>Continue without payment</Button>}
        </div>
        <p role="status" aria-live="polite" className="mt-2 min-h-5 text-sm text-zinc-600">{statusText}</p>
      </div>

      <aside className="lg:sticky lg:top-4">
        <OnboardingPreview form={form} services={services} offer={offer} />
      </aside>
    </div>
  );
}
