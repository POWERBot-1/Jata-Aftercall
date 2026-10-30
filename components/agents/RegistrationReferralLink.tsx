"use client";
import { useState } from "react";
export default function RegistrationReferralLink() {
  const [link, setLink] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function rotate() {
    if (busy || !window.confirm("Generate a new link? Any previous registration links will stop working.")) return;
    setBusy(true); setError(""); setLink("");
    try {
      const response = await fetch("/api/agents/referrals", { method: "POST" });
      const data = await response.json();
      if (!response.ok || typeof data.path !== "string" || !/^\/agents\/register\?ref=[A-Za-z0-9_-]{43}$/.test(data.path)) setError(data.error || "Could not create a link.");
      else setLink(new URL(data.path, window.location.origin).href);
    } catch { setError("Connection interrupted. A link may have been rotated; generate another if needed."); }
    finally { setBusy(false); }
  }
  return <div><p>Registration referral evidence is optional and does not create a commission. Generating a new link revokes older links. Copy the link now; it will not be shown again after leaving this page.</p><button type="button" className="mk-btn" onClick={rotate} disabled={busy}>{busy ? "Generating…" : "Generate registration link"}</button>{link && <p><label htmlFor="registration-referral">Your link</label><br /><input id="registration-referral" readOnly value={link} onFocus={(e) => e.currentTarget.select()} /></p>}{error && <p role="alert">{error}</p>}</div>;
}
