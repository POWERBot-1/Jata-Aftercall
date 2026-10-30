"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Status = "loading" | "new" | "submitted" | "rejected" | "signed-out" | "error";

export default function ApplicationForm({ referralCode = "" }: { referralCode?: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [privacy, setPrivacy] = useState(false);
  const [referralConsent, setReferralConsent] = useState(false);

  async function loadStatus() {
    try {
      const response = await fetch("/api/agents/application", { cache: "no-store" });
      if (response.status === 401) { setStatus("signed-out"); return; }
      if (!response.ok) { setStatus("error"); return; }
      const data = await response.json();
      setStatus(data.applied ? (data.status === "REJECTED" ? "rejected" : "submitted") : "new");
    } catch { setStatus("error"); }
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/agents/application", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (response.status === 401) { setStatus("signed-out"); return; }
        if (!response.ok) { setStatus("error"); return; }
        const data = await response.json();
        setStatus(data.applied ? (data.status === "REJECTED" ? "rejected" : "submitted") : "new");
      })
      .catch(() => { if (!controller.signal.aborted) setStatus("error"); });
    return () => controller.abort();
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/agents/application", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fullName, phone, privacyAccepted: privacy, referralCode, referralConsent }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 401) setStatus("signed-out");
        else setMessage(data.error || "Unable to submit. Please try again.");
      } else setStatus(data.status === "REJECTED" ? "rejected" : "submitted");
    } catch { setMessage("Connection interrupted. Please try again; repeat submissions will not create another application."); }
    finally { setBusy(false); }
  }

  if (status === "loading") return <p role="status">Checking your application…</p>;
  if (status === "signed-out") return <div className="mk-prose"><p>Sign in with an existing JATA AFTERCALL account to apply. A separate agent-only registration path may be available when enabled. If you arrived via a referral, reopen that link after signing in to decide whether to share attribution.</p><Link href="/login?next=agents">Sign in</Link>{" · "}<Link href="/agents/register">Agent-only registration</Link></div>;
  if (status === "error") return <div role="alert"><p>We could not check your application. Please try again.</p><button type="button" className="mk-btn" onClick={() => { setStatus("loading"); void loadStatus(); }}>Try again</button></div>;
  if (status === "rejected") return <div role="status" className="mk-prose"><h2>Application rejected</h2><p>This application was rejected and has not activated an agent account. No referral or commission entitlement has been created.</p><Link href="/contact">Support options</Link></div>;
  if (status === "submitted") return <div role="status" className="mk-prose"><h2>Application received</h2><p>Your phone is not verified and you are not an active agent. Self-service phone verification, agent terms and referral tools are not yet available. Submitting this application does not guarantee activation or commission.</p><Link href="/agents/dashboard">View application status</Link></div>;
  return (
    <form onSubmit={submit} className="mk-prose">
      <p>Applications can be recorded, but activation and phone verification are not yet available. Do not submit if you do not want your details stored while these features are being developed.</p>
      <p><label htmlFor="agent-name">Full name</label><br /><input id="agent-name" name="fullName" autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={2} maxLength={80} /></p>
      <p><label htmlFor="agent-phone">Kenyan mobile number</label><br /><input id="agent-phone" name="phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={30} /></p>
      <p><label><input type="checkbox" checked={privacy} onChange={(e) => setPrivacy(e.target.checked)} required /> I have read the <Link href="/privacy">privacy notice</Link> and understand my application details will be stored.</label></p>
      {referralCode && <p><label><input type="checkbox" checked={referralConsent} onChange={(event) => setReferralConsent(event.target.checked)} /> I agree to record that this application came from the referring agent. This is optional and does not guarantee a reward.</label></p>}
      {message && <p role="alert">{message}</p>}
      <button className="mk-btn" type="submit" disabled={busy}>{busy ? "Submitting…" : "Submit application"}</button>
    </form>
  );
}
