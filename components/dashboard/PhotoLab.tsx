"use client";

/**
 * JATA Photo Lab (§11–§17, §39, §40)
 *
 * Where an owner creates a website image without writing a prompt, or improves a photo they
 * already took. Everything here is in plain language, works one-handed on a phone, and never
 * commits an image to the website on its own: the owner picks one, and JATA tells them exactly
 * what it is — a photograph or JATA-designed artwork standing in for one.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { FILE_INPUT_ACCEPT, humanFileSize } from "@/lib/media/imageFormat";
import { ASPECT_LABELS, type AspectRatio } from "@/lib/media/imagePlan";
import { cropDataUrl, enhanceDataUrl, prepareUpload, uploadPreparedImage, type PipelineProgress } from "@/lib/media/browserImage";

type Asset = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  alt?: string | null;
  label?: string | null;
  source?: string;
};

type Status = {
  presets: Array<{ key: string; label: string; description: string; placement: string }>;
  styles: Array<{ key: string; label: string }>;
  provider: { image: { key: string; label: string; photorealistic: boolean; configured: boolean }; vendorConnected: boolean; note: string };
  editor: { key: string; label: string } | null;
  quota: { remainingImages: number; remainingEnhances: number; imagesPerMonth: number; planLabel: string; summary: string };
};

type Tab = "create" | "improve" | "crop";

export function PhotoLab({
  businessId,
  subjectType = "PRODUCT",
  subjectId = null,
  subjectName = "",
  subjectDescription = "",
  imageKind = "IMAGE",
  initialTab = "create",
  sourceAsset = null,
  onUse,
  onClose,
}: {
  businessId: string;
  subjectType?: "PRODUCT" | "SERVICE" | "SECTION" | "LOGO" | "BUSINESS";
  subjectId?: string | null;
  subjectName?: string;
  subjectDescription?: string;
  imageKind?: "IMAGE" | "LOGO" | "HERO" | "OTHER";
  initialTab?: Tab;
  sourceAsset?: Asset | null;
  onUse: (url: string, asset: { id: string; url: string; alt: string | null }) => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [status, setStatus] = useState<Status | null>(null);
  const [preset, setPreset] = useState("product-photo");
  const [style, setStyle] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [count, setCount] = useState(2);
  const [busy, setBusy] = useState<"" | "create" | "improve-ai" | "improve-phone" | "crop" | "upload">("");
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notes2, setNotes2] = useState<string[]>([]);
  const [candidates, setCandidates] = useState<Asset[]>([]);
  const [strength, setStrength] = useState<"light" | "balanced" | "strong">("balanced");
  const [aspect, setAspect] = useState<AspectRatio>("square");
  const [working, setWorking] = useState<string | null>(null);
  const [sourceImage, setSourceImage] = useState<{ url: string; id: string | null } | null>(sourceAsset ? { url: sourceAsset.url, id: sourceAsset.id } : null);
  const [library, setLibrary] = useState<Asset[]>([]);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch(`/api/studio/ai/status?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        setStatus(data as Status);
        if (!style && Array.isArray(data?.styles) && data.styles[0]) setStyle(String(data.styles[0].key));
      }
    } catch {
      setStatus(null);
    }
  }, [businessId, style]);

  const loadLibrary = useCallback(async () => {
    try {
      const response = await fetch(`/api/media?businessId=${encodeURIComponent(businessId)}&limit=60`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      setLibrary(Array.isArray(data.assets) ? data.assets : []);
    } catch {
      setLibrary([]);
    }
  }, [businessId]);

  useEffect(() => {
    void loadStatus();
    void loadLibrary();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId]);

  const quotaLeft = status?.quota.remainingImages ?? null;
  const canCreate = quotaLeft === null || quotaLeft > 0;

  async function create(refresh: boolean) {
    setBusy("create");
    setError(null);
    setNotes2([]);
    setWorking("Creating your image…");
    try {
      const response = await fetch("/api/studio/ai/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          preset,
          style,
          subjectType,
          subjectId,
          subjectName,
          subjectDescription,
          ownerNotes: notes,
          count,
          refresh,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't create the image this time. Your business information is safe. Try again.");
        return;
      }
      setCandidates(Array.isArray(data.assets) ? data.assets : []);
      setNotes2(Array.isArray(data.notes) ? data.notes : []);
      if (data.quota?.summary) setStatus((current) => (current ? { ...current, quota: { ...current.quota, summary: data.quota.summary, remainingImages: data.quota.remainingImages } } : current));
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
    } finally {
      setBusy("");
      setWorking(null);
    }
  }

  async function improveOnPhone() {
    if (!sourceImage) return setError("Choose a photo to improve first.");
    setBusy("improve-phone");
    setError(null);
    setWorking("Improving your photo…");
    try {
      const prepared = await enhanceDataUrl(sourceImage.url, { strength, onProgress: setProgress });
      if (prepared.status !== "ok") {
        setError(prepared.issue.message);
        return;
      }
      const uploaded = await uploadPreparedImage({
        businessId,
        upload: prepared.upload,
        kind: imageKind,
        alt: subjectName ? `${subjectName} — improved photo` : "",
        source: "ENHANCED",
        label: "ACTUAL",
        onProgress: setProgress,
      });
      if (uploaded.status !== "ok") {
        setError(uploaded.error);
        return;
      }
      // Record the on-device improvement so the library shows exactly what was applied (§43).
      await fetch("/api/studio/ai/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          imageDataUrl: prepared.upload.dataUrl,
          assetId: uploaded.asset.id,
          subjectType,
          subjectId,
          mode: "device",
          strength,
          applied: ["lighting", "exposure", "contrast", "colour", "sharpness"],
        }),
      }).catch(() => null);
      setCandidates([{ ...uploaded.asset, label: "ACTUAL" }]);
      setNotes2([...prepared.upload.notes, "Your product stays exactly the same product — only the presentation changed."]);
      void loadLibrary();
    } catch {
      setError("We couldn't improve that photo on your phone. Try again, or pick another photo.");
    } finally {
      setBusy("");
      setProgress(null);
      setWorking(null);
    }
  }

  async function improveWithAi() {
    if (!sourceImage) return setError("Choose a photo to improve first.");
    setBusy("improve-ai");
    setError(null);
    setWorking("Applying your website style…");
    try {
      const response = await fetch("/api/studio/ai/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessId,
          imageDataUrl: sourceImage.url,
          assetId: sourceImage.id,
          subjectType,
          subjectId,
          mode: "provider",
          ownerNotes: notes,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't improve the photo this time. Your original is safe — try again.");
        return;
      }
      setCandidates(Array.isArray(data.assets) ? data.assets : []);
      setNotes2(Array.isArray(data.notes) ? data.notes : []);
      void loadLibrary();
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
    } finally {
      setBusy("");
      setWorking(null);
    }
  }

  async function crop() {
    if (!sourceImage) return setError("Choose a photo to crop first.");
    setBusy("crop");
    setError(null);
    setWorking("Cropping your photo…");
    try {
      const prepared = await cropDataUrl(sourceImage.url, { aspect, onProgress: setProgress });
      if (prepared.status !== "ok") {
        setError(prepared.issue.message);
        return;
      }
      const uploaded = await uploadPreparedImage({
        businessId,
        upload: prepared.upload,
        kind: imageKind,
        alt: subjectName ? `${subjectName}` : "",
        source: "UPLOAD",
        label: "ACTUAL",
        onProgress: setProgress,
      });
      if (uploaded.status !== "ok") {
        setError(uploaded.error);
        return;
      }
      setCandidates([{ ...uploaded.asset, label: "ACTUAL" }]);
      setNotes2(["Saved as a new image — your original is untouched."]);
      void loadLibrary();
    } catch {
      setError("We couldn't crop that photo. Try again.");
    } finally {
      setBusy("");
      setProgress(null);
      setWorking(null);
    }
  }

  async function chooseCandidate(asset: Asset) {
    setWorking("Saving your choice…");
    onUse(asset.url, { id: asset.id, url: asset.url, alt: asset.alt ?? null });
    setWorking(null);
    onClose();
  }

  async function removeCandidate(asset: Asset) {
    setCandidates((current) => current.filter((entry) => entry.id !== asset.id));
    await fetch(`/api/media?id=${encodeURIComponent(asset.id)}`, { method: "DELETE" }).catch(() => null);
    void loadLibrary();
  }

  async function refineWithCrop(asset: Asset) {
    setSourceImage({ url: asset.url, id: asset.id });
    setTab("crop");
    setCandidates([]);
  }

  const aspectOptions = useMemo(() => (["square", "portrait", "landscape", "wide"] as AspectRatio[]).map((key) => ({ key, label: ASPECT_LABELS[key] })), []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label="JATA photo lab">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl bg-white p-4 shadow-xl sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="jata-kicker">JATA photo lab</p>
            <h3 className="text-base font-bold">{subjectName ? subjectName : "Website images"}</h3>
            <p className="text-sm text-zinc-600">
              {status?.provider.note || "Create images with JATA, or improve a photo you already have."}
            </p>
          </div>
          <button type="button" className="jata-btn jata-btn-ghost" onClick={onClose} aria-label="Close photo lab">
            Close
          </button>
        </div>

        <div className="mt-3 flex gap-2 overflow-x-auto pb-1 text-sm" role="tablist" aria-label="Photo lab modes">
          {([
            { key: "create", label: "✨ Create with JATA" },
            { key: "improve", label: "Improve a photo" },
            { key: "crop", label: "Crop" },
          ] as Array<{ key: Tab; label: string }>).map((entry) => (
            <button
              key={entry.key}
              type="button"
              role="tab"
              aria-selected={tab === entry.key}
              className={`inline-flex min-h-11 shrink-0 items-center rounded-full border px-4 font-semibold ${tab === entry.key ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white"}`}
              onClick={() => {
                setTab(entry.key);
                setError(null);
                setNotes2([]);
              }}
            >
              {entry.label}
            </button>
          ))}
        </div>

        {status ? (
          <p className="jata-hint mt-2">
            {status.quota.summary}
            {status.provider.vendorConnected ? ` Images by ${status.provider.image.label}.` : " JATA designs branded artwork from your colours and style."}
          </p>
        ) : null}

        {tab === "create" ? (
          <section className="mt-3 space-y-3">
            <div>
              <span className="jata-label">What should we create?</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {(status?.presets || [{ key: "product-photo", label: "Professional product photo", description: "", placement: "product" }]).map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setPreset(entry.key)}
                    aria-pressed={preset === entry.key}
                    className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${preset === entry.key ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white"}`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <span className="jata-label">Style</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {(status?.styles || []).map((entry) => (
                  <button
                    key={entry.key}
                    type="button"
                    onClick={() => setStyle(entry.key)}
                    aria-pressed={style === entry.key}
                    className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${style === entry.key ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white"}`}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
            </div>

            <label className="jata-field">
              <span className="jata-label">Anything specific? (optional)</span>
              <input
                className="jata-input"
                value={notes}
                maxLength={200}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="e.g. served in our blue bowl, with the shop front in the background"
              />
            </label>

            <div className="flex flex-wrap items-center gap-2">
              <label className="jata-field">
                <span className="jata-label">How many options?</span>
                <select className="jata-input" value={count} onChange={(event) => setCount(Number(event.target.value))}>
                  {[1, 2, 3, 4].map((value) => (
                    <option key={value} value={value} disabled={(quotaLeft ?? 4) < value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <button type="button" className="jata-btn jata-btn-primary" disabled={busy !== "" || !canCreate} onClick={() => void create(false)}>
                {busy === "create" ? "Creating…" : "Create images"}
              </button>
            </div>
            {!canCreate ? <p className="jata-hint">You have used this month&apos;s included images. Your existing images stay yours and the allowance resets on the 1st.</p> : null}
          </section>
        ) : null}

        {tab === "improve" ? (
          <section className="mt-3 space-y-3">
            <p className="text-sm text-zinc-600">
              JATA improves lighting, exposure, contrast, sharpness and background — the product itself stays exactly the same product.
            </p>
            <div className="flex flex-wrap gap-3">
              <label className="jata-btn jata-btn-secondary cursor-pointer">
                Choose from my phone
                <input
                  type="file"
                  accept={FILE_INPUT_ACCEPT}
                  className="hidden"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!file) return;
                    setBusy("upload");
                    setError(null);
                    const prepared = await prepareUpload(file, { onProgress: setProgress });
                    setBusy("");
                    setProgress(null);
                    if (prepared.status !== "ok") {
                      setError(prepared.issue.message);
                      return;
                    }
                    setSourceImage({ url: prepared.upload.dataUrl, id: null });
                  }}
                />
              </label>
              <button type="button" className="jata-btn jata-btn-ghost" onClick={() => void loadLibrary()}>
                From my photos
              </button>
            </div>
            <div>
              <span className="jata-label">Improve how much?</span>
              <div className="mt-1 flex flex-wrap gap-2">
                {(["light", "balanced", "strong"] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => setStrength(level)}
                    aria-pressed={strength === level}
                    className={`min-h-11 rounded-full border px-3 text-sm font-semibold capitalize ${strength === level ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white"}`}
                  >
                    {level}
                  </button>
                ))}
              </div>
            </div>
            {sourceImage ? (
              <div className="flex items-center gap-3 rounded-xl border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sourceImage.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                <p className="text-sm text-zinc-600">Selected photo</p>
              </div>
            ) : (
              <div className="grid grid-cols-4 gap-2">
                {library.slice(0, 12).map((asset) => (
                  <button key={asset.id} type="button" onClick={() => setSourceImage({ url: asset.url, id: asset.id })} aria-label="Choose this photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset.url} alt="" className="h-16 w-full rounded-lg border object-cover" />
                  </button>
                ))}
              </div>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="jata-btn jata-btn-primary" disabled={busy !== "" || !sourceImage} onClick={() => void improveOnPhone()}>
                {busy === "improve-phone" ? "Improving…" : "Improve now (on my phone)"}
              </button>
              {status?.editor ? (
                <button type="button" className="jata-btn jata-btn-secondary" disabled={busy !== "" || !sourceImage} onClick={() => void improveWithAi()}>
                  {busy === "improve-ai" ? "Working…" : `Improve with ${status.editor.label}`}
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "crop" ? (
          <section className="mt-3 space-y-3">
            <div className="flex flex-wrap gap-2">
              {aspectOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setAspect(option.key)}
                  aria-pressed={aspect === option.key}
                  className={`min-h-11 rounded-full border px-3 text-sm font-semibold ${aspect === option.key ? "border-zinc-900 bg-zinc-900 text-white" : "bg-white"}`}
                >
                  {option.label}
                </button>
              ))}
            </div>
            {!sourceImage ? (
              <div className="grid grid-cols-4 gap-2">
                {library.slice(0, 12).map((asset) => (
                  <button key={asset.id} type="button" onClick={() => setSourceImage({ url: asset.url, id: asset.id })} aria-label="Choose this photo">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset.url} alt="" className="h-16 w-full rounded-lg border object-cover" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-3 rounded-xl border p-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={sourceImage.url} alt="" className="h-16 w-16 rounded-lg object-cover" />
                <p className="text-sm text-zinc-600">Centred crop — your original stays in your library.</p>
              </div>
            )}
            <button type="button" className="jata-btn jata-btn-primary" disabled={busy !== "" || !sourceImage} onClick={() => void crop()}>
              {busy === "crop" ? "Cropping…" : "Save cropped image"}
            </button>
          </section>
        ) : null}

        {working ? <p className="mt-3 text-sm font-semibold text-zinc-700" role="status">{working}</p> : null}
        {progress ? (
          <div className="mt-3" role="status" aria-live="polite">
            <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
              <div className="h-full bg-zinc-900 transition-[width]" style={{ width: `${progress.percent}%` }} />
            </div>
            <p className="mt-1 text-xs text-zinc-600">
              {progress.message} {progress.percent > 0 ? `${progress.percent}%` : ""}
            </p>
          </div>
        ) : null}
        {error ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3" role="alert">
            <p className="text-sm text-amber-900">{error}</p>
            {tab === "create" ? (
              <button type="button" className="jata-btn jata-btn-secondary mt-2" disabled={busy !== ""} onClick={() => void create(false)}>
                Try again
              </button>
            ) : null}
          </div>
        ) : null}
        {notes2.length > 0 ? (
          <ul className="mt-3 space-y-1 text-xs text-zinc-600">
            {notes2.map((note) => (
              <li key={note}>• {note}</li>
            ))}
          </ul>
        ) : null}

        {candidates.length > 0 ? (
          <section className="mt-4">
            <h4 className="text-sm font-bold">{candidates.length} option{candidates.length === 1 ? "" : "s"}</h4>
            <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {candidates.map((asset) => (
                <li key={asset.id} className="rounded-xl border p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={asset.url} alt={asset.alt || "Generated image"} className="h-28 w-full rounded-lg object-cover" />
                  {asset.label === "REPRESENTATIVE" ? (
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">JATA designed</p>
                  ) : null}
                  {typeof asset.width === "number" && typeof asset.height === "number" ? (
                    <p className="text-[11px] text-zinc-500">
                      {asset.width}×{asset.height} px
                    </p>
                  ) : null}
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button type="button" className="jata-btn jata-btn-primary" onClick={() => void chooseCandidate(asset)}>
                      Use this image
                    </button>
                    <button type="button" className="jata-btn jata-btn-ghost" onClick={() => void refineWithCrop(asset)}>
                      Crop
                    </button>
                    <button type="button" className="jata-btn jata-btn-ghost" onClick={() => void removeCandidate(asset)}>
                      Remove
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            <p className="jata-hint">Saved to your photos automatically. Nothing on your website changes until you publish.</p>
            {tab === "create" ? (
              <button type="button" className="jata-btn jata-btn-secondary mt-2" disabled={busy !== "" || !canCreate} onClick={() => void create(true)}>
                {busy === "create" ? "Creating…" : "Create other options"}
              </button>
            ) : null}
          </section>
        ) : null}
      </div>
    </div>
  );
}

/** Upload progress summary used by the picker, kept here so both share one implementation. */
export function uploadNote(upload: { sourceBytes: number; bytes: number }): string {
  if (upload.sourceBytes <= upload.bytes) return `Uploaded ${humanFileSize(upload.bytes)}.`;
  return `Optimized ${humanFileSize(upload.sourceBytes)} to ${humanFileSize(upload.bytes)}.`;
}

export { prepareUpload, uploadPreparedImage };
