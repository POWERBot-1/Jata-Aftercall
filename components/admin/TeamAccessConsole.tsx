"use client";

/** Minimal admin console for the verified team entitlement. No allowlist is embedded here. */

import { useState } from "react";
import { formatDateTime } from "@/lib/dateFormat";

type Lookup = { userId: string; email: string; maskedPhone: string | null; entitled: boolean; label: string | null };

export function TeamAccessConsole() {
  const [email, setEmail] = useState("");
  const [account, setAccount] = useState<Lookup | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  async function call(action: "lookup" | "start-verification" | "revoke") {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/team-access", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, email, userId: account?.userId }),
      });
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error || "That request could not be completed.");
        return;
      }
      if (action === "lookup") {
        setAccount(data as Lookup);
        setCode(null);
        setMessage(data.entitled ? "This account currently has JATA Team — Free Access." : "No active team entitlement on this account.");
      } else if (action === "start-verification") {
        setCode(data.code);
        setMessage(`Verification code generated. Deliver it to the team member out of band before ${formatDateTime(data.expiresAt)}. It is shown here only once.`);
      } else {
        setCode(null);
        setMessage("Team access revoked. Normal subscription rules now apply; billing history is unchanged.");
        setAccount((current) => (current ? { ...current, entitled: false, label: null } : current));
      }
    } catch {
      setMessage("The request failed. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ws-stack">
      <section className="ws-panel" aria-labelledby="team-lookup-title">
        <h2 id="team-lookup-title" className="ws-panel__title">Find an account</h2>
        <p className="ws-muted ws-small">Only a signed-in platform administrator can use this console. The authorised number list is never displayed or sent to the browser.</p>
        <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void call("lookup"); }}>
          <label className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm font-semibold">
            Account email
            <input
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammember@example.com"
              className="jata-input min-h-11 rounded-xl border px-3"
            />
          </label>
          <button type="submit" disabled={busy} className="jata-btn jata-btn-primary min-h-11">Look up</button>
        </form>
      </section>

      {account ? (
        <section className="ws-panel" aria-labelledby="team-account-title">
          <h2 id="team-account-title" className="ws-panel__title">Verification and revocation</h2>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div><dt className="ws-muted">Account</dt><dd className="font-semibold">{account.email}</dd></div>
            <div><dt className="ws-muted">Phone</dt><dd className="font-semibold">{account.maskedPhone || "Not set"}</dd></div>
            <div><dt className="ws-muted">Status</dt><dd className="font-semibold">{account.label || "Standard customer"}</dd></div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" disabled={busy} className="jata-btn jata-btn-primary min-h-11" onClick={() => void call("start-verification")}>
              Start phone verification
            </button>
            <button type="button" disabled={busy || !account.entitled} className="jata-btn jata-btn-secondary min-h-11" onClick={() => void call("revoke")}>
              Revoke team access
            </button>
          </div>
          {code ? (
            <p className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm">
              One-time code for out-of-band delivery: <strong className="text-lg tracking-widest">{code}</strong>
            </p>
          ) : null}
        </section>
      ) : null}

      <p role="status" aria-live="polite" className="ws-small">{message}</p>
    </div>
  );
}
