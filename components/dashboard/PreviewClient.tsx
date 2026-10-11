"use client";

/**
 * Draft vs live preview (§16, §22)
 *
 * The owner sees exactly what a customer sees, in the device most of their customers use, and
 * can switch between the live site and their unpublished draft at any time. Restoring an older
 * version is one click and never deletes the newer draft.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const DEVICES = [
  { id: "mobile", label: "Mobile", width: 390, height: 780 },
  { id: "tablet", label: "Tablet", width: 834, height: 900 },
  { id: "desktop", label: "Desktop", width: 1280, height: 860 },
] as const;

type Device = (typeof DEVICES)[number]["id"];

export function PreviewClient({
  businessId,
  slug,
  draftVersion,
  publishedVersion,
}: {
  businessId: string;
  slug: string;
  draftVersion: number;
  publishedVersion: number;
}) {
  const router = useRouter();
  const [device, setDevice] = useState<Device>("mobile");
  const [mode, setMode] = useState<"draft" | "live">("draft");
  const [nonce, setNonce] = useState(0);
  const [versions, setVersions] = useState<Array<{ version: number; publishedAt: string | null; categoryKey: string }>>([]);
  const [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);

  const active = DEVICES.find((entry) => entry.id === device) || DEVICES[0];
  const src = mode === "draft" ? `/b/${slug}?preview=draft&v=${nonce}` : `/b/${slug}?v=${nonce}`;

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const response = await fetch(`/api/experience/versions?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" });
        const data = await response.json().catch(() => ({}));
        if (!cancelled) setVersions(Array.isArray(data.versions) ? data.versions : []);
      } catch {
        if (!cancelled) setVersions([]);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [businessId]);

  async function restore(version: number) {
    setRestoring(true);
    setMessage(null);
    try {
      const response = await fetch("/api/experience/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Restoring replaces the draft, so it names the version the preview was built from (409 if it moved on).
        body: JSON.stringify({ businessId, version, expectedDraftVersion: draftVersion }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setMessage({ tone: "error", text: data.error || "We couldn’t restore that version." });
      setMessage({ tone: "ok", text: `Version ${version} restored to your draft. Publish it to make it live.` });
      setMode("draft");
      setNonce((value) => value + 1);
      router.refresh();
    } catch {
      setMessage({ tone: "error", text: "We couldn’t reach the server. Please try again." });
    } finally {
      setRestoring(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="jata-toolbar">
        <div className="flex gap-2" role="group" aria-label="Preview mode">
          <button type="button" className={`jata-btn ${mode === "draft" ? "jata-btn-primary" : "jata-btn-secondary"}`} aria-pressed={mode === "draft"} onClick={() => { setMode("draft"); setNonce((value) => value + 1); }}>
            Draft
          </button>
          <button type="button" className={`jata-btn ${mode === "live" ? "jata-btn-primary" : "jata-btn-secondary"}`} aria-pressed={mode === "live"} onClick={() => { setMode("live"); setNonce((value) => value + 1); }}>
            Live
          </button>
        </div>
        <div className="flex gap-2" role="group" aria-label="Device">
          {DEVICES.map((entry) => (
            <button
              key={entry.id}
              type="button"
              className={`jata-btn ${device === entry.id ? "jata-btn-primary" : "jata-btn-secondary"}`}
              aria-pressed={device === entry.id}
              onClick={() => setDevice(entry.id)}
            >
              {entry.label}
            </button>
          ))}
          <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setNonce((value) => value + 1)}>Reload</button>
          <a className="jata-btn jata-btn-ghost" href={src} target="_blank" rel="noopener noreferrer">Open in new tab</a>
        </div>
      </div>

      <p className="text-sm text-zinc-600">
        {mode === "draft"
          ? `Showing your draft (version ${draftVersion}). Only you can see this.`
          : publishedVersion > 0
            ? `Showing the live site (version ${publishedVersion}) — what customers see now.`
            : "Nothing is published yet, so the live view is empty."}
      </p>

      <div className="flex justify-center">
        <div
          className="overflow-hidden rounded-2xl border bg-zinc-100"
          style={{ width: "100%", maxWidth: active.width }}
        >
          <iframe
            key={`${mode}-${device}-${nonce}`}
            src={src}
            title={mode === "draft" ? "Draft preview" : "Live site preview"}
            className="jata-preview-frame"
            style={{ height: active.height, border: 0 }}
          />
        </div>
      </div>

      <section className="jata-card">
        <h2 className="text-sm font-bold">Version history</h2>
        {versions.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-600">Published versions appear here, so you can always roll back.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {versions.map((version) => (
              <li key={version.version} className="jata-section-row">
                <div className="min-w-0 flex-1 text-sm">
                  <p className="font-semibold">Version {version.version}</p>
                  <p className="text-xs text-zinc-600">
                    {version.publishedAt ? new Date(version.publishedAt).toLocaleString("en-KE") : "Not published"}
                  </p>
                </div>
                <button type="button" className="jata-btn jata-btn-secondary" disabled={restoring} onClick={() => restore(version.version)}>
                  {restoring ? "Restoring…" : "Restore"}
                </button>
              </li>
            ))}
          </ul>
        )}
        {message ? (
          <p className={`mt-3 text-sm ${message.tone === "error" ? "jata-error" : "text-emerald-700"}`} role="status">{message.text}</p>
        ) : null}
      </section>
    </div>
  );
}
