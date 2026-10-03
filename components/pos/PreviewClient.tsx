"use client";

import { useState } from "react";
import Link from "next/link";
import type { PreviewSandbox } from "@/lib/pos/preview";

/**
 * The preview sandbox (§23, §42, §44).
 *
 * Only the modules this business is configured for appear — a salon has no kitchen queue and a
 * restaurant has no job cards. The data is seeded from the configuration, so two different
 * businesses preview two different systems from the same software. Nothing here is saved: a
 * preview is not production.
 */

type Tab = { key: string; label: string };

export function PreviewClient({
  sandbox,
  basePath,
  entitled,
}: {
  sandbox: PreviewSandbox;
  basePath: string;
  entitled: boolean;
}) {
  const tabs: Tab[] = [
    { key: "dashboard", label: "Dashboard" },
    { key: "sell", label: "Selling" },
    ...(sandbox.orders.length ? [{ key: "orders", label: "Orders" }] : []),
    ...(sandbox.customers.length ? [{ key: "customers", label: "Customers" }] : []),
    ...(sandbox.credit.length ? [{ key: "credit", label: "Credit" }] : []),
    ...(sandbox.inventory.length ? [{ key: "stock", label: "Stock" }] : []),
    ...(sandbox.suppliers.length ? [{ key: "suppliers", label: "Suppliers" }] : []),
    ...(sandbox.expenses.length ? [{ key: "expenses", label: "Expenses" }] : []),
    ...(sandbox.staff.length ? [{ key: "staff", label: "Staff" }] : []),
    { key: "reports", label: "Reports" },
    { key: "receipt", label: "Receipt" },
  ];
  const [tab, setTab] = useState(tabs[0]?.key ?? "dashboard");
  const [cart, setCart] = useState<{ id: string; name: string; priceKES: number; quantity: number }[]>([]);

  const cartTotal = cart.reduce((total, line) => total + line.priceKES * line.quantity, 0);

  function add(item: { id: string; name: string; priceKES: number }) {
    setCart((lines) => {
      const existing = lines.find((line) => line.id === item.id);
      if (existing) return lines.map((line) => (line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line));
      return [...lines, { ...item, quantity: 1 }];
    });
  }

  return (
    <div className="space-y-4">
      <div className="pos-preview">
        <div className="pos-preview-head">
          <div>
            <p className="jata-kicker">Preview · sample data</p>
            <p className="font-semibold">{sandbox.headline}</p>
          </div>
          <div className="pos-tabs">
            {tabs.map((entry) => (
              <button key={entry.key} type="button" className="pos-tab" data-selected={tab === entry.key} onClick={() => setTab(entry.key)}>
                {entry.label}
              </button>
            ))}
          </div>
        </div>

        <div className="pos-preview-body">
          <p className="pos-note">{sandbox.notice}</p>

          <div className="pos-quick">
            {sandbox.quickActions.map((action) => (
              <span key={action.key} className={action.icon ? "jata-btn jata-btn-secondary pos-action" : "jata-btn jata-btn-secondary pos-action"}>
                <span aria-hidden="true">{action.icon}</span> {action.label}
              </span>
            ))}
          </div>

          {tab === "dashboard" ? (
            <>
              <dl className="pos-cards">
                {sandbox.dashboard.map((card) => (
                  <div className="pos-card" key={card.key}>
                    <dt>{card.label}</dt>
                    <dd className="pos-card-value">{card.value}</dd>
                    {card.hint ? <dd className="pos-card-hint">{card.hint}</dd> : null}
                  </div>
                ))}
              </dl>
              <div>
                <p className="jata-kicker">What you will see in the menu</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {sandbox.navigation.map((item) => (
                    <span className="pos-chip" key={item.key}>
                      <span aria-hidden="true">{item.icon}</span> {item.label}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="jata-kicker">Empty screens teach the next step</p>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {sandbox.emptyStates.map((state) => (
                    <div className="pos-empty" key={state.module}>
                      <strong>{state.title}</strong>
                      <p>{state.body}</p>
                      <span className="jata-btn jata-btn-secondary">{state.action}</span>
                    </div>
                  ))}
                </div>
              </div>
            </>
          ) : null}

          {tab === "sell" ? (
            <div className="pos-till">
              <div>
                <p className="jata-kicker">{sandbox.saleFlow.prompt}</p>
                <div className="pos-catalogue mt-2">
                  {sandbox.catalogue.map((item) => (
                    <button type="button" key={item.id} className="pos-item" onClick={() => add(item)}>
                      <strong>{item.name}</strong>
                      <span>{item.priceKES.toLocaleString("en-KE")}</span>
                      {item.stock !== undefined ? <small>{item.stock} in stock</small> : <small>{item.category ?? item.kind}</small>}
                    </button>
                  ))}
                </div>
              </div>
              <div className="pos-cart">
                <p className="jata-kicker">This sale</p>
                {cart.length === 0 ? <p className="pos-note">Tap an item to add it — this is what your first sale feels like.</p> : null}
                {cart.map((line) => (
                  <div className="pos-line" key={line.id}>
                    <div className="pos-line-main">
                      <strong>{line.name}</strong>
                      <small>{line.priceKES.toLocaleString("en-KE")} each</small>
                    </div>
                    <div className="pos-qty">
                      <button type="button" aria-label={`Remove one ${line.name}`} onClick={() => setCart((lines) => lines.flatMap((entry) => (entry.id === line.id ? (entry.quantity > 1 ? [{ ...entry, quantity: entry.quantity - 1 }] : []) : [entry])))}>−</button>
                      <span>{line.quantity}</span>
                      <button type="button" aria-label={`Add one ${line.name}`} onClick={() => setCart((lines) => lines.map((entry) => (entry.id === line.id ? { ...entry, quantity: entry.quantity + 1 } : entry)))}>+</button>
                    </div>
                  </div>
                ))}
                <div className="pos-totals">
                  <div><span>Items</span><span>{cartTotal.toLocaleString("en-KE")}</span></div>
                  <div className="pos-total-line"><span>Total</span><span>KES {cartTotal.toLocaleString("en-KE")}</span></div>
                </div>
                <div className="pos-pay">
                  <p className="jata-kicker">How are they paying?</p>
                  <div className="pos-methods">
                    {sandbox.saleFlow.paymentMethods.map((method) => (
                      <span className="pos-method" key={method.key}>{method.label}</span>
                    ))}
                  </div>
                </div>
                <p className="pos-note">
                  In the real POS this saves a sale, moves stock, prints a receipt and records the payment — in one step.
                </p>
              </div>
            </div>
          ) : null}

          {tab === "orders" ? (
            <div className="pos-board">
              {groupOrders(sandbox.orders).map((column) => (
                <div className="pos-column" key={column.state}>
                  <div className="pos-column-head">
                    <span>{column.state}</span>
                    <span className="pos-pill">{column.orders.length}</span>
                  </div>
                  {column.orders.map((order) => (
                    <div className="pos-order-card" key={order.id}>
                      <strong>{order.reference}</strong>
                      <small>{order.customer} · {order.channel}</small>
                      <small>{order.totalKES} · {order.at}</small>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          ) : null}

          {tab === "customers" ? (
            <div className="pos-rows">
              {sandbox.customers.map((customer) => (
                <div className="pos-row" key={customer.id}>
                  <div className="pos-row-main">
                    <strong>{customer.name}</strong>
                    <small>{customer.phone}{customer.segment ? ` · ${customer.segment}` : ""}</small>
                  </div>
                  <div className="pos-row-values">
                    <span>{customer.visits} visits</span>
                    {customer.balanceKES > 0 ? <span className="pos-pill" data-tone="warn">Owes {customer.balanceKES.toLocaleString("en-KE")}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "credit" ? (
            <div className="pos-scroll">
              <table className="pos-table">
                <thead><tr><th>Who</th><th>Balance</th><th>Status</th><th>Due</th></tr></thead>
                <tbody>
                  {sandbox.credit.map((entry) => (
                    <tr key={entry.name}>
                      <td>{entry.name}</td>
                      <td>{entry.balanceKES}</td>
                      <td><span className="pos-pill" data-tone={entry.status === "Overdue" ? "danger" : "neutral"}>{entry.status}</span></td>
                      <td>{entry.dueIn}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "stock" ? (
            <div className="pos-scroll">
              <table className="pos-table">
                <thead><tr><th>Item</th><th>Unit</th><th>On hand</th><th>Status</th></tr></thead>
                <tbody>
                  {sandbox.inventory.map((item) => (
                    <tr key={item.name}>
                      <td>{item.name}</td>
                      <td>{item.unit}</td>
                      <td>{item.quantity}</td>
                      <td><span className="pos-pill" data-tone={item.status === "Low" ? "warn" : item.status === "Out" ? "danger" : "success"}>{item.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}

          {tab === "suppliers" ? (
            <div className="pos-rows">
              {sandbox.suppliers.map((supplier) => (
                <div className="pos-row" key={supplier.name}>
                  <div className="pos-row-main"><strong>{supplier.name}</strong><small>{supplier.terms}</small></div>
                  <div className="pos-row-values"><span>{supplier.balanceKES}</span></div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "expenses" ? (
            <div className="pos-rows">
              {sandbox.expenses.map((expense, index) => (
                <div className="pos-row" key={`${expense.category}-${index}`}>
                  <div className="pos-row-main"><strong>{expense.category}</strong><small>{expense.at}</small></div>
                  <div className="pos-row-values"><span>{expense.amountKES}</span></div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "staff" ? (
            <div className="pos-rows">
              {sandbox.staff.map((member) => (
                <div className="pos-row" key={member.name}>
                  <div className="pos-row-main"><strong>{member.name}</strong><small>{member.role}</small></div>
                  <div className="pos-row-values"><span>{member.salesKES}</span></div>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "reports" ? (
            <div className="grid gap-2 sm:grid-cols-2">
              {sandbox.reports.map((report) => (
                <div className="pos-summary-group" key={report.key}>
                  <h3>{report.group}</h3>
                  <p className="font-semibold text-sm">{report.label}</p>
                  <p className="pos-note">{report.blurb}</p>
                  <p className="pos-note mt-1">
                    <span className="pos-chip">{report.basis === "recorded" ? "From your records" : report.basis === "calculated" ? "Calculated" : "Estimate"}</span>
                  </p>
                </div>
              ))}
            </div>
          ) : null}

          {tab === "receipt" ? (
            <div className="grid gap-3">
              <p className="pos-note">This is the receipt your customer gets — the wording, the layout and what is shown all come from your setup.</p>
              <pre className="pos-receipt">{sandbox.receiptText}</pre>
            </div>
          ) : null}
        </div>
      </div>

      <div className="pos-form-actions">
        <Link href={`${basePath}/configure`} className="jata-btn jata-btn-ghost">← Change my answers</Link>
        {entitled ? (
          <Link href={basePath} className="jata-btn jata-btn-primary">Go to my POS</Link>
        ) : (
          <Link href={`${basePath}/plan`} className="jata-btn jata-btn-primary">Looks right — choose the plan</Link>
        )}
      </div>
    </div>
  );
}

function groupOrders(orders: PreviewSandbox["orders"]) {
  const columns = new Map<string, PreviewSandbox["orders"]>();
  for (const order of orders) {
    const list = columns.get(order.state) ?? [];
    list.push(order);
    columns.set(order.state, list);
  }
  return [...columns.entries()].map(([state, list]) => ({ state, orders: list }));
}
