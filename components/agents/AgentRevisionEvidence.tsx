"use client";
import { useEffect, useRef, useState } from "react";

/**
 * ADMIN-023 §028: the agent reads the members of one of THEIR OWN immutable report revisions, in
 * bounded pages, via the reconcile GET (`after` = opaque event-ID cursor, `nextCursor` = next-page marker).
 * Members are shown by source and day only. Event identifiers, names and phone numbers are never rendered.
 */
type Member = { eventId: string; source: string; eventCreatedAt: string };
type Revision = {
  periodKey: string;
  revision: number;
  registrationCount: string;
  existingApplicationCount: string;
  evidenceStatus: string;
  nextCursor: string | null;
  members: Member[];
};
type State =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; revision: Revision; members: Member[]; nextCursor: string | null; loadingMore: boolean; moreError: string };

const ENDPOINT = "/api/agents/reports/referrals/reconcile";
const dateFormat = new Intl.DateTimeFormat("en-KE", { timeZone: "Africa/Nairobi", dateStyle: "medium" });
const formatDay = (iso: string) => (Number.isFinite(Date.parse(iso)) ? dateFormat.format(new Date(iso)) : "Unknown date");
const EVIDENCE_TEXT: Record<string, string> = {
  MATCHED: "This revision matches current referral evidence.",
  RECONCILIATION_REQUIRED: "Current referral evidence differs from this revision. Manual reconciliation is required.",
  LEGACY_UNVERIFIABLE: "The original membership was not retained, so this revision cannot be verified.",
  REPORT_NOT_FOUND: "This report could not be found.",
};

function isMember(value: unknown): value is Member {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return typeof row.eventId === "string" && typeof row.source === "string" && typeof row.eventCreatedAt === "string";
}

function parseRevision(data: unknown): Revision | null {
  if (!data || typeof data !== "object") return null;
  const row = data as Record<string, unknown>;
  if (!Array.isArray(row.members) || !row.members.every(isMember)) return null;
  if (typeof row.periodKey !== "string" || typeof row.revision !== "number" || typeof row.evidenceStatus !== "string") return null;
  if (typeof row.registrationCount !== "string" || typeof row.existingApplicationCount !== "string") return null;
  if (row.nextCursor !== null && typeof row.nextCursor !== "string") return null;
  return data as Revision;
}

async function fetchRevision(periodKey: string, after: string | null, signal: AbortSignal): Promise<Revision> {
  const query = new URLSearchParams({ periodKey, revision: "1" });
  if (after) query.set("after", after);
  const response = await fetch(`${ENDPOINT}?${query.toString()}`, { cache: "no-store", credentials: "same-origin", headers: { accept: "application/json" }, signal });
  if (!response.ok) {
    let message = "The evidence list is temporarily unavailable. Try again.";
    if (response.status === 404) message = "This report revision is not available to your account.";
    if (response.status === 403) message = "An active agent account is required to view evidence lists.";
    if (response.status === 429) message = "Too many requests. Wait a moment, then try again.";
    throw new Error(message);
  }
  const revision = parseRevision(await response.json());
  if (!revision) throw new Error("The evidence list returned an unexpected response.");
  return revision;
}

export default function AgentRevisionEvidence({ periodKey, label }: { periodKey: string; label: string }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const controller = useRef<AbortController | null>(null);
  const headingId = `evidence-${periodKey.replace(/[^A-Za-z0-9_-]/g, "-")}`;

  useEffect(() => () => controller.current?.abort(), []);

  async function open() {
    const abort = new AbortController();
    controller.current = abort;
    setState({ status: "loading" });
    try {
      const revision = await fetchRevision(periodKey, null, abort.signal);
      setState({ status: "ready", revision, members: revision.members, nextCursor: revision.nextCursor, loadingMore: false, moreError: "" });
    } catch (error: unknown) {
      if (!abort.signal.aborted) setState({ status: "error", message: error instanceof Error ? error.message : "Unavailable." });
    }
  }

  async function loadMore(cursor: string) {
    const abort = new AbortController();
    controller.current = abort;
    setState((current) => (current.status === "ready" ? { ...current, loadingMore: true, moreError: "" } : current));
    try {
      const page = await fetchRevision(periodKey, cursor, abort.signal);
      setState((current) => {
        if (current.status !== "ready") return current;
        // Keep the first occurrence of each event: a page boundary must never duplicate a member.
        const seen = new Set(current.members.map((member) => member.eventId));
        const fresh = page.members.filter((member) => !seen.has(member.eventId));
        return { ...current, members: [...current.members, ...fresh], nextCursor: page.nextCursor, loadingMore: false, moreError: "" };
      });
    } catch (error: unknown) {
      if (!abort.signal.aborted) {
        setState((current) => (current.status === "ready"
          ? { ...current, loadingMore: false, moreError: error instanceof Error ? error.message : "Unavailable." }
          : current));
      }
    }
  }

  function close() {
    controller.current?.abort();
    setState({ status: "idle" });
  }

  if (state.status === "idle") {
    return (
      <button type="button" aria-expanded="false" aria-label={`Show evidence list for ${label}`}
        style={{ minHeight: "44px", minWidth: "44px", padding: "0.6rem 1rem" }} onClick={open}>
        Show evidence list
      </button>
    );
  }

  return (
    <section aria-labelledby={headingId}>
      <h4 id={headingId}>Evidence list for {label}</h4>
      {state.status === "loading" && <p role="status">Loading the evidence list…</p>}
      {state.status === "error" && <p role="alert">{state.message}</p>}
      {state.status === "ready" && (
        <>
          <p>{EVIDENCE_TEXT[state.revision.evidenceStatus] ?? EVIDENCE_TEXT.REPORT_NOT_FOUND}</p>
          <p aria-live="polite">
            Showing {state.members.length} evidence item{state.members.length === 1 ? "" : "s"} from revision {state.revision.revision}.
          </p>
          <ul aria-labelledby={headingId} className="jata-revision-evidence-list">
            {state.members.map((member, index) => (
              <li key={member.eventId}>
                Evidence {index + 1} · {member.source === "REGISTRATION" ? "New registration" : "Existing account"} · {formatDay(member.eventCreatedAt)}
              </li>
            ))}
          </ul>
          {state.moreError && <p role="alert">{state.moreError}</p>}
          {state.nextCursor && (
            <button type="button" disabled={state.loadingMore} style={{ minHeight: "44px", minWidth: "44px", padding: "0.6rem 1rem" }}
              onClick={() => state.nextCursor && loadMore(state.nextCursor)}>
              {state.loadingMore ? "Loading more evidence…" : "Load more evidence"}
            </button>
          )}
          <button type="button" style={{ minHeight: "44px", minWidth: "44px", padding: "0.6rem 1rem", marginLeft: "0.5rem" }} onClick={close}>
            Hide evidence list
          </button>
        </>
      )}
    </section>
  );
}
