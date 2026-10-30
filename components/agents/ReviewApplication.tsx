"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ReviewApplication({ id, action }: { id: string; action: "approve" | "suspend" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !window.confirm(action === "approve" ? "Confirm manual eligibility review and activate this agent? This does not enable commissions." : "Suspend this agent? This does not suspend their account.")) return;
    const reason = new FormData(event.currentTarget).get("reason");
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/admin/agents/applications/${encodeURIComponent(id)}/decision`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, reason }) });
      const data = await response.json();
      if (!response.ok) setError(data.error || "Decision could not be saved."); else router.refresh();
    } catch { setError("Connection interrupted. Refresh to check the application status."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit}>
    <label htmlFor={`${action}-reason-${id}`}>{action === "approve" ? "Eligibility review" : "Reason for suspension"}</label>{" "}
    <select id={`${action}-reason-${id}`} name="reason" required defaultValue="">
      <option value="" disabled>Select reason</option>
      {action === "approve" ? <option value="MANUAL_ELIGIBILITY_REVIEW">Manual eligibility review completed</option> : <><option value="COMPLIANCE_REVIEW">Compliance review</option><option value="APPLICANT_REQUEST">Applicant request</option></>}
    </select>{" "}
    <button type="submit" disabled={busy} className="jata-btn jata-btn-secondary jata-btn-sm">{busy ? "Saving…" : action === "approve" ? "Approve and activate" : "Suspend agent"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
