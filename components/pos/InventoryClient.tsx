"use client";

import { useState } from "react";
import { formatDateTime } from "@/lib/format";
import type { AdjustmentInput } from "@/lib/pos/inventory";

/**
 * Stock room (§16, §33).
 *
 * Three actions, all of which write a movement with a reason: adjust, move between locations, and
 * count. The on-hand number is never typed in directly — a count records what was found and the
 * server writes the difference, so the ledger always explains the number on the screen.
 */

export type StockRow = { id: string; productId: string; name: string; unitKey: string; quantity: number; reorderLevel: number; branchId: string | null };
export type MovementRow = { id: string; when: string | Date; item: string; reason: string; delta: number; note: string | null };
export type BranchRow = { id: string; name: string };
export type ProductOption = { id: string; name: string; unitKey: string };
export type ReasonOption = { key: string; label: string };

export function InventoryClient({
  businessId,
  basePath,
  stock,
  movements,
  branches,
  products,
  reasons,
  canAdjust,
  canTransfer,
  canCount,
  locations,
  words,
  entitled,
}: {
  businessId: string;
  basePath: string;
  stock: StockRow[];
  movements: MovementRow[];
  branches: BranchRow[];
  products: ProductOption[];
  reasons: ReasonOption[];
  canAdjust: boolean;
  canTransfer: boolean;
  canCount: boolean;
  locations: boolean;
  words: { stock: string; branch: string };
  entitled: boolean;
}) {
  const [mode, setMode] = useState<"adjust" | "transfer" | "count" | null>(null);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [reason, setReason] = useState(reasons[0]?.key ?? "ADJUSTMENT");
  const [quantity, setQuantity] = useState(1);
  const [counted, setCounted] = useState(0);
  const [note, setNote] = useState("");
  const [fromBranchId, setFromBranchId] = useState(branches[0]?.id ?? "");
  const [toBranchId, setToBranchId] = useState(branches[1]?.id ?? branches[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const selected = products.find((product) => product.id === productId);
  const onHand = stock
    .filter((row) => row.productId === productId)
    .reduce((total, row) => total + Number(row.quantity ?? 0), 0);

  async function submit() {
    setBusy(true);
    setError(null);
    setDone(null);
    const action = mode === "transfer" ? "transfer" : mode === "count" ? "count" : "adjust";
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/inventory`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          productId,
          reason,
          quantity: action === "count" ? counted : quantity,
          counted,
          note: note || null,
          fromBranchId,
          toBranchId,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? "We couldn't save that stock change.");
        setBusy(false);
        return;
      }
      setDone(
        action === "transfer"
          ? "Moved. Both locations were updated with their own movement."
          : action === "count"
            ? `Counted. ${Number(data.difference ?? 0) === 0 ? "The count matched the system." : `Difference of ${data.difference} recorded.`}`
            : `Saved. ${selected?.name ?? "Item"} is now ${data.quantity ?? onHand}.`,
      );
      setBusy(false);
      setNote("");
      window.location.reload();
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="pos-toolbar">
        <div className="pos-tabs">
          {canAdjust ? <button type="button" className="pos-tab" data-selected={mode === "adjust"} onClick={() => setMode(mode === "adjust" ? null : "adjust")}>Adjust</button> : null}
          {canTransfer && locations ? <button type="button" className="pos-tab" data-selected={mode === "transfer"} onClick={() => setMode(mode === "transfer" ? null : "transfer")}>Move between {words.branch.toLowerCase()}s</button> : null}
          {canCount ? <button type="button" className="pos-tab" data-selected={mode === "count"} onClick={() => setMode(mode === "count" ? null : "count")}>Stock count</button> : null}
        </div>
        {!entitled ? <span className="pos-pill" data-tone="warn">Renew to change stock</span> : null}
      </div>

      {error ? <p className="jata-error" role="alert">{error}</p> : null}
      {done ? <p className="pos-note" role="status">{done}</p> : null}

      {mode ? (
        <form
          className="jata-card p-4 pos-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <p className="jata-kicker">
            {mode === "adjust" ? "Change the number, with a reason" : mode === "transfer" ? `Move ${words.stock.toLowerCase()} between locations` : "What did you actually count?"}
          </p>

          <div className="pos-grid-2">
            <div className="jata-field">
              <label className="jata-label" htmlFor="inv-product">Which item?</label>
              <select id="inv-product" className="jata-input" value={productId} onChange={(event) => setProductId(event.target.value)}>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>{product.name}</option>
                ))}
              </select>
              <p className="jata-hint">System says {onHand} {selected?.unitKey ?? ""}.</p>
            </div>

            {mode === "adjust" ? (
              <>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="inv-reason">Why is it changing?</label>
                  <select id="inv-reason" className="jata-input" value={reason} onChange={(event) => setReason(event.target.value)}>
                    {reasons.map((option) => (
                      <option key={option.key} value={option.key}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="inv-quantity">How much?</label>
                  <input id="inv-quantity" className="jata-input" type="number" min={0} step="any" value={quantity || ""} onChange={(event) => setQuantity(Number(event.target.value))} />
                  <p className="jata-hint">Damage, expiry and wastage take stock away; opening stock adds it.</p>
                </div>
              </>
            ) : null}

            {mode === "count" ? (
              <div className="jata-field">
                <label className="jata-label" htmlFor="inv-counted">How many did you count?</label>
                <input id="inv-counted" className="jata-input" type="number" min={0} step="any" value={counted || ""} onChange={(event) => setCounted(Number(event.target.value))} />
                <p className="jata-hint">
                  {counted > 0 && onHand >= 0 ? `JATA will record a difference of ${counted - onHand}.` : "JATA records the difference, not a new number."}
                </p>
              </div>
            ) : null}

            {mode === "transfer" ? (
              <>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="inv-from">From</label>
                  <select id="inv-from" className="jata-input" value={fromBranchId} onChange={(event) => setFromBranchId(event.target.value)}>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </div>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="inv-to">To</label>
                  <select id="inv-to" className="jata-input" value={toBranchId} onChange={(event) => setToBranchId(event.target.value)}>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                  </select>
                </div>
                <div className="jata-field">
                  <label className="jata-label" htmlFor="inv-move-qty">How much?</label>
                  <input id="inv-move-qty" className="jata-input" type="number" min={1} step="any" value={quantity || ""} onChange={(event) => setQuantity(Number(event.target.value))} />
                </div>
              </>
            ) : null}

            <div className="jata-field">
              <label className="jata-label" htmlFor="inv-note">Short reason</label>
              <input id="inv-note" className="jata-input" type="text" value={note} onChange={(event) => setNote(event.target.value)} placeholder="Broken in transit, counted after closing" />
              <p className="jata-hint">Some reasons need a note — it is what makes the ledger readable later.</p>
            </div>
          </div>

          <div className="pos-form-actions">
            <button type="submit" className="jata-btn jata-btn-primary" disabled={busy || !productId || !entitled}>
              {busy ? "Saving…" : "Save the change"}
            </button>
            <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setMode(null)}>Cancel</button>
          </div>
        </form>
      ) : null}

      <section>
        <p className="jata-kicker">{words.stock} on hand</p>
        {stock.length === 0 ? (
          <div className="pos-empty">
            <strong>No stock recorded yet</strong>
            <p>Receive a delivery or record an opening balance, and the numbers will live here.</p>
            <a className="jata-btn jata-btn-secondary" href={`${basePath}/purchases`}>Record a purchase</a>
          </div>
        ) : (
          <div className="pos-scroll">
            <table className="pos-table">
              <thead>
                <tr><th>Item</th><th>Unit</th><th>On hand</th>{locations ? <th>{words.branch}</th> : null}<th>Status</th></tr>
              </thead>
              <tbody>
                {stock.map((row) => {
                  const out = row.quantity <= 0;
                  const low = !out && row.quantity <= row.reorderLevel;
                  return (
                    <tr key={row.id}>
                      <td>{row.name}</td>
                      <td>{row.unitKey}</td>
                      <td>{row.quantity}</td>
                      {locations ? <td>{branches.find((branch) => branch.id === row.branchId)?.name ?? "Main"}</td> : null}
                      <td>
                        <span className="pos-pill" data-tone={out ? "danger" : low ? "warn" : "success"}>
                          {out ? "Out" : low ? "Low" : "In stock"}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <p className="jata-kicker">Every change, with its reason</p>
        {movements.length === 0 ? (
          <p className="pos-note">Nothing has moved yet.</p>
        ) : (
          <div className="pos-rows">
            {movements.map((movement) => (
              <div className="pos-row" key={movement.id}>
                <div className="pos-row-main">
                  <strong>{movement.item}</strong>
                  <small>{formatDateTime(new Date(movement.when))}{movement.note ? ` · ${movement.note}` : ""}</small>
                </div>
                <div className="pos-row-values">
                  <span className="pos-chip">{movement.reason.replace(/_/g, " ").toLowerCase()}</span>
                  <strong>{movement.delta > 0 ? `+${movement.delta}` : movement.delta}</strong>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** Client-side mirror of the server's sanitiser, so the form can explain itself before posting. */
export type LocalAdjustment = AdjustmentInput;
