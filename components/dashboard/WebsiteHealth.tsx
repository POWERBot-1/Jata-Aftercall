"use client";

/**
 * Website health (§25, §36, §46)
 *
 * The honest version of a readiness score: every point maps to something a customer would
 * notice, every failing check says why it matters and what to do, and "Fix with JATA" applies a
 * specific, reversible draft change — never a silent rewrite of the owner's business facts.
 */

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PhotoLab } from "./PhotoLab";

type Fix =
  | { kind: "apply"; id: string; label: string; description: string }
  | { kind: "link"; href: string; label: string }
  | { kind: "photo-lab"; label: string; subjectType: "PRODUCT" | "SERVICE" | "BUSINESS"; subjectId: string | null; subjectName: string };

type Check = {
  id: string;
  group: string;
  label: string;
  detail: string;
  status: "pass" | "attention";
  weight: number;
  fix?: Fix;
};

type Report = {
  score: number;
  band: string;
  bandLabel: string;
  summary: string;
  passing: Check[];
  attention: Check[];
  topActions: Check[];
  recommendations: string[];
};

type Payload = {
  /** The draft version the report was computed from. Fixes send it back. */
  draftVersion?: number | null;
  report: Report;
  summary: string;
  publishing: { entitled: boolean; ready: boolean; hasUnpublishedChanges: boolean; failedChecks: string[] };
  ai: { providerLabel: string; photographic: boolean; note: string };
};

export function WebsiteHealth({ businessId, initialReport }: { businessId: string; initialReport?: Report | null }) {
  const router = useRouter();
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(!initialReport);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "warn" | "error"; text: string } | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [photoLab, setPhotoLab] = useState<{ subjectType: "PRODUCT" | "SERVICE" | "BUSINESS"; subjectId: string | null; subjectName: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/studio/health?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setPayload(data as Payload);
    } catch {
      // The card simply hides; the Studio itself keeps working.
    } finally {
      setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function applyFix(id: string, label: string) {
    setBusy(id);
    setMessage(null);
    try {
      const response = await fetch("/api/experience", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          op: "studio-fix",
          fixId: id,
          ...(payload?.draftVersion ? { expectedDraftVersion: payload.draftVersion } : {}),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // The website changed after this report was made: show the conflict and reload the report. Nothing was applied.
        if (data.code === "draft_version_conflict") {
          setMessage({ tone: "warn", text: data.error || "Your website changed in another window. Nothing was changed." });
          await load();
          router.refresh();
          return;
        }
        setMessage({ tone: data.needsOwnerInput ? "warn" : "error", text: data.error || "We couldn't apply that fix." });
        return;
      }
      setMessage({ tone: "ok", text: `${label} — done. Preview it, or publish when you are ready.` });
      await load();
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "We couldn't reach JATA. Please try again." });
    } finally {
      setBusy("");
    }
  }

  const report = payload?.report || initialReport || null;
  if (loading && !report) {
    return (
      <section className="jata-card" aria-busy="true">
        <div className="h-5 w-40 animate-pulse rounded bg-zinc-100" />
        <div className="mt-3 h-2 w-full animate-pulse rounded bg-zinc-100" />
        <div className="mt-3 h-24 w-full animate-pulse rounded bg-zinc-50" />
      </section>
    );
  }
  if (!report) return null;

  const visible = showAll ? report.attention : report.topActions;

  return (
    <section className="jata-card" aria-labelledby="health-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="health-heading" className="text-sm font-bold">
            Website health
          </h2>
          <p className="mt-1 text-sm text-zinc-600">{report.summary}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold">
            {report.score}
            <span className="text-base font-semibold text-zinc-500">%</span>
          </p>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{report.bandLabel}</p>
        </div>
      </div>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-zinc-100" role="img" aria-label={`Website readiness ${report.score} percent`}>
        <div
          className={`h-full ${report.score >= 90 ? "bg-emerald-500" : report.score >= 70 ? "bg-lime-500" : report.score >= 45 ? "bg-amber-500" : "bg-red-400"}`}
          style={{ width: `${report.score}%` }}
        />
      </div>

      {report.attention.length === 0 ? (
        <p className="mt-3 text-sm text-emerald-700">Everything a customer needs is in place. Publish whenever you are ready.</p>
      ) : (
        <>
          <h3 className="mt-4 text-xs font-bold uppercase tracking-wide text-zinc-500">{showAll ? "Everything that needs attention" : "Worth fixing first"}</h3>
          <ul className="mt-2 space-y-2">
            {visible.map((check) => (
              <li key={check.id} className="rounded-xl border p-3">
                <p className="text-sm font-semibold">⚠️ {check.label}</p>
                <p className="mt-0.5 text-sm text-zinc-600">{check.detail}</p>
                {check.fix ? (
                  <div className="mt-2">
                    {check.fix.kind === "apply" ? (
                      <>
                        <button type="button" className="jata-btn jata-btn-secondary" disabled={busy === check.fix.id} onClick={() => void applyFix(check.fix!.kind === "apply" ? check.fix.id : "", check.fix!.label)}>
                          {busy === check.fix.id ? "Applying…" : `Fix with JATA — ${check.fix.label}`}
                        </button>
                        <p className="jata-hint">{check.fix.description}</p>
                      </>
                    ) : null}
                    {check.fix.kind === "link" ? (
                      <a className="jata-btn jata-btn-secondary" href={`/dashboard/businesses/${businessId}/${check.fix.href === "settings" ? "theme" : check.fix.href}`}>
                        {check.fix.label}
                      </a>
                    ) : null}
                    {check.fix.kind === "photo-lab" ? (
                      <button
                        type="button"
                        className="jata-btn jata-btn-secondary"
                        onClick={() =>
                          setPhotoLab({
                            subjectType: check.fix!.kind === "photo-lab" ? check.fix.subjectType : "BUSINESS",
                            subjectId: check.fix!.kind === "photo-lab" ? check.fix.subjectId : null,
                            subjectName: check.fix!.kind === "photo-lab" ? check.fix.subjectName : "",
                          })
                        }
                      >
                        ✨ {check.fix.label}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          {report.attention.length > report.topActions.length ? (
            <button type="button" className="jata-btn jata-btn-ghost mt-2" onClick={() => setShowAll((state) => !state)} aria-expanded={showAll}>
              {showAll ? "Show fewer" : `Show all ${report.attention.length} items`}
            </button>
          ) : null}
        </>
      )}

      {report.recommendations.length > 0 ? (
        <div className="mt-4 rounded-xl bg-zinc-50 p-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-zinc-500">What JATA noticed</h3>
          <ul className="mt-1 space-y-1 text-sm text-zinc-700">
            {report.recommendations.map((line) => (
              <li key={line}>• {line}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {report.passing.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">What is already good ({report.passing.length})</summary>
          <ul className="mt-2 space-y-1 text-sm text-zinc-600">
            {report.passing.map((check) => (
              <li key={check.id}>
                ✅ <span className="font-semibold text-zinc-700">{check.label}</span> — {check.detail}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {payload?.publishing ? (
        <p className="jata-hint mt-3">
          {payload.publishing.entitled
            ? payload.publishing.ready
              ? "Your website passes the publish checklist."
              : `Publishing still needs: ${payload.publishing.failedChecks.join(", ")}.`
            : "Publishing unlocks with the Interactive Business plan — your work stays saved."}
        </p>
      ) : null}
      {payload?.ai ? <p className="jata-hint">{payload.ai.note}</p> : null}
      {message ? (
        <p className={`mt-2 text-sm ${message.tone === "error" ? "jata-error" : message.tone === "warn" ? "text-amber-800" : "text-emerald-700"}`} role="status">
          {message.text}
          {message.tone === "warn" ? ` You can add that in Theme & brand.` : ""}
        </p>
      ) : null}

      {photoLab ? (
        <PhotoLab
          businessId={businessId}
          subjectType={photoLab.subjectType}
          subjectId={photoLab.subjectId}
          subjectName={photoLab.subjectName}
          onUse={() => {
            setPhotoLab(null);
            void load();
          }}
          onClose={() => setPhotoLab(null)}
        />
      ) : null}
    </section>
  );
}
