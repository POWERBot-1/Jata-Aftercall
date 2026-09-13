"use client";
import { useState } from "react";

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

export default function DashboardClient({ businesses, metricsMap }: { businesses: Biz[]; metricsMap: Record<string, { views: number; whatsapp: number; calls: number; directions: number; shares: number }> }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [msg, setMsg] = useState("");

  async function togglePublish(b: Biz) {
    const res = await fetch("/api/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: b.id, isPublished: !b.isPublished }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(data.error || "Failed");
    else location.reload();
  }

  async function updateBusiness(b: Biz, patch: Record<string, unknown>) {
    const res = await fetch("/api/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: b.id, ...patch }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(data.error || "Update failed");
    else {
      setMsg("Saved ✓");
      setTimeout(() => location.reload(), 500);
    }
  }

  if (businesses.length === 0) {
    return (
      <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 bg-white p-8 text-center">
        <p className="text-sm font-semibold">No businesses yet</p>
        <p className="mt-1 text-sm text-zinc-600">Create your first page in ~5 minutes.</p>
        <a href="/onboarding" className="mt-4 inline-flex rounded-full bg-zinc-900 px-6 py-2.5 text-sm font-semibold text-white">Create business page</a>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-6">
      {msg && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">{msg}</p>}
      {businesses.map((b) => {
        const m = metricsMap[b.id] || { views: 0, whatsapp: 0, calls: 0, directions: 0, shares: 0 };
        return (
          <div key={b.id} className="rounded-2xl border border-zinc-200 bg-white p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold">{b.name}</h2>
                <p className="text-xs font-semibold uppercase tracking-widest text-zinc-500">{b.category} • {b.theme} theme</p>
                <p className="mt-1 text-sm">
                  <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${b.isPublished ? "bg-emerald-50 text-emerald-700" : "bg-zinc-100 text-zinc-600"}`}>
                    {b.isPublished ? "🟢 LIVE" : "⚪ DRAFT"}
                  </span>{" "}
                  <span className="ml-2 text-xs text-zinc-500">{b.subscription ? `${b.subscription.status} • ${b.subscription.planName}` : "No subscription"}</span>
                </p>
                <p className="mt-2 text-sm">
                  <a href={`/b/${b.slug}`} target="_blank" rel="noopener noreferrer" className="font-medium text-emerald-700 underline">{b.publicUrl}</a>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`/b/${b.slug}`} target="_blank" className="rounded-full border px-4 py-1.5 text-sm font-medium">Preview</a>
                <button onClick={() => togglePublish(b)} className={`rounded-full px-4 py-1.5 text-sm font-semibold ${b.isPublished ? "border" : "bg-zinc-900 text-white"}`}>
                  {b.isPublished ? "Unpublish" : "Publish"}
                </button>
              </div>
            </div>

            {/* Metrics */}
            <div className="mt-4 grid grid-cols-5 gap-2 text-center text-xs">
              {[
                ["Views", m.views],
                ["WhatsApp", m.whatsapp],
                ["Calls", m.calls],
                ["Directions", m.directions],
                ["Shares", m.shares],
              ].map(([label, val]) => (
                <div key={String(label)} className="rounded-xl bg-zinc-50 px-2 py-3">
                  <p className="text-lg font-bold">{val as number}</p>
                  <p className="text-zinc-500">{label as string}</p>
                </div>
              ))}
            </div>

            {/* Quick actions */}
            <div className="mt-4 flex flex-wrap gap-2 text-sm">
              <button onClick={() => setEditing(editing === b.id ? null : b.id)} className="rounded-full border px-4 py-1.5">Edit page</button>
              <a href={`/dashboard/subscription?businessId=${b.id}`} className="rounded-full border px-4 py-1.5">Subscription</a>
              <button
                onClick={() => {
                  if (navigator.share) navigator.share({ title: b.name, url: b.publicUrl }).catch(() => {});
                  else {
                    navigator.clipboard.writeText(b.publicUrl);
                    alert("Link copied");
                    fetch("/api/analytics/event", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ businessId: b.id, eventType: "SHARE_CLICK" }) });
                  }
                }}
                className="rounded-full bg-zinc-900 px-4 py-1.5 font-semibold text-white"
              >
                Share my page
              </button>
            </div>

            {editing === b.id && (
              <div className="mt-4 space-y-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-4">
                <p className="text-sm font-semibold">Edit page</p>
                <EditForm business={b} onSave={(patch) => updateBusiness(b, patch)} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <ServiceManager businessId={b.id} />
                  <OfferManager businessId={b.id} />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
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
    <div className="space-y-2">
      <input className="w-full rounded-xl border bg-white px-3 py-2 text-sm" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Business name" />
      <input className="w-full rounded-xl border bg-white px-3 py-2 text-sm" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} placeholder="Category" />
      <div className="grid grid-cols-2 gap-2">
        <input className="rounded-xl border bg-white px-3 py-2 text-sm" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="Phone" />
        <input className="rounded-xl border bg-white px-3 py-2 text-sm" value={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.value })} placeholder="WhatsApp" />
      </div>
      <input className="w-full rounded-xl border bg-white px-3 py-2 text-sm" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} placeholder="Location" />
      <textarea className="w-full rounded-xl border bg-white px-3 py-2 text-sm" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} placeholder="Short description" rows={2} />
      <input className="w-full rounded-xl border bg-white px-3 py-2 text-sm" value={form.aftercallMsg} onChange={(e) => setForm({ ...form, aftercallMsg: e.target.value })} placeholder='AfterCall banner e.g. Thanks for contacting us 👋' />
      <select className="w-full rounded-xl border bg-white px-3 py-2 text-sm" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
        <option value="clean">Clean — light minimal</option>
        <option value="dark">Dark — premium</option>
        <option value="warm">Warm — Kenyan SME</option>
      </select>
      <button onClick={() => onSave(form)} className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white">Save changes</button>
    </div>
  );
}

function ServiceManager({ businessId }: { businessId: string }) {
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
    if (!res.ok) setMsg(data.error || "Failed");
    else {
      setMsg("Added ✓");
      setTitle("");
      setPrice("");
      setTimeout(() => location.reload(), 400);
    }
  }
  return (
    <div className="rounded-xl border bg-white p-3">
      <p className="text-xs font-bold">Add service</p>
      <input className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm" placeholder="e.g. Braiding" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm" placeholder="Price label e.g. From KES 1,500" value={price} onChange={(e) => setPrice(e.target.value)} />
      <button onClick={add} className="mt-2 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white">Add service</button>
      {msg && <p className="mt-1 text-xs text-zinc-600">{msg}</p>}
    </div>
  );
}

function OfferManager({ businessId }: { businessId: string }) {
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
    if (!res.ok) setMsg(data.error || "Failed");
    else {
      setMsg("Offer saved ✓");
      setTimeout(() => location.reload(), 400);
    }
  }
  return (
    <div className="rounded-xl border bg-white p-3">
      <p className="text-xs font-bold">Edit offer</p>
      <input className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm" placeholder="Offer title e.g. Braids from KES 1,500" value={title} onChange={(e) => setTitle(e.target.value)} />
      <input className="mt-2 w-full rounded-lg border px-2 py-1.5 text-sm" placeholder="Subtitle e.g. This week only" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      <button onClick={save} className="mt-2 rounded-full bg-zinc-900 px-4 py-1.5 text-xs font-semibold text-white">Save offer</button>
      {msg && <p className="mt-1 text-xs text-zinc-600">{msg}</p>}
    </div>
  );
}
