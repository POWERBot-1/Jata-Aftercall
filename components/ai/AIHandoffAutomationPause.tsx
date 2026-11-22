"use client";

import { useState } from "react";

export default function AIHandoffAutomationPause({ businessId, enabled }: { businessId: string; enabled: boolean }) {
  const [status, setStatus] = useState(enabled ? "Event processing is enabled for this business." : "Processing is paused by default.");
  const [busy, setBusy] = useState(false);
  async function pause() {
    setBusy(true);
    try {
      const response = await fetch("/api/ai/followup-events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not pause processing.");
      setStatus("Event processing is paused. Existing tasks and queued events were preserved.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not pause processing.");
    } finally {
      setBusy(false);
    }
  }
  return <div><p role="status">{status}</p><button type="button" onClick={pause} disabled={busy}>{busy ? "Pausing…" : "Pause event processing"}</button></div>;
}
