"use client";

/**
 * Theme & brand editor (§20, §21)
 *
 * Themes are shared tokens, not templates: every category can use any theme, and brand
 * colours are checked against WCAG AA before they are applied, so a customer-facing page can
 * never become unreadable because of an owner's colour choice (§21).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ExperienceDocument, ExperienceSettings } from "@/lib/experience/types";
import type { ThemeOption } from "./ThemeOption";
import { contrastRatio, readableTextOn } from "@/lib/experience/color";
import { MediaPicker } from "./MediaPicker";

export function ThemeEditor({
  businessId,
  document: initial,
  draftVersion,
  themes,
  showCommerce,
  showBooking,
}: {
  businessId: string;
  document: ExperienceDocument;
  /** The draft version this editor was rendered from. Every save sends it; a stale save is refused. */
  draftVersion: number | null;
  themes: ThemeOption[];
  showCommerce: boolean;
  showBooking: boolean;
}) {
  const router = useRouter();
  const [document, setDocument] = useState<ExperienceDocument>(initial);
  const [version, setVersion] = useState<number | null>(draftVersion);
  useEffect(() => setVersion(draftVersion), [draftVersion]);
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "saving"; text: string } | null>(null);

  async function save(patch: { themeKey?: string; brand?: Partial<ExperienceDocument["brand"]>; settings?: Partial<ExperienceSettings> }) {
    setMessage({ tone: "saving", text: "Saving…" });
    try {
      const response = await fetch("/api/experience", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, ...patch, expectedDraftVersion: version }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.code === "draft_version_conflict") {
        // Nothing was written. Reload the latest draft rather than saving over it.
        setMessage({ tone: "error", text: "Your website changed in another window, so this change was not saved. The page will reload to the latest draft. Nothing was overwritten." });
        router.refresh();
        return;
      }
      if (!response.ok) {
        setMessage({ tone: "error", text: data.error || "We couldn’t save that change." });
        return;
      }
      setDocument(data.document as ExperienceDocument);
      if (typeof data.experience?.draftVersion === "number") setVersion(data.experience.draftVersion);
      setMessage({ tone: "ok", text: "Saved ✓" });
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "We couldn’t reach the server. Please try again." });
    }
  }

  const brand = document.brand || {};

  return (
    <div className="space-y-5">
      <section className="jata-card">
        <h2 className="text-sm font-bold">Look & feel</h2>
        <p className="mt-1 text-sm text-zinc-600">Pick a starting point. You can change your colours underneath.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {themes.map((theme) => {
            const active = document.themeKey === theme.key;
            return (
              <button
                key={theme.key}
                type="button"
                aria-pressed={active}
                onClick={() => save({ themeKey: theme.key })}
                className={`rounded-2xl border p-3 text-left ${active ? "border-zinc-900 ring-2 ring-zinc-900" : "bg-white"}`}
              >
                <span className="flex gap-1" aria-hidden="true">
                  {theme.swatches.map((colour) => (
                    <span key={colour} className="h-6 flex-1 rounded" style={{ background: colour }} />
                  ))}
                </span>
                <span className="mt-2 block text-sm font-semibold">{theme.name}</span>
                <span className="block text-xs text-zinc-600">{theme.description}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="jata-card">
        <h2 className="text-sm font-bold">Brand</h2>
        <div className="mt-3 space-y-3">
          <div className="jata-field">
            <label className="jata-label" htmlFor="brand-name">Business name</label>
            <input id="brand-name" className="jata-input" value={brand.businessName || ""} onChange={(event) => setDocument({ ...document, brand: { ...brand, businessName: event.target.value } })} onBlur={(event) => save({ brand: { businessName: event.target.value } })} />
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="brand-tagline">Tagline</label>
            <input id="brand-tagline" className="jata-input" placeholder="One line customers remember" value={brand.tagline || ""} onChange={(event) => setDocument({ ...document, brand: { ...brand, tagline: event.target.value } })} onBlur={(event) => save({ brand: { tagline: event.target.value } })} />
          </div>
          <MediaPicker businessId={businessId} label="Logo" value={brand.logoUrl || ""} onChange={(url) => { setDocument({ ...document, brand: { ...brand, logoUrl: url } }); save({ brand: { logoUrl: url } }); }} />
          <MediaPicker businessId={businessId} label="Hero image" value={brand.heroImageUrl || ""} onChange={(url) => { setDocument({ ...document, brand: { ...brand, heroImageUrl: url } }); save({ brand: { heroImageUrl: url } }); }} />
        </div>
      </section>

      <section className="jata-card">
        <h2 className="text-sm font-bold">Colours</h2>
        <p className="mt-1 text-sm text-zinc-600">
          We keep text readable automatically. If a colour would make text hard to read, we adjust it and tell you.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <ColourField label="Primary" value={brand.primaryColor || "#111827"} onChange={(value) => { setDocument({ ...document, brand: { ...brand, primaryColor: value } }); save({ brand: { primaryColor: value } }); }} />
          <ColourField label="Secondary" value={brand.secondaryColor || "#f4f4f5"} onChange={(value) => { setDocument({ ...document, brand: { ...brand, secondaryColor: value } }); save({ brand: { secondaryColor: value } }); }} />
          <ColourField label="Accent" value={brand.accentColor || "#f59e0b"} onChange={(value) => { setDocument({ ...document, brand: { ...brand, accentColor: value } }); save({ brand: { accentColor: value } }); }} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold">Buttons</span>
          {(["solid", "soft", "outline", "pill"] as const).map((style) => (
            <button
              key={style}
              type="button"
              aria-pressed={(brand.buttonStyle || "solid") === style}
              className={`rounded-full border px-3 py-1 text-sm font-semibold capitalize ${(brand.buttonStyle || "solid") === style ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white"}`}
              onClick={() => { setDocument({ ...document, brand: { ...brand, buttonStyle: style } }); save({ brand: { buttonStyle: style } }); }}
            >
              {style}
            </button>
          ))}
        </div>
      </section>

      <section className="jata-card">
        <h2 className="text-sm font-bold">Contact & fulfilment</h2>
        <p className="mt-1 text-sm text-zinc-600">These details appear on your site and drive the WhatsApp, call and directions buttons.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="jata-field">
            <label className="jata-label" htmlFor="set-phone">Phone</label>
            <input id="set-phone" className="jata-input" value={document.settings?.phone || ""} onChange={(event) => setDocument({ ...document, settings: { ...document.settings, phone: event.target.value } })} onBlur={(event) => save({ settings: { phone: event.target.value } })} />
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="set-whatsapp">WhatsApp</label>
            <input id="set-whatsapp" className="jata-input" value={document.settings?.whatsapp || ""} onChange={(event) => setDocument({ ...document, settings: { ...document.settings, whatsapp: event.target.value } })} onBlur={(event) => save({ settings: { whatsapp: event.target.value } })} />
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="set-email">Email</label>
            <input id="set-email" className="jata-input" value={document.settings?.email || ""} onChange={(event) => setDocument({ ...document, settings: { ...document.settings, email: event.target.value } })} onBlur={(event) => save({ settings: { email: event.target.value } })} />
          </div>
          <div className="jata-field">
            <label className="jata-label" htmlFor="set-location">Location</label>
            <input id="set-location" className="jata-input" value={document.settings?.location || ""} onChange={(event) => setDocument({ ...document, settings: { ...document.settings, location: event.target.value } })} onBlur={(event) => save({ settings: { location: event.target.value } })} />
          </div>
        </div>

        {showCommerce ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="jata-field">
              <label className="jata-label" htmlFor="set-delivery-fee">Delivery fee (KES)</label>
              <input id="set-delivery-fee" type="number" min={0} className="jata-input" value={document.settings?.deliveryFeeKES ?? ""} onChange={(event) => setDocument({ ...document, settings: { ...document.settings, deliveryFeeKES: event.target.value === "" ? 0 : Number(event.target.value) } })} onBlur={(event) => save({ settings: { deliveryFeeKES: event.target.value === "" ? 0 : Number(event.target.value) } })} />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="set-min-order">Minimum order (KES)</label>
              <input id="set-min-order" type="number" min={0} className="jata-input" value={document.settings?.minOrderKES ?? ""} onChange={(event) => setDocument({ ...document, settings: { ...document.settings, minOrderKES: event.target.value === "" ? 0 : Number(event.target.value) } })} onBlur={(event) => save({ settings: { minOrderKES: event.target.value === "" ? 0 : Number(event.target.value) } })} />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="set-delivery-note">Delivery note</label>
              <input id="set-delivery-note" className="jata-input" value={document.settings?.deliveryNote || ""} onChange={(event) => setDocument({ ...document, settings: { ...document.settings, deliveryNote: event.target.value } })} onBlur={(event) => save({ settings: { deliveryNote: event.target.value } })} />
            </div>
          </div>
        ) : null}

        {showBooking ? (
          <div className="mt-4 jata-field">
            <label className="jata-label" htmlFor="set-slot">Appointment length (minutes)</label>
            <input id="set-slot" type="number" min={5} className="jata-input" value={document.settings?.bookingSlotMinutes ?? 30} onChange={(event) => setDocument({ ...document, settings: { ...document.settings, bookingSlotMinutes: Number(event.target.value) || 30 } })} onBlur={(event) => save({ settings: { bookingSlotMinutes: Number(event.target.value) || 30 } })} />
          </div>
        ) : null}
      </section>

      {message ? (
        <p className={`text-sm ${message.tone === "error" ? "jata-error" : "text-emerald-700"}`} role="status">
          {message.text}
        </p>
      ) : null}
    </div>
  );
}

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  const ratio = contrastRatio(value, readableTextOn(value));
  return (
    <div className="jata-field">
      <label className="jata-label" htmlFor={`colour-${label}`}>{label}</label>
      <div className="flex items-center gap-2">
        <input
          id={`colour-${label}`}
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-12 rounded border bg-white"
        />
        <span
          className="flex-1 rounded-lg border px-3 py-2 text-sm font-semibold"
          style={{ background: value, color: readableTextOn(value) }}
        >
          Sample text
        </span>
      </div>
      <p className="jata-hint">
        {ratio !== null && ratio >= 4.5 ? "Meets AA contrast." : "We’ll darken or lighten text automatically to stay readable."}
      </p>
    </div>
  );
}
