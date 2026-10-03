"use client";

import { useState } from "react";
import Link from "next/link";

/**
 * POS settings (§25, §26, §37, §48, §49).
 *
 * Publishing, history, copying a setup to another business, saving it as a template, and the
 * activity log. Every one of these is an owner-level action, and each is written to the audit
 * trail with who did it and what changed.
 */

export type VersionRow = { id: string; version: number; note: string | null; publishedAt: string; createdByName: string | null };
export type AuditRow = { id: string; when: string; actor: string; label: string; action: string; targetType: string | null; targetId: string | null };
export type ScopeRow = { key: string; label: string; blurb: string };
export type TargetBusiness = { id: string; name: string };

export function SettingsClient({
  businessId,
  basePath,
  businessName,
  entitled,
  lifecycleLabel,
  entitlementReason,
  expiresAt,
  draftVersion,
  publishedVersion,
  hasUnpublishedChanges,
  canPublish,
  versions,
  audit,
  scopes,
  explained,
  targets,
  savedTemplates,
  builtInTemplates,
}: {
  businessId: string;
  basePath: string;
  businessName: string;
  entitled: boolean;
  lifecycleLabel: string;
  entitlementReason: string;
  expiresAt: string | null;
  draftVersion: number;
  publishedVersion: number;
  hasUnpublishedChanges: boolean;
  canPublish: boolean;
  versions: VersionRow[];
  audit: AuditRow[];
  scopes: ScopeRow[];
  explained: { copies: string[]; neverCopies: string[] };
  targets: TargetBusiness[];
  savedTemplates: { id: string; name: string; description: string | null; updatedAt: string }[];
  builtInTemplates: { key: string; name: string; description: string }[];
}) {
  const [tab, setTab] = useState<"publish" | "history" | "copy" | "activity">("publish");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [targetBusinessId, setTargetBusinessId] = useState(targets[0]?.id ?? "");
  const [chosenScopes, setChosenScopes] = useState<string[]>(scopes.map((scope) => scope.key));
  const [templateName, setTemplateName] = useState(`${businessName} setup`);

  async function call(path: string, payload?: Record<string, unknown>, successMessage?: string) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "We couldn't do that.");
        setBusy(false);
        return;
      }
      setMessage(successMessage ?? data?.message ?? "Done.");
      setBusy(false);
      window.location.reload();
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <section className="jata-card p-4">
        <div className="pos-toolbar">
          <div>
            <p className="jata-kicker">Plan</p>
            <p className="font-semibold">{lifecycleLabel}</p>
            <p className="pos-note">
              {entitled
                ? expiresAt
                  ? `Active until ${new Date(expiresAt).toLocaleDateString("en-KE")}.`
                  : "Active."
                : entitlementReason}
            </p>
          </div>
          <Link href={`${basePath}/plan`} className={entitled ? "jata-btn jata-btn-ghost" : "jata-btn jata-btn-primary"}>
            {entitled ? "Plan details" : "Choose plan"}
          </Link>
        </div>
      </section>

      <div className="pos-tabs">
        {(["publish", "history", "copy", "activity"] as const).map((entry) => (
          <button type="button" key={entry} className="pos-tab" data-selected={tab === entry} onClick={() => setTab(entry)}>
            {entry === "publish" ? "Publishing" : entry === "history" ? "History" : entry === "copy" ? "Copy & templates" : "Activity"}
          </button>
        ))}
      </div>

      {error ? <p className="jata-error" role="alert">{error}</p> : null}
      {message ? <p className="pos-note" role="status">{message}</p> : null}

      {tab === "publish" ? (
        <section className="jata-card p-4 space-y-3">
          <div>
            <p className="jata-kicker">How your POS works</p>
            <h3 className="text-base font-semibold">Draft version {draftVersion}{publishedVersion > 0 ? ` · live version ${publishedVersion}` : " · nothing live yet"}</h3>
            <p className="pos-note">
              {hasUnpublishedChanges
                ? "You have changes that are not applied yet. Publishing makes them the way your POS works."
                : publishedVersion > 0
                  ? "Your POS is running the published setup."
                  : "Publish once the plan is paid to switch your POS on."}
            </p>
          </div>
          <div className="pos-form-actions">
            <Link href={`${basePath}/configure`} className="jata-btn jata-btn-secondary">Change my answers</Link>
            <Link href={`${basePath}/preview`} className="jata-btn jata-btn-ghost">Preview</Link>
            <button
              type="button"
              className="jata-btn jata-btn-primary"
              disabled={busy || !canPublish || !entitled || !hasUnpublishedChanges && publishedVersion > 0}
              onClick={() => void call("/configuration/publish", {}, "Published. Your POS is running this setup.")}
            >
              {busy ? "Working…" : "Publish this setup"}
            </button>
          </div>
          {!entitled ? <p className="pos-note">Publishing needs an active plan — nothing becomes live before payment is confirmed.</p> : null}
          <p className="pos-note">
            Publishing never changes a past sale. Transactions keep the setup they were recorded under, so old
            receipts still make sense.
          </p>
        </section>
      ) : null}

      {tab === "history" ? (
        <section className="jata-card p-4 space-y-3">
          <div>
            <p className="jata-kicker">History</p>
            <h3 className="text-base font-semibold">Every setup you have published</h3>
            <p className="pos-note">
              Rolling back writes a new version with the old setup — the history is never rewritten.
            </p>
          </div>
          {versions.length === 0 ? (
            <p className="pos-note">Nothing published yet.</p>
          ) : (
            <div className="pos-rows">
              {versions.map((version) => (
                <div className="pos-row" key={version.id}>
                  <div className="pos-row-main">
                    <strong>Version {version.version}{version.version === publishedVersion ? " · live" : ""}</strong>
                    <small>
                      {new Date(version.publishedAt).toLocaleString("en-KE")}
                      {version.createdByName ? ` · ${version.createdByName}` : ""}
                      {version.note ? ` · ${version.note}` : ""}
                    </small>
                  </div>
                  {canPublish && version.version !== publishedVersion ? (
                    <button
                      type="button"
                      className="jata-btn jata-btn-secondary"
                      disabled={busy || !entitled}
                      onClick={() => void call("/configuration/versions", { versionId: version.id }, `Rolled back to version ${version.version}.`)}
                    >
                      Roll back to this
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {tab === "copy" ? (
        <div className="space-y-3">
          <section className="jata-card p-4 space-y-3">
            <div>
              <p className="jata-kicker">Copy this setup</p>
              <h3 className="text-base font-semibold">Use it on another of your businesses</h3>
              <p className="pos-note">
                Copying takes the setup only. {explained.neverCopies.join(", ")} stay where they are.
              </p>
            </div>

            {targets.length === 0 ? (
              <p className="pos-note">You have no other business to copy into yet.</p>
            ) : (
              <>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="clone-target">Copy into</label>
                  <select id="clone-target" className="jata-input" value={targetBusinessId} onChange={(event) => setTargetBusinessId(event.target.value)}>
                    {targets.map((target) => <option key={target.id} value={target.id}>{target.name}</option>)}
                  </select>
                  <p className="jata-hint">A business with a live POS cannot be overwritten — edit its setup instead.</p>
                </div>

                <div>
                  <p className="jata-label">What should be copied?</p>
                  <div className="pos-grid-2 mt-1">
                    {scopes.map((scope) => (
                      <label className="pos-chip" key={scope.key} data-on={chosenScopes.includes(scope.key)}>
                        <input
                          type="checkbox"
                          checked={chosenScopes.includes(scope.key)}
                          onChange={(event) =>
                            setChosenScopes((current) =>
                              event.target.checked ? [...current, scope.key] : current.filter((key) => key !== scope.key),
                            )
                          }
                        />
                        <span>
                          <strong>{scope.label}</strong>
                          <small className="pos-note"> {scope.blurb}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="pos-form-actions">
                  <button
                    type="button"
                    className="jata-btn jata-btn-primary"
                    disabled={busy || !targetBusinessId || !chosenScopes.length}
                    onClick={() =>
                      void call("/configuration/clone", { targetBusinessId, scopes: chosenScopes }, "Copied. Open that business to finish its setup.")
                    }
                  >
                    {busy ? "Working…" : "Copy the setup"}
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="jata-card p-4 space-y-3">
            <div>
              <p className="jata-kicker">Templates</p>
              <h3 className="text-base font-semibold">Save this setup for later</h3>
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="template-name">What should we call it?</label>
              <input id="template-name" className="jata-input" type="text" value={templateName} onChange={(event) => setTemplateName(event.target.value)} />
            </div>
            <div className="pos-form-actions">
              <button type="button" className="jata-btn jata-btn-secondary" disabled={busy} onClick={() => void call("/configuration/clone", { save: true, name: templateName }, "Saved as your template.")}>
                {busy ? "Working…" : "Save as my template"}
              </button>
            </div>

            {savedTemplates.length ? (
              <div className="pos-rows">
                {savedTemplates.map((template) => (
                  <div className="pos-row" key={template.id}>
                    <div className="pos-row-main">
                      <strong>{template.name}</strong>
                      <small>{template.description ?? "Your setup"} · saved {new Date(template.updatedAt).toLocaleDateString("en-KE")}</small>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            <div>
              <p className="jata-kicker">Starting points JATA ships with</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {builtInTemplates.map((template) => (
                  <span className="pos-chip" key={template.key} title={template.description}>{template.name}</span>
                ))}
              </div>
              <p className="pos-note mt-2">
                These are offered when a new business starts its questions — they pre-fill answers, never data.
              </p>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "activity" ? (
        <section className="jata-card p-4 space-y-3">
          <div>
            <p className="jata-kicker">Activity</p>
            <h3 className="text-base font-semibold">Who did what, and when</h3>
            <p className="pos-note">Refused access is recorded too, so you can see if something was tried.</p>
          </div>
          {audit.length === 0 ? (
            <p className="pos-note">Nothing recorded yet.</p>
          ) : (
            <div className="pos-rows">
              {audit.map((entry) => (
                <div className="pos-row" key={entry.id}>
                  <div className="pos-row-main">
                    <strong>{entry.label}</strong>
                    <small>{entry.actor} · {new Date(entry.when).toLocaleString("en-KE")}</small>
                  </div>
                  <div className="pos-row-values">
                    {entry.targetType ? <span className="pos-chip">{entry.targetType.toLowerCase()}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      ) : null}
    </div>
  );
}
