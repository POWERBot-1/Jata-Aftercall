"use client";
import { useState } from "react";

type Plan = { id: string; key: string; name: string; priceKES: number; durationDays: number; isActive: boolean };

export default function PlansClient({ plans }: { plans: Plan[] }) {
  const [msg, setMsg] = useState("");
  const [editing, setEditing] = useState<Plan | null>(null);

  async function save(plan: Partial<Plan> & { id?: string }) {
    const res = await fetch("/api/admin/plans", {
      method: plan.id ? "PATCH" : "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(plan),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(data.error || "Failed");
    else {
      setMsg("Saved ✓");
      setTimeout(() => location.reload(), 500);
    }
  }

  return (
    <div className="mt-4 space-y-4">
      {msg && <p className="rounded-xl bg-amber-50 p-3 text-sm">{msg}</p>}
      <div className="grid gap-3">
        {plans.map((p) => (
          <div key={p.id} className="rounded-2xl border bg-white p-4">
            <p className="text-sm font-bold">{p.key} — {p.name}</p>
            <p className="text-xs text-zinc-500">KES {p.priceKES} • {p.durationDays} days • {p.isActive ? "Active" : "Inactive"}</p>
            <button onClick={() => setEditing(p)} className="mt-2 rounded-full border px-3 py-1 text-xs">Edit</button>
          </div>
        ))}
      </div>

      {editing && (
        <div className="rounded-2xl border bg-zinc-50 p-4">
          <p className="text-sm font-bold">Edit plan {editing.key}</p>
          <input className="mt-2 w-full rounded-xl border bg-white px-3 py-2 text-sm" value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} placeholder="Name" />
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input className="rounded-xl border bg-white px-3 py-2 text-sm" type="number" value={editing.priceKES} onChange={(e) => setEditing({ ...editing, priceKES: parseInt(e.target.value, 10) })} placeholder="Price KES" />
            <input className="rounded-xl border bg-white px-3 py-2 text-sm" type="number" value={editing.durationDays} onChange={(e) => setEditing({ ...editing, durationDays: parseInt(e.target.value, 10) })} placeholder="Duration days" />
          </div>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={editing.isActive} onChange={(e) => setEditing({ ...editing, isActive: e.target.checked })} /> Active</label>
          <div className="mt-3 flex gap-2">
            <button onClick={() => save(editing)} className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white">Save</button>
            <button onClick={() => setEditing(null)} className="rounded-full border bg-white px-5 py-2 text-sm">Cancel</button>
          </div>
        </div>
      )}

      <CreatePlan onSave={save} />
    </div>
  );
}

function CreatePlan({ onSave }: { onSave: (p: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ key: "", name: "", priceKES: 999, durationDays: 365 });
  return (
    <div className="rounded-2xl border bg-white p-4">
      <p className="text-sm font-bold">Create plan</p>
      <input className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" placeholder="Key e.g. PROMO" value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value.toUpperCase() })} />
      <input className="mt-2 w-full rounded-xl border px-3 py-2 text-sm" placeholder="Name e.g. Promo — KES 499/year" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      <div className="mt-2 grid grid-cols-2 gap-2">
        <input className="rounded-xl border px-3 py-2 text-sm" type="number" value={form.priceKES} onChange={(e) => setForm({ ...form, priceKES: parseInt(e.target.value, 10) })} />
        <input className="rounded-xl border px-3 py-2 text-sm" type="number" value={form.durationDays} onChange={(e) => setForm({ ...form, durationDays: parseInt(e.target.value, 10) })} />
      </div>
      <button onClick={() => onSave(form)} className="mt-2 rounded-full bg-zinc-900 px-5 py-2 text-sm font-semibold text-white">Create</button>
    </div>
  );
}
