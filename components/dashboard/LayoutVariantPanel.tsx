"use client";

/**
 * "Try another layout" (Immersive Website Engine, Phase 3)
 *
 * Shows a candidate layout from /api/experience/variant. Nothing is saved until the owner clicks
 * "Use this layout", which goes through the existing draft write path, so undo and the previous
 * draft are kept. Asking again only previews: the owner is never sent to a new draft automatically.
 */

import { useState } from "react";
import type { ExperienceDocument } from "@/lib/experience/types";
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

  async function preview(seed?: string) {
    setBusy("preview");
    setMessage(null);
    try {
      const response = await fetch("/api/experience/variant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, ...(seed ? { seed } : {}) }),
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
      </div>
      {result ? (
        <div className="mt-3 text-sm text-zinc-700" aria-live="polite">
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
