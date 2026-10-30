"use client";
import { useState } from "react";
export default function RegistrationReferralLink() {
  const [link, setLink] = useState(""); const [applicationLink, setApplicationLink] = useState(""); const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  async function rotate() {
    if (busy || !window.confirm("Generate new links? Both previous registration and existing-account links will stop working.")) return;
    setBusy(true); setError(""); setLink(""); setApplicationLink("");
    try {
      const response = await fetch("/api/agents/referrals", { method: "POST" });
      const data = await response.json();
      if (!response.ok || typeof data.path !== "string" || !/^\/agents\/register\?ref=[A-Za-z0-9_-]{43}$/.test(data.path)) setError(data.error || "Could not create a link.");
      else if (typeof data.applicationPath !== "string" || !/^\/agents\/apply\?ref=[A-Za-z0-9_-]{43}$/.test(data.applicationPath) || data.path.slice(-43) !== data.applicationPath.slice(-43)) setError("Could not create application link.");
      else { setLink(new URL(data.path, window.location.origin).href); setApplicationLink(new URL(data.applicationPath, window.location.origin).href); }
    } catch { setError("Connection interrupted. A link may have been rotated; generate another if needed."); }
    finally { setBusy(false); }
  }
  return <div><p>Application referral evidence is optional and does not create a commission. Generating new links revokes both older registration and existing-account links. Copy them now; they will not be shown again after leaving this page.</p><button type="button" className="mk-btn" onClick={rotate} disabled={busy}>{busy ? "Generating…" : "Generate referral links"}</button>{link && <p><label htmlFor="registration-referral">Link for new registrations</label><br /><input id="registration-referral" readOnly value={link} onFocus={(e) => e.currentTarget.select()} /></p>}{applicationLink && <p><label htmlFor="existing-account-referral">Link for existing account holders</label><br /><input id="existing-account-referral" readOnly value={applicationLink} onFocus={(e) => e.currentTarget.select()} /></p>}{error && <p role="alert">{error}</p>}</div>;
}
