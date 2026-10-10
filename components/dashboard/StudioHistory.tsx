"use client";

/**
 * Undo, Redo and recovery (§45)
 *
 * One bar, on every Studio screen, that steps backwards and forwards through everything the owner
 * has changed — sections, design, photos, catalogue edits and AI content alike — because every one
 * of those changes goes through the same write path. It never publishes: going back changes the
 * draft, and the owner still decides when customers see it.
 */

import { useCallback, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";

type Revision = {
  draftVersion: number;
  label: string;
  source: string;
  createdAt: string | null;
  current: boolean;
};

type HistoryState = {
  canUndo: boolean;
  canRedo: boolean;
  cursor: number;
  head: number;
  count: number;
  revisions: Revision[];
  /** The draft version this list was read at. Undo, redo and open-a-version send it back. */
  draftVersion: number | null;
};

function when(value: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-KE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function StudioHistory({ businessId }: { businessId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [state, setState] = useState<HistoryState | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/experience/history?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok && Array.isArray(data.revisions)) {
        setState({
          canUndo: Boolean(data.canUndo),
          canRedo: Boolean(data.canRedo),
          cursor: Number(data.cursor) || 0,
          head: Number(data.head) || 0,
          count: Number(data.count) || 0,
          revisions: data.revisions,
          draftVersion: Number(data.draftVersion) || null,
        });
      }
    } catch {
      // History is a convenience: if it cannot load, the Studio keeps working untouched.
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load, pathname]);

  async function move(payload: { direction?: "undo" | "redo"; version?: number }) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch("/api/experience/history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Only move if the draft is still the one this list was read from; otherwise the server refuses (409).
        body: JSON.stringify({ businessId, ...payload, ...(state?.draftVersion ? { expectedDraftVersion: state.draftVersion } : {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(typeof data.error === "string" ? data.error : "We couldn’t move through your history just now.");
        await load();
        return;
      }
      setState({
        canUndo: Boolean(data.canUndo),
        canRedo: Boolean(data.canRedo),
        cursor: Number(data.cursor) || 0,
        head: Number(data.head) || 0,
        count: Number(data.count) || 0,
        revisions: Array.isArray(data.revisions) ? data.revisions : [],
        draftVersion: Number(data.draftVersion) || null,
      });
      setMessage(typeof data.message === "string" ? data.message : "Your draft was updated.");
      router.refresh();
    } catch {
      setError("We couldn’t reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (!state || state.count === 0) return null;

  return (
    <>
      <div className="jata-history-bar" role="group" aria-label="Undo and redo">
        <button
          type="button"
          className="jata-btn jata-btn-secondary"
          onClick={() => void move({ direction: "undo" })}
          disabled={busy || !state.canUndo}
          aria-label="Undo the last change"
        >
          ↩︎ Undo
        </button>
        <button
          type="button"
          className="jata-btn jata-btn-secondary"
          onClick={() => void move({ direction: "redo" })}
          disabled={busy || !state.canRedo}
          aria-label="Redo the change you undid"
        >
          ↪︎ Redo
        </button>
        <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setOpen(true)} aria-expanded={open}>
          🕘 History
        </button>
      </div>

      {(message || error) && (
        <p className={`jata-history-note ${error ? "jata-history-note-error" : ""}`} role="status">
          {error || message}
        </p>
      )}

      {open && (
        <div className="jata-history-sheet" role="dialog" aria-modal="true" aria-label="Your website history">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Your website history</h2>
              <p className="jata-hint">
                Everything you have changed, newest first. Going back here changes your draft only — publishing stays your decision.
              </p>
            </div>
            <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setOpen(false)}>
              Close
            </button>
          </div>

          <ul className="mt-3 space-y-2">
            {state.revisions.map((revision) => (
              <li key={revision.draftVersion} className="jata-history-row">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-zinc-900">
                    {revision.label}
                    {revision.current ? <span className="ml-2 text-xs font-semibold text-emerald-700">You are here</span> : null}
                  </p>
                  <p className="jata-hint">
                    Version {revision.draftVersion}
                    {revision.createdAt ? ` · ${when(revision.createdAt)}` : ""}
                    {revision.source === "AI" ? " · JATA AI" : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="jata-btn jata-btn-secondary"
                  disabled={busy || revision.current}
                  onClick={() => void move({ version: revision.draftVersion })}
                >
                  {revision.current ? "Current" : "Go back to this"}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
