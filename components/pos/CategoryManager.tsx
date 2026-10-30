"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Category = { id: string; name: string; isActive: boolean; _count: { products: number }; image: { imageUrl: string } | null };

/** Categories persist independently of the items assigned to them. */
export function CategoryManager({ businessId, initialCategories, canEdit }: { businessId: string; initialCategories: Category[]; canEdit: boolean }) {
  const router = useRouter();
  const [categories, setCategories] = useState(initialCategories);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const url = `/api/pos/${encodeURIComponent(businessId)}/categories`;
  async function change(action: string, id?: string, categoryName?: string) {
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, id, name: categoryName }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not change the category.");
      const refreshed = await fetch(url); const list = await refreshed.json();
      if (!refreshed.ok) throw new Error(list.error ?? "Category saved, but the list could not be reloaded. Refresh the page.");
      setCategories(list.categories); setName(""); setEditing(null); setMessage("Category saved."); router.refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Could not change the category."); }
    finally { setBusy(false); }
  }
  return <section className="jata-card p-5 space-y-3" aria-labelledby="pos-categories-heading">
    <h2 id="pos-categories-heading" className="text-lg font-bold">Categories</h2>
    <p className="jata-hint">Categories can exist without items. Renaming keeps item and photo associations. Inactive categories stay on existing items but cannot be newly assigned.</p>
    {canEdit ? <form className="pos-toolbar" onSubmit={(event) => { event.preventDefault(); void change("create", undefined, name); }}>
      <label className="jata-label" htmlFor="pos-category-name">New category</label>
      <input id="pos-category-name" className="jata-input" maxLength={80} value={name} onChange={(event) => setName(event.target.value)} />
      <button className="jata-btn jata-btn-secondary" type="submit" disabled={busy || !name.trim()}>Add category</button>
    </form> : null}
    {!categories.length ? <p className="jata-hint">No categories yet.</p> : <ul className="space-y-3">{categories.map((category) => <li key={category.id} className="space-y-2">
      <strong>{category.name}</strong> <span className="pos-pill">{category.isActive ? "Active" : "Inactive"}</span>
      <p className="jata-hint">{category._count.products} items, including archived items{category.image ? " · photo attached" : ""}</p>
      {canEdit ? <div className="pos-toolbar">
        {editing === category.id ? <form onSubmit={(event) => { event.preventDefault(); void change("rename", category.id, editName); }}>
          <label className="jata-label" htmlFor={`category-edit-${category.id}`}>Category name</label>
          <input id={`category-edit-${category.id}`} className="jata-input" maxLength={80} value={editName} onChange={(event) => setEditName(event.target.value)} />
          <button type="submit" className="jata-btn jata-btn-secondary" disabled={busy || !editName.trim()}>Save category</button>
          <button type="button" className="jata-btn jata-btn-ghost" disabled={busy} onClick={() => setEditing(null)}>Cancel</button>
        </form> : <button type="button" className="jata-btn jata-btn-secondary" disabled={busy} onClick={() => { setEditing(category.id); setEditName(category.name); }}>Edit {category.name}</button>}
        <button type="button" className="jata-btn jata-btn-secondary" disabled={busy} onClick={() => void change(category.isActive ? "deactivate" : "restore", category.id)}>{category.isActive ? "Deactivate" : "Restore"} {category.name}</button>
        <button type="button" className="jata-btn jata-btn-ghost" disabled={busy} onClick={() => void change("delete", category.id)}>Delete {category.name}</button>
      </div> : null}
    </li>)}</ul>}
    {error ? <p role="alert" className="jata-error">{error}</p> : null}
    <p role="status" className="jata-hint">{message}</p>
    <p className="jata-hint">To delete a category, first move all its items, including archived items, and remove its photo. Library images and sale history are not deleted.</p>
  </section>;
}
