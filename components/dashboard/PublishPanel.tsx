"use client";

/**
 * Publish control (§23, §58)
 *
 * Publishing is a single server-authoritative action: the server re-checks the payment, the
 * entitlement and the checklist, so a hidden button state can never be used to publish an
 * unpaid or incomplete site.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";

type Check = { id: string; label: string; status: "pass" | "fail"; hint?: string; href?: string };

export function PublishPanel({
  businessId,
  ready,
  checks,
  published,
  draftVersion,
  publishedVersion,
  hasUnpublishedChanges,
  entitled,
  publicUrl,
}: {
  businessId: string;
  ready: boolean;
  checks: Check[];
  published: boolean;
  draftVersion: number;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
  entitled: boolean;
  publicUrl: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<"" | "publish" | "unpublish">("");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);

  async function act(action: "publish" | "unpublish") {
    setBusy(action);
    setMessage(null);
    try {
      const response = await fetch("/api/experience/publish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Publish exactly the draft version shown above. If it changed in another window, the server refuses (409).
        body: JSON.stringify(action === "publish" ? { businessId, action, expectedDraftVersion: draftVersion } : { businessId, action }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 409 && data.code === "draft_version_conflict") {
        setMessage({ tone: "error", text: data.error || "Your website changed in another window. Nothing was published." });
        router.refresh();
        return;
      }
      if (data.published) {
        setMessage({ tone: "ok", text: `${data.message || "You’re live 🎉"} ${data.url || publicUrl}` });
        router.refresh();
        return;
      }
      if (action === "unpublish" && response.ok) {
        setMessage({ tone: "warn", text: "Your site is now hidden. Your content is safe." });
        router.refresh();
        return;
      }
      setMessage({ tone: "error", text: data.error || "We couldn’t complete that. Please try again." });
    } catch {
      setMessage({ tone: "error", text: "We couldn’t reach the server. Please try again." });
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="jata-card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold">Publishing</h2>
          <p className="mt-1 text-sm text-zinc-600">
            {published
              ? hasUnpublishedChanges
                ? `Live (version ${publishedVersion}). You have unpublished changes — publish to make them visible.`
                : `Live (version ${publishedVersion}). Everything you have saved is visible to customers.`
              : `Draft (version ${draftVersion}). Only you can see it until you publish.`}
          </p>
        </div>
        <span className={`jata-status ${published ? "jata-live" : "jata-draft"}`}>{published ? "Live" : "Draft"}</span>
      </div>

      <ul className="mt-4 grid gap-2 text-sm" aria-label="Publish checklist">
        {checks.map((check) => (
          <li key={check.id} className="flex items-start gap-2">
            <span aria-hidden="true">{check.status === "pass" ? "✅" : "⚠️"}</span>
            <span>
              <span className="font-semibold">{check.label}</span>
              {check.hint ? <span className="block text-zinc-600">{check.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          className="jata-btn jata-btn-primary"
          disabled={busy !== "" || (!ready && entitled)}
          onClick={() => act("publish")}
          aria-describedby="publish-help"
        >
          {busy === "publish" ? "Publishing…" : published ? "Publish changes" : "Publish my website"}
        </button>
        {published ? (
          <button type="button" className="jata-btn jata-btn-secondary" disabled={busy !== ""} onClick={() => act("unpublish")}>
            {busy === "unpublish" ? "Unpublishing…" : "Unpublish"}
          </button>
        ) : null}
        <a className="jata-btn jata-btn-ghost" href={publicUrl} target="_blank" rel="noopener noreferrer">
          Open live site
        </a>
      </div>
      <p id="publish-help" className="jata-hint">
        {entitled
          ? ready
            ? "Everything checks out. Publish whenever you are happy with the preview."
            : "Finish the items above, then publish."
          : "Activate the Interactive Business plan to unlock publishing."}
      </p>
      {message ? (
        <p className={`mt-3 text-sm ${message.tone === "error" ? "jata-error" : message.tone === "warn" ? "text-amber-700" : "text-emerald-700"}`} role="status">
          {message.text}
        </p>
      ) : null}
    </section>
  );
}
