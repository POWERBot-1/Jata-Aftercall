"use client";
import { useState } from "react";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/password-reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't process the request. Please try again later.");
        return;
      }
      setSent(true);
    } catch {
      setError("We couldn't process the request. Please try again later.");
    } finally {
      setLoading(false);
    }
  }

  if (sent) {
    return (
      <div className="jata-card mt-6 space-y-3 p-5" role="status" aria-live="polite">
        <p className="font-medium text-zinc-900">Check your email</p>
        <p className="text-sm text-zinc-600">If an account exists for that address, we&apos;ll send a one-time reset link. It expires in 30 minutes.</p>
        <a href="/login" className="inline-flex font-semibold underline">Back to sign in</a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="jata-card mt-6 space-y-3 p-5">
      <Field id="recovery-email" label="Email" hint="Enter the email address on your account.">
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          maxLength={254}
          autoComplete="email"
          inputMode="email"
        />
      </Field>
      <FormError>{error}</FormError>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Sending…" : "Send reset link"}
      </Button>
    </form>
  );
}
