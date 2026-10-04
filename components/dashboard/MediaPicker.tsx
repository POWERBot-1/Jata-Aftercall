"use client";

/**
 * Media picker (§18, §19, §20, §39, §40)
 *
 * The field an owner meets every time they add a photo: a product, a service, a hero, a logo.
 * It replaces the previous picker whose payload never reached the server — the assignment is
 * simple and must keep working on a phone in a shop with two bars of signal:
 *
 *   Upload (normalized on the device) → preview → save → Choose existing → ✨ Create with JATA
 *
 * Uploads are validated by content, corrected for orientation, resized, compressed and stored
 * with a progress bar and a retry. A failure never loses the rest of the form: the owner keeps
 * their typed price, name and description and simply tries the photo again.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { FILE_INPUT_ACCEPT, humanFileSize } from "@/lib/media/imageFormat";
import { prepareUpload, uploadPreparedImage, type PipelineProgress } from "@/lib/media/browserImage";
import { PhotoLab } from "./PhotoLab";

type Asset = {
  id: string;
  url: string;
  width: number | null;
  height: number | null;
  alt: string | null;
  source?: string;
  label?: string | null;
};

export function MediaPicker({
  businessId,
  label,
  value,
  onChange,
  kind = "IMAGE",
  subjectType = "PRODUCT",
  subjectId = null,
  subjectName = "",
  subjectDescription = "",
  help,
}: {
  businessId: string;
  label: string;
  value?: string;
  onChange: (url: string) => void;
  kind?: "IMAGE" | "LOGO" | "HERO" | "OTHER";
  subjectType?: "PRODUCT" | "SERVICE" | "SECTION" | "LOGO" | "BUSINESS";
  subjectId?: string | null;
  subjectName?: string;
  subjectDescription?: string;
  help?: string;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [open, setOpen] = useState(false);
  const [labOpen, setLabOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState<string[]>([]);
  const [progress, setProgress] = useState<PipelineProgress | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "upload" | "ai">("all");
  const [lastFile, setLastFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<{ url: string; pending: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ businessId, limit: "60" });
      if (query.trim()) params.set("q", query.trim());
      if (filter === "ai") params.set("source", "AI_GENERATED");
      if (filter === "upload") params.set("source", "UPLOAD");
      const response = await fetch(`/api/media?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch {
      setAssets([]);
    }
  }, [businessId, query, filter]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  async function handleFile(file: File) {
    setError(null);
    setNotes([]);
    setLastFile(file);
    setBusy(true);
    setPreview({ url: "", pending: true });
    try {
      const prepared = await prepareUpload(file, { onProgress: setProgress });
      if (prepared.status !== "ok") {
        setPreview(null);
        setError(prepared.issue.message);
        return;
      }
      setPreview({ url: prepared.upload.dataUrl, pending: true });
      setNotes(prepared.upload.notes);
      const uploaded = await uploadPreparedImage({
        businessId,
        upload: prepared.upload,
        alt: subjectName || file.name.replace(/\.[^.]+$/, "").slice(0, 80),
        kind,
        source: "UPLOAD",
        label: "ACTUAL",
        onProgress: setProgress,
      });
      if (uploaded.status !== "ok") {
        setError(uploaded.error);
        return;
      }
      onChange(uploaded.asset.url);
      setPreview({ url: uploaded.asset.url, pending: false });
      void load();
    } catch {
      setPreview(null);
      setError("We couldn't save that photo. Your other details are safe — try again.");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  const shown = preview?.url || value || "";
  const uploaded = /^data:/.test(shown) ? "Uploaded photo" : shown;

  return (
    <div className="jata-field">
      <span className="jata-label">{label}</span>
      {help ? <span className="jata-hint">{help}</span> : null}

      <div className="mt-1 flex items-start gap-3">
        <div className="grid h-20 w-20 shrink-0 place-items-center overflow-hidden rounded-xl border bg-zinc-50 text-[11px] text-zinc-500">
          {shown ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={shown} alt="" className="h-full w-full object-cover" />
          ) : (
            <span>No image</span>
          )}
        </div>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <button type="button" className="jata-btn jata-btn-secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "Working…" : shown ? "Replace photo" : "Upload photo"}
          </button>
          <button type="button" className="jata-btn jata-btn-secondary" onClick={() => setLabOpen(true)} disabled={busy}>
            ✨ Create with JATA
          </button>
          <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setOpen((state) => !state)} aria-expanded={open}>
            {open ? "Hide my photos" : "Choose existing"}
          </button>
          {shown ? (
            <button
              type="button"
              className="jata-btn jata-btn-ghost"
              onClick={() => {
                onChange("");
                setPreview(null);
                setNotes([]);
              }}
            >
              Remove
            </button>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept={FILE_INPUT_ACCEPT}
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) void handleFile(file);
            }}
          />
        </div>
      </div>

      {progress ? (
        <div className="mt-2" role="status" aria-live="polite">
          <div className="h-2 w-full overflow-hidden rounded-full bg-zinc-100">
            <div className="h-full bg-zinc-900 transition-[width] duration-200" style={{ width: `${progress.percent}%` }} />
          </div>
          <p className="mt-1 text-xs text-zinc-600">{progress.message}</p>
        </div>
      ) : null}

      {notes.length > 0 && !error ? (
        <ul className="mt-2 space-y-0.5 text-xs text-zinc-600">
          {notes.map((note) => (
            <li key={note}>• {note}</li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 p-2" role="alert">
          <p className="text-sm text-amber-900">{error}</p>
          {lastFile ? (
            <button type="button" className="jata-btn jata-btn-secondary mt-2" disabled={busy} onClick={() => void handleFile(lastFile)}>
              Try this photo again
            </button>
          ) : null}
        </div>
      ) : null}

      {shown && !busy ? <p className="jata-hint mt-2 truncate">{uploaded === "Uploaded photo" ? "Saved to your photos" : uploaded}</p> : null}

      {open ? (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="jata-input flex-1"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search my photos"
              aria-label="Search my photos"
            />
            <select className="jata-input w-auto" value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)} aria-label="Filter photos">
              <option value="all">All photos</option>
              <option value="upload">My uploads</option>
              <option value="ai">JATA created</option>
            </select>
          </div>
          {assets.length === 0 ? (
            <div className="jata-empty">
              <p className="text-sm font-semibold">Your website is ready for photos</p>
              <p className="mt-1 text-sm text-zinc-600">Upload a photo from your phone, or let JATA create one from your brand colours.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {assets.map((asset) => (
                <li key={asset.id}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(asset.url);
                      setPreview({ url: asset.url, pending: false });
                      setNotes([]);
                    }}
                    className={`w-full overflow-hidden rounded-xl border ${value === asset.url ? "border-zinc-900 ring-2 ring-zinc-900" : ""}`}
                    aria-label={asset.alt || "Choose this photo"}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={asset.url} alt={asset.alt || ""} className="h-20 w-full object-cover" loading="lazy" />
                  </button>
                  <p className="mt-0.5 truncate text-[11px] text-zinc-500">
                    {asset.source === "AI_GENERATED" ? "JATA created" : asset.source === "ENHANCED" || asset.source === "AI_ENHANCED" ? "Improved" : "My photo"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {labOpen ? (
        <PhotoLab
          businessId={businessId}
          subjectType={subjectType}
          subjectId={subjectId}
          subjectName={subjectName}
          subjectDescription={subjectDescription}
          imageKind={kind}
          onUse={(url) => {
            onChange(url);
            setPreview({ url, pending: false });
            setNotes([]);
            void load();
          }}
          onClose={() => {
            setLabOpen(false);
            void load();
          }}
        />
      ) : null}
    </div>
  );
}

/** Compact note helper shared with the Photo Lab. */
export function mediaNote(bytes: number): string {
  return humanFileSize(bytes);
}
