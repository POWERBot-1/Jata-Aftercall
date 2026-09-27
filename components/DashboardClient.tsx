"use client";
import { useState } from "react";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { SAFE_ERRORS } from "@/lib/safeError";
import { getSubscriptionPageUrl } from "@/lib/subscriptionFlow";
import Link from "next/link";

type Biz = {
  id: string;
  slug: string;
  name: string;
  category: string;
  isPublished: boolean;
  status: string;
  theme: string;
  phone?: string | null;
  whatsapp?: string | null;
  location?: string | null;
  description?: string | null;
  aftercallMsg?: string | null;
  publicUrl: string;
  subscription: { status: string; expiresAt: string | null; planName: string } | null;
  servicesCount: number;
  hasOffer: boolean;
};

type Metrics = { views: number; whatsapp: number; calls: number; directions: number; shares: number; serviceClicks?: number };

export default function DashboardClient({ businesses, metricsMap }: { businesses: Biz[]; metricsMap: Record<string, Metrics> }) {
  const [msg, setMsg] = useState("");

  async function patch(b: Biz, body: Record<string, unknown>, success = "Saved.") {
    const res = await fetch("/api/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: b.id, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMsg(data.error || SAFE_ERRORS.saveFailed);
      return false;
    }
    setMsg(success);
    setTimeout(() => location.reload(), 400);
    return true;
  }

  if (businesses.length === 0) {
    return (
      <div className="jata-card mt-6 p-8 text-center">
        <p className="text-sm font-semibold">No business page yet</p>
        <p className="mt-1 text-sm text-zinc-600">Create one in three steps. Payment is not required to publish.</p>
        <Button href="/onboarding" className="mt-4">Start onboarding</Button>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      <FormError>{msg}</FormError>
      {businesses.map((b) => {
        const m = metricsMap[b.id] || { views: 0, whatsapp: 0, calls: 0, directions: 0, shares: 0, serviceClicks: 0 };
        const isActiveSub = b.subscription?.status === "ACTIVE";
        return (
          <article key={b.id} className="jata-card p-5">
            <header className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="jata-section-title">Identity</p>
                <h2 className="mt-1 text-xl font-bold">{b.name}</h2>
                <p className="text-sm text-zinc-600">{b.category} · /b/{b.slug} · {b.theme} theme</p>
                <p className="mt-2">
                  <span className={b.isPublished ? "jata-live" : "jata-draft"}>{b.isPublished ? "Live" : "Draft"}</span>
                  <span className="ml-2 text-xs text-zinc-500">{b.status}</span>
                  {b.subscription ? (
                    <span className={`ml-2 rounded-full px-2 py-0.5 text-xs font-semibold ${isActiveSub ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                      {b.subscription.status}
                    </span>
                  ) : (
                    <span className="ml-2 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">No subscription</span>
                  )}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button href={`/b/${b.slug}`} variant="secondary">View</Button>
                <Button onClick={() => sharePage(b)}>{b.isPublished ? "Share" : "Copy link"}</Button>
                <Button variant={b.isPublished ? "secondary" : "primary"} onClick={() => patch(b, { isPublished: !b.isPublished }, b.isPublished ? "Unpublished." : "Published. Payment was not required.")}>
                  {b.isPublished ? "Unpublish" : "Publish"}
                </Button>
              </div>
            </header>

            {/* Subscription CTA — authorized: Subscribe / View plans and pay */}
            <div className="mt-4 rounded-xl border border-dashed bg-zinc-50 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="text-xs font-bold uppercase tracking-widest text-zinc-500">Subscription</p>
                  {b.subscription ? (
                    <p className="mt-1 text-sm">
                      {b.subscription.planName} — {b.subscription.status}
                      {b.subscription.expiresAt ? ` · Expires ${new Date(b.subscription.expiresAt).toLocaleDateString()}` : ""}
                    </p>
                  ) : (
                    <p className="mt-1 text-sm text-zinc-600">No active subscription — subscribe to keep your page active beyond trial.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Link href={getSubscriptionPageUrl(b.id)} className="rounded-full bg-zinc-900 px-4 py-2 text-xs font-semibold text-white hover:bg-zinc-800">
                    {isActiveSub ? "View plans" : "Subscribe"}
                  </Link>
                  <Link href={getSubscriptionPageUrl(b.id)} className="rounded-full border bg-white px-4 py-2 text-xs font-semibold hover:bg-zinc-50">
                    View plans and pay
                  </Link>
                </div>
              </div>
            </div>

            <section className="mt-5">
              <p className="jata-section-title">Activity</p>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center text-xs sm:grid-cols-6">
                {[
                  ["Views", m.views],
                  ["WhatsApp", m.whatsapp],
                  ["Calls", m.calls],
                  ["Directions", m.directions],
                  ["Shares", m.shares],
                  ["Services", m.serviceClicks || 0],
                ].map(([label, val]) => (
                  <div key={String(label)} className="rounded-xl bg-zinc-50 px-2 py-3">
                    <p className="text-lg font-bold">{val as number}</p>
                    <p className="text-zinc-500">{label as string}</p>
                  </div>
                ))}
              </div>
            </section>

            <div className="mt-5 grid gap-4 lg:grid-cols-3">
              <section className="rounded-2xl border border-zinc-200 p-4 lg:col-span-1">
                <p className="jata-section-title">Profile</p>
                <EditForm business={b} onSave={(body) => patch(b, body)} />
              </section>
              <section className="rounded-2xl border border-zinc-200 p-4">
                <p className="jata-section-title">Services and products</p>
                <p className="mt-1 text-xs text-zinc-500">{b.servicesCount} listed</p>
                <ServiceManager businessId={b.id} onError={setMsg} />
              </section>
              <section className="rounded-2xl border border-zinc-200 p-4">
                <p className="jata-section-title">Offer</p>
                <p className="mt-1 text-xs text-zinc-500">{b.hasOffer ? "An offer is live." : "No offer yet."}</p>
                <OfferManager businessId={b.id} onError={setMsg} />
              </section>
            </div>
            {b.subscription ? (
              <p className="mt-4 text-xs text-zinc-500">Subscription: {b.subscription.status} · {b.subscription.planName}. This does not control whether the page is live.</p>
            ) : null}
          </article>
        );
      })}
    </div>
  );
}

function sharePage(b: Biz) {
  const url = b.publicUrl;
  if (navigator.share) {
    navigator.share({ title: b.name, url }).catch(() => {});
  } else {
    navigator.clipboard.writeText(url);
    alert("Link copied");
  }
  fetch("/api/analytics/event", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessId: b.id, eventType: "SHARE_CLICK" }),
  }).catch(() => {});
}

function EditForm({ business, onSave }: { business: Biz; onSave: (patch: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({
    name: business.name,
    category: business.category,
    phone: business.phone || "",
    whatsapp: business.whatsapp || "",
    location: business.location || "",
    description: business.description || "",
    aftercallMsg: business.aftercallMsg || "",
    theme: business.theme,
  });
  return (
    <div className="mt-3 space-y-2">
      <Field id={`${business.id}-name`} label="Business name">
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </Field>
      <Field id={`${business.id}-category`} label="Category">
        <input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
      </Field>
      <Field id={`${business.id}-phone`} label="Phone">
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
      </Field>
      <Field id={`${business.id}-whatsapp`} label="WhatsApp">
        <input value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} />
      </Field>
      <Field id={`${business.id}-location`} label="Location">
        <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
      </Field>
      <Field id={`${business.id}-description`} label="Description">
        <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field id={`${business.id}-theme`} label="Theme" hint="Clean, dark, or warm.">
        <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
          <option value="clean">Clean</option>
          <option value="dark">Dark</option>
          <option value="warm">Warm</option>
        </select>
      </Field>
      <Button onClick={() => onSave(form)}>Save profile</Button>
    </div>
  );
}

function ServiceManager({ businessId, onError }: { businessId: string; onError: (msg: string) => void }) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState("");
  async function add() {
    const res = await fetch("/api/services", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, title, priceLabel: price || undefined }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data.error || SAFE_ERRORS.serviceFailed;
      setMsg(message);
      onError(message);
      return;
    }
    setMsg("Service saved.");
    setTitle("");
    setPrice("");
    setTimeout(() => location.reload(), 400);
  }
  return (
    <div className="mt-3 space-y-2">
      <Field id={`${businessId}-service`} label="Service or product">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field id={`${businessId}-service-price`} label="Price label" hint="For example From KES 1,500.">
        <input value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Button onClick={add}>Add service</Button>
      <FormError>{msg && msg !== "Service saved." ? msg : ""}</FormError>
      {msg === "Service saved." ? <p className="text-xs text-emerald-700">{msg}</p> : null}
    </div>
  );
}

function OfferManager({ businessId, onError }: { businessId: string; onError: (msg: string) => void }) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [msg, setMsg] = useState("");
  async function save() {
    const res = await fetch("/api/offer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, title, subtitle }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = data.error || SAFE_ERRORS.offerFailed;
      setMsg(message);
      onError(message);
      return;
    }
    setMsg("Offer saved.");
    setTimeout(() => location.reload(), 400);
  }
  return (
    <div className="mt-3 space-y-2">
      <Field id={`${businessId}-offer`} label="Offer title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field id={`${businessId}-offer-sub`} label="Offer detail">
        <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      </Field>
      <Button onClick={save}>Save offer</Button>
      <FormError>{msg && msg !== "Offer saved." ? msg : ""}</FormError>
      {msg === "Offer saved." ? <p className="text-xs text-emerald-700">{msg}</p> : null}
    </div>
  );
}
