"use client";

/**
 * Media library (§18, §27, §43)
 *
 * Every image the business owns, in one place, with what it is and where it came from: uploads,
 * JATA-created images, improved photos. Owners can search, filter, set alt text, crop, reuse,
 * set a cover and delete — and deleting a JATA-created batch removes exactly those files.
 */

import { useCallback, useEffect, useState } from "react";
import { ASPECT_LABELS, type AspectRatio } from "@/lib/media/imagePlan";
import { cropDataUrl, uploadPreparedImage } from "@/lib/media/browserImage";
import { PhotoLab } from "./PhotoLab";

type Asset = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  bytes: number | null;
  mime: string | null;
  kind: string;
  alt: string | null;
  source: string;
  label: string | null;
  aiGenerationId: string | null;
  createdAt: string;
};

type Generation = {
  id: string;
  kind: string;
  status: string;
  providerKey: string;
  createdAt: string;
  assetIds: string[];
  errorCode: string | null;
};

const SOURCE_LABELS: Record<string, string> = {
  UPLOAD: "My photo",
  AI_GENERATED: "JATA created",
  AI_ENHANCED: "Improved by AI",
  ENHANCED: "Improved on my phone",
};

const LABEL_NOTES: Record<string, string> = {
  REPRESENTATIVE: "Designed artwork — not a photo of the actual product",
  ACTUAL: "Your real product",
  AI_GENERATED: "AI-generated photograph",
};

export function MediaLibrary({ businessId, heroImageUrl }: { businessId: string; heroImageUrl: string | null }) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [generations, setGenerations] = useState<Generation[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "UPLOAD" | "AI_GENERATED" | "IMPROVED">("all");
  const [altDraft, setAltDraft] = useState<{ id: string; value: string } | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [labFor, setLabFor] = useState<{ tab: "create" | "improve" | "crop"; asset?: Asset | null } | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ businessId, limit: "120" });
      if (query.trim()) params.set("q", query.trim());
      if (filter === "UPLOAD") params.set("source", "UPLOAD");
      if (filter === "AI_GENERATED") params.set("source", "AI_GENERATED");
      const response = await fetch(`/api/media?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch {
      setError("We couldn't load your photos. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, [businessId, query, filter]);

  const loadHistory = useCallback(async () => {
    try {
      const response = await fetch(`/api/studio/ai/history?businessId=${encodeURIComponent(businessId)}&limit=20`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      setGenerations(Array.isArray(data.generations) ? data.generations : []);
    } catch {
      setGenerations([]);
    }
  }, [businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (showHistory) void loadHistory();
  }, [showHistory, loadHistory]);

  async function saveAlt(id: string, value: string) {
    setBusy(`alt-${id}`);
    setError(null);
    try {
      const response = await fetch("/api/media", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, alt: value }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't save that description.");
        return;
      }
      setAssets((current) => current.map((asset) => (asset.id === id ? { ...asset, alt: data.asset?.alt ?? value } : asset)));
      setAltDraft(null);
      setNotice("Description saved.");
    } catch {
      setError("We couldn't reach JATA. Please try again.");
    } finally {
      setBusy("");
    }
  }

  async function suggestAlt(asset: Asset) {
    setBusy(`suggest-${asset.id}`);
    try {
      const response = await fetch("/api/experience/assist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, kind: "IMAGE_ALT", name: asset.alt || "photo" }),
      });
      const data = await response.json().catch(() => ({}));
      const suggestion = Array.isArray(data.suggestions) ? String(data.suggestions[0]?.text || "") : "";
      setAltDraft({ id: asset.id, value: suggestion || asset.alt || "" });
    } catch {
      setAltDraft({ id: asset.id, value: asset.alt || "" });
    } finally {
      setBusy("");
    }
  }

  async function remove(asset: Asset) {
    if (typeof window !== "undefined" && !window.confirm("Remove this image? Anywhere it is used will show no image until you choose another.")) return;
    setBusy(`delete-${asset.id}`);
    try {
      const response = await fetch(`/api/media?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "We couldn't remove that image.");
        return;
      }
      setAssets((current) => current.filter((entry) => entry.id !== asset.id));
      setNotice("Image removed.");
    } catch {
      setError("We couldn't reach JATA. Please try again.");
    } finally {
      setBusy("");
    }
  }

  async function removeGeneration(generation: Generation) {
    if (typeof window !== "undefined" && !window.confirm("Remove this batch of JATA-created images?")) return;
    setBusy(`gen-${generation.id}`);
    try {
      const response = await fetch(`/api/studio/ai/history?id=${encodeURIComponent(generation.id)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        setError(data.error || "We couldn't remove those images.");
        return;
      }
      setGenerations((current) => current.filter((entry) => entry.id !== generation.id));
      void load();
      setNotice("Removed the images JATA created in that request.");
    } catch {
      setError("We couldn't reach JATA. Please try again.");
    } finally {
      setBusy("");
    }
  }

  async function quickCrop(asset: Asset, aspect: AspectRatio) {
    setBusy(`crop-${asset.id}`);
    setError(null);
    try {
      const prepared = await cropDataUrl(asset.url, { aspect });
      if (prepared.status !== "ok") {
        setError(prepared.issue.message);
        return;
      }
      const uploaded = await uploadPreparedImage({
        businessId,
        upload: prepared.upload,
        alt: asset.alt || "",
        kind: asset.kind as "IMAGE" | "LOGO" | "HERO" | "OTHER",
        source: "UPLOAD",
        label: asset.label,
      });
      if (uploaded.status !== "ok") {
        setError(uploaded.error);
        return;
      }
      setNotice("Saved a cropped copy — your original is untouched.");
      void load();
    } catch {
      setError("We couldn't crop that image. Please try again.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-4">
      <div className="jata-card">
        <div className="flex flex-wrap items-end gap-2">
          <label className="jata-field flex-1">
            <span className="jata-label">Search my photos</span>
            <input className="jata-input" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by description, or how it was made" />
          </label>
          <label className="jata-field">
            <span className="jata-label">Show</span>
            <select className="jata-input" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}>
              <option value="all">Everything</option>
              <option value="UPLOAD">My photos</option>
              <option value="AI_GENERATED">JATA created</option>
              <option value="IMPROVED">Improved</option>
            </select>
          </label>
          <button type="button" className="jata-btn jata-btn-primary" onClick={() => setLabFor({ tab: "create" })}>
            ✨ Create with JATA
          </button>
          <button type="button" className="jata-btn jata-btn-secondary" onClick={() => setLabFor({ tab: "improve" })}>
            Improve a photo
          </button>
          <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setShowHistory((state) => !state)} aria-expanded={showHistory}>
            {showHistory ? "Hide JATA history" : "JATA history"}
          </button>
        </div>
        {notice ? <p className="mt-2 text-sm text-emerald-700" role="status">{notice}</p> : null}
        {error ? (
          <p className="jata-error mt-2 text-sm" role="alert">
            {error}
          </p>
        ) : null}
      </div>

      {showHistory ? (
        <section className="jata-card">
          <h2 className="text-sm font-bold">What JATA created</h2>
          {generations.length === 0 ? (
            <p className="mt-1 text-sm text-zinc-600">Nothing yet. Images you create will be listed here so you can remove them.</p>
          ) : (
            <ul className="mt-2 space-y-2 text-sm">
              {generations.map((generation) => (
                <li key={generation.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-2">
                  <span>
                    <span className="font-semibold capitalize">{generation.kind.toLowerCase()}</span>{" "}
                    <span className="text-zinc-600">
                      · {generation.providerKey === "jata-local" ? "JATA designed" : generation.providerKey} ·{" "}
                      {new Date(generation.createdAt).toLocaleDateString()} · {generation.assetIds.length} image
                      {generation.assetIds.length === 1 ? "" : "s"}
                      {generation.status !== "SUCCEEDED" ? ` · ${generation.status.toLowerCase()}` : ""}
                    </span>
                  </span>
                  <button type="button" className="jata-btn jata-btn-ghost" disabled={busy === `gen-${generation.id}`} onClick={() => void removeGeneration(generation)}>
                    Remove these images
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {[0, 1, 2, 3, 4, 5].map((index) => (
            <div key={index} className="h-40 animate-pulse rounded-xl bg-zinc-100" />
          ))}
        </div>
      ) : assets.length === 0 ? (
        <div className="jata-empty">
          <p className="text-sm font-semibold">Your website is ready for photos</p>
          <p className="mt-1 text-sm text-zinc-600">
            Upload a photo from your phone, or let JATA design one from your brand colours. Every image here can be reused on any product, service or section.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="jata-btn jata-btn-primary" onClick={() => setLabFor({ tab: "create" })}>
              ✨ Create my first image
            </button>
            <button type="button" className="jata-btn jata-btn-secondary" onClick={() => setLabFor({ tab: "improve" })}>
              Upload a photo
            </button>
          </div>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {assets.map((asset) => (
            <li key={asset.id} className="jata-card">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={asset.url} alt={asset.alt || ""} className="h-32 w-full rounded-lg object-cover" loading="lazy" />
              <div className="mt-2 flex flex-wrap gap-1 text-[11px]">
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-semibold">{SOURCE_LABELS[asset.source] || asset.source}</span>
                {asset.width ? (
                  <span className="rounded-full bg-zinc-100 px-2 py-0.5">
                    {asset.width}×{asset.height}
                  </span>
                ) : null}
                {asset.label && LABEL_NOTES[asset.label] ? <span className="rounded-full bg-zinc-100 px-2 py-0.5">{LABEL_NOTES[asset.label]}</span> : null}
              </div>

              {altDraft?.id === asset.id ? (
                <div className="mt-2">
                  <label className="jata-field">
                    <span className="jata-label">Describe this image (for screen readers)</span>
                    <input className="jata-input" value={altDraft.value} maxLength={160} onChange={(event) => setAltDraft({ id: asset.id, value: event.target.value })} />
                  </label>
                  <div className="mt-1 flex gap-1">
                    <button type="button" className="jata-btn jata-btn-primary" disabled={busy === `alt-${asset.id}`} onClick={() => void saveAlt(asset.id, altDraft.value)}>
                      Save
                    </button>
                    <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setAltDraft(null)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <p className="mt-1 line-clamp-2 text-xs text-zinc-600">{asset.alt || "No description yet"}</p>
              )}

              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setAltDraft({ id: asset.id, value: asset.alt || "" })}>
                  Describe
                </button>
                <button type="button" className="jata-btn jata-btn-ghost" disabled={busy === `suggest-${asset.id}`} onClick={() => void suggestAlt(asset)}>
                  ✨ Suggest
                </button>
                <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setLabFor({ tab: "crop", asset })}>
                  Crop
                </button>
                <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setLabFor({ tab: "improve", asset })}>
                  Improve
                </button>
                <button type="button" className="jata-btn jata-btn-ghost" disabled={busy === `delete-${asset.id}`} onClick={() => void remove(asset)}>
                  Delete
                </button>
              </div>
              {asset.url === heroImageUrl ? <p className="mt-1 text-[11px] font-semibold text-emerald-700">Used as your opening image</p> : null}
              <details className="mt-1">
                <summary className="cursor-pointer text-[11px] text-zinc-500">Quick crop</summary>
                <div className="mt-1 flex flex-wrap gap-1">
                  {(["square", "portrait", "landscape"] as AspectRatio[]).map((ratio) => (
                    <button key={ratio} type="button" className="jata-btn jata-btn-ghost" disabled={busy === `crop-${asset.id}`} onClick={() => void quickCrop(asset, ratio)}>
                      {ASPECT_LABELS[ratio]}
                    </button>
                  ))}
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}

      {labFor ? (
        <PhotoLab
          businessId={businessId}
          subjectType="BUSINESS"
          subjectName=""
          initialTab={labFor.tab}
          sourceAsset={labFor.asset ? { id: labFor.asset.id, url: labFor.asset.url, width: labFor.asset.width, height: labFor.asset.height, alt: labFor.asset.alt } : null}
          onUse={() => {
            void load();
          }}
          onClose={() => {
            setLabFor(null);
            void load();
            if (showHistory) void loadHistory();
          }}
        />
      ) : null}
    </div>
  );
}
