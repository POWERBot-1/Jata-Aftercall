"use client";

import { useState } from "react";

/**
 * Moving one order on (§29).
 *
 * The buttons are the moves the workflow allows from the current state — the server offered them,
 * and the server will refuse anything else. Cancelling needs its own permission (§36).
 */
export function MoveOrderPanel({
  businessId,
  orderId,
  word,
  states,
  history,
  canManage,
  canCancel,
  entitled,
}: {
  businessId: string;
  orderId: string;
  word: string;
  states: { key: string; label: string; hint?: string }[];
  history: { id: string; fromState: string | null; toState: string; note: string | null; createdAt: string | Date }[];
  canManage: boolean;
  canCancel: boolean;
  entitled: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  async function move(toState: string) {
    setBusy(toState);
    setError(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/orders/${encodeURIComponent(orderId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: toState, note: note || null }),
      });
      const data = await response.json();
      if (!response.ok) setError(data?.error ?? `We couldn't move that ${word.toLowerCase()}.`);
      else window.location.reload();
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="jata-card p-4 space-y-3">
      <div>
        <p className="jata-kicker">Move it along</p>
        <h3 className="text-base font-semibold">What happens next?</h3>
      </div>

      {error ? <p className="jata-error" role="alert">{error}</p> : null}
      {!entitled ? <p className="pos-note">Renew the plan to keep moving {word.toLowerCase()}s along.</p> : null}

      {states.length === 0 ? (
        <p className="pos-note">This {word.toLowerCase()} is finished. Nothing more to do here.</p>
      ) : (
        <>
          <div className="jata-field">
            <label className="jata-label" htmlFor="move-note">Note (optional)</label>
            <input id="move-note" className="jata-input" type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Left with the neighbour, part ordered" />
          </div>
          <div className="pos-form-actions">
            {states.map((state) => {
              const cancel = state.key.toUpperCase() === "CANCELLED";
              return (
                <button
                  type="button"
                  key={state.key}
                  className={cancel ? "jata-btn jata-btn-ghost" : "jata-btn jata-btn-secondary"}
                  disabled={busy === state.key || !canManage || !entitled || (cancel && !canCancel)}
                  title={state.hint}
                  onClick={() => move(state.key)}
                >
                  {busy === state.key ? "Working…" : state.label}
                </button>
              );
            })}
          </div>
        </>
      )}

      {history.length ? (
        <div>
          <p className="jata-kicker">History</p>
          <ol className="mt-2 grid gap-1 text-sm">
            {history.map((entry) => (
              <li key={entry.id} className="flex flex-wrap gap-x-2">
                <span className="pos-note">{new Date(entry.createdAt).toLocaleString("en-KE")}</span>
                <span>{entry.fromState ? `${entry.fromState} → ${entry.toState}` : `Started as ${entry.toState}`}</span>
                {entry.note ? <span className="pos-note">· {entry.note}</span> : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </section>
  );
}
