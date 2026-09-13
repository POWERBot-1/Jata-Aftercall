"use client";
import { useState } from "react";

export default function AdminBusinessActions({ businessId, isPublished, status }: { businessId: string; isPublished: boolean; status: string }) {
  const [msg, setMsg] = useState("");
  async function patch(data: Record<string, unknown>) {
    const res = await fetch("/api/admin/business", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ businessId, ...data }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(j.error || "Failed");
    else {
      setMsg("Updated ✓");
      setTimeout(() => location.reload(), 500);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <button onClick={() => patch({ isPublished: !isPublished })} className="rounded-full border px-3 py-1 text-xs font-semibold">{isPublished ? "Unpublish" : "Publish"}</button>
      <button onClick={() => patch({ status: status === "SUSPENDED" ? "ACTIVE" : "SUSPENDED" })} className="rounded-full border px-3 py-1 text-xs font-semibold">{status === "SUSPENDED" ? "Reactivate" : "Suspend"}</button>
      {msg && <span className="text-xs text-zinc-600">{msg}</span>}
    </div>
  );
}
