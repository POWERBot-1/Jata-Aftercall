"use client";

/**
 * AI content assistance (§44)
 *
 * Suggestions only. The assistant never sees or changes prices, stock or availability, and
 * nothing is written until the owner reviews the wording and saves it themselves.
 */

import { useState } from "react";

type Suggestion = { id: string; text: string };

export function AssistBox({
  businessId,
  kind,
  name,
  categoryKey,
  onAccept,
}: {
  businessId: string;
  kind: "PRODUCT_DESCRIPTION" | "SERVICE_DESCRIPTION" | "TAGLINE" | "SEO_DESCRIPTION" | "OFFER_COPY" | "IMAGE_ALT";
  name: string;
  categoryKey: string;
  onAccept: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [note, setNote] = useState<string | null>(null);

  async function request() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/experience/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, kind, name, categoryKey }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "Assistance is unavailable right now.");
      setSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      setNote(typeof data.note === "string" ? data.note : null);
    } catch {
      setError("We couldn’t reach the server. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2">
      <button
        type="button"
        className="jata-btn jata-btn-ghost"
        onClick={() => {
          setOpen((state) => !state);
          if (!open && suggestions.length === 0) void request();
        }}
        aria-expanded={open}
      >
        ✨ Help me write this
      </button>
      {open ? (
        <div className="mt-2 rounded-xl border bg-zinc-50 p-3">
          <p className="text-xs text-zinc-600">
            Suggestions are drafts for you to review. Prices, stock and availability are never changed by the assistant.
          </p>
          {error ? <p className="jata-error mt-2 text-sm" role="alert">{error}</p> : null}
          <ul className="mt-2 space-y-2">
            {suggestions.map((suggestion) => (
              <li key={suggestion.id} className="rounded-lg border bg-white p-2 text-sm">
                <p>{suggestion.text}</p>
                <button
                  type="button"
                  className="jata-btn jata-btn-secondary mt-2"
                  onClick={() => {
                    onAccept(suggestion.text);
                    setOpen(false);
                  }}
                >
                  Use this
                </button>
              </li>
            ))}
          </ul>
          {note ? <p className="jata-hint">{note}</p> : null}
          <button type="button" className="jata-btn jata-btn-ghost mt-2" disabled={busy} onClick={request}>
            {busy ? "Thinking…" : "Show other ideas"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
