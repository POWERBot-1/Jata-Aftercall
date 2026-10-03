"use client";

import { useState } from "react";
import { formatKES, formatDateTime } from "@/lib/format";

/**
 * Buying in (§12, §33).
 *
 * A purchase order records what was ordered; receiving writes the stock movements. Partial
 * receiving is offered only when the configuration allows it, and supplier credit goes on the
 * payables ledger — never mixed with what customers owe (§30).
 */

export type PurchaseRow = {
  id: string;
  reference: string;
  status: string;
  supplierName: string | null;
  totalKES: number;
  paidKES: number;
  createdAt: string | Date;
  expectedAt: string | Date | null;
  items: { id: string; name: string; quantity: number; receivedQty: number; unitKey: string | null; unitCostKES: number; productId: string | null }[];
};

export function PurchasesClient({
  businessId,
  basePath,
  purchases,
  suppliers,
  products,
  purchaseOrders,
  partialReceiving,
  supplierCredit,
  word,
  canCreate,
  entitled,
}: {
  businessId: string;
  basePath: string;
  purchases: PurchaseRow[];
  suppliers: { id: string; name: string }[];
  products: { id: string; name: string; unitKey: string; costKES: number | null }[];
  purchaseOrders: boolean;
  partialReceiving: boolean;
  supplierCredit: boolean;
  word: string;
  canCreate: boolean;
  entitled: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [lines, setLines] = useState<{ productId: string; quantity: number; unitCostKES: number }[]>([]);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [unitCostKES, setUnitCostKES] = useState(0);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [receiveNow, setReceiveNow] = useState(!purchaseOrders);
  const [notes, setNotes] = useState("");

  const [receiving, setReceiving] = useState<string | null>(null);
  const [receiveQty, setReceiveQty] = useState<Record<string, number>>({});
  const [payAmountKES, setPayAmountKES] = useState(0);
  const [payMethod, setPayMethod] = useState("cash");
  const [payReference, setPayReference] = useState("");

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = products.find((product) => product.id === productId);
  const total = lines.reduce((sum, line) => sum + line.unitCostKES * line.quantity, 0);

  function addLine() {
    if (!chosen) return;
    const cost = unitCostKES || Number(chosen.costKES ?? 0);
    setLines((current) => [...current, { productId: chosen.id, quantity: Math.max(1, quantity), unitCostKES: cost }]);
    setQuantity(1);
    setUnitCostKES(0);
  }

  async function post(path: string, payload: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "We couldn't save that.");
        return false;
      }
      window.location.reload();
      return true;
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="jata-error" role="alert">{error}</p> : null}

      <div className="pos-toolbar">
        <p className="pos-note">
          {supplierCredit
            ? `What you owe a ${word.toLowerCase()} is kept separate from what your customers owe you.`
            : `You pay your ${word.toLowerCase()}s on delivery.`}
        </p>
        {canCreate ? (
          <button type="button" className="jata-btn jata-btn-primary" onClick={() => setCreating((open) => !open)}>
            {creating ? "Close" : "+ Record a purchase"}
          </button>
        ) : null}
      </div>

      {creating ? (
        <form
          className="jata-card p-4 pos-form"
          onSubmit={(event) => {
            event.preventDefault();
            void post("/purchases", {
              supplierId: supplierId || null,
              reference: reference || null,
              expectedAt: expectedAt || null,
              receiveNow,
              notes: notes || null,
              items: lines.map((line) => ({
                productId: line.productId,
                quantity: line.quantity,
                unitCostKES: line.unitCostKES,
              })),
            });
          }}
        >
          <p className="jata-kicker">Buying in</p>

          <div className="pos-grid-2">
            <div className="jata-field">
              <label className="jata-label" htmlFor="po-product">Item</label>
              <select id="po-product" className="jata-input" value={productId} onChange={(event) => setProductId(event.target.value)}>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}</option>)}
              </select>
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="po-quantity">How much?</label>
              <input id="po-quantity" className="jata-input" type="number" min={1} step="any" value={quantity || ""} onChange={(event) => setQuantity(Number(event.target.value))} />
              <p className="jata-hint">In {chosen?.unitKey ?? "units"}.</p>
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="po-cost">What does one cost? (KES)</label>
              <input id="po-cost" className="jata-input" type="number" min={0} value={unitCostKES || ""} placeholder={String(chosen?.costKES ?? 0)} onChange={(event) => setUnitCostKES(Number(event.target.value))} />
            </div>
            <div className="jata-field">
              <span className="jata-label">&nbsp;</span>
              <button type="button" className="jata-btn jata-btn-secondary" onClick={addLine}>+ Add line</button>
            </div>
          </div>

          {lines.length ? (
            <div className="pos-rows">
              {lines.map((line, index) => {
                const product = products.find((entry) => entry.id === line.productId);
                return (
                  <div className="pos-row" key={`${line.productId}-${index}`}>
                    <div className="pos-row-main">
                      <strong>{product?.name ?? "Item"}</strong>
                      <small>{line.quantity} × {formatKES(line.unitCostKES)}</small>
                    </div>
                    <div className="pos-row-values">
                      <span>{formatKES(line.unitCostKES * line.quantity)}</span>
                      <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>Remove</button>
                    </div>
                  </div>
                );
              })}
              <p className="pos-note">Total {formatKES(total)}</p>
            </div>
          ) : null}

          <div className="pos-grid-2">
            {suppliers.length ? (
              <div className="jata-field">
                <label className="jata-label" htmlFor="po-supplier">{word}</label>
                <select id="po-supplier" className="jata-input" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
                  <option value="">No {word.toLowerCase()} on record</option>
                  {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
                </select>
              </div>
            ) : null}
            <div className="jata-field">
              <label className="jata-label" htmlFor="po-reference">Your reference</label>
              <input id="po-reference" className="jata-input" type="text" value={reference} onChange={(event) => setReference(event.target.value)} placeholder="Auto if left blank" />
            </div>
            {purchaseOrders ? (
              <>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="po-expected">When should it arrive?</label>
                  <input id="po-expected" className="jata-input" type="date" value={expectedAt} onChange={(event) => setExpectedAt(event.target.value)} />
                </div>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="po-now">Has it arrived already?</label>
                  <label className="pos-chip" data-on={receiveNow}>
                    <input id="po-now" type="checkbox" checked={receiveNow} onChange={(event) => setReceiveNow(event.target.checked)} />
                    {receiveNow ? "Yes — put it into stock now" : "No — it is still on order"}
                  </label>
                </div>
              </>
            ) : null}
            <div className="jata-field">
              <label className="jata-label" htmlFor="po-notes">Notes</label>
              <input id="po-notes" className="jata-input" type="text" value={notes} onChange={(event) => setNotes(event.target.value)} />
            </div>
          </div>

          <div className="pos-form-actions">
            <button type="submit" className="jata-btn jata-btn-primary" disabled={busy || !lines.length || !entitled}>
              {busy ? "Saving…" : receiveNow ? `Save and put ${formatKES(total)} into stock` : `Save the order · ${formatKES(total)}`}
            </button>
            {!entitled ? <span className="pos-note">Renew the plan to record purchases.</span> : null}
          </div>
        </form>
      ) : null}

      {purchases.length === 0 ? (
        <div className="pos-empty">
          <strong>No purchases yet</strong>
          <p>Record what you buy and the stock arrives with it — every item, with its reason.</p>
          {canCreate ? <button type="button" className="jata-btn jata-btn-primary" onClick={() => setCreating(true)}>+ Record a purchase</button> : null}
        </div>
      ) : (
        <div className="pos-rows">
          {purchases.map((purchase) => {
            const outstanding = purchase.items.filter((item) => item.receivedQty < item.quantity);
            const isOpen = receiving === purchase.id;
            return (
              <div className="jata-card p-4 space-y-2" key={purchase.id}>
                <div className="pos-toolbar">
                  <div className="pos-row-main">
                    <strong>{purchase.reference}</strong>
                    <small>
                      {formatDateTime(new Date(purchase.createdAt))}
                      {purchase.supplierName ? ` · ${purchase.supplierName}` : ""}
                      {purchase.expectedAt ? ` · expected ${new Date(purchase.expectedAt).toLocaleDateString("en-KE")}` : ""}
                    </small>
                  </div>
                  <div className="pos-row-values">
                    <span>{formatKES(purchase.totalKES)}</span>
                    <span className="pos-pill" data-tone={purchase.status === "RECEIVED" ? "success" : purchase.status === "CANCELLED" ? "danger" : "warn"}>
                      {purchase.status.toLowerCase()}
                    </span>
                  </div>
                </div>

                <div className="pos-scroll">
                  <table className="pos-table">
                    <thead><tr><th>Item</th><th>Ordered</th><th>Received</th><th>Cost</th></tr></thead>
                    <tbody>
                      {purchase.items.map((item) => (
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td>{item.quantity}{item.unitKey ? ` ${item.unitKey}` : ""}</td>
                          <td>{item.receivedQty}</td>
                          <td>{formatKES(item.unitCostKES)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {outstanding.length && purchase.status !== "CANCELLED" ? (
                  <div className="pos-form-actions">
                    <button type="button" className="jata-btn jata-btn-secondary" onClick={() => { setReceiving(isOpen ? null : purchase.id); setReceiveQty({}); setPayAmountKES(0); }} disabled={!entitled}>
                      {isOpen ? "Close" : "Receive stock"}
                    </button>
                    <span className="pos-note">{outstanding.length} line(s) still to arrive.</span>
                  </div>
                ) : null}

                {isOpen ? (
                  <div className="space-y-2">
                    {outstanding.map((item) => (
                      <div className="pos-row" key={item.id}>
                        <div className="pos-row-main">
                          <strong>{item.name}</strong>
                          <small>{item.receivedQty} of {item.quantity} received</small>
                        </div>
                        <div className="pos-qty">
                          <input
                            className="jata-input"
                            type="number"
                            min={0}
                            max={item.quantity - item.receivedQty}
                            aria-label={`Quantity received of ${item.name}`}
                            value={receiveQty[item.id] ?? (partialReceiving ? 0 : item.quantity - item.receivedQty)}
                            onChange={(event) => setReceiveQty((current) => ({ ...current, [item.id]: Number(event.target.value) }))}
                          />
                        </div>
                      </div>
                    ))}

                    {supplierCredit ? (
                      <div className="pos-grid-2">
                        <div className="jata-field">
                          <label className="jata-label" htmlFor={`pay-${purchase.id}`}>Paying them now? (KES)</label>
                          <input id={`pay-${purchase.id}`} className="jata-input" type="number" min={0} value={payAmountKES || ""} onChange={(event) => setPayAmountKES(Number(event.target.value))} />
                        </div>
                        <div className="jata-field">
                          <label className="jata-label" htmlFor={`pay-method-${purchase.id}`}>How?</label>
                          <select id={`pay-method-${purchase.id}`} className="jata-input" value={payMethod} onChange={(event) => setPayMethod(event.target.value)}>
                            <option value="cash">Cash</option>
                            <option value="mpesa">M-Pesa</option>
                            <option value="bank">Bank transfer</option>
                            <option value="card">Card</option>
                          </select>
                        </div>
                        <div className="jata-field">
                          <label className="jata-label" htmlFor={`pay-ref-${purchase.id}`}>Reference</label>
                          <input id={`pay-ref-${purchase.id}`} className="jata-input" type="text" value={payReference} onChange={(event) => setPayReference(event.target.value)} />
                        </div>
                      </div>
                    ) : null}

                    <div className="pos-form-actions">
                      <button
                        type="button"
                        className="jata-btn jata-btn-primary"
                        disabled={busy || !entitled}
                        onClick={() =>
                          void post(`/purchases/${encodeURIComponent(purchase.id)}/receive`, {
                            items: Object.entries(receiveQty).map(([purchaseItemId, qty]) => ({ purchaseItemId, quantity: qty })),
                            payment: payAmountKES > 0 ? { amountKES: payAmountKES, method: payMethod, reference: payReference || null } : null,
                          })
                        }
                      >
                        {busy ? "Working…" : "Put it into stock"}
                      </button>
                      {!partialReceiving ? <span className="pos-note">Partial receiving is off, so the full outstanding quantity arrives.</span> : null}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <p className="pos-note">
        <a className="jata-btn jata-btn-ghost" href={`${basePath}/suppliers`}>Manage {word.toLowerCase()}s</a>
      </p>
    </div>
  );
}
