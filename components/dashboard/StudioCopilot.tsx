"use client";

/**
 * Website Studio copilot (§5, §22, §40, §53)
 *
 * A drawer that is available on every Studio screen. It proposes; the owner decides. Every
 * proposal states exactly what will change, can be previewed, and can be undone with one tap —
 * and it never touches prices, stock, availability, contact details, hours or legal text.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Action =
  | { kind: "navigate"; href: string; label: string }
  | { kind: "photo-lab"; label: string; subjectType: "PRODUCT" | "SERVICE" | "BUSINESS"; subjectId: string | null; subjectName: string }
  | { kind: "assist"; label: string; sectionId: string | null; field: string }
  | { kind: "ask"; question: string };

type Proposal = {
  title: string;
  summary: string;
  changes: string[];
  warnings: string[];
  previewHint: string;
  requiresReview: boolean;
};

type Reply = {
  intent: string;
  message: string;
  proposal: Proposal | null;
  actions: Action[];
  suggestions: string[];
  applied?: boolean;
  appliedChanges?: string[];
  skippedChanges?: string[];
  previousDocument?: unknown;
  health?: { score: number; bandLabel: string };
};

type Turn = { role: "owner" | "jata"; text: string; reply?: Reply };

const OPEN_STORAGE_PREFIX = "jata.studio.copilot.";

export function StudioCopilot({ businessId }: { businessId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [pending, setPending] = useState<Reply | null>(null);
  const [undoSnapshot, setUndoSnapshot] = useState<unknown | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [health, setHealth] = useState<{ score: number; bandLabel: string } | null>(null);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(`${OPEN_STORAGE_PREFIX}${businessId}`);
      if (stored) setTurns(JSON.parse(stored) as Turn[]);
    } catch {
      // Session history is a nicety; losing it must not break the assistant.
    }
  }, [businessId]);

  useEffect(() => {
    try {
      window.sessionStorage.setItem(`${OPEN_STORAGE_PREFIX}${businessId}`, JSON.stringify(turns.slice(-12)));
    } catch {
      // ignore quota/private-mode failures
    }
  }, [turns, businessId]);

  const loadSuggestions = useCallback(async () => {
    try {
      const response = await fetch(`/api/studio/copilot?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (Array.isArray(data.suggestions)) setSuggestions(data.suggestions.slice(0, 6));
      if (data.health?.score !== undefined) setHealth({ score: Number(data.health.score), bandLabel: String(data.health.bandLabel || "") });
    } catch {
      setSuggestions([]);
    }
  }, [businessId]);

  useEffect(() => {
    if (open && suggestions.length === 0) void loadSuggestions();
  }, [open, suggestions.length, loadSuggestions]);

  async function send(message: string, apply = false) {
    if (!message.trim() || busy) return;
    setBusy(true);
    setError(null);
    if (!apply) setTurns((current) => [...current, { role: "owner", text: message }]);
    try {
      const response = await fetch("/api/studio/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, message, apply }),
      });
      const data = (await response.json().catch(() => ({}))) as Reply & { error?: string };
      if (!response.ok) {
        setError(data.error || "JATA couldn't answer that right now. Please try again.");
        return;
      }
      if (apply) {
        setTurns((current) => [
          ...current,
          {
            role: "jata",
            text: data.applied
              ? `Done — ${(data.appliedChanges || []).length} change${(data.appliedChanges || []).length === 1 ? "" : "s"} saved to your draft. Preview it, and Undo if you preferred it before.`
              : "I didn't change anything.",
            reply: data,
          },
        ]);
        if (data.applied) {
          setUndoSnapshot(data.previousDocument ?? null);
          if (data.health) setHealth({ score: Number(data.health.score), bandLabel: String(data.health.bandLabel || "") });
          setPending(null);
          router.refresh();
        }
        if (Array.isArray(data.skippedChanges) && data.skippedChanges.length > 0) {
          setError(`Some changes need your input first: ${data.skippedChanges.join(" ")}`);
        }
      } else {
        setTurns((current) => [...current, { role: "jata", text: data.message, reply: data }]);
        setPending(data.proposal ? data : null);
        if (data.health) setHealth({ score: Number(data.health.score), bandLabel: String(data.health.bandLabel || "") });
      }
    } catch {
      setError("We couldn't reach JATA. Your website is unchanged — try again.");
    } finally {
      setBusy(false);
      setInput("");
    }
  }

  async function undo() {
    if (!undoSnapshot) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/experience", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, document: undoSnapshot }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "We couldn't undo that change.");
        return;
      }
      setUndoSnapshot(null);
      setTurns((current) => [...current, { role: "jata", text: "Undone — your website is back exactly as it was." }]);
      router.refresh();
    } catch {
      setError("We couldn't reach JATA to undo that change.");
    } finally {
      setBusy(false);
    }
  }

  const hrefFor = (href: string) => {
    const map: Record<string, string> = {
      overview: `/dashboard/businesses/${businessId}`,
      sections: `/dashboard/businesses/${businessId}/sections`,
      items: `/dashboard/businesses/${businessId}/items`,
      theme: `/dashboard/businesses/${businessId}/theme`,
      design: `/dashboard/businesses/${businessId}/design`,
      photos: `/dashboard/businesses/${businessId}/photos`,
      preview: `/dashboard/businesses/${businessId}/preview`,
    };
    return map[href] || `/dashboard/businesses/${businessId}`;
  };

  return (
    <>
      <button
        type="button"
        className="jata-copilot-fab"
        aria-expanded={open}
        onClick={() => setOpen((state) => !state)}
        title="Ask JATA about your website"
      >
        {open ? "Close assistant" : "✨ Ask JATA"}
      </button>

      {open ? (
        <aside className="jata-copilot" role="complementary" aria-label="JATA website assistant">
          <header className="flex items-start justify-between gap-2">
            <div>
              <p className="jata-kicker">Website assistant</p>
              <h2 className="text-sm font-bold">Ask JATA to improve your website</h2>
              {health ? (
                <p className="text-xs text-zinc-600">
                  Readiness {health.score}% · {health.bandLabel}
                </p>
              ) : null}
            </div>
            <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setOpen(false)} aria-label="Close assistant">
              ✕
            </button>
          </header>

          <div className="mt-2 space-y-2 overflow-y-auto pr-1" style={{ maxHeight: "46vh" }}>
            {turns.length === 0 ? (
              <p className="text-sm text-zinc-600">
                Tell me what you want to change in your own words. I&apos;ll show you exactly what I would change, and you decide.
              </p>
            ) : null}
            {turns.map((turn, index) => (
              <div key={`${turn.role}-${index}`} className={turn.role === "owner" ? "text-right" : ""}>
                <p className={`inline-block max-w-full rounded-xl px-3 py-2 text-sm ${turn.role === "owner" ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-800"}`}>
                  {turn.text}
                </p>
                {turn.reply?.proposal ? (
                  <div className="mt-1 rounded-xl border bg-white p-2 text-left text-sm">
                    <p className="font-semibold">{turn.reply.proposal.title}</p>
                    <p className="text-zinc-600">{turn.reply.proposal.summary}</p>
                    <ul className="mt-1 list-disc pl-4 text-zinc-600">
                      {turn.reply.proposal.changes.map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                    {turn.reply.proposal.warnings.map((warning) => (
                      <p key={warning} className="mt-1 text-amber-800">
                        ⚠️ {warning}
                      </p>
                    ))}
                    <p className="jata-hint">{turn.reply.proposal.previewHint}</p>
                  </div>
                ) : null}
              </div>
            ))}
          </div>

          {pending?.proposal ? (
            <div className="mt-2 rounded-xl border bg-zinc-50 p-2">
              <p className="text-sm font-semibold">Apply “{pending.proposal.title}”?</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" className="jata-btn jata-btn-primary" disabled={busy} onClick={() => void send(lastOwnerMessage(turns) || input, true)}>
                  {busy ? "Applying…" : "Apply"}
                </button>
                <a className="jata-btn jata-btn-secondary" href={`/dashboard/businesses/${businessId}/preview`} target="_blank" rel="noopener noreferrer">
                  Preview my website
                </a>
                <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setPending(null)}>
                  Not now
                </button>
              </div>
            </div>
          ) : null}

          {undoSnapshot ? (
            <button type="button" className="jata-btn jata-btn-ghost mt-2" disabled={busy} onClick={() => void undo()}>
              ↩︎ Undo the last change
            </button>
          ) : null}

          {error ? (
            <p className="jata-error mt-2 text-sm" role="alert">
              {error}
            </p>
          ) : null}

          {suggestions.length > 0 && turns.length < 2 ? (
            <ul className="mt-2 flex flex-wrap gap-1">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button type="button" className="jata-btn jata-btn-ghost text-xs" onClick={() => void send(suggestion)}>
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <form
            className="mt-3 flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void send(input);
            }}
          >
            <input
              className="jata-input flex-1"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="e.g. Make my homepage look more premium"
              aria-label="Ask JATA to improve your website"
            />
            <button type="submit" className="jata-btn jata-btn-primary" disabled={busy || !input.trim()}>
              {busy ? "…" : "Ask"}
            </button>
          </form>
          <p className="jata-hint">
            JATA never changes your prices, stock, hours, contact details or legal information — and never publishes without you.
          </p>
        </aside>
      ) : null}
    </>
  );
}

function lastOwnerMessage(turns: Turn[]): string {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    if (turns[index].role === "owner") return turns[index].text;
  }
  return "";
}
