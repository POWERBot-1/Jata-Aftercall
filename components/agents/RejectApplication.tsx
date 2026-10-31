"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function RejectApplication({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !window.confirm("Reject this application? This does not suspend an account and cannot be undone here.")) return;
    const reason = new FormData(event.currentTarget).get("reason");
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/agents/applications/${encodeURIComponent(id)}/reject`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ reason }) });
      const data = await response.json();
      if (!response.ok) setError(data.error || "Decision could not be saved.");
      else router.refresh();
    } catch { setError("Connection interrupted. Refresh to check the application status."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit}>
    <label htmlFor={`reason-${id}`}>Reason for rejection</label>{" "}
    <select id={`reason-${id}`} name="reason" required defaultValue="">
      <option value="" disabled>Select reason</option>
      <option value="APPLICANT_REQUEST">Applicant requested withdrawal</option>
      <option value="DUPLICATE_APPLICATION">Duplicate application</option>
    </select>{" "}
    <button type="submit" disabled={busy} className="jata-btn jata-btn-secondary jata-btn-sm">{busy ? "Saving…" : "Reject application"}</button>
    {error && <p role="alert">{error}</p>}
  </form>;
}
