"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function LoginForm() {
  const [form, setForm] = useState({ email: "", password: "" });
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(data.error || "We couldn't sign you in. Please try again.");
        return;
      }
      router.push("/dashboard");
      router.refresh();
    } catch {
      setErr("We couldn't sign you in. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={submit} className="jata-card mt-6 space-y-3 p-5">
      <Field id="login-email" label="Email" hint="The email you registered with." error={err || undefined}>
        <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required autoComplete="email" />
      </Field>
      <Field id="login-password" label="Password" hint="At least 8 characters.">
        <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required autoComplete="current-password" />
      </Field>
      <FormError>{err}</FormError>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
