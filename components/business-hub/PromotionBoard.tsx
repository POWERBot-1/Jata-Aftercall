"use client";

/**
 * Promotional Spotlight management (Business Hub C).
 *
 * Create, edit, activate, deactivate and delete promotions with an Africa/Nairobi start and
 * expiry. The board shows the computed state of every row — Scheduled, Live, Paused or Expired —
 * so an expired promotion is visibly expired rather than silently still on the page.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Megaphone, Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import type { PromotionView } from "@/lib/business-hub/promotions";
import { formatBusinessDateTime, toBusinessLocalInput } from "@/lib/sale-pricing";

type Draft = {
  id?: string;
  title: string;
  subtitle: string;
  body: string;
  badge: string;
  discountLabel: string;
  imageUrl: string;
  ctaKind: "NONE" | "ORDER_REQUEST" | "WHATSAPP" | "CALL";
  ctaLabel: string;
  ctaValue: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  priority: number;
};

const EMPTY: Draft = {
  title: "",
  subtitle: "",
  body: "",
  badge: "",
  discountLabel: "",
  imageUrl: "",
  ctaKind: "ORDER_REQUEST",
  ctaLabel: "",
  ctaValue: "",
  startsAt: "",
  endsAt: "",
  isActive: true,
  priority: 0,
};

const STATE_TONE: Record<string, string> = {
  LIVE: "success",
  SCHEDULED: "info",
  PAUSED: "warning",
  EXPIRED: "neutral",
};

function defaultWindow() {
  const now = new Date();
  const start = toBusinessLocalInput(now);
  const end = toBusinessLocalInput(new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000));
  return { startsAt: start, endsAt: end };
}

export function PromotionBoard({ businessId, promotions }: { businessId: string; promotions: PromotionView[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startNew() {
    setError(null);
    setEditing({ ...EMPTY, ...defaultWindow() });
  }

  function startEdit(promotion: PromotionView) {
    setError(null);
    setEditing({
      id: promotion.id,
      title: promotion.title,
      subtitle: promotion.subtitle ?? "",
      body: promotion.body ?? "",
      badge: promotion.badge ?? "",
      discountLabel: promotion.discountLabel ?? "",
      imageUrl: promotion.imageUrl ?? "",
      ctaKind: promotion.ctaKind,
      ctaLabel: promotion.ctaLabel ?? "",
      ctaValue: promotion.ctaValue ?? "",
      startsAt: promotion.startsAtInput,
      endsAt: promotion.endsAtInput,
      isActive: promotion.isActive,
      priority: promotion.priority,
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    setError(null);
    const payload = {
      title: editing.title,
      subtitle: editing.subtitle,
      body: editing.body,
      badge: editing.badge,
      discountLabel: editing.discountLabel,
      imageUrl: editing.imageUrl,
      ctaKind: editing.ctaKind,
      ctaLabel: editing.ctaLabel,
      ctaValue: editing.ctaValue,
      startsAt: editing.startsAt,
      endsAt: editing.endsAt,
      isActive: editing.isActive,
      priority: editing.priority,
    };
    try {
      const response = await fetch(
        editing.id ? `/api/business/${businessId}/promotions/${editing.id}` : `/api/business/${businessId}/promotions`,
        { method: editing.id ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      );
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't save that promotion.");
        return;
      }
      setEditing(null);
      router.refresh();
    } catch {
      setError("We couldn't reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(promotion: PromotionView) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/business/${businessId}/promotions/${promotion.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !promotion.isActive }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "We couldn't update that promotion.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function remove(promotion: PromotionView) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/business/${businessId}/promotions/${promotion.id}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "We couldn't delete that promotion.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  const live = promotions.filter((promotion) => promotion.state === "LIVE").length;

  return (
    <div className="space-y-4">
      <div className="jata-toolbar">
        <p className="text-sm text-zinc-600">
          {promotions.length} promotion{promotions.length === 1 ? "" : "s"} · {live} live now
        </p>
        <button type="button" className="jata-btn jata-btn-primary" onClick={startNew} disabled={busy}>
          <Plus size={15} aria-hidden="true" /> New promotion
        </button>
      </div>

      {error ? (
        <p className="jata-error text-sm" role="alert">
          {error}
        </p>
      ) : null}

      {editing ? (
        <form onSubmit={save} className="jata-card space-y-3">
          <h2 className="text-sm font-bold">{editing.id ? "Edit promotion" : "New promotion"}</h2>

          <div className="jata-field">
            <label className="jata-label" htmlFor="promotion-title">
              Title
            </label>
            <input id="promotion-title" className="jata-input" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} maxLength={90} required placeholder="Weekend combo — 2 plates for KES 900" />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="jata-field">
              <label className="jata-label" htmlFor="promotion-subtitle">
                Short line <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input id="promotion-subtitle" className="jata-input" value={editing.subtitle} onChange={(event) => setEditing({ ...editing, subtitle: event.target.value })} maxLength={120} />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="promotion-badge">
                Badge <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input id="promotion-badge" className="jata-input" value={editing.badge} onChange={(event) => setEditing({ ...editing, badge: event.target.value })} maxLength={24} placeholder="New · Limited · Offer" />
            </div>
          </div>

          <div className="jata-field">
            <label className="jata-label" htmlFor="promotion-body">
              Details <span className="font-normal text-zinc-500">(optional)</span>
            </label>
            <textarea id="promotion-body" className="jata-input min-h-20" value={editing.body} onChange={(event) => setEditing({ ...editing, body: event.target.value })} maxLength={600} />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="jata-field">
              <label className="jata-label" htmlFor="promotion-discount">
                Discount label <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input id="promotion-discount" className="jata-input" value={editing.discountLabel} onChange={(event) => setEditing({ ...editing, discountLabel: event.target.value })} maxLength={40} placeholder="Save KES 200" />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="promotion-image">
                Image URL <span className="font-normal text-zinc-500">(optional)</span>
              </label>
              <input id="promotion-image" className="jata-input" value={editing.imageUrl} onChange={(event) => setEditing({ ...editing, imageUrl: event.target.value })} maxLength={600} inputMode="url" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="jata-field">
              <label className="jata-label" htmlFor="promotion-starts">
                Starts (Nairobi time)
              </label>
              <input id="promotion-starts" type="datetime-local" className="jata-input" value={editing.startsAt} onChange={(event) => setEditing({ ...editing, startsAt: event.target.value })} required />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="promotion-ends">
                Ends (Nairobi time)
              </label>
              <input id="promotion-ends" type="datetime-local" className="jata-input" value={editing.endsAt} onChange={(event) => setEditing({ ...editing, endsAt: event.target.value })} required />
            </div>
          </div>
          <p className="jata-hint">Times are Africa/Nairobi. The promotion stops the moment its end time passes.</p>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="jata-field">
              <label className="jata-label" htmlFor="promotion-cta-kind">
                Button
              </label>
              <select id="promotion-cta-kind" className="jata-input" value={editing.ctaKind} onChange={(event) => setEditing({ ...editing, ctaKind: event.target.value as Draft["ctaKind"] })}>
                <option value="ORDER_REQUEST">Order request</option>
                <option value="WHATSAPP">WhatsApp</option>
                <option value="CALL">Call</option>
                <option value="NONE">No button</option>
              </select>
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="promotion-cta-label">
                Button label
              </label>
              <input id="promotion-cta-label" className="jata-input" value={editing.ctaLabel} onChange={(event) => setEditing({ ...editing, ctaLabel: event.target.value })} maxLength={40} placeholder="Order now" />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="promotion-cta-value">
                WhatsApp or call number
              </label>
              <input id="promotion-cta-value" className="jata-input" value={editing.ctaValue} onChange={(event) => setEditing({ ...editing, ctaValue: event.target.value })} maxLength={40} placeholder="0712 345 678" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={editing.isActive} onChange={(event) => setEditing({ ...editing, isActive: event.target.checked })} />
            Promotion is active (uncheck to pause it)
          </label>

          <div className="flex flex-wrap gap-2">
            <button type="submit" className="jata-btn jata-btn-primary" disabled={busy}>
              {busy ? <Loader2 size={15} aria-hidden="true" className="animate-spin" /> : null}
              {editing.id ? "Save changes" : "Publish promotion"}
            </button>
            <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setEditing(null)} disabled={busy}>
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      {promotions.length === 0 ? (
        <div className="jata-empty">
          <Megaphone size={20} aria-hidden="true" />
          <p className="text-sm font-semibold">No promotions yet</p>
          <p className="mt-1 text-sm text-zinc-600">Highlight an offer, a new product or an announcement on your page.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {promotions.map((promotion) => (
            <li key={promotion.id} className="jata-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold">{promotion.title}</p>
                  {promotion.subtitle ? <p className="text-sm text-zinc-600">{promotion.subtitle}</p> : null}
                  <p className="text-xs text-zinc-600">
                    {formatBusinessDateTime(new Date(promotion.startsAt))} → {formatBusinessDateTime(new Date(promotion.endsAt))}
                  </p>
                </div>
                <span className="jata-pill" data-tone={STATE_TONE[promotion.state] ?? "neutral"}>
                  {promotion.state}
                </span>
              </div>
              {promotion.body ? <p className="mt-2 text-sm">{promotion.body}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="jata-btn jata-btn-secondary" onClick={() => startEdit(promotion)} disabled={busy}>
                  <Pencil size={15} aria-hidden="true" /> Edit
                </button>
                <button type="button" className="jata-btn jata-btn-secondary" onClick={() => toggleActive(promotion)} disabled={busy}>
                  {promotion.isActive ? <Pause size={15} aria-hidden="true" /> : <Play size={15} aria-hidden="true" />}
                  {promotion.isActive ? "Pause" : "Activate"}
                </button>
                <button type="button" className="jata-btn jata-btn-secondary" onClick={() => remove(promotion)} disabled={busy}>
                  <Trash2 size={15} aria-hidden="true" /> Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default PromotionBoard;
