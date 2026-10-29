"use client";

import { useEffect, useRef, useState } from "react";
import { FILE_INPUT_ACCEPT } from "@/lib/media/imageFormat";
import { prepareUpload, uploadPreparedImage } from "@/lib/media/browserImage";
import { safeImageUrl } from "@/lib/workspaceImagery";

/** Optional photos for categories already used by POS products. Assets stay in the media library. */
export function CategoryPhotos({ businessId, categories, initialImages, canEdit }: {
  businessId: string; categories: string[]; initialImages: { category: string; imageUrl: string }[]; canEdit: boolean;
}) {
  const [images, setImages] = useState(() => Object.fromEntries(initialImages.map((image) => [image.category, image.imageUrl])));
  const [selected, setSelected] = useState(categories[0] ?? "");
  const [pending, setPending] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const sequence = useRef(0);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  useEffect(() => () => { sequence.current += 1; }, []);
  if (!categories.length) return null;

  function resetSelection() {
    sequence.current += 1;
    setPending(null); setPreview(null); setBusy(false); setError(""); setMessage("");
  }
  async function save(category: string, imageUrl: string | null) {
    const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/category-images`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category, imageUrl }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "Could not save the category photo. Try again.");
  }
  async function upload(file: File) {
    const request = ++sequence.current;
    const category = selected;
    const current = () => sequence.current === request;
    setPending(file); setPreview(URL.createObjectURL(file)); setBusy(true); setError(""); setMessage("Preparing photo…");
    const progress = (value: { message: string }) => { if (current()) setMessage(value.message); };
    try {
      const prepared = await prepareUpload(file, { onProgress: progress });
      if (!current()) return;
      if (prepared.status !== "ok") throw new Error(prepared.issue.message);
      const result = await uploadPreparedImage({ businessId, upload: prepared.upload, kind: "IMAGE", source: "UPLOAD", label: "ACTUAL", onProgress: progress });
      if (!current()) return;
      if (result.status !== "ok") throw new Error(result.error);
      setMessage("Saving category photo…");
      await save(category, result.asset.url);
      if (!current()) return;
      setImages((old) => ({ ...old, [category]: result.asset.url }));
      setPending(null); setPreview(null); setMessage("Category photo saved.");
    } catch (err) {
      if (current()) { setError(err instanceof Error ? err.message : "Could not upload the photo. Try again."); setMessage("Photo not saved. Retry or discard your selection."); }
    } finally { if (current()) setBusy(false); }
  }
  async function remove() {
    const request = ++sequence.current;
    const category = selected;
    setBusy(true); setError("");
    try {
      await save(category, null);
      if (sequence.current !== request) return;
      setImages((old) => { const next = { ...old }; delete next[category]; return next; });
      setMessage("Category photo removed. The library image was kept.");
    } catch (err) { if (sequence.current === request) setError(err instanceof Error ? err.message : "Could not remove the photo."); }
    finally { if (sequence.current === request) setBusy(false); }
  }
  const image = preview || safeImageUrl(images[selected]);
  return <section className="jata-card p-5 space-y-3" aria-labelledby="pos-category-photos">
    <h2 id="pos-category-photos" className="text-lg font-bold">Category photos</h2>
    <p className="jata-hint">Categories come from your items. Photos remain in your media library when replaced or removed.</p>
    <label className="jata-label" htmlFor="pos-category-select">Category</label>
    <select id="pos-category-select" className="jata-input" disabled={busy} value={selected} onChange={(event) => { resetSelection(); setSelected(event.target.value); }}>
      {categories.map((category) => <option key={category} value={category}>{category}</option>)}
    </select>
    {image ? <img src={image} alt={`${selected} category photo`} width={120} height={120} style={{ width: 120, height: 120, objectFit: "cover", borderRadius: 12 }} /> : <p className="jata-hint">No category photo selected.</p>}
    {canEdit ? <div className="space-y-2">
      <label className="jata-label" htmlFor="pos-category-photo">Choose a photo</label>
      <input id="pos-category-photo" className="pos-file-input" type="file" accept={FILE_INPUT_ACCEPT} disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} />
      {pending && !busy ? <button type="button" className="jata-btn jata-btn-secondary" onClick={() => void upload(pending)}>Retry upload</button> : null}
      {pending && !busy ? <button type="button" className="jata-btn jata-btn-ghost" onClick={resetSelection}>Discard selection</button> : null}
      {!pending && images[selected] ? <button type="button" className="jata-btn jata-btn-ghost" disabled={busy} onClick={() => void remove()}>Remove category photo</button> : null}
    </div> : null}
    {error ? <p className="jata-error" role="alert">{error}</p> : null}
    <p className="jata-hint" role="status" aria-live="polite">{message || "Choose a JPG, PNG or WebP."}</p>
  </section>;
}
