"use client";
import { useEffect, useState } from "react";
import { Field, FormError } from "@/components/ui/Field";
import { Button } from "@/components/ui/Button";

export default function ResetPasswordForm() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // The token is carried in the fragment, so it is not sent to the web server in the page URL.
    // Defer capture until the next frame so React Strict Mode's setup/cleanup/setup cycle cannot
    // clear the fragment before the surviving effect pass reads it.
    const value = new URLSearchParams(window.location.hash.slice(1)).get("token") || "";
    if (!value) return;
    const frame = window.requestAnimationFrame(() => {
      setToken(value);
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (password !== confirmation) {
      setError("Those passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const response = await fetch("/api/auth/password-reset/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn't update your password. Request a new link and try again.");
        return;
      }
      setComplete(true);
      setPassword("");
      setConfirmation("");
    } catch {
      setError("We couldn't update your password. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  if (complete) {
    return (
      <div className="jata-card mt-6 space-y-3 p-5" role="status" aria-live="polite">
        <p className="font-medium text-zinc-900">Password updated</p>
        <p className="text-sm text-zinc-600">Your other sessions have been signed out. Sign in with your new password.</p>
        <a href="/login" className="inline-flex font-semibold underline">Continue to sign in</a>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="jata-card mt-6 space-y-3 p-5" role="status" aria-live="polite">
        <p className="text-sm text-zinc-700">This reset link is missing or has already been cleared from this page.</p>
        <a href="/forgot-password" className="inline-flex font-semibold underline">Request a new link</a>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="jata-card mt-6 space-y-3 p-5">
      <Field id="new-password" label="New password" hint="At least 8 characters; maximum 72 UTF-8 bytes.">
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
        />
      </Field>
      <Field id="confirm-password" label="Confirm password">
        <input
          type="password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          required
          minLength={8}
          maxLength={72}
          autoComplete="new-password"
        />
      </Field>
      <FormError>{error}</FormError>
      <Button type="submit" disabled={loading} className="w-full">
        {loading ? "Updating…" : "Update password"}
      </Button>
    </form>
  );
}
