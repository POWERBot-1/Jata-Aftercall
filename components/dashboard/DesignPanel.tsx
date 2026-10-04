"use client";

/**
 * Design studio (§8, §26, §30, §44, §52)
 *
 * Three things an owner actually needs on one screen:
 *
 *   1. A complete visual direction — chosen, not assembled from jargon — which sets theme,
 *      brand colours, button shape and the photography language used by AI generation.
 *   2. A brand kit: logo, colours, button style, tone.
 *   3. Guided SEO: title, description and social preview image, with AI suggestions that use
 *      only the business's own facts.
 *
 * "Help me write this" suggests; it never saves. Applying a direction is reversible: the previous
 * document is restored with one tap.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ExperienceDocument } from "@/lib/experience/types";
import { MediaPicker } from "./MediaPicker";
import type { DesignDirection } from "@/lib/studio/designDirections";

type ThemeOption = { key: string; name: string; description: string; swatches: string[] };

export function DesignPanel({
  businessId,
  document: initial,
  directions,
  themes,
  currentDirectionKey,
}: {
  businessId: string;
  document: ExperienceDocument;
  directions: DesignDirection[];
  themes: ThemeOption[];
  currentDirectionKey: string | null;
}) {
  const router = useRouter();
  const [document, setDocument] = useState<ExperienceDocument>(initial);
  const [undoSnapshot, setUndoSnapshot] = useState<ExperienceDocument | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error" | "saving"; text: string } | null>(null);
  const [seoSuggestions, setSeoSuggestions] = useState<string[]>([]);
  const [seoBusy, setSeoBusy] = useState(false);

  async function save(patch: Record<string, unknown>, note: string) {
    setBusy(note);
    setMessage({ tone: "saving", text: "Saving…" });
    const before = document;
    try {
      const response = await fetch("/api/experience", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, ...patch }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage({ tone: "error", text: data.error || "We couldn't save that change." });
        return false;
      }
      setUndoSnapshot(before);
      setDocument(data.document as ExperienceDocument);
      setMessage({ tone: "ok", text: `Saved ✓ ${note} — preview it, or undo if you prefer the previous look.` });
      router.refresh();
      return true;
    } catch {
      setMessage({ tone: "error", text: "We couldn't reach the server. Please try again." });
      return false;
    } finally {
      setBusy("");
    }
  }

  async function undo() {
    if (!undoSnapshot) return;
    const snapshot = undoSnapshot;
    setUndoSnapshot(null);
    await save({ document: snapshot }, "Reverted");
  }

  async function applyDirection(direction: DesignDirection) {
    await save(
      {
        themeKey: direction.themeKey,
        brand: { ...direction.brand },
        photographyStyle: direction.photographyStyle,
        designDirectionKey: direction.key,
      },
      `${direction.name} applied`,
    );
  }

  async function suggestSeo(kind: "SEO_TITLE" | "SEO_DESCRIPTION") {
    setSeoBusy(true);
    setSeoSuggestions([]);
    try {
      const response = await fetch("/api/experience/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          kind,
          name: document.brand.businessName,
          businessName: document.brand.businessName,
          categoryKey: document.categoryKey,
          location: document.settings.location,
          notes: document.brand.description,
        }),
      });
      const data = await response.json().catch(() => ({}));
      setSeoSuggestions(Array.isArray(data.suggestions) ? data.suggestions.map((entry: { text: string }) => entry.text) : []);
    } catch {
      setSeoSuggestions([]);
    } finally {
      setSeoBusy(false);
    }
  }

  const brand = document.brand || {};
  const seo = document.seo || {};

  return (
    <div className="space-y-5">
      {message ? (
        <p className={`text-sm ${message.tone === "error" ? "jata-error" : "text-emerald-700"}`} role="status">
          {message.text}
        </p>
      ) : null}
      {undoSnapshot ? (
        <button type="button" className="jata-btn jata-btn-ghost" disabled={busy !== ""} onClick={() => void undo()}>
          ↩︎ Undo the last design change
        </button>
      ) : null}

      <section className="jata-card">
        <h2 className="text-sm font-bold">Design directions</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Each direction is a complete, coherent look — type, spacing, colour, buttons and the style JATA uses for your images. You can change anything afterwards.
        </p>
        <ul className="mt-3 grid gap-3 md:grid-cols-3">
          {directions.map((direction) => {
            const active = currentDirectionKey === direction.key || document.designDirectionKey === direction.key;
            return (
              <li key={direction.key} className={`rounded-xl border p-3 ${active ? "border-zinc-900 ring-1 ring-zinc-900" : ""}`}>
                <div className="flex gap-1" aria-hidden="true">
                  {direction.swatches.map((colour) => (
                    <span key={colour} className="h-6 w-6 rounded-full border" style={{ background: colour }} />
                  ))}
                </div>
                <h3 className="mt-2 text-sm font-bold">
                  {direction.name} {active ? <span className="text-xs font-semibold text-emerald-700">· current</span> : null}
                </h3>
                <p className="mt-1 text-sm text-zinc-600">{direction.description}</p>
                <p className="jata-hint">Best for: {direction.bestFor}</p>
                <p className="jata-hint">
                  {direction.typography} · {direction.photographyStyle.replace("-", " ")} photography
                </p>
                <button type="button" className="jata-btn jata-btn-primary mt-2" disabled={busy !== ""} onClick={() => void applyDirection(direction)}>
                  {busy === `${direction.name} applied` ? "Applying…" : active ? "Re-apply this look" : `Use ${direction.name}`}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="jata-card">
        <h2 className="text-sm font-bold">Brand</h2>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <MediaPicker
            businessId={businessId}
            label="Logo"
            kind="LOGO"
            subjectType="LOGO"
            subjectName={brand.businessName || ""}
            value={brand.logoUrl || ""}
            onChange={(url) => void save({ brand: { logoUrl: url } }, "Logo updated")}
          />
          <MediaPicker
            businessId={businessId}
            label="Opening (hero) image"
            kind="HERO"
            subjectType="BUSINESS"
            subjectName={brand.businessName || ""}
            value={brand.heroImageUrl || ""}
            onChange={(url) => void save({ brand: { heroImageUrl: url } }, "Opening image updated")}
            help="A wide photo of your business, your food or your work."
          />
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(["primaryColor", "secondaryColor", "accentColor"] as const).map((key) => (
            <label key={key} className="jata-field">
              <span className="jata-label">{key === "primaryColor" ? "Primary colour" : key === "secondaryColor" ? "Secondary colour" : "Accent colour"}</span>
              <input
                type="color"
                className="jata-input h-11 p-1"
                value={brand[key] || "#333333"}
                onChange={(event) => setDocument((current) => ({ ...current, brand: { ...current.brand, [key]: event.target.value.toUpperCase() } }))}
                onBlur={(event) => void save({ brand: { [key]: event.target.value.toUpperCase() } }, "Colour updated")}
              />
            </label>
          ))}
        </div>
        <label className="jata-field mt-3">
          <span className="jata-label">Button style</span>
          <select
            className="jata-input"
            value={brand.buttonStyle || "solid"}
            onChange={(event) => void save({ brand: { buttonStyle: event.target.value } }, "Button style updated")}
          >
            <option value="solid">Solid — strongest</option>
            <option value="soft">Soft — friendly</option>
            <option value="outline">Outline — understated</option>
            <option value="pill">Pill — modern</option>
          </select>
        </label>
        <label className="jata-field mt-3">
          <span className="jata-label">One line about your business</span>
          <input
            className="jata-input"
            maxLength={200}
            value={brand.description || ""}
            onChange={(event) => setDocument((current) => ({ ...current, brand: { ...current.brand, description: event.target.value } }))}
            onBlur={(event) => void save({ brand: { description: event.target.value } }, "Description updated")}
            placeholder="What you do, in your own words"
          />
          <span className="jata-hint">Used on your homepage and in your search description. JATA never invents one for you.</span>
        </label>
      </section>

      <section className="jata-card">
        <h2 className="text-sm font-bold">Theme</h2>
        <p className="mt-1 text-sm text-zinc-600">Start from any of these. Your colours and content stay exactly as they are.</p>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2">
          {themes.map((theme) => (
            <li key={theme.key}>
              <button
                type="button"
                className={`w-full rounded-xl border p-3 text-left ${document.themeKey === theme.key ? "border-zinc-900 ring-1 ring-zinc-900" : ""}`}
                disabled={busy !== ""}
                onClick={() => void save({ themeKey: theme.key }, "Theme updated")}
              >
                <div className="flex gap-1" aria-hidden="true">
                  {theme.swatches.map((colour) => (
                    <span key={colour} className="h-5 w-5 rounded-full border" style={{ background: colour }} />
                  ))}
                </div>
                <p className="mt-1 text-sm font-semibold">{theme.name}</p>
                <p className="text-xs text-zinc-600">{theme.description}</p>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="jata-card">
        <h2 className="text-sm font-bold">How you appear on Google and WhatsApp</h2>
        <p className="mt-1 text-sm text-zinc-600">This is what people see when your website is shared or found in search. JATA writes it from your own details.</p>

        <label className="jata-field mt-3">
          <span className="jata-label">Search title</span>
          <input
            className="jata-input"
            maxLength={70}
            value={seo.title || ""}
            onChange={(event) => setDocument((current) => ({ ...current, seo: { ...(current.seo || {}), title: event.target.value } }))}
            onBlur={(event) => void save({ document: { ...document, seo: { ...(document.seo || {}), title: event.target.value } } }, "Search title updated")}
          />
        </label>
        <button type="button" className="jata-btn jata-btn-ghost mt-1" disabled={seoBusy} onClick={() => void suggestSeo("SEO_TITLE")}>
          ✨ Help me write this
        </button>

        <label className="jata-field mt-3">
          <span className="jata-label">Search description</span>
          <textarea
            className="jata-input"
            rows={3}
            maxLength={180}
            value={seo.description || ""}
            onChange={(event) => setDocument((current) => ({ ...current, seo: { ...(current.seo || {}), description: event.target.value } }))}
            onBlur={(event) => void save({ document: { ...document, seo: { ...(document.seo || {}), description: event.target.value } } }, "Search description updated")}
          />
        </label>
        <button type="button" className="jata-btn jata-btn-ghost mt-1" disabled={seoBusy} onClick={() => void suggestSeo("SEO_DESCRIPTION")}>
          {seoBusy ? "Thinking…" : "✨ Help me write this"}
        </button>

        {seoSuggestions.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {seoSuggestions.map((suggestion) => (
              <li key={suggestion} className="rounded-xl border bg-zinc-50 p-2 text-sm">
                <p>{suggestion}</p>
                <button
                  type="button"
                  className="jata-btn jata-btn-secondary mt-2"
                  onClick={() => {
                    const isTitle = suggestion.length <= 70 && !suggestion.includes(". ");
                    void save(
                      { document: { ...document, seo: { ...(document.seo || {}), [isTitle ? "title" : "description"]: suggestion } } },
                      isTitle ? "Search title updated" : "Search description updated",
                    );
                    setSeoSuggestions([]);
                  }}
                >
                  Use this
                </button>
              </li>
            ))}
          </ul>
        ) : null}

        <div className="mt-3">
          <MediaPicker
            businessId={businessId}
            label="Image shown when your link is shared"
            kind="IMAGE"
            subjectType="BUSINESS"
            subjectName={brand.businessName || ""}
            value={seo.imageUrl || ""}
            onChange={(url) => void save({ document: { ...document, seo: { ...(document.seo || {}), imageUrl: url } } }, "Share image updated")}
          />
        </div>
      </section>
    </div>
  );
}
