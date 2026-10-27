"use client";

import { useState } from "react";

/** Signed-in team member submits the code an administrator delivered out of band. */
export function TeamAccessVerificationForm() {
  const [code, setCode] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setStatus("");
    try {
      const response = await fetch("/api/account/team-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: code.trim() }),
      });
      const data = await response.json();
      setStatus(response.ok ? `${data.label} is now active on this account. Reload the dashboard to see it.` : (data.error || "Verification failed."));
      if (response.ok) setCode("");
    } catch {
      setStatus("We could not reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-[14rem] flex-col gap-1 text-sm font-semibold">
        Six-digit verification code
        <input
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
          className="jata-input min-h-11 rounded-xl border px-3 tracking-widest"
          aria-describedby="team-code-help"
        />
      </label>
      <button type="submit" disabled={busy || code.length !== 6} className="jata-btn jata-btn-primary min-h-11">Verify</button>
      <p id="team-code-help" className="ws-small ws-muted">Your account&apos;s phone must already be confirmed by an administrator. Entering a code does not change your phone number.</p>
      <p role="status" aria-live="polite" className="ws-small w-full">{status}</p>
    </form>
  );
}
