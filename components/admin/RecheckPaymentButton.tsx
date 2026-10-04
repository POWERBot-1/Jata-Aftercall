"use client";

import { useState } from "react";

/**
 * JATA operator action: ask the provider for the current truth about one payment (§102).
 *
 * This is deliberately not a "replay" of stored provider data. The server asks the provider, and
 * only the provider's answer can move the payment — so an operator can never make money appear
 * (§41, §120). The action is audited as a JATA operator action.
 */
export function RecheckPaymentButton({ transactionId }: { transactionId: string }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function recheck() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch(`/api/admin/payments/${encodeURIComponent(transactionId)}/recheck`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setResult(data?.error ?? "The check was refused.");
      } else {
        setResult(
          data?.checked === false
            ? "Nothing could be checked with the provider."
            : `Provider says: ${String(data?.status ?? "unknown").replace(/_/g, " ").toLowerCase()}`,
        );
      }
    } catch {
      setResult("The check could not be completed.");
    }
    setBusy(false);
  }

  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="rounded border px-2 py-0.5 text-xs" onClick={recheck} disabled={busy}>
        {busy ? "Checking…" : "Check with provider"}
      </button>
      {result ? <span className="text-zinc-500">{result}</span> : null}
    </span>
  );
}
