"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Status = "loading" | "new" | "submitted" | "signed-out" | "error";

export default function ApplicationForm() {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [privacy, setPrivacy] = useState(false);

  async function loadStatus() {
    try {
      const response = await fetch("/api/agents/application", { cache: "no-store" });
      if (response.status === 401) { setStatus("signed-out"); return; }
      if (!response.ok) { setStatus("error"); return; }
      const data = await response.json();
      setStatus(data.applied ? "submitted" : "new");
    } catch { setStatus("error"); }
  }
  useEffect(() => { void loadStatus(); }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/agents/application", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone, privacyAccepted: privacy }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) setStatus("signed-out");
        else setMessage(data.error || "Unable to submit. Please try again.");
      } else setStatus("submitted");
    } catch { setMessage("Connection interrupted. Please try again; repeat submissions will not create another application."); }
    finally { setBusy(false); }
  }

  if (status === "loading") return <p role="status">Checking your application…</p>;
  if (status === "signed-out") return <div className="mk-prose"><p>Sign in with an existing JATA AFTERCALL account to apply. The existing account registration flow also creates a business; a separate agent-only account flow is not yet available.</p><Link href="/login">Sign in</Link></div>;
  if (status === "error") return <div role="alert"><p>We could not check your application. Please try again.</p><button type="button" className="mk-btn" onClick={() => { setStatus("loading"); void loadStatus(); }}>Try again</button></div>;
  if (status === "submitted") return <div role="status" className="mk-prose"><h2>Application received</h2><p>Your phone is not verified and you are not an active agent. Self-service phone verification, agent terms and referral tools are not yet available. Submitting this application does not guarantee activation or commission.</p></div>;
  return (
    <form onSubmit={submit} className="mk-prose">
      <p>Applications can be recorded, but activation and phone verification are not yet available. Do not submit if you do not want your details stored while these features are being developed.</p>
      <p><label htmlFor="agent-name">Full name</label><br /><input id="agent-name" name="fullName" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} maxLength={80} /></p>
      <p><label htmlFor="agent-phone">Kenyan mobile number</label><br /><input id="agent-phone" name="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={30} /></p>
      <p><label><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required /> I have read the <Link href="/privacy">privacy notice</Link> and understand my application details will be stored.</label></p>
      {message && <p role="alert">{message}</p>}
      <button className="mk-btn" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button>
    </form>
  );
}
