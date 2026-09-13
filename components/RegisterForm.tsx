"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RegisterForm() {
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    const data = await res.json().catch(() => ({}));
    setLoading(false);
    if (!res.ok) {
      setErr(data.error || "Registration failed");
      return;
    }
    router.push("/dashboard");
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-3 rounded-2xl border border-zinc-200 bg-white p-5">
      <input className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm" placeholder="Full name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} />
      <input className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm" placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
      <input className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm" placeholder="Phone (07…)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required />
      <input className="w-full rounded-xl border border-zinc-200 px-3 py-2.5 text-sm" placeholder="Password (min 8)" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} />
      {err && <p className="text-sm text-red-600">{err}</p>}
      <button disabled={loading} className="w-full rounded-full bg-zinc-900 py-3 text-sm font-semibold text-white disabled:opacity-50">
        {loading ? "Creating…" : "Create account"}
      </button>
      <p className="text-center text-xs text-zinc-500">By creating you agree to our terms. No spam.</p>
    </form>
  );
}
