"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";
import { LocationFields, locationError } from "@/components/LocationFields";
import { SAFE_ERRORS } from "@/lib/safeError";
import { getSubscriptionPageUrl } from "@/lib/subscriptionFlow";
import { nextActionFor } from "@/lib/nextAction";
import { businessStatusLabel, subscriptionStatusLabel, toneClass } from "@/lib/statusLabels";
import ReferralShareCard from "@/components/ReferralShareCard";

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
  lat?: number | null;
  lng?: number | null;
  description?: string | null;
  aftercallMsg?: string | null;
  publicUrl: string;
  /** Stage 2: the owner's own referral link, when the page is eligible to share one. */
  referralUrl?: string | null;
  subscription: { status: string; expiresAt: string | null; planName: string } | null;
  servicesCount: number;
  hasOffer: boolean;
};

type Metrics = { views: number; whatsapp: number; calls: number; directions: number; shares: number; serviceClicks?: number };
type Notice = { kind: "success" | "error"; text: string } | null;

function NoticeBar({ notice }: { notice: Notice }) {
  if (!notice) return <p role="status" aria-live="polite" className="sr-only" />;
  if (notice.kind === "error") return <FormError>{notice.text}</FormError>;
  return <p role="status" aria-live="polite" className="jata-status alert-success">{notice.text}</p>;
}

export default function DashboardClient({ businesses, metricsMap }: { businesses: Biz[]; metricsMap: Record<string, Metrics> }) {
  if (businesses.length === 0) {
    return (
      <div className="jata-card mt-6 p-8 text-center">
        <h2 className="text-base font-semibold">No business page yet</h2>
        <p className="mt-1 text-sm text-zinc-600">Set one up in seven short steps. Your page goes live once your subscription payment is confirmed.</p>
        <Button href="/onboarding" className="mt-4">Start setup</Button>
      </div>
    );
  }
  return (
    <div className="mt-6 space-y-6">
      {businesses.map((b) => (
        <BusinessCard key={b.id} b={b} m={metricsMap[b.id] || { views: 0, whatsapp: 0, calls: 0, directions: 0, shares: 0, serviceClicks: 0 }} />
      ))}
    </div>
  );
}

type Section = "profile" | "services" | "offer" | null;

function BusinessCard({ b, m }: { b: Biz; m: Metrics }) {
  const router = useRouter();
  const [notice, setNotice] = useState<Notice>(null);
  const [open, setOpen] = useState<Section>(null);
  const [busy, setBusy] = useState(false);
  const sub = subscriptionStatusLabel(b.subscription?.status);
  const bizStatus = businessStatusLabel(b.status);
  const action = nextActionFor({
    isPublished: b.isPublished,
    hasContact: Boolean(b.phone || b.whatsapp),
    hasLocation: Boolean(b.location || (typeof b.lat === "number" && typeof b.lng === "number")),
    servicesCount: b.servicesCount,
    subscriptionStatus: b.subscription?.status ?? null,
    expiresAt: b.subscription?.expiresAt ?? null,
  });

  async function patch(body: Record<string, unknown>, success = "Saved.") {
    if (busy) return false;
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/business", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: b.id, ...body }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setNotice({ kind: "error", text: data.error || SAFE_ERRORS.saveFailed }); return false; }
      setNotice({ kind: "success", text: success });
      router.refresh();
      return true;
    } catch {
      setNotice({ kind: "error", text: SAFE_ERRORS.saveFailed });
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId: b.id, eventType: "SHARE_CLICK" }),
    }).catch(() => {});
    if (navigator.share) { navigator.share({ title: b.name, url: b.publicUrl }).catch(() => {}); return; }
    try {
      await navigator.clipboard.writeText(b.publicUrl);
      setNotice({ kind: "success", text: "Link copied. Paste it into WhatsApp, SMS or social media." });
    } catch {
      setNotice({ kind: "success", text: `Copy your link: ${b.publicUrl}` });
    }
  }

  function actionControl() {
    switch (action.key) {
      case "add-contact":
      case "add-location":
        return <Button onClick={() => setOpen("profile")}>{action.key === "add-contact" ? "Add contact details" : "Add location"}</Button>;
      case "add-services":
        return <Button onClick={() => setOpen("services")}>Add a service</Button>;
      case "publish":
        return <Button disabled={busy} onClick={() => patch({ isPublished: true }, "Published. Your page is live.")}>Publish page</Button>;
      case "renew":
      case "subscribe":
        return <Button href={getSubscriptionPageUrl(b.id)}>{action.key === "renew" ? "Renew plan" : "Choose a plan"}</Button>;
      default:
        return <Button onClick={() => void share()}>Share page</Button>;
    }
  }

  return (
    <article className="jata-card p-5" aria-labelledby={`biz-${b.id}-name`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={`biz-${b.id}-name`} className="text-xl font-bold [overflow-wrap:anywhere]">{b.name}</h2>
          <p className="text-sm text-zinc-600 [overflow-wrap:anywhere]">{b.category} · /b/{b.slug}</p>
          <p className="mt-2 flex flex-wrap gap-2">
            <span className={b.isPublished ? "jata-live" : "jata-draft"}>{b.isPublished ? "Live" : "Draft"}</span>
            <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${toneClass(sub.tone)}`}>Plan: {sub.label}</span>
            {b.status === "SUSPENDED" && <span className={`rounded-full px-2 py-0.5 text-sm font-semibold ${toneClass(bizStatus.tone)}`}>{bizStatus.label}</span>}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button href={`/b/${b.slug}`} variant="secondary">{b.isPublished ? "View page" : "Preview"}</Button>
          {action.key !== "share" && <Button variant="secondary" onClick={() => void share()}>{b.isPublished ? "Share" : "Copy link"}</Button>}
        </div>
      </header>

      <div className="mt-3"><NoticeBar notice={notice} /></div>

      <section className="mt-4 rounded-xl border border-dashed bg-zinc-50 p-4" aria-label="Next step">
        <p className="text-sm font-bold uppercase tracking-widest text-zinc-600">Next step</p>
        <div className="mt-1 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold">{action.title}</p>
            <p className="text-sm text-zinc-600">{action.detail}</p>
          </div>
          {actionControl()}
        </div>
      </section>

      <section className="mt-4 flex flex-wrap items-center justify-between gap-2 text-sm" aria-label="Subscription">
        <p>
          <span className="font-semibold">Subscription:</span>{" "}
          {b.subscription ? `${b.subscription.planName} — ${sub.label}${b.subscription.expiresAt ? ` · until ${new Date(b.subscription.expiresAt).toLocaleDateString("en-KE")}` : ""}` : "No plan yet. Choose a plan to unlock publishing."}
          {sub.help ? ` ${sub.help}` : ""}
        </p>
        {action.key !== "renew" && action.key !== "subscribe" && (
          <Link href={getSubscriptionPageUrl(b.id)} className="jata-btn jata-btn-ghost underline">Manage plan</Link>
        )}
      </section>

      {b.referralUrl && <ReferralShareCard url={b.referralUrl} />}

      <section className="mt-4" aria-labelledby={`biz-${b.id}-activity`}>
        <h3 id={`biz-${b.id}-activity`} className="jata-section-title">Activity</h3>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">
          {([
            ["Views", m.views],
            ["WhatsApp", m.whatsapp],
            ["Calls", m.calls],
            ["Directions", m.directions],
            ["Shares", m.shares],
            ["Services", m.serviceClicks || 0],
          ] as const).map(([label, val]) => (
            <div key={label} className="flex flex-col-reverse rounded-xl bg-zinc-50 px-2 py-3">
              <dt className="text-zinc-600">{label}</dt>
              <dd className="text-lg font-bold">{val}</dd>
            </div>
          ))}
        </dl>
      </section>

      <div className="mt-4 space-y-2">
        <EditSection title="Edit profile, contact & location" open={open === "profile"} onToggle={(o) => setOpen(o ? "profile" : null)}>
          <EditForm business={b} busy={busy} onSave={(body) => patch(body, "Profile saved.")} />
        </EditSection>
        <EditSection title={`Services (${b.servicesCount} listed)`} open={open === "services"} onToggle={(o) => setOpen(o ? "services" : null)}>
          <ServiceManager businessId={b.id} onSaved={() => router.refresh()} />
        </EditSection>
        <EditSection title={b.hasOffer ? "Offer (live)" : "Offer (none yet)"} open={open === "offer"} onToggle={(o) => setOpen(o ? "offer" : null)}>
          <OfferManager businessId={b.id} onSaved={() => router.refresh()} />
        </EditSection>
      </div>

      {b.isPublished && (
        <div className="mt-4 border-t pt-3">
          <button type="button" disabled={busy} className="jata-btn jata-btn-ghost underline" onClick={() => patch({ isPublished: false }, "Unpublished. Your page is now a private draft.")}>Unpublish page</button>
        </div>
      )}
    </article>
  );
}

function EditSection({ title, open, onToggle, children }: { title: string; open: boolean; onToggle: (open: boolean) => void; children: React.ReactNode }) {
  return (
    <details className="rounded-2xl border" open={open} onToggle={(e) => { const next = (e.currentTarget as HTMLDetailsElement).open; if (next !== open) onToggle(next); }}>
      <summary className="flex min-h-11 cursor-pointer items-center px-4 text-sm font-semibold">{title}</summary>
      <div className="border-t px-4 pb-4">{children}</div>
    </details>
  );
}

function EditForm({ business, busy, onSave }: { business: Biz; busy: boolean; onSave: (patch: Record<string, unknown>) => Promise<boolean> }) {
  const [form, setForm] = useState({
    name: business.name,
    category: business.category,
    phone: business.phone || "",
    whatsapp: business.whatsapp || "",
    location: business.location || "",
    lat: business.lat === null || business.lat === undefined ? "" : String(business.lat),
    lng: business.lng === null || business.lng === undefined ? "" : String(business.lng),
    description: business.description || "",
    aftercallMsg: business.aftercallMsg || "",
    theme: business.theme,
  });
  const [problem, setProblem] = useState("");
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
      <LocationFields
        idPrefix={business.id}
        value={{ location: form.location, lat: form.lat, lng: form.lng }}
        onChange={(v) => setForm({ ...form, ...v })}
      />
      <Field id={`${business.id}-description`} label="Description">
        <textarea rows={2} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </Field>
      <Field id={`${business.id}-banner`} label="After-call message" hint="Shown at the top of your page.">
        <input maxLength={120} value={form.aftercallMsg} onChange={(e) => setForm({ ...form, aftercallMsg: e.target.value })} />
      </Field>
      <Field id={`${business.id}-theme`} label="Page style" hint="Clean, dark, or warm.">
        <select value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value })}>
          <option value="clean">Clean</option>
          <option value="dark">Dark</option>
          <option value="warm">Warm</option>
        </select>
      </Field>
      <FormError>{problem}</FormError>
      <Button disabled={busy} onClick={() => { const p = locationError(form); setProblem(p); if (!p) void onSave({ ...form, whatsapp: form.whatsapp || form.phone }); }}>{busy ? "Saving…" : "Save profile"}</Button>
    </div>
  );
}

function ServiceManager({ businessId, onSaved }: { businessId: string; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");
  const [msg, setMsg] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  async function add() {
    if (saving) return;
    if (title.trim().length < 2) { setMsg({ kind: "error", text: "Enter a service name (at least 2 characters)." }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/services", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, title, priceLabel: price || undefined }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ kind: "error", text: data.error || SAFE_ERRORS.serviceFailed }); return; }
      setMsg({ kind: "success", text: "Service saved." });
      setTitle("");
      setPrice("");
      onSaved();
    } catch {
      setMsg({ kind: "error", text: SAFE_ERRORS.serviceFailed });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <Field id={`${businessId}-service`} label="Service or product">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field id={`${businessId}-service-price`} label="Price label" hint="For example From KES 1,500.">
        <input value={price} onChange={(e) => setPrice(e.target.value)} />
      </Field>
      <Button disabled={saving} onClick={add}>{saving ? "Saving…" : "Add service"}</Button>
      <NoticeBar notice={msg} />
    </div>
  );
}

function OfferManager({ businessId, onSaved }: { businessId: string; onSaved: () => void }) {
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [msg, setMsg] = useState<Notice>(null);
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    if (!title.trim()) { setMsg({ kind: "error", text: "Enter an offer title." }); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/offer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, title, subtitle }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { setMsg({ kind: "error", text: data.error || SAFE_ERRORS.offerFailed }); return; }
      setMsg({ kind: "success", text: "Offer saved." });
      onSaved();
    } catch {
      setMsg({ kind: "error", text: SAFE_ERRORS.offerFailed });
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="mt-3 space-y-2">
      <Field id={`${businessId}-offer`} label="Offer title">
        <input value={title} onChange={(e) => setTitle(e.target.value)} />
      </Field>
      <Field id={`${businessId}-offer-sub`} label="Offer detail">
        <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
      </Field>
      <Button disabled={saving} onClick={save}>{saving ? "Saving…" : "Save offer"}</Button>
      <NoticeBar notice={msg} />
    </div>
  );
}
