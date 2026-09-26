"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { SAFE_ERRORS } from "@/lib/safeError";

const CATEGORIES = ["Restaurant", "Salon", "Barber", "Mechanic", "Real Estate", "Professional Services", "Retail", "Home Services", "Beauty", "Food", "Events", "Other"];
const STEPS = ["Business", "Services & offer", "Publish"] as const;

export default function OnboardingForm() {
  const [step, setStep] = useState(1);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [business, setBusiness] = useState<{ id: string; slug: string; name: string } | null>(null);
  const [form, setForm] = useState({
    name: "",
    category: "Beauty",
    phone: "",
    whatsapp: "",
    location: "",
    description: "",
    theme: "clean",
    aftercallMsg: "Thanks for contacting us",
  });
  const [services, setServices] = useState<{ title: string; priceLabel: string }[]>([{ title: "", priceLabel: "" }]);
  const [offer, setOffer] = useState({ title: "", subtitle: "" });
  const router = useRouter();

  async function createBusiness() {
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/business", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || SAFE_ERRORS.businessFailed);
        return;
      }
      setBusiness(data.business);
      setStep(2);
    } catch {
      setErr(SAFE_ERRORS.businessFailed);
    } finally {
      setLoading(false);
    }
  }

  async function saveServicesAndOffer() {
    if (!business) return;
    setErr("");
    setLoading(true);
    try {
      for (const s of services) {
        if (!s.title.trim()) continue;
        const res = await fetch("/api/services", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId: business.id, title: s.title, priceLabel: s.priceLabel }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setErr(data.error || SAFE_ERRORS.serviceFailed);
          return;
        }
      }
      if (offer.title.trim()) {
        const res = await fetch("/api/offer", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ businessId: business.id, title: offer.title, subtitle: offer.subtitle }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setErr(data.error || SAFE_ERRORS.offerFailed);
          return;
        }
      }
      setStep(3);
    } catch {
      setErr(SAFE_ERRORS.saveFailed);
    } finally {
      setLoading(false);
    }
  }

  async function publish() {
    if (!business) return;
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, isPublished: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || SAFE_ERRORS.publishFailed);
        return;
      }
      router.push(`/b/${business.slug}`);
      router.refresh();
    } catch {
      setErr(SAFE_ERRORS.publishFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="jata-card mt-6 p-5">
      <ol className="flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, index) => {
          const n = index + 1;
          const active = step === n;
          const done = step > n;
          return (
            <li key={label} className={`rounded-full px-3 py-1 font-semibold ${active || done ? "bg-zinc-900 text-white" : "border border-zinc-200 text-zinc-500"}`}>
              {n}. {label}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-xs text-zinc-500">Step {step} of 3. Publishing does not require payment.</p>
      <FormError>{err}</FormError>

      {step === 1 && (
        <div className="mt-4 space-y-3">
          <p className="jata-section-title">Business</p>
          <Field id="onboard-name" label="Business name" hint="This is the name customers will see.">
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          </Field>
          <Field id="onboard-category" label="Category">
            <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="onboard-phone" label="Phone" hint="Customers tap this to call.">
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} inputMode="tel" />
            </Field>
            <Field id="onboard-whatsapp" label="WhatsApp" hint="Leave blank to use the phone number.">
              <input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} inputMode="tel" />
            </Field>
          </div>
          <Field id="onboard-location" label="Location" hint="For example Kitengela, Nairobi.">
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </Field>
          <Field id="onboard-description" label="Short description">
            <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </Field>
          <Field id="onboard-banner" label="After-call banner">
            <input value={form.aftercallMsg} onChange={(e) => setForm({ ...form, aftercallMsg: e.target.value })} />
          </Field>
          <fieldset>
            <legend className="jata-label">Style</legend>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {[
                { k: "clean", l: "Clean", d: "White minimal" },
                { k: "dark", l: "Dark", d: "Premium dark" },
                { k: "warm", l: "Warm", d: "Kenyan warm" },
              ].map((t) => (
                <button key={t.k} type="button" onClick={() => setForm({ ...form, theme: t.k })} className={`rounded-xl border p-3 text-left ${form.theme === t.k ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white"}`}>
                  <p className="text-sm font-bold">{t.l}</p>
                  <p className={`text-xs ${form.theme === t.k ? "text-zinc-300" : "text-zinc-500"}`}>{t.d}</p>
                </button>
              ))}
            </div>
          </fieldset>
          <Button disabled={loading || form.name.trim().length < 2} onClick={createBusiness} className="w-full">
            {loading ? "Saving…" : "Continue to services and offer"}
          </Button>
        </div>
      )}

      {step === 2 && (
        <div className="mt-4 space-y-3">
          <p className="jata-section-title">Services and offer</p>
          <p className="text-xs text-zinc-500">Add what you sell. You can skip and add these later.</p>
          {services.map((s, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-2">
              <Field id={`service-title-${i}`} label={`Service ${i + 1}`} hint="For example Braiding.">
                <input value={s.title} onChange={(e) => { const c = [...services]; c[i] = { ...c[i], title: e.target.value }; setServices(c); }} />
              </Field>
              <Field id={`service-price-${i}`} label="Price" hint="For example From KES 1,500.">
                <input value={s.priceLabel} onChange={(e) => { const c = [...services]; c[i] = { ...c[i], priceLabel: e.target.value }; setServices(c); }} />
              </Field>
            </div>
          ))}
          <button type="button" onClick={() => setServices([...services, { title: "", priceLabel: "" }])} className="text-xs font-semibold underline">+ Add another service</button>
          <Field id="offer-title" label="Today's offer" hint="Optional. Shown above your services.">
            <input value={offer.title} onChange={(e) => setOffer({ ...offer, title: e.target.value })} />
          </Field>
          <Field id="offer-subtitle" label="Offer detail">
            <input value={offer.subtitle} onChange={(e) => setOffer({ ...offer, subtitle: e.target.value })} />
          </Field>
          <div className="flex gap-2">
            <Button variant="secondary" className="flex-1" onClick={() => setStep(3)}>Skip</Button>
            <Button className="flex-1" disabled={loading} onClick={saveServicesAndOffer}>{loading ? "Saving…" : "Save and continue"}</Button>
          </div>
        </div>
      )}

      {step === 3 && business && (
        <div className="mt-4 space-y-3">
          <p className="jata-section-title">Publish</p>
          <div className="rounded-xl bg-zinc-50 p-4 text-sm">
            <p className="font-bold">{business.name}</p>
            <p className="text-xs text-zinc-600">/b/{business.slug}</p>
            <p className="mt-2 text-xs">You can publish now. Payment is not required to go live.</p>
          </div>
          <a href={`/b/${business.slug}`} target="_blank" rel="noopener noreferrer" className="block text-center text-sm font-semibold underline">Preview draft</a>
          <Button disabled={loading} onClick={publish} className="w-full">{loading ? "Publishing…" : "Publish page"}</Button>
          <p className="text-center text-xs text-zinc-500">Put /b/{business.slug} on WhatsApp, social posts, posters, and receipts.</p>
        </div>
      )}
    </div>
  );
}
