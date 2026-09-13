"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const CATEGORIES = ["Restaurant","Salon","Barber","Mechanic","Real Estate","Professional Services","Retail","Home Services","Beauty","Food","Events","Other"];

export default function OnboardingForm({ plans }: { plans: { id: string; key: string; name: string; priceKES: number }[] }) {
  const [step, setStep] = useState(1);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const [business, setBusiness] = useState<any>(null);
  const [form, setForm] = useState({
    name: "",
    category: "Beauty",
    phone: "",
    whatsapp: "",
    location: "",
    description: "",
    theme: "clean",
    aftercallMsg: "Thanks for contacting us 👋",
  });
  const [services, setServices] = useState<{ title: string; priceLabel: string }[]>([{ title: "", priceLabel: "" }]);
  const [offer, setOffer] = useState({ title: "", subtitle: "" });
  const router = useRouter();

  async function createBusiness() {
    setErr("");
    setLoading(true);
    const res = await fetch("/api/business", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setErr(data.error || "Failed to create business");
      return;
    }
    setBusiness(data.business);
    setStep(2);
  }

  async function saveServices() {
    for (const s of services) {
      if (!s.title.trim()) continue;
      await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, title: s.title, priceLabel: s.priceLabel }),
      });
    }
    setStep(3);
  }

  async function saveOffer() {
    if (offer.title.trim()) {
      await fetch("/api/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: business.id, title: offer.title, subtitle: offer.subtitle }),
      });
    }
    setStep(4);
  }

  async function pay(planId: string) {
    setLoading(true);
    setErr("");
    const res = await fetch("/api/checkout", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: business.id, planId }),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setErr(data.error || "Checkout failed");
      return;
    }
    if (data.mock) {
      // Mock flow: auto-verify
      const verify = await fetch(`/api/paystack/verify?reference=${data.reference}&mock=success`);
      const vdata = await verify.json().catch(() => ({}));
      if (!verify.ok) {
        setErr(vdata.error || "Mock verification failed");
        return;
      }
      setStep(5);
      return;
    }
    if (data.authorization_url) {
      window.location.href = data.authorization_url;
    }
  }

  async function publish() {
    const res = await fetch("/api/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: business.id, isPublished: true }),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setErr(d.error || "Publish failed");
      return;
    }
    router.push(`/b/${business.slug}`);
  }

  return (
    <div className="mt-6 rounded-2xl border bg-white p-5">
      <div className="flex gap-2 text-xs">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n} className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold ${step >= n ? "bg-zinc-900 text-white" : "border"}`}>{n}</span>
        ))}
        <span className="ml-2 self-center text-xs text-zinc-500">Step {step} of 5</span>
      </div>

      {err && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-700">{err}</p>}

      {step === 1 && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold">Business information</p>
          <input className="w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Business name *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          <select className="w-full rounded-xl border px-3 py-2.5 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <div className="grid grid-cols-2 gap-3">
            <input className="rounded-xl border px-3 py-2.5 text-sm" placeholder="Phone *" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <input className="rounded-xl border px-3 py-2.5 text-sm" placeholder="WhatsApp (same if empty)" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
          </div>
          <input className="w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Location e.g. Kitengela, Nairobi" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          <textarea className="w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Short description (value prop)" rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          <input className="w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="AfterCall banner — Thanks for contacting us 👋" value={form.aftercallMsg} onChange={(e) => setForm({ ...form, aftercallMsg: e.target.value })} />
          <p className="text-xs font-semibold">Choose style</p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { k: "clean", l: "Clean", d: "White minimal" },
              { k: "dark", l: "Dark", d: "Premium dark" },
              { k: "warm", l: "Warm", d: "Kenyan warm" },
            ].map((t) => (
              <button key={t.k} onClick={() => setForm({ ...form, theme: t.k })} className={`rounded-xl border p-3 text-left ${form.theme === t.k ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white"}`}>
                <p className="text-sm font-bold">{t.l}</p><p className={`text-xs ${form.theme === t.k ? "text-zinc-300" : "text-zinc-500"}`}>{t.d}</p>
              </button>
            ))}
          </div>
          <button disabled={loading || !form.name || !form.phone} onClick={createBusiness} className="w-full rounded-full bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-40">
            {loading ? "Creating…" : "Continue → Services"}
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold">Add services/products (optional)</p>
          <p className="text-xs text-zinc-500">Example: Braiding — From KES 1,500</p>
          {services.map((s, i) => (
            <div key={i} className="flex gap-2">
              <input className="flex-1 rounded-xl border px-3 py-2 text-sm" placeholder="Service name" value={s.title} onChange={(e) => { const c = [...services]; c[i].title = e.target.value; setServices(c); }} />
              <input className="flex-1 rounded-xl border px-3 py-2 text-sm" placeholder="Price e.g. From KES 1,500" value={s.priceLabel} onChange={(e) => { const c = [...services]; c[i].priceLabel = e.target.value; setServices(c); }} />
            </div>
          ))}
          <button onClick={() => setServices([...services, { title: "", priceLabel: "" }])} className="text-xs font-semibold underline">+ Add another</button>
          <div className="flex gap-2">
            <button onClick={() => setStep(3)} className="flex-1 rounded-full border py-2.5 text-sm font-semibold">Skip</button>
            <button onClick={saveServices} className="flex-1 rounded-full bg-zinc-900 py-2.5 text-sm font-semibold text-white">Save & continue</button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold">Add today&apos;s offer (optional)</p>
          <input className="w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Offer title e.g. Braids from KES 1,500" value={offer.title} onChange={(e) => setOffer({ ...offer, title: e.target.value })} />
          <input className="w-full rounded-xl border px-3 py-2.5 text-sm" placeholder="Subtitle e.g. This week only" value={offer.subtitle} onChange={(e) => setOffer({ ...offer, subtitle: e.target.value })} />
          <div className="flex gap-2">
            <button onClick={() => setStep(4)} className="flex-1 rounded-full border py-2.5 text-sm font-semibold">Skip</button>
            <button onClick={saveOffer} className="flex-1 rounded-full bg-zinc-900 py-2.5 text-sm font-semibold text-white">Save & continue</button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="mt-4 space-y-3">
          <p className="text-sm font-semibold">Preview & pay</p>
          <div className="rounded-xl bg-zinc-50 p-4 text-sm">
            <p className="font-bold">{business?.name} — /b/{business?.slug}</p>
            <p className="text-xs text-zinc-600">{form.category} • {form.location}</p>
            <p className="mt-2 text-xs">Choose plan — amount is set server-side. Pay via Paystack (JATA ATLAS 2006074).</p>
          </div>
          <div className="grid gap-2">
            {plans.map((p) => (
              <button key={p.id} disabled={loading} onClick={() => pay(p.id)} className="rounded-xl border bg-white px-4 py-3 text-left hover:bg-zinc-50 disabled:opacity-50">
                <p className="text-sm font-semibold">{p.name}</p>
                <p className="text-xs text-zinc-500">KES {p.priceKES} — Pay with Paystack</p>
              </button>
            ))}
          </div>
          <a href={`/b/${business?.slug}`} target="_blank" className="block text-center text-xs font-semibold underline">Preview page (before payment) →</a>
          <p className="text-center text-xs text-zinc-500">Payment verified server-side. Webhook authoritative.</p>
        </div>
      )}

      {step === 5 && (
        <div className="mt-4 space-y-3 text-center">
          <p className="text-lg font-bold">Payment verified ✓</p>
          <p className="text-sm text-zinc-600">Your subscription is active. Preview then publish your page.</p>
          <a href={`/b/${business.slug}`} target="_blank" className="inline-flex rounded-full border px-5 py-2 text-sm font-semibold">Preview page</a>
          <button onClick={publish} className="w-full rounded-full bg-zinc-900 py-3 text-sm font-semibold text-white">Publish page →</button>
          <p className="text-xs text-zinc-500">Put <code className="rounded bg-zinc-100 px-1">/b/{business.slug}</code> on WhatsApp, social, posters & receipts.</p>
        </div>
      )}
    </div>
  );
}
