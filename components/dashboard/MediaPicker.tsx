"use client";

/**
 * Media library (§19, §47)
 *
 * Upload, choose from the business's existing images, or paste a link. Only raster images are
 * accepted (no SVG, no remote fetch) and identical uploads are reused instead of duplicated.
 */

import { useEffect, useRef, useState } from "react";

type Asset = { id: string; url: string; width: number | null; height: number | null; alt: string | null };

const MAX_BYTES = 2 * 1024 * 1024;

export function MediaPicker({
  businessId,
  label,
  value,
  onChange,
}: {
  businessId: string;
  label: string;
  value?: string;
  onChange: (url: string) => void;
}) {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function load() {
    try {
      const response = await fetch(`/api/media?businessId=${encodeURIComponent(businessId)}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      setAssets(Array.isArray(data.assets) ? data.assets : []);
    } catch {
      setAssets([]);
    }
  }

  useEffect(() => {
    if (open) void load();
  }, [open, businessId]);

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_BYTES) return setError("That image is larger than 2 MB. Please choose a smaller one.");
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.type)) return setError("Only PNG, JPG, WEBP or GIF images are accepted.");
    setBusy(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("read failed"));
        reader.readAsDataURL(file);
      });
      const response = await fetch("/api/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId, dataUrl, alt: file.name.replace(/\.[^.]+$/, "").slice(0, 80) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) return setError(data.error || "We couldn’t save that image. Please try again.");
      onChange(String(data.asset?.url || ""));
      setOpen(true);
      void load();
    } catch {
      setError("We couldn’t read that image. Please try another.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="jata-field">
      <span className="jata-label">{label}</span>
      <div className="mt-1 flex items-start gap-3">
        <div
          aria-hidden="true"
          className="grid h-16 w-16 shrink-0 place-items-center overflow-hidden rounded-lg border bg-zinc-50 text-[10px] text-zinc-500"
          style={value ? { backgroundImage: `url(${value})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
        >
          {!value ? "No image" : ""}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="jata-btn jata-btn-secondary" onClick={() => inputRef.current?.click()} disabled={busy}>
            {busy ? "Uploading…" : "Upload"}
          </button>
          <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setOpen((state) => !state)} aria-expanded={open}>
            {open ? "Hide library" : "Choose existing"}
          </button>
          {value ? (
            <button type="button" className="jata-btn jata-btn-ghost" onClick={() => onChange("")}>
              Remove
            </button>
          ) : null}
          <input
            ref={inputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(file);
              event.target.value = "";
            }}
          />
        </div>
      </div>
      {error ? <p className="jata-error mt-2 text-sm" role="alert">{error}</p> : null}
      {open ? (
        <div className="mt-3 grid grid-cols-3 gap-2 sm:grid-cols-4">
          {assets.length === 0 ? (
            <p className="col-span-full text-sm text-zinc-600">No images yet. Upload one to start your library.</p>
          ) : (
            assets.map((asset) => (
              <button
                key={asset.id}
                type="button"
                onClick={() => onChange(asset.url)}
                className={`h-20 overflow-hidden rounded-lg border bg-zinc-50 ${value === asset.url ? "border-zinc-900 ring-2 ring-zinc-900" : ""}`}
                style={{ backgroundImage: `url(${asset.url})`, backgroundSize: "cover", backgroundPosition: "center" }}
                aria-label={asset.alt || "Choose image"}
              />
            ))
          )}
        </div>
      ) : null}
    </div>
  );
}
