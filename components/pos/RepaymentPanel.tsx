"use client";

import { useEffect, useRef, useState } from "react";

type PendingRepayment = { key: string; amountKES: number; method: string; reference: string };
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
  const [pending, setPending] = useState<PendingRepayment | null>(null);
  const [ready, setReady] = useState(false);
  const submitting = useRef(false);
  const storageKey = `pos-repayment:${businessId}:${customerId}`;

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) {
        const saved = JSON.parse(raw) as PendingRepayment;
        if (!saved.key || !Number.isFinite(saved.amountKES) || typeof saved.method !== "string" || typeof saved.reference !== "string") throw new Error("Invalid pending repayment");
        setPending(saved);
        setAmountKES(saved.amountKES);
        setMethod(saved.method);
        setReference(saved.reference);
      }
      setReady(true);
    } catch {
      setError("Pending repayment state is unavailable. Check the account before recording another payment.");
    }
  }, [storageKey]);

  async function submit() {
    if (submitting.current || !ready) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      const request = pending ?? { key: crypto.randomUUID(), amountKES, method, reference };
      // Persist before sending: an interrupted request must be retried with the same key and body.
      sessionStorage.setItem(storageKey, JSON.stringify(request));
      setPending(request);
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/customers/${encodeURIComponent(customerId)}`, {
        method: "POST",
        headers: { "content-type": "application/json", "Idempotency-Key": request.key },
        body: JSON.stringify({ amountKES: request.amountKES, method: request.method, reference: request.reference || null }),
      });
      const data = await response.json();
      if (!response.ok) {
        // The domain checks for an existing key before it rejects a balance validation; this
        // specific refusal therefore proves that this key did not commit a repayment.
        if (data?.code === "REPAYMENT_INVALID") {
          sessionStorage.removeItem(storageKey);
          setPending(null);
        }
        setError(data?.error ?? "Unable to confirm this payment. Retry the same request.");
      } else {
        sessionStorage.removeItem(storageKey);
        window.location.reload();
      }
    } catch {
      setError("Unable to confirm this payment. Retry the same request before recording another.");
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  if (ready && !pending && balanceKES <= 0) {
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
      {pending ? <p className="pos-note">A previous request needs confirmation. Retry this same payment before recording a different one.</p> : null}

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
            disabled={!!pending || !ready}
            onChange={(event) => setAmountKES(Math.max(0, Math.min(balanceKES, Number(event.target.value))))}
          />
        </div>
        <div className="jata-field">
          <label className="jata-label" htmlFor="repay-method">How did they pay?</label>
          <select id="repay-method" className="jata-input" value={method} disabled={!!pending || !ready} onChange={(event) => setMethod(event.target.value)}>
            <option value="cash">Cash</option>
            <option value="mpesa">M-Pesa</option>
            <option value="bank">Bank transfer</option>
            <option value="card">Card</option>
          </select>
        </div>
        <div className="jata-field">
          <label className="jata-label" htmlFor="repay-reference">Reference (optional)</label>
          <input id="repay-reference" className="jata-input" type="text" value={reference} disabled={!!pending || !ready} onChange={(event) => setReference(event.target.value)} />
        </div>
      </div>

      <div className="pos-form-actions">
        <button type="button" className="jata-btn jata-btn-primary" onClick={submit} disabled={busy || !ready || amountKES <= 0 || !entitled}>
          {busy ? "Saving…" : pending ? `Retry ${formatKES(amountKES)}` : `Record ${formatKES(amountKES)}`}
        </button>
        {!entitled ? <span className="pos-note">Renew the plan to collect payments.</span> : null}
        <a className="jata-btn jata-btn-ghost" href={basePath}>Dashboard</a>
      </div>
      <p className="pos-note">Repaying more than the balance is refused — overpayment is a separate conversation, not a silent credit.</p>
    </section>
  );
}
