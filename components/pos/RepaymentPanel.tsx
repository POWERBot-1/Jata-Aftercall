"use client";

import { useState } from "react";
import { formatKES } from "@/lib/format";

/**
 * Collecting what a customer owes (§30, §31). The balance shown is the server's, and the payment
 * is validated against it — a browser cannot declare a smaller balance to pay off (§56).
 */
export function RepaymentPanel({
  businessId,
  basePath,
  customerId,
  customerName,
  balanceKES,
  entitled,
  words,
}: {
  businessId: string;
  basePath: string;
  customerId: string;
  customerName: string;
  balanceKES: number;
  entitled: boolean;
  words: { customer: string };
}) {
  const [amountKES, setAmountKES] = useState(balanceKES);
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/customers/${encodeURIComponent(customerId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountKES, method, reference: reference || null }),
      });
      const data = await response.json();
      if (!response.ok) setError(data?.error ?? "We couldn't record that payment.");
      else window.location.reload();
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  if (balanceKES <= 0) {
    return (
      <section className="jata-card p-4">
        <p className="jata-kicker">Credit</p>
        <p className="text-sm">{customerName} owes nothing right now.</p>
      </section>
    );
  }

  return (
    <section className="jata-card p-4 space-y-3">
      <div>
        <p className="jata-kicker">Collect a payment</p>
        <h3 className="text-base font-semibold">{formatKES(balanceKES)} owed by {customerName}</h3>
      </div>

      {error ? <p className="jata-error" role="alert">{error}</p> : null}

      <div className="pos-grid-2">
        <div className="jata-field">
          <label className="jata-label" htmlFor="repay-amount">Amount (KES)</label>
          <input
            id="repay-amount"
            className="jata-input"
            type="number"
            min={1}
            max={balanceKES}
            value={amountKES || ""}
            onChange={(event) => setAmountKES(Math.max(0, Math.min(balanceKES, Number(event.target.value))))}
          />
        </div>
        <div className="jata-field">
          <label className="jata-label" htmlFor="repay-method">How did they pay?</label>
          <select id="repay-method" className="jata-input" value={method} onChange={(event) => setMethod(event.target.value)}>
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa</option>
            <option value="bank">Bank transfer</option>
            <option value="card">Card</option>
          </select>
        </div>
        <div className="jata-field">
          <label className="jata-label" htmlFor="repay-reference">Reference (optional)</label>
          <input id="repay-reference" className="jata-input" type="text" value={reference} onChange={(event) => setReference(event.target.value)} />
        </div>
      </div>

      <div className="pos-form-actions">
        <button type="button" className="jata-btn jata-btn-primary" onClick={submit} disabled={busy || amountKES <= 0 || !entitled}>
          {busy ? "Saving…" : `Record ${formatKES(amountKES)}`}
        </button>
        {!entitled ? <span className="pos-note">Renew the plan to collect payments.</span> : null}
        <a className="jata-btn jata-btn-ghost" href={basePath}>Dashboard</a>
      </div>
      <p className="pos-note">Repaying more than the balance is refused — overpayment is a separate conversation, not a silent credit.</p>
    </section>
  );
}
