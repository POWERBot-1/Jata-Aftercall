"use client";

/**
 * "Try another layout" (Immersive Website Engine, Phase 3)
 *
 * Shows a candidate layout from /api/experience/variant. Nothing is saved until the owner clicks
 * "Use this layout", which goes through the existing draft write path, so undo and the previous
 * draft are kept. Asking again only previews: the owner is never sent to a new draft automatically.
 */

import { useState, useEffect } from "react";
import type { ExperienceDocument } from "@/lib/experience/types";
import { getExperienceProfile } from "@/lib/experience/categories";
import { TEMPLATE_FAMILIES, DESIGN_PERSONALITIES, DESIGN_AUDIENCES, DESIGN_DENSITIES, type DesignGoal, type ArtDirection, type TemplateFamilyKey } from "@/lib/experience/templateFamilies";
import { themeOf } from "@/lib/experience/document";

type Candidate = {
  candidate: ExperienceDocument;
  accepted: boolean;
  seed: string;
  report: { maxSimilarity: number; threshold: number };
  change: { themeChanged: boolean; sectionOrderChanged: boolean };
  comparedWith: number;
  baseDraftVersion: number;
  history: { publishedCompared: number; limitation: string | null };
  direction?: { family: TemplateFamilyKey; semanticScore: number; reasons: Array<{ code: string; explanation: string }> };
};

export function LayoutVariantPanel({
  businessId,
  current,
  onApplied,
}: {
  businessId: string;
  current: ExperienceDocument;
  onApplied: (document: ExperienceDocument) => void;
}) {
  const [busy, setBusy] = useState<"" | "preview" | "apply">("");
  const [result, setResult] = useState<Candidate | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const caps = getExperienceProfile(current.categoryKey).capabilities;
  const [goal, setGoal] = useState<DesignGoal>(current.artDirection?.goal || (caps.includes("commerce") ? "sell" : caps.includes("booking") ? "book" : "enquire"));
  const [personality, setPersonality] = useState<ArtDirection["personality"]>(current.artDirection?.personality || "warm");
  const [audience, setAudience] = useState<ArtDirection["audience"]>(current.artDirection?.audience || "local");
  const [density, setDensity] = useState<ArtDirection["density"]>(current.artDirection?.density || "balanced");
  const [family, setFamily] = useState<"" | TemplateFamilyKey>("");
  useEffect(() => {
    const capabilities = getExperienceProfile(current.categoryKey).capabilities;
    setGoal(current.artDirection?.goal || (capabilities.includes("commerce") ? "sell" : capabilities.includes("booking") ? "book" : "enquire"));
    setResult(null); setFamily("");
  }, [businessId, current.categoryKey, current.artDirection?.goal]);

  async function preview(seed?: string) {
    setBusy("preview");
    setMessage(null);
    try {
      const response = await fetch("/api/experience/variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, brief: { goal, personality, audience, density }, ...(family ? { family } : {}), ...(seed ? { seed } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(data.error || "We couldn't create a layout right now. Your current website is unchanged.");
        return;
      }
      setResult(data as Candidate);
      if (!data.accepted) {
        setMessage("That layout is too close to your current or recent designs. Try another, or keep the current one.");
      }
    } catch {
      setMessage("We couldn't reach the server. Your current website is unchanged.");
    } finally {
      setBusy("");
    }
  }

  async function apply() {
    if (!result) return;
    setBusy("apply");
    try {
      // Send the draft version the preview was built from. If the draft changed since, the server
      // refuses (409) and nothing is overwritten; the owner previews again from the latest draft.
      const response = await fetch("/api/experience", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, document: result.candidate, expectedDraftVersion: result.baseDraftVersion }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setMessage(
          data.code === "draft_version_conflict"
            ? "Your website changed while you were previewing. Preview a layout again from the latest draft. Nothing was overwritten."
            : data.error || "We couldn't save that layout. Your current draft is unchanged.",
        );
        if (data.code === "draft_version_conflict") setResult(null);
        return;
      }
      onApplied(data.document as ExperienceDocument);
      setResult(null);
      setMessage("Layout applied to your draft. You can undo it at any time.");
    } catch {
      setMessage("We couldn't reach the server. Your current draft is unchanged.");
    } finally {
      setBusy("");
    }
  }

  const candidateTheme = result ? themeOf(result.candidate).name : null;

  return (
    <section className="rounded-xl border p-4" aria-labelledby="layout-variant-heading">
      <h2 id="layout-variant-heading" className="text-sm font-bold">Try another layout</h2>
      <p className="jata-hint mt-1">
        JATA creates a different arrangement of your existing content. Your prices, products and contact details stay exactly as they are.
      </p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Customer objective<select className="jata-input mt-1" disabled={busy !== ""} value={goal} onChange={(event) => { setGoal(event.target.value as DesignGoal); setFamily(""); setResult(null); }}>
          {(["sell", "book", "enquire", "browse"] as const).filter((value) => value !== "sell" || caps.includes("commerce")).filter((value) => value !== "book" || caps.includes("booking")).map((value) => <option key={value} value={value}>{value === "sell" ? "Discover and order" : value === "book" ? "Choose and book" : value === "enquire" ? "Understand and enquire" : "Browse catalogue"}</option>)}
        </select></label>
        <label className="text-sm">Brand personality<select className="jata-input mt-1" disabled={busy !== ""} value={personality} onChange={(event) => { setPersonality(event.target.value as ArtDirection["personality"]); setResult(null); }}>{DESIGN_PERSONALITIES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm">Target audience<select className="jata-input mt-1" disabled={busy !== ""} value={audience} onChange={(event) => { setAudience(event.target.value as ArtDirection["audience"]); setResult(null); }}>{DESIGN_AUDIENCES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm">Information density<select className="jata-input mt-1" disabled={busy !== ""} value={density} onChange={(event) => { setDensity(event.target.value as ArtDirection["density"]); setResult(null); }}>{DESIGN_DENSITIES.map((value) => <option key={value}>{value}</option>)}</select></label>
        <label className="text-sm sm:col-span-2">Composition family<select className="jata-input mt-1" disabled={busy !== ""} value={family} onChange={(event) => { setFamily(event.target.value as "" | TemplateFamilyKey); setResult(null); }}><option value="">Content-led recommendation</option>{TEMPLATE_FAMILIES.filter((entry) => entry.goals.includes(goal)).map((entry) => <option key={entry.key} value={entry.key}>{entry.name}{entry.immersive !== "none" ? " — HTML fallback, scene not activated" : ""}</option>)}</select></label>
      </div>
      <p className="jata-hint mt-2">Deterministic content/intent reasoning, not a provider call or measured conversion/performance score. No new media generated or uploaded.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="jata-btn" disabled={busy !== ""} onClick={() => void preview()}>
          {busy === "preview" ? "Creating…" : "Preview a layout"}
        </button>
        {result ? (
          <button
            type="button"
            className="jata-btn"
            disabled={busy !== ""}
            onClick={() => void preview(`${businessId}:${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`)}
          >
            Try another
          </button>
        ) : null}
        {result && result.accepted ? (
          <button type="button" className="jata-btn jata-btn-primary" disabled={busy !== ""} onClick={() => void apply()}>
            {busy === "apply" ? "Applying…" : "Use this layout"}
          </button>
        ) : null}
        {/* A layout that scored too similar is not blocked: the owner may still choose it, having seen why. */}
        {result && !result.accepted ? (
          <button type="button" className="jata-btn" disabled={busy !== ""} onClick={() => void apply()}>
            {busy === "apply" ? "Applying…" : "Use it anyway"}
          </button>
        ) : null}
      </div>
      {result ? (
        <div className="mt-3 text-sm text-zinc-700" aria-live="polite">
          {result.direction ? <><p>Composition: <strong>{TEMPLATE_FAMILIES.find((entry) => entry.key === result.direction.family)?.name}</strong></p><ul className="mt-1 list-disc pl-5">{result.direction.reasons.slice(0, 5).map((reason) => <li key={reason.code}>{reason.explanation}</li>)}</ul></> : null}
          <p>
            Preview theme: <strong>{candidateTheme}</strong>
            {result.change.themeChanged ? "" : " (same theme)"}
            {result.change.sectionOrderChanged ? " · sections reordered" : " · section order unchanged"}
          </p>
          <p className="jata-hint">
            Similarity to your current and recent layouts: {Math.round(result.report.maxSimilarity * 100)}% (limit {Math.round(result.report.threshold * 100)}%).
          </p>
          {result.history.limitation ? (
            <p className="jata-hint" data-testid="variant-history-limitation">
              {result.history.limitation}
            </p>
          ) : null}
        </div>
      ) : null}
      {message ? (
        <p className="mt-2 text-sm" role="status">
          {message}
        </p>
      ) : null}
      <span className="sr-only">Current theme: {themeOf(current).name}</span>
    </section>
  );
}
