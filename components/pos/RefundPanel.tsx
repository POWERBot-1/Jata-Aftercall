"use client";

import { useState } from "react";
import { formatKES } from "@/lib/format";

/**
 * Refunds, returns and voids (§54, §36).
 *
 * Money goes back as its own record and stock comes back as its own movement. The original sale
 * is never edited, which is why this panel asks *what* is coming back rather than offering a
 * delete button.
 */

type RefundItem = { id: string; name: string; quantity: number; unitKey: string; totalKES: number; productId: string | null };

export function RefundPanel({
  businessId,
  basePath,
  saleId,
  receiptNumber,
  refundableKES,
  refundedKES,
  status,
  canRefund,
  canVoid,
  refundsEnabled,
  items,
  stockTracked,
}: {
  businessId: string;
  basePath: string;
  saleId: string;
  receiptNumber: string;
  refundableKES: number;
  refundedKES: number;
  status: string;
  canRefund: boolean;
  canVoid: boolean;
  refundsEnabled: boolean;
  items: RefundItem[];
  stockTracked: boolean;
}) {
  const [amountKES, setAmountKES] = useState(refundableKES);
  const [returns, setReturns] = useState<Record<string, number>>({});
  const [method, setMethod] = useState("cash");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const returnedValue = items.reduce((total, item) => {
    const count = returns[item.id] ?? 0;
    if (!count) return total;
    const unit = item.quantity ? item.totalKES / item.quantity : 0;
    return total + Math.round(unit * count);
  }, 0);

  async function submit(voiding: boolean) {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/sales/${encodeURIComponent(saleId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          void: voiding,
          amountKES: voiding ? undefined : amountKES,
          method,
          reference: reference || null,
          reason: reason || (voiding ? "Voided" : null),
          items: Object.entries(returns)
            .filter(([, quantity]) => Number(quantity) > 0)
            .map(([saleItemId, quantity]) => ({ saleItemId, quantity: Number(quantity) })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "We couldn't record that.");
        setBusy(false);
        return;
      }
      setDone(
        voiding
          ? "Sale voided. Stock is back and any money taken has been returned."
          : `Refunded ${formatKES(data?.refundedKES ?? 0)}${data?.returnedToStock ? ` · ${data.returnedToStock} item(s) back in stock` : ""}.`,
      );
      setBusy(false);
      window.location.reload();
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
      setBusy(false);
    }
  }

  if (status === "VOIDED") {
    return (
      <section className="jata-card p-4">
        <p className="jata-kicker">Closed</p>
        <p className="text-sm">This {receiptNumber} was voided. Nothing more can be changed on it.</p>
      </section>
    );
  }

  return (
    <section className="jata-card p-4 space-y-3">
      <div>
        <p className="jata-kicker">Put something right</p>
        <h3 className="text-base font-semibold">Refund or return</h3>
        <p className="pos-note">
          {refundedKES > 0 ? `${formatKES(refundedKES)} already refunded. ` : ""}
          {refundableKES > 0 ? `${formatKES(refundableKES)} left to refund.` : "Nothing left to refund on this sale."}
        </p>
      </div>

      {done ? <p className="pos-note" role="status">{done}</p> : null}
      {error ? <p className="jata-error" role="alert">{error}</p> : null}

      {stockTracked && items.some((item) => item.productId) ? (
        <div>
          <p className="jata-label">What is coming back into stock?</p>
          <div className="pos-rows mt-2">
            {items.filter((item) => item.productId).map((item) => (
              <div className="pos-row" key={item.id}>
                <div className="pos-row-main">
                  <strong>{item.name}</strong>
                  <small>Sold {item.quantity} {item.unitKey}</small>
                </div>
                <div className="pos-qty">
                  <button
                    type="button"
                    aria-label={`One less ${item.name}`}
                    onClick={() => setReturns((current) => ({ ...current, [item.id]: Math.max(0, (current[item.id] ?? 0) - 1) }))}
                  >−</button>
                  <span>{returns[item.id] ?? 0}</span>
                  <button
                    type="button"
                    aria-label={`One more ${item.name}`}
                    onClick={() => setReturns((current) => ({ ...current, [item.id]: Math.min(item.quantity, (current[item.id] ?? 0) + 1) }))}
                  >+</button>
                </div>
              </div>
            ))}
          </div>
          {returnedValue > 0 ? <p className="pos-note mt-2">Returning these is worth {formatKES(returnedValue)}.</p> : null}
        </div>
      ) : null}

      {refundsEnabled && canRefund ? (
        <>
          <div className="pos-grid-2">
            <div className="jata-field">
              <label className="jata-label" htmlFor="refund-amount">Money back (KES)</label>
              <input
                id="refund-amount"
                className="jata-input"
                type="number"
                min={0}
                max={refundableKES}
                value={amountKES || ""}
                onChange={(event) => setAmountKES(Math.max(0, Math.min(refundableKES, Number(event.target.value))))}
              />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="refund-method">How are you returning it?</label>
              <select id="refund-method" className="jata-input" value={method} onChange={(event) => setMethod(event.target.value)}>
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
                <option value="bank">Bank transfer</option>
                <option value="card">Card</option>
              </select>
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="refund-reference">Reference (optional)</label>
              <input id="refund-reference" className="jata-input" type="text" value={reference} onChange={(event) => setReference(event.target.value)} />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="refund-reason">Why?</label>
              <input
                id="refund-reason"
                className="jata-input"
                type="text"
                placeholder="Damaged, wrong item, changed their mind"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            </div>
          </div>

          <div className="pos-form-actions">
            <button
              type="button"
              className="jata-btn jata-btn-secondary"
              onClick={() => submit(false)}
              disabled={busy || (amountKES <= 0 && returnedValue <= 0)}
            >
              {busy ? "Working…" : "Record refund"}
            </button>
            {canVoid ? (
              <button type="button" className="jata-btn jata-btn-ghost" onClick={() => submit(true)} disabled={busy}>
                Void the whole sale
              </button>
            ) : null}
          </div>
        </>
      ) : canVoid ? (
        <div className="pos-form-actions">
          <button type="button" className="jata-btn jata-btn-ghost" onClick={() => submit(true)} disabled={busy}>
            {busy ? "Working…" : "Void the whole sale"}
          </button>
          <p className="pos-note">Refunds are switched off for this business, so a mistake is corrected by voiding.</p>
        </div>
      ) : (
        <p className="pos-note">You don&apos;t have permission to refund or void. Ask a manager.</p>
      )}

      <p className="pos-note">
        <a className="jata-btn jata-btn-ghost" href={basePath}>Back to dashboard</a>
      </p>
    </section>
  );
}
