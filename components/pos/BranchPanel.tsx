"use client";

import { useState } from "react";

/**
 * Adding a location (§16). Only offered when the configuration switched on more than one; the
 * server checks that too, so the form can never be used to widen a single-location business.
 */
export function BranchPanel({
  businessId,
  word,
  canCreate,
  multiLocation,
  remaining,
}: {
  businessId: string;
  word: string;
  canCreate: boolean;
  multiLocation: boolean;
  remaining: number;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [location, setLocation] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/branches`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, location: location || null, phone: phone || null }),
      });
      const data = await response.json();
      if (!response.ok) setError(data?.error ?? `We couldn't add that ${word.toLowerCase()}.`);
      else window.location.reload();
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!canCreate) return null;

  return (
    <section className="jata-card p-4 space-y-3">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{word}</p>
          <h3 className="text-base font-semibold">Add a {word.toLowerCase()}</h3>
          <p className="pos-note">
            {multiLocation
              ? remaining > 0
                ? `Your setup allows ${remaining} more.`
                : "Your setup has reached its number of locations — change your setup to add another."
              : "Your POS is set up for one location. Turn on more locations in your setup first."}
          </p>
        </div>
        <button type="button" className="jata-btn jata-btn-secondary" onClick={() => setOpen((value) => !value)} disabled={!multiLocation || remaining <= 0}>
          {open ? "Close" : `+ Add ${word.toLowerCase()}`}
        </button>
      </div>

      {error ? <p className="jata-error" role="alert">{error}</p> : null}

      {open ? (
        <form
          className="pos-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div className="pos-grid-2">
            <div className="jata-field">
              <label className="jata-label" htmlFor="branch-name">What do you call it?</label>
              <input id="branch-name" className="jata-input" type="text" value={name} onChange={(event) => setName(event.target.value)} placeholder="Town centre" required />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="branch-location">Where is it?</label>
              <input id="branch-location" className="jata-input" type="text" value={location} onChange={(event) => setLocation(event.target.value)} />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="branch-phone">Phone</label>
              <input id="branch-phone" className="jata-input" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} />
            </div>
          </div>
          <div className="pos-form-actions">
            <button type="submit" className="jata-btn jata-btn-primary" disabled={busy || !name.trim()}>
              {busy ? "Saving…" : `Add ${word.toLowerCase()}`}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
