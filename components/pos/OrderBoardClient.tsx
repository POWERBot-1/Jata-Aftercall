"use client";

import { useState } from "react";
import Link from "next/link";
import { formatKES } from "@/lib/format";
import { channelLabel } from "@/lib/pos/receipt";

/**
 * The order board (§28, §29).
 *
 * Columns are the states this business configured — a restaurant sees New → Preparing → Ready, a
 * laundry sees Dropped off → Washing → Ready for collection. Moving a card asks the server, and
 * the server only accepts moves the workflow defines; the buttons offered are exactly those.
 */

export type BoardOrder = {
  id: string;
  reference: string;
  customerName: string | null;
  channel: string;
  stateKey: string;
  totalKES: number;
  createdAt: string | Date;
  fulfilment: string | null;
  itemCount: number;
};

export type BoardColumn = {
  key: string;
  label: string;
  orders: BoardOrder[];
  next: { key: string; label: string }[];
};

export function OrderBoardClient({
  businessId,
  basePath,
  columns,
  canManage,
  canCancel,
  word,
  plural,
  entitled,
}: {
  businessId: string;
  basePath: string;
  columns: BoardColumn[];
  canManage: boolean;
  canCancel: boolean;
  word: string;
  plural: string;
  entitled: boolean;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function move(orderId: string, toState: string, cancel: boolean) {
    if (cancel && !canCancel) {
      setError("You don't have permission to cancel.");
      return;
    }
    setBusy(orderId);
    setError(null);
    try {
      const response = await fetch(`/api/pos/${encodeURIComponent(businessId)}/orders/${encodeURIComponent(orderId)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ state: toState }),
      });
      const data = await response.json();
      if (!response.ok) setError(data?.error ?? `We couldn't move that ${word.toLowerCase()}.`);
      else window.location.reload();
    } catch {
      setError("We couldn't reach JATA. Check your connection and try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-3">
      {error ? <p className="jata-error" role="alert">{error}</p> : null}
      {!entitled ? <p className="pos-note">Renew the plan to move {plural.toLowerCase()} along.</p> : null}

      <div className="pos-board">
        {columns.map((column) => (
          <div className="pos-column" key={column.key}>
            <div className="pos-column-head">
              <span>{column.label}</span>
              <span className="pos-pill">{column.orders.length}</span>
            </div>

            {column.orders.length === 0 ? <p className="pos-note">Nothing here.</p> : null}

            {column.orders.map((order) => (
              <div className="pos-order-card" key={order.id}>
                <div className="pos-toolbar">
                  <Link href={`${basePath}/orders/${order.id}`}><strong>{order.reference}</strong></Link>
                  <span>{formatKES(order.totalKES)}</span>
                </div>
                <small>
                  {order.customerName ?? "Walk-in"} · {channelLabel(order.channel)} · {order.itemCount} item{order.itemCount === 1 ? "" : "s"}
                  {order.fulfilment ? ` · ${order.fulfilment.toLowerCase()}` : ""}
                </small>
                <small>{new Date(order.createdAt).toLocaleString("en-KE", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })}</small>

                {canManage && column.next.length ? (
                  <div className="pos-form-actions">
                    {column.next.map((state) => {
                      const cancel = state.key.toUpperCase() === "CANCELLED";
                      return (
                        <button
                          type="button"
                          key={state.key}
                          className={cancel ? "jata-btn jata-btn-ghost" : "jata-btn jata-btn-secondary"}
                          disabled={busy === order.id || !entitled || (cancel && !canCancel)}
                          onClick={() => move(order.id, state.key, cancel)}
                        >
                          {busy === order.id ? "…" : state.label}
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
