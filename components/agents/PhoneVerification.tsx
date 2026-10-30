"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** A verified phone is not eligibility, activation or commission entitlement. */
export default function PhoneVerification() {
  const [message, setMessage] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  async function submit(path: "request" | "confirm") {
    if (busy) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/agents/verification/${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(path === "confirm" ? { code } : {}) });
      const data = await response.json();
      if (!response.ok) setMessage(data.error || "Verification is unavailable.");
      else if (data.status === "VERIFIED") { setMessage("Phone verified. Your agent account is not active."); router.refresh(); }
      else setMessage("A code was requested. If it arrives, enter it below.");
    } catch { setMessage("Verification is temporarily unavailable."); }
    finally { setBusy(false); }
  }
  return <div>
    <p>Phone verification requires an approved provider. Verification alone does not activate an agent account.</p>
    <button className="mk-btn" type="button" disabled={busy} onClick={() => void submit("request")}>Request verification code</button>
    <form onSubmit={(event) => { event.preventDefault(); void submit("confirm"); }}>
      <label htmlFor="agent-verification-code">Six-digit code</label>{" "}
      <input id="agent-verification-code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value)} required />{" "}
      <button className="mk-btn" type="submit" disabled={busy}>Verify phone</button>
    </form>
    {message && <p role="status">{message}</p>}
  </div>;
}
