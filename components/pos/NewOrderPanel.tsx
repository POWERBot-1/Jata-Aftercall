"use client";

import { useState } from "react";
import { formatKES } from "@/lib/format";
import { channelLabel } from "@/lib/pos/receipt";

/**
 * Taking an order (§28, §29, §62).
 *
 * The fields on show are the ones this business configured: channels it actually sells through,
 * delivery only when it delivers, a deposit only when it takes them, and modifiers only for a
 * trade that needs "no onions, extra sauce".
 */

export type OrderProductOption = { id: string; name: string; priceKES: number; unitKey: string };
export type OrderCustomerOption = { id: string; name: string; phone: string | null };

type Line = { productId: string; name: string; quantity: number; unitPriceKES: number; modifiers: string };

export function NewOrderPanel(props: {
  businessId: string;
  basePath: string;
  word: string;
  channels: string[];
  deliveryEnabled: boolean;
  pickupEnabled: boolean;
  deposits: boolean;
  dueDates: boolean;
  products: OrderProductOption[];
  customers: OrderCustomerOption[];
  modifiers: boolean;
}) {
  const { businessId, basePath, word, channels, products, customers } = props;
  const [lines, setLines] = useState<Line[]>([]);
  const [productId, setProductId] = useState(products[0]?.id ?? "");
  const [quantity, setQuantity] = useState(1);
  const [modifiers, setModifiers] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [channel, setChannel] = useState(channels[0] ?? "walk_in");
  const [fulfilment, setFulfilment] = useState(props.pickupEnabled ? "PICKUP" : props.deliveryEnabled ? "DELIVERY" : "DINE_IN");
  const [address, setAddress] = useState("");
  const [expectedAt, setExpectedAt] = useState("");
  const [depositKES, setDepositKES] = useState(0);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const total = lines.reduce((sum, line) => sum + line.unitPriceKES * line.quantity, 0);
  const chosen = products.find((product) => product.id === productId);

  function addLine() {
    if (!chosen) return;
    setLines((current) => {
      const existing = current.find((line) => line.productId === chosen.id && line.modifiers === modifiers.trim());
      if (existing) {
        return current.map((line) => (line === existing ? { ...line, quantity: line.quantity + quantity } : line));
      }
      return [...current, { productId: chosen.id, name: chosen.name, quantity, unitPriceKES: chosen.priceKES, modifiers: modifiers.trim() }];
    });
    setQuantity(1);
    setModifiers("");
  }

  async function submit() {
    if (!lines.length) {
      setError(`Add at least one item to the ${word.toLowerCase()}.`);
      return;
    }
    setBusy(true);
    setError(null);
    const selectedCustomer = customers.find((customer) => customer.id === customerId);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/orders`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          customerId: customerId || null,
          customerName: selectedCustomer?.name ?? customerName ?? null,
          customerPhone: selectedCustomer?.phone ?? customerPhone ?? null,
          channel,
          fulfilment,
          address: address || null,
          expectedAt: expectedAt || null,
          depositKES: props.deposits ? depositKES : null,
          notes: notes || null,
          items: lines.map((line) => ({
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            unitPriceKES: line.unitPriceKES,
            modifiers: line.modifiers || null,
          })),
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error ?? `We couldn't save that ${word.toLowerCase()}.`);
        setBusy(false);
        return;
      }
      window.location.href = `${basePath}/orders`;
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <form
      className="jata-card p-4 pos-form"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <div>
        <p className="jata-kicker">New {word.toLowerCase()}</p>
        <h3 className="text-base font-semibold">What are they ordering?</h3>
      </div>

      <div className="pos-grid-2">
        <div className="jata-field">
          <label className="jata-label" htmlFor="order-product">Item</label>
          <select id="order-product" className="jata-input" value={productId} onChange={(event) => setProductId(event.target.value)}>
            {products.map((product) => (
              <option key={product.id} value={product.id}>{product.name} · {formatKES(product.priceKES)}</option>
            ))}
          </select>
        </div>
        <div className="jata-field">
          <label className="jata-label" htmlFor="order-quantity">How many?</label>
          <input id="order-quantity" className="jata-input" type="number" min={1} value={quantity || ""} onChange={(event) => setQuantity(Math.max(1, Number(event.target.value)))} />
        </div>
        {props.modifiers ? (
          <div className="jata-field">
            <label className="jata-label" htmlFor="order-modifiers">Anything special?</label>
            <input id="order-modifiers" className="jata-input" type="text" value={modifiers} onChange={(event) => setModifiers(event.target.value)} placeholder="No onions, extra sauce" />
          </div>
        ) : null}
        <div className="jata-field">
          <span className="jata-label">&nbsp;</span>
          <button type="button" className="jata-btn jata-btn-secondary" onClick={addLine}>+ Add to the {word.toLowerCase()}</button>
        </div>
      </div>

      {lines.length ? (
        <div className="pos-rows">
          {lines.map((line, index) => (
            <div className="pos-row" key={`${line.productId}-${index}`}>
              <div className="pos-row-main">
                <strong>{line.name}</strong>
                <small>{line.quantity} × {formatKES(line.unitPriceKES)}{line.modifiers ? ` · ${line.modifiers}` : ""}</small>
              </div>
              <div className="pos-row-values">
                <span>{formatKES(line.unitPriceKES * line.quantity)}</span>
                <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setLines((current) => current.filter((_, position) => position !== index))}>
                  Remove
                </button>
              </div>
            </div>
          ))}
          <p className="pos-note">Total {formatKES(total)}</p>
        </div>
      ) : null}

      <div className="pos-grid-2">
        {customers.length ? (
          <div className="jata-field">
            <label className="jata-label" htmlFor="order-customer">Who is it for?</label>
            <select id="order-customer" className="jata-input" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Walk-in (no record)</option>
              {customers.map((customer) => (
                <option key={customer.id} value={customer.id}>{customer.name}{customer.phone ? ` · ${customer.phone}` : ""}</option>
              ))}
            </select>
          </div>
        ) : (
          <>
            <div className="jata-field">
              <label className="jata-label" htmlFor="order-name">Their name</label>
              <input id="order-name" className="jata-input" type="text" value={customerName} onChange={(event) => setCustomerName(event.target.value)} />
            </div>
            <div className="jata-field">
              <label className="jata-label" htmlFor="order-phone">Their phone</label>
              <input id="order-phone" className="jata-input" type="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} />
            </div>
          </>
        )}

        {channels.length > 1 ? (
          <div className="jata-field">
            <label className="jata-label" htmlFor="order-channel">How did it come in?</label>
            <select id="order-channel" className="jata-input" value={channel} onChange={(event) => setChannel(event.target.value)}>
              {channels.map((entry) => <option key={entry} value={entry}>{channelLabel(entry)}</option>)}
            </select>
            <p className="jata-hint">So you can see what each channel brings in.</p>
          </div>
        ) : null}

        {props.deliveryEnabled || props.pickupEnabled ? (
          <div className="jata-field">
            <label className="jata-label" htmlFor="order-fulfilment">How do they get it?</label>
            <select id="order-fulfilment" className="jata-input" value={fulfilment} onChange={(event) => setFulfilment(event.target.value)}>
              {props.pickupEnabled ? <option value="PICKUP">Collecting</option> : null}
              {props.deliveryEnabled ? <option value="DELIVERY">Delivering</option> : null}
              <option value="DINE_IN">Here</option>
            </select>
          </div>
        ) : null}

        {props.deliveryEnabled && fulfilment === "DELIVERY" ? (
          <div className="jata-field">
            <label className="jata-label" htmlFor="order-address">Where to?</label>
            <textarea id="order-address" className="jata-input" rows={2} value={address} onChange={(event) => setAddress(event.target.value)} />
          </div>
        ) : null}

        {props.dueDates ? (
          <div className="jata-field">
            <label className="jata-label" htmlFor="order-due">When is it due?</label>
            <input id="order-due" className="jata-input" type="datetime-local" value={expectedAt} onChange={(event) => setExpectedAt(event.target.value)} />
          </div>
        ) : null}

        {props.deposits ? (
          <div className="jata-field">
            <label className="jata-label" htmlFor="order-deposit">Deposit taken (KES)</label>
            <input id="order-deposit" className="jata-input" type="number" min={0} value={depositKES || ""} onChange={(event) => setDepositKES(Math.max(0, Number(event.target.value)))} />
          </div>
        ) : null}

        <div className="jata-field">
          <label className="jata-label" htmlFor="order-notes">Notes for the team</label>
          <input id="order-notes" className="jata-input" type="text" value={notes} onChange={(event) => setNotes(event.target.value)} />
        </div>
      </div>

      {error ? <p className="jata-error" role="alert">{error}</p> : null}

      <div className="pos-form-actions">
        <button type="submit" className="jata-btn jata-btn-primary" disabled={busy || !lines.length}>
          {busy ? "Saving…" : `Save the ${word.toLowerCase()} · ${formatKES(total)}`}
        </button>
        <a className="jata-btn jata-btn-ghost" href={`${basePath}/orders`}>Cancel</a>
      </div>
    </form>
  );
}
