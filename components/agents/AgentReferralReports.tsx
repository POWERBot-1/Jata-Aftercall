"use client";
import { useEffect, useRef, useState } from "react";

/** Mirrors the API's labelled snapshot shape. Counts only: no names, phone numbers or application ids. */
type Snapshot = {
  periodKey: string;
  periodType: string;
  startInclusive: string;
  endExclusive: string;
  registrationCount: string;
  existingApplicationCount: string;
  createdAt: string;
};
type Page = { items: Snapshot[]; nextCursor: string | null; truncated: boolean };
type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: Snapshot[]; nextCursor: string | null; loadingMore: boolean; moreError: string };

const ENDPOINT = "/api/agents/reports/referrals";
const dateFormat = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium" });
const formatDay = (iso: string) => (Number.isFinite(Date.parse(iso)) ? dateFormat.format(new Date(iso)) : "Unknown date");
const isCount = (value: unknown): value is string => typeof value === "string" && /^\d{1,12}$/.test(value);

function parsePage(data: unknown): Page | null {
  if (!data || typeof data !== "object") return null;
  const { items, nextCursor, truncated } = data as Record<string, unknown>;
  if (!Array.isArray(items) || (nextCursor !== null && typeof nextCursor !== "string") || typeof truncated !== "boolean") return null;
  const valid = items.every((item): item is Snapshot => {
    if (!item || typeof item !== "object") return false;
    const row = item as Record<string, unknown>;
    return typeof row.periodKey === "string" && typeof row.periodType === "string" && typeof row.startInclusive === "string" &&
      typeof row.endExclusive === "string" && typeof row.createdAt === "string" && isCount(row.registrationCount) && isCount(row.existingApplicationCount);
  });
  return valid ? (data as Page) : null;
}

async function fetchPage(cursor: string | null, signal: AbortSignal): Promise<Page> {
  const url = cursor ? `${ENDPOINT}?cursor=${encodeURIComponent(cursor)}` : ENDPOINT;
  const response = await fetch(url, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" }, signal });
  if (!response.ok) {
    let message = "Referral report snapshots are temporarily unavailable. Refresh to try again.";
    if (response.status === 403) message = "An active agent account is required to view referral report snapshots.";
    if (response.status === 401) message = "Sign in to view referral report snapshots.";
    if (response.status === 429) message = "Too many requests. Wait a moment, then try again.";
    throw new Error(message);
  }
  const page = parsePage(await response.json());
  if (!page) throw new Error("Referral report snapshots returned an unexpected response.");
  return page;
}

export default function AgentReferralReports() {
  const [state, setState] = useState<State>({ status: "loading" });
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    fetchPage(null, abort.signal)
      .then((page) => setState({ status: "ready", items: page.items, nextCursor: page.nextCursor, loadingMore: false, moreError: "" }))
      .catch((error: unknown) => { if (!abort.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Unavailable." }); });
    return () => abort.abort();
  }, []);

  async function loadOlder(cursor: string) {
    const abort = new AbortController();
    controller.current = abort;
    setState((current) => (current.status === "ready" ? { ...current, loadingMore: true, moreError: "" } : current));
    try {
      const page = await fetchPage(cursor, abort.signal);
      setState((current) => {
        if (current.status !== "ready") return current;
        // Keep the first occurrence of each period: a page boundary must never duplicate a row.
        const seen = new Set(current.items.map((item) => item.periodKey));
        const fresh = page.items.filter((item) => !seen.has(item.periodKey));
        return { status: "ready", items: [...current.items, ...fresh], nextCursor: page.nextCursor, loadingMore: false, moreError: "" };
      });
    } catch (error: unknown) {
      if (!abort.signal.aborted) {
        setState((current) => (current.status === "ready"
          ? { ...current, loadingMore: false, moreError: error instanceof Error ? error.message : "Unavailable." }
          : current));
      }
    }
  }

  return (
    <section aria-labelledby="report-snapshots-heading">
      <h2 id="report-snapshots-heading">Referral evidence by completed period</h2>
      <p>Counts reflect your application-referral records only. Sales, commission and delivery are not checked on this page.</p>

      {state.status === "loading" && <p role="status">Loading your referral report snapshots…</p>}

      {state.status === "error" && <p role="alert">{state.message}</p>}

      {state.status === "ready" && state.items.length === 0 && (
        <p>No referral report snapshots yet. A snapshot appears here once a completed period has been captured.</p>
      )}

      {state.status === "ready" && state.items.length > 0 && (
        <>
          <ol aria-label="Referral report snapshots, newest first" className="jata-report-snapshot-list">
            {state.items.map((item) => (
              <li key={item.periodKey}>
                <h3>{item.periodType === "MONTHLY" ? "Monthly" : "Daily"} · {formatDay(item.startInclusive)} to {formatDay(item.endExclusive)}</h3>
                <dl>
                  <div><dt>New registrations from referral links</dt><dd>{item.registrationCount}</dd></div>
                  <div><dt>Existing accounts linked</dt><dd>{item.existingApplicationCount}</dd></div>
                </dl>
              </li>
            ))}
          </ol>
          <p aria-live="polite">Showing {state.items.length} snapshot{state.items.length === 1 ? "" : "s"}.</p>
          {state.moreError && <p role="alert">{state.moreError}</p>}
          {state.nextCursor && (
            <button type="button" disabled={state.loadingMore} onClick={() => state.nextCursor && loadOlder(state.nextCursor)}>
              {state.loadingMore ? "Loading older snapshots…" : "Load older snapshots"}
            </button>
          )}
        </>
      )}
    </section>
  );
}
