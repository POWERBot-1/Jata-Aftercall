"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { MethodOption } from "@/lib/pos/money";
import type { ReceiptDocument } from "@/lib/pos/types";

/**
 * The till (§58, §59, §62).
 *
 * The whole job is one sale, fast: tap the item, tap how they paid, done. A barcode scanner is
 * just a keyboard that types and presses Enter, so the search box doubles as the scanner input.
 * Totals, tax, discounts and credit are all decided by the server — this screen only collects
 * what happened at the counter and shows the receipt it gets back.
 */

export type TillProduct = {
  id: string;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  priceKES: number;
  unitKey: string;
  barcode?: string | null;
  category?: string | null;
  stock?: number | null;
};

export type TillCustomer = { id: string; name: string; phone?: string | null; balanceKES?: number };

type CartLine = {
  key: string;
  productId: string | null;
  name: string;
  kind: "PRODUCT" | "SERVICE";
  unitPriceKES: number;
  unitKey: string;
  quantity: number;
  discountKES: number;
  stock?: number | null;
};

type PaymentLine = { method: string; amountKES: number; reference: string };

type SaleResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  warnings?: string[];
  shortages?: { name: string; requested: number; available: number }[];
  sale?: { id: string; receiptNumber: string; status: string };
  receipt?: ReceiptDocument;
  receiptText?: string;
  totals?: { subtotalKES: number; discountKES: number; taxKES: number; totalKES: number; paidKES: number; balanceKES: number; changeKES: number };
  changeKES?: number;
  creditKES?: number;
};

export function TillClient({
  businessId,
  basePath,
  products,
  customers,
  methods,
  words,
  flags,
  entitled,
  entitlementReason,
  nextReceiptNumber,
}: {
  businessId: string;
  basePath: string;
  products: TillProduct[];
  customers: TillCustomer[];
  methods: MethodOption[];
  words: { sale: string; customer: string; product: string; products: string; order: string };
  flags: {
    discounts: boolean;
    splitPayments: boolean;
    partialPayments: boolean;
    credit: boolean;
    taxEnabled: boolean;
    taxLabel: string;
    deliveryEnabled: boolean;
    deliveryFeeKES: number;
    canEditPrice: boolean;
    canDiscount: boolean;
    channels: string[];
  };
  entitled: boolean;
  entitlementReason: string;
  nextReceiptNumber: string;
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [payments, setPayments] = useState<PaymentLine[]>([]);
  const [method, setMethod] = useState<string>(methods[0]?.key ?? "cash");
  const [customerId, setCustomerId] = useState("");
  const [discountKES, setDiscountKES] = useState(0);
  const [feeKES, setFeeKES] = useState(0);
  const [notes, setNotes] = useState("");
  const [channel, setChannel] = useState(flags.channels[0] ?? "walk_in");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [result, setResult] = useState<SaleResponse | null>(null);
  const [showCustomerPicker, setShowCustomerPicker] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  const subtotal = cart.reduce((total, line) => total + line.unitPriceKES * line.quantity, 0);
  const lineDiscounts = cart.reduce((total, line) => total + line.discountKES, 0);
  const afterDiscount = Math.max(0, subtotal - lineDiscounts - discountKES);
  const total = Math.max(0, afterDiscount + feeKES);
  const tendered = payments.reduce((sum, payment) => sum + (payment.method === "credit" ? 0 : payment.amountKES), 0);
  const onCredit = payments.filter((payment) => payment.method === "credit").reduce((sum, payment) => sum + payment.amountKES, 0);
  const balance = Math.max(0, total - tendered - onCredit);
  const change = Math.max(0, tendered - total);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return products;
    return products.filter((product) =>
      [product.name, product.barcode ?? "", product.category ?? ""].some((value) => value.toLowerCase().includes(term)),
    );
  }, [products, search]);

  function add(product: TillProduct, quantity = 1) {
    setCart((lines) => {
      const existing = lines.find((line) => line.productId === product.id);
      if (existing) {
        return lines.map((line) => (line.productId === product.id ? { ...line, quantity: line.quantity + quantity } : line));
      }
      return [
        ...lines,
        {
          key: product.id,
          productId: product.id,
          name: product.name,
          kind: product.kind,
          unitPriceKES: product.priceKES,
          unitKey: product.unitKey,
          quantity,
          discountKES: 0,
          stock: product.stock,
        },
      ];
    });
    setResult(null);
  }

  // A scanner types the code and presses Enter (§59).
  function onSearchEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const term = search.trim();
    if (!term) return;
    const exact = products.find((product) => product.barcode && product.barcode.toLowerCase() === term.toLowerCase());
    const match = exact ?? (visible.length === 1 ? visible[0] : null);
    if (match) {
      add(match);
      setSearch("");
    }
  }

  function setQuantity(key: string, quantity: number) {
    setCart((lines) =>
      lines.flatMap((line) => (line.key === key ? (quantity <= 0 ? [] : [{ ...line, quantity }]) : [line])),
    );
  }

  function chooseMethod(next: string) {
    setMethod(next);
    // Cash for the exact total is the common case (§62): one tap, then complete.
    setPayments((current) => {
      const withoutMethod = current.filter((payment) => payment.method !== next);
      const needsReference = methods.find((entry) => entry.key === next)?.needsReference;
      return [
        ...withoutMethod,
        { method: next, amountKES: next === "credit" ? balance : total, reference: needsReference ? "" : "" },
      ];
    });
  }

  function updatePayment(index: number, patch: Partial<PaymentLine>) {
    setPayments((current) => current.map((payment, position) => (position === index ? { ...payment, ...patch } : payment)));
  }

  async function complete() {
    setBusy(true);
    setError(null);
    setWarnings([]);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/sales`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          items: cart.map((line) => ({
            productId: line.productId,
            name: line.name,
            quantity: line.quantity,
            unitPriceKES: line.unitPriceKES,
            discountKES: line.discountKES,
          })),
          payments: payments.filter((payment) => payment.amountKES > 0 || payment.method === "credit"),
          customerId: customerId || null,
          channel,
          notes: notes || null,
          discountKES: discountKES || null,
          feeKES: feeKES || null,
        }),
      });
      const data: SaleResponse = await response.json();
      if (!response.ok || data.ok === false) {
        setError(data.error ?? "We couldn't record that sale.");
        setWarnings(data.warnings ?? []);
        setBusy(false);
        return;
      }
      setResult(data);
      setWarnings(data.warnings ?? []);
      setCart([]);
      setPayments([]);
      setDiscountKES(0);
      setFeeKES(0);
      setNotes("");
      setBusy(false);
      searchRef.current?.focus();
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
      setBusy(false);
    }
  }

  function reset() {
    setResult(null);
    setCart([]);
    setPayments([]);
    setDiscountKES(0);
    setFeeKES(0);
    setNotes("");
    searchRef.current?.focus();
  }

  // Keep the tendered amount in step with the total while the cart changes.
  useEffect(() => {
    setPayments((current) =>
      current.map((payment) => ({
        ...payment,
        amountKES: payment.method === "credit" ? Math.max(0, total - current.filter((entry) => entry.method !== "credit").reduce((sum, entry) => sum + entry.amountKES, 0)) : total,
      })),
    );
    // Only react to the total, not to the payments array itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  if (result?.receipt || result?.receiptText) {
    return (
      <div className="space-y-4">
        <div className="jata-card p-5">
          <p className="jata-kicker">Sale recorded</p>
          <h2 className="text-lg font-bold">{result.sale?.receiptNumber ?? nextReceiptNumber}</h2>
          <p className="pos-note">
            {result.totals ? `Total KES ${result.totals.totalKES.toLocaleString("en-KE")}` : ""}
            {result.changeKES ? ` · Change KES ${result.changeKES.toLocaleString("en-KE")}` : ""}
            {result.creditKES ? ` · On credit KES ${result.creditKES.toLocaleString("en-KE")}` : ""}
            {result.totals?.balanceKES ? ` · Still owed KES ${result.totals.balanceKES.toLocaleString("en-KE")}` : ""}
          </p>
          {warnings.length ? (
            <ul className="mt-3 grid gap-1">
              {warnings.map((warning) => <li key={warning} className="pos-note">• {warning}</li>)}
            </ul>
          ) : null}
          <pre className="pos-receipt mt-4">{result.receiptText}</pre>
          <div className="pos-form-actions mt-4">
            <button type="button" className="jata-btn jata-btn-primary" onClick={reset}>New {words.sale.toLowerCase()}</button>
            <button type="button" className="jata-btn jata-btn-secondary" onClick={() => window.print()}>Print receipt</button>
            {result.sale?.id ? (
              <Link className="jata-btn jata-btn-ghost" href={`${basePath}/sales/${result.sale.id}`}>Open {words.sale.toLowerCase()}</Link>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!entitled ? (
        <div className="pos-banner" data-tone="warn" role="status">
          <div>
            <p className="pos-banner-label">Not live yet</p>
            <p className="pos-banner-text">{entitlementReason}</p>
          </div>
          <Link href={`${basePath}/plan`} className="jata-btn jata-btn-secondary">Choose plan</Link>
        </div>
      ) : null}

      {products.length === 0 ? (
        <div className="pos-empty">
          <strong>Add your first {words.product.toLowerCase()}</strong>
          <p>You need something to sell before you can record a {words.sale.toLowerCase()}. It takes about a minute.</p>
          <Link href={`${basePath}/products?new=1`} className="jata-btn jata-btn-primary">+ Add {words.product}</Link>
        </div>
      ) : null}

      <div className="pos-till">
        <div className="space-y-3">
          <div className="pos-toolbar">
            <input
              ref={searchRef}
              className="jata-input pos-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={onSearchEnter}
              placeholder={`Search ${words.products.toLowerCase()} or scan a barcode…`}
              aria-label={`Search ${words.products.toLowerCase()}`}
            />
          </div>

          <div className="pos-catalogue">
            {visible.slice(0, 60).map((product) => {
              const out = typeof product.stock === "number" && product.stock <= 0;
              return (
                <button type="button" key={product.id} className="pos-item" data-out={out} onClick={() => add(product)}>
                  <strong>{product.name}</strong>
                  <span>KES {product.priceKES.toLocaleString("en-KE")}</span>
                  <small>
                    {typeof product.stock === "number" ? `${product.stock} ${product.unitKey}` : product.unitKey}
                  </small>
                </button>
              );
            })}
          </div>
          {visible.length === 0 ? <p className="pos-note">Nothing matches “{search}”.</p> : null}
        </div>

        <div className="pos-cart">
          <div className="pos-toolbar">
            <p className="jata-kicker">This {words.sale.toLowerCase()}</p>
            {cart.length ? (
              <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setCart([])}>Clear</button>
            ) : null}
          </div>

          {cart.length === 0 ? (
            <p className="pos-note">Tap an item to start. {nextReceiptNumber} is the next receipt number.</p>
          ) : null}

          {cart.map((line) => (
            <div className="pos-line" key={line.key}>
              <div className="pos-line-main">
                <strong>{line.name}</strong>
                <small>
                  KES {line.unitPriceKES.toLocaleString("en-KE")} / {line.unitKey}
                  {line.discountKES > 0 ? ` · less KES ${line.discountKES.toLocaleString("en-KE")}` : ""}
                </small>
              </div>
              <div className="pos-qty">
                <button type="button" aria-label={`One less ${line.name}`} onClick={() => setQuantity(line.key, line.quantity - 1)}>−</button>
                <input
                  className="jata-input"
                  aria-label={`Quantity of ${line.name}`}
                  type="number"
                  min={0}
                  value={line.quantity}
                  onChange={(event) => setQuantity(line.key, Math.max(0, Number(event.target.value)))}
                />
                <button type="button" aria-label={`One more ${line.name}`} onClick={() => setQuantity(line.key, line.quantity + 1)}>+</button>
                <strong className="ml-2">KES {(line.unitPriceKES * line.quantity - line.discountKES).toLocaleString("en-KE")}</strong>
              </div>
            </div>
          ))}

          <div className="pos-totals">
            <div><span>Items</span><span>KES {subtotal.toLocaleString("en-KE")}</span></div>
            {lineDiscounts + discountKES > 0 ? (
              <div><span>Discount</span><span>− KES {(lineDiscounts + discountKES).toLocaleString("en-KE")}</span></div>
            ) : null}
            {flags.taxEnabled ? <div><span>{flags.taxLabel || "Tax"}</span><span>Included by the server</span></div> : null}
            {feeKES > 0 ? <div><span>Delivery</span><span>KES {feeKES.toLocaleString("en-KE")}</span></div> : null}
            <div className="pos-total-line"><span>Total</span><span>KES {total.toLocaleString("en-KE")}</span></div>
          </div>

          {flags.discounts && flags.canDiscount && cart.length > 0 ? (
            <div className="jata-field">
              <label className="jata-label" htmlFor="till-discount">Discount the whole {words.sale.toLowerCase()} (KES)</label>
              <input
                id="till-discount"
                className="jata-input"
                type="number"
                min={0}
                value={discountKES || ""}
                onChange={(event) => setDiscountKES(Math.max(0, Number(event.target.value)))}
              />
            </div>
          ) : null}

          {flags.deliveryEnabled ? (
            <div className="jata-field">
              <label className="jata-label" htmlFor="till-fee">Delivery fee (KES)</label>
              <input
                id="till-fee"
                className="jata-input"
                type="number"
                min={0}
                value={feeKES || ""}
                placeholder={String(flags.deliveryFeeKES || 0)}
                onChange={(event) => setFeeKES(Math.max(0, Number(event.target.value)))}
              />
            </div>
          ) : null}

          {flags.channels.length > 1 ? (
            <div className="jata-field">
              <label className="jata-label" htmlFor="till-channel">Where did this come from?</label>
              <select id="till-channel" className="jata-input" value={channel} onChange={(event) => setChannel(event.target.value)}>
                {flags.channels.map((entry) => (
                  <option key={entry} value={entry}>{entry.replace(/_/g, " ")}</option>
                ))}
              </select>
            </div>
          ) : null}

          <div className="pos-pay">
            <p className="jata-kicker">How are they paying?</p>
            <div className="pos-methods">
              {methods.map((entry) => (
                <button
                  type="button"
                  key={entry.key}
                  className="pos-method"
                  data-selected={payments.some((payment) => payment.method === entry.key) || (!payments.length && method === entry.key)}
                  onClick={() => chooseMethod(entry.key)}
                >
                  {entry.label}
                </button>
              ))}
            </div>

            {payments.map((payment, index) => (
              <div className="pos-grid-2" key={`${payment.method}-${index}`}>
                <div className="jata-field">
                  <label className="jata-label" htmlFor={`pay-${index}`}>{payment.method === "credit" ? "On credit (KES)" : `${payment.method} amount (KES)`}</label>
                  <input
                    id={`pay-${index}`}
                    className="jata-input"
                    type="number"
                    min={0}
                    value={payment.amountKES || ""}
                    onChange={(event) => updatePayment(index, { amountKES: Math.max(0, Number(event.target.value)) })}
                  />
                </div>
                {methods.find((entry) => entry.key === payment.method)?.needsReference ? (
                  <div className="jata-field">
                    <label className="jata-label" htmlFor={`ref-${index}`}>Reference</label>
                    <input
                      id={`ref-${index}`}
                      className="jata-input"
                      type="text"
                      placeholder="M-Pesa code"
                      value={payment.reference}
                      onChange={(event) => updatePayment(index, { reference: event.target.value })}
                    />
                  </div>
                ) : null}
              </div>
            ))}

            {flags.splitPayments && payments.length > 0 ? (
              <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setPayments((current) => [...current, { method: methods[0]?.key ?? "cash", amountKES: 0, reference: "" }])}>
                + Add another payment
              </button>
            ) : null}
          </div>

          {flags.credit || flags.partialPayments ? (
            <div>
              <div className="pos-toolbar">
                <p className="jata-kicker">{words.customer}</p>
                <button type="button" className="jata-btn jata-btn-ghost" onClick={() => setShowCustomerPicker((open) => !open)}>
                  {customerId ? "Change" : "Add"}
                </button>
              </div>
              {showCustomerPicker ? (
                <div className="jata-field mt-2">
                  <label className="jata-label" htmlFor="till-customer">Who is this for?</label>
                  <select id="till-customer" className="jata-input" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
                    <option value="">Walk-in (no name)</option>
                    {customers.map((customer) => (
                      <option key={customer.id} value={customer.id}>
                        {customer.name}{customer.balanceKES ? ` · owes KES ${Number(customer.balanceKES).toLocaleString("en-KE")}` : ""}
                      </option>
                    ))}
                  </select>
                  <p className="jata-hint">Needed for credit and for keeping their history.</p>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="jata-field">
            <label className="jata-label" htmlFor="till-notes">Note (optional)</label>
            <input id="till-notes" className="jata-input" type="text" value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Anything the next person should know" />
          </div>

          {error ? <p className="jata-error" role="alert">{error}</p> : null}
          {warnings.length ? (
            <ul className="grid gap-1">
              {warnings.map((warning) => <li key={warning} className="pos-note">• {warning}</li>)}
            </ul>
          ) : null}

          <div className="pos-totals">
            {tendered > 0 || onCredit > 0 ? (
              <>
                <div><span>Taken</span><span>KES {tendered.toLocaleString("en-KE")}</span></div>
                {onCredit > 0 ? <div><span>On credit</span><span>KES {onCredit.toLocaleString("en-KE")}</span></div> : null}
                {change > 0 ? <div><span>Change due</span><span>KES {change.toLocaleString("en-KE")}</span></div> : null}
                {balance > 0 ? <div><span>Still owed</span><span>KES {balance.toLocaleString("en-KE")}</span></div> : null}
              </>
            ) : null}
          </div>

          <button
            type="button"
            className="jata-btn jata-btn-primary pos-action-primary"
            onClick={complete}
            disabled={busy || !cart.length || !entitled || (payments.length === 0 && !(flags.partialPayments || flags.credit))}
          >
            {busy ? "Saving…" : `Complete ${words.sale.toLowerCase()} · KES ${total.toLocaleString("en-KE")}`}
          </button>
          <p className="pos-note">Stock, the receipt and the payment are saved together in one step.</p>
        </div>
      </div>
    </div>
  );
}
