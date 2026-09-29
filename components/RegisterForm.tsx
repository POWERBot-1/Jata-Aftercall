"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function RegisterForm({ refCode = null }: { refCode?: string | null }) {
  const [form, setForm] = useState({ name: "", email: "", phone: "", password: "", businessName: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Stage 2: `ref` is a hint only. Attribution is resolved and validated server-side.
        body: JSON.stringify(refCode ? { ...form, ref: refCode } : form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "We couldn't create your account. Please try again.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setErr("We couldn't create your account. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="jata-card mt-6 space-y-3 p-5">
      <Field id="register-name" label="Your name" hint="The name on your account." error={err && !form.name ? err : undefined}>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required maxLength={80} autoComplete="name" />
      </Field>
      <Field id="register-business" label="Business name" hint="This becomes your page. You can edit it later.">
        <input value={form.businessName} onChange={(e) => setForm({ ...form, businessName: e.target.value })} maxLength={80} autoComplete="organization" />
      </Field>
      <Field id="register-email" label="Email" hint="We'll use this to sign you in." error={err && form.name ? err : undefined}>
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" />
      </Field>
      <Field id="register-phone" label="Phone" hint="A Kenyan mobile number, for example 07…">
        <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required autoComplete="tel" inputMode="tel" />
      </Field>
      <Field id="register-password" label="Password" hint="At least 8 characters.">
        <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={8} autoComplete="new-password" />
      </Field>
      <FormError>{err}</FormError>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Creating…" : "Create account"}
      </Button>
      <p className="text-center text-xs text-zinc-500">By creating an account you agree to our terms. No spam.</p>
    </form>
  );
}
