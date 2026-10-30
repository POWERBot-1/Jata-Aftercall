"use client";

import { useState } from "react";
import Link from "next/link";

export default function AgentRegistrationForm() {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/agents/register", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName: form.get("fullName"), email: form.get("email"), phone: form.get("phone"), password: form.get("password"), privacyAccepted: form.get("privacy") === "on", termsAccepted: form.get("terms") === "on" }),
      });
      const data = await response.json();
      if (!response.ok) setError(data.error || "We could not submit your request. Please try again.");
      else setDone(true);
    } catch { setError("Connection interrupted. Please try again; an existing account will not be overwritten."); }
    finally { setBusy(false); }
  }

  if (done) return <div className="mk-prose" role="status">
    <h2>Request processed</h2>
    <p>If this email was not already registered, an account and application have been created. If it was already registered, the existing account was not changed. Sign in with your existing credentials, then return to the application page.</p>
    <p>Phone verification and agent activation are not available yet. No commission or referral entitlement is created.</p>
    <Link href="/login">Sign in</Link>{" · "}<Link href="/agents/apply">Application page</Link>
  </div>;
  return <form onSubmit={submit} className="mk-prose">
    <p>A business is not required. This records an application only; phone verification, activation, programme terms and referral tools are not yet available.</p>
    <p><label htmlFor="new-agent-name">Full name</label><br /><input id="new-agent-name" name="fullName" autoComplete="name" required minLength={2} maxLength={80} /></p>
    <p><label htmlFor="new-agent-email">Email</label><br /><input id="new-agent-email" name="email" type="email" autoComplete="email" required maxLength={254} /></p>
    <p><label htmlFor="new-agent-phone">Kenyan mobile number</label><br /><input id="new-agent-phone" name="phone" type="tel" autoComplete="tel" required maxLength={30} /></p>
    <p><label htmlFor="new-agent-password">Password</label><br /><input id="new-agent-password" name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={72} /><br /><small>At least 8 characters, and no more than 72 UTF-8 bytes.</small></p>
    <p><label><input name="privacy" type="checkbox" required /> I have read the <Link href="/privacy">privacy notice</Link> and understand my application details will be stored.</label></p>
    <p><label><input name="terms" type="checkbox" required /> I accept the <Link href="/terms">website terms of service</Link>. Separate agent programme terms are not yet available.</label></p>
    {error && <p role="alert">{error}</p>}
    <button className="mk-btn" type="submit" disabled={busy}>{busy ? "Submitting…" : "Create account and apply"}</button>
  </form>;
}
