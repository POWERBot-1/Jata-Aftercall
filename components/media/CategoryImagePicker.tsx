"use client";

/**
 * Category image picker (image-first Studio + POS).
 *
 * One reusable, visual chooser used by Website Studio (the website opening image) and by
 * Business POS (the optional header image) without coupling the two plans: each parent
 * supplies the gallery order, the current value and how a choice is persisted, and this
 * component owns the large preview, the phone/desktop crop preview, focal repositioning,
 * the starter gallery and the phone-upload flow.
 *
 * Honesty rules: a starter picture is labelled with what it is (a JATA photo or an AI-made
 * illustration of the *kind* of business) and uploading a photo reports the server's real
 * answer — including, today, that durable photo storage is not configured yet. Nothing here
 * pretends a save happened when it did not.
 */
/* eslint-disable @next/next/no-img-element */

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Check, Crop, Eye, ImagePlus, Monitor, RotateCcw, Smartphone, Sparkles, Trash2, Upload,
} from "lucide-react";
import type { CategoryImage } from "@/lib/categoryImagery";
import { clampFocal, focalToObjectPosition } from "@/lib/categoryImagery";
import { FILE_INPUT_ACCEPT } from "@/lib/media/imageFormat";
import { prepareUpload, uploadPreparedImage } from "@/lib/media/browserImage";

export type PickedImage = { src: string; alt: string; imageId: string | null; focal: { x: number; y: number } };

type Props = {
  /** Gallery, suggested image first (see `galleryForExperienceCategory` / `galleryForPosType`). */
  gallery: { suggestedId: string; images: CategoryImage[] };
  /** Currently saved image URL, or null when the business has not chosen one. */
  value: string | null;
  /** Saved focal point in percent, if the owner repositioned the crop. */
  focal?: { x: number; y: number } | null;
  /** Business whose library an upload belongs to. Omit to hide upload (e.g. previews). */
  businessId?: string;
  /** Where "Generate image" leads. Omit to hide it. */
  createHref?: string;
  title: string;
  description?: string;
  onUse: (image: PickedImage) => Promise<void> | void;
  /** Restore the suggested category image. Omit to hide Restore. */
  onRestore?: () => Promise<void> | void;
  /** Remove the chosen image entirely. Omit to hide Remove. */
  onRemove?: () => Promise<void> | void;
  /** Persist a repositioned crop without changing the picture. Omit to hide repositioning. */
  onFocalChange?: (focal: { x: number; y: number }) => Promise<void> | void;
};

function sameImage(image: CategoryImage, value: string | null): boolean {
  if (!value) return false;
  return image.src === value || image.webp === value;
}

export function CategoryImagePicker({
  gallery, value, focal, businessId, createHref, title, description,
  onUse, onRestore, onRemove, onFocalChange,
}: Props) {
  const suggested = gallery.images.find((image) => image.id === gallery.suggestedId) ?? gallery.images[0];
  const selectedImage = gallery.images.find((image) => sameImage(image, value)) ?? null;

  const [preview, setPreview] = useState<CategoryImage | null>(null);
  const [view, setView] = useState<"desktop" | "mobile">("desktop");
  const [localFocal, setLocalFocal] = useState<{ x: number; y: number } | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);

  const current = preview ?? selectedImage ?? suggested;
  const currentFocal = localFocal ?? (selectedImage && current?.id === selectedImage.id ? focal : null) ?? current?.focal ?? { x: 50, y: 45 };
  const usingCurrent = Boolean(current && sameImage(current, value));
  const showingUploaded = Boolean(value && !selectedImage && !preview);

  async function run(action: string, fn: () => Promise<void> | void, done: string) {
    setBusy(action);
    setError(null);
    setNotice(null);
    try {
      await fn();
      setNotice(done);
    } catch {
      setError("We couldn't save that. Check your connection and try again — nothing was changed.");
    } finally {
      setBusy("");
    }
  }

  async function handleFile(file: File) {
    if (!businessId) return;
    setBusy("upload");
    setError(null);
    setNotice(null);
    try {
      const prepared = await prepareUpload(file, {});
      if (prepared.status !== "ok") {
        setError(prepared.issue.message);
        return;
      }
      const uploaded = await uploadPreparedImage({
        businessId, upload: prepared.upload, alt: "My business photo", kind: "HERO", source: "UPLOAD", label: "ACTUAL",
      });
      if (uploaded.status !== "ok") {
        // The server's real answer — today this explains that durable photo storage is not
        // configured yet, so the starter gallery below remains the saveable choice.
        setError(uploaded.error);
        return;
      }
      await onUse({ src: uploaded.asset.url, alt: uploaded.asset.alt || "My business photo", imageId: null, focal: { x: 50, y: 45 } });
      setPreview(null);
      setNotice("Your photo is saved and in use.");
    } catch {
      setError("We couldn't read that photo. Try a JPG, PNG or WebP image.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="jata-card" aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-base font-bold">{title}</h2>
          {description ? <p className="mt-1 max-w-xl text-sm text-zinc-600">{description}</p> : null}
        </div>
        <span className="rounded-full border px-2.5 py-1 text-[11px] font-semibold text-zinc-600">
          {value ? "Image saved" : "Suggested image"}
        </span>
      </div>

      {/* Large live preview with a phone/desktop crop switch. */}
      <div className="mt-3 overflow-hidden rounded-2xl border bg-zinc-100">
        <div
          className={view === "mobile" ? "relative mx-auto aspect-[4/5] max-h-[420px]" : "relative aspect-[16/9]"}
          data-testid="category-image-preview"
        >
          {showingUploaded ? (
            <img src={value as string} alt="Your saved business image" className="h-full w-full object-cover"
              style={{ objectPosition: focalToObjectPosition(localFocal ?? focal) }} />
          ) : current && !broken.has(current.id) ? (
            <picture>
              {current.webp ? <source srcSet={current.webpSrcSet} type="image/webp" sizes="(max-width: 720px) 100vw, 1200px" /> : null}
              <img src={current.src} srcSet={current.srcSet} sizes="(max-width: 720px) 100vw, 1200px" alt={current.alt}
                width={current.width} height={current.height} className="h-full w-full object-cover"
                style={{ objectPosition: focalToObjectPosition(currentFocal) }}
                onError={() => setBroken((prev) => new Set(prev).add(current.id))} />
            </picture>
          ) : (
            <div className="grid h-full place-items-center p-6 text-center text-sm text-zinc-600" role="status">
              This picture could not load. Pick another one below — your saved image has not changed.
            </div>
          )}
          <span className="absolute bottom-2 left-2 rounded-full bg-black/65 px-2.5 py-1 text-[11px] font-semibold text-white">
            {showingUploaded ? "Your photo" : current?.provenance === "ai-generated-illustration" ? "AI-made illustration" : "Illustrative photo"}
          </span>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2" role="group" aria-label="Preview size">
        <button type="button" className="jata-btn jata-btn-ghost" aria-pressed={view === "mobile"} onClick={() => setView("mobile")}>
          <Smartphone size={15} aria-hidden="true" /> Phone
        </button>
        <button type="button" className="jata-btn jata-btn-ghost" aria-pressed={view === "desktop"} onClick={() => setView("desktop")}>
          <Monitor size={15} aria-hidden="true" /> Desktop
        </button>
        {current && !usingCurrent && !showingUploaded ? (
          <button type="button" className="jata-btn jata-btn-primary" disabled={Boolean(busy)}
            onClick={() => void run("use", async () => { await onUse({ src: current.src, alt: current.alt, imageId: current.id, focal: currentFocal }); setPreview(null); }, "Image saved. It will be used from now on.")}>
            <Check size={15} aria-hidden="true" /> {busy === "use" ? "Saving…" : "Use image"}
          </button>
        ) : null}
        {businessId ? (
          <button type="button" className="jata-btn jata-btn-secondary" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()}>
            <Upload size={15} aria-hidden="true" /> {busy === "upload" ? "Working…" : value ? "Change image" : "Upload my photo"}
          </button>
        ) : null}
        {createHref ? (
          <Link href={createHref} className="jata-btn jata-btn-secondary">
            <Sparkles size={15} aria-hidden="true" /> Generate image
          </Link>
        ) : null}
        {onRestore && value ? (
          <button type="button" className="jata-btn jata-btn-ghost" disabled={Boolean(busy)}
            onClick={() => void run("restore", async () => { await onRestore(); setPreview(null); setLocalFocal(null); }, "Back to the suggested image for your kind of business.")}>
            <RotateCcw size={15} aria-hidden="true" /> Restore suggested
          </button>
        ) : null}
        {onRemove && value ? (
          <button type="button" className="jata-btn jata-btn-ghost" disabled={Boolean(busy)}
            onClick={() => void run("remove", async () => { await onRemove(); setPreview(null); setLocalFocal(null); }, "Image removed.")}>
            <Trash2 size={15} aria-hidden="true" /> Remove
          </button>
        ) : null}
        <input ref={fileRef} type="file" accept={FILE_INPUT_ACCEPT} className="hidden" aria-label="Upload your own photo"
          onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void handleFile(file); }} />
      </div>

      {/* Crop repositioning. Sliders are keyboard-friendly large touch targets. */}
      {onFocalChange ? (
        <details className="mt-3 rounded-xl border bg-white p-3">
          <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
            <Crop size={15} aria-hidden="true" /> Reposition the crop
          </summary>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="jata-field">
              <span className="jata-label">Left ↔ right</span>
              <input type="range" min={5} max={95} value={currentFocal.x} className="w-full" aria-label="Horizontal position"
                onChange={(event) => setLocalFocal({ x: clampFocal(event.target.value, 50), y: currentFocal.y })} />
            </label>
            <label className="jata-field">
              <span className="jata-label">Up ↔ down</span>
              <input type="range" min={5} max={95} value={currentFocal.y} className="w-full" aria-label="Vertical position"
                onChange={(event) => setLocalFocal({ x: currentFocal.x, y: clampFocal(event.target.value, 45) })} />
            </label>
          </div>
          <button type="button" className="jata-btn jata-btn-secondary mt-2" disabled={Boolean(busy) || !localFocal}
            onClick={() => localFocal && void run("focal", () => onFocalChange(localFocal), "Crop position saved.")}>
            <Eye size={15} aria-hidden="true" /> Save position
          </button>
          <p className="jata-hint mt-1">Move the sliders, check Phone and Desktop above, then save. Your original picture is never altered.</p>
        </details>
      ) : null}

      {notice ? <p className="mt-3 text-sm font-semibold text-emerald-700" role="status">{notice}</p> : null}
      {error ? (
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3" role="alert">
          <p className="text-sm text-amber-900">{error}</p>
        </div>
      ) : null}

      {/* Starter gallery: large image cards, suggested first. */}
      <h3 className="mt-4 flex items-center gap-2 text-sm font-bold">
        <ImagePlus size={15} aria-hidden="true" /> Ready images for your kind of business
      </h3>
      <ul className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {gallery.images.map((image) => {
          const active = current?.id === image.id && !showingUploaded;
          const inUse = sameImage(image, value);
          return (
            <li key={image.id}>
              <button type="button" aria-pressed={active} onClick={() => { setPreview(image); setLocalFocal(null); setError(null); }}
                className={`block w-full overflow-hidden rounded-2xl border text-left ${active ? "border-zinc-900 ring-2 ring-zinc-900" : "bg-white"}`}>
                <span className="block aspect-[4/3] bg-zinc-100">
                  {broken.has(image.id) ? (
                    <span className="grid h-full place-items-center p-3 text-center text-xs text-zinc-500">Unavailable</span>
                  ) : (
                    <picture>
                      {image.webp ? <source srcSet={image.webpSrcSet} type="image/webp" sizes="(max-width: 720px) 50vw, 300px" /> : null}
                      <img src={image.src} srcSet={image.srcSet} sizes="(max-width: 720px) 50vw, 300px" alt={image.alt}
                        width={image.width} height={image.height} loading="lazy" decoding="async"
                        className="h-full w-full object-cover" style={{ objectPosition: focalToObjectPosition(image.focal) }}
                        onError={() => setBroken((prev) => new Set(prev).add(image.id))} />
                    </picture>
                  )}
                </span>
                <span className="block px-2.5 py-2">
                  <span className="block text-[13px] font-bold leading-tight">{image.label}</span>
                  <span className="mt-0.5 block text-[11px] text-zinc-500">
                    {image.id === gallery.suggestedId ? "Suggested for you · " : ""}{image.provenance === "ai-generated-illustration" ? "AI-made illustration" : "Illustrative photo"}{inUse ? " · In use" : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      <p className="jata-hint mt-2">
        These pictures show the kind of business — they are not photos of your shop. Your own photo always looks more trustworthy; upload one whenever you have it.
      </p>
    </section>
  );
}

export default CategoryImagePicker;
