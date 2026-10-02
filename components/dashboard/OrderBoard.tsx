"use client";

/**
 * Order board (§28)
 *
 * Every order moves through an explicit state machine, and payment state is shown alongside
 * fulfilment state so an unpaid order is never mistaken for a completed sale (§27).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ORDER_STAGES, STAGE_LABELS, isValidStageTransition, type OrderStage } from "@/lib/experience/orders";
import { formatDateTime, formatKES, maskPhone } from "@/lib/format";

type OrderItem = { id: string; name: string; quantity: number; unitPriceKES: number; variantDesc: string | null };
export type BoardOrder = {
  id: string;
  orderReference: string;
  customerName: string | null;
  customerPhone: string | null;
  status: string;
  stage: string;
  paymentStatus: string;
  subtotalKES: number;
  deliveryFeeKES: number;
  discountKES: number;
  totalKES: number;
  fulfilmentType: string | null;
  deliveryLocation: string | null;
  deliveryInstructions: string | null;
  notes: string | null;
  createdAt: string;
  items: OrderItem[];
};

export function OrderBoard({
  orders: initial,
  stages,
}: {
  orders: BoardOrder[];
  stages: string[];
}) {
  const router = useRouter();
  const [orders, setOrders] = useState<BoardOrder[]>(initial);
  const [filter, setFilter] = useState("ALL");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = filter === "ALL" ? orders : orders.filter((order) => order.stage === filter);
  const newCount = orders.filter((order) => order.stage === "NEW").length;

  async function move(order: BoardOrder, stage: OrderStage) {
    setBusyId(order.id);
    setError(null);
    try {
      const response = await fetch("/api/orders", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId: order.id, stage }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || "We couldn’t update that order.");
        return;
      }
      setOrders((current) => current.map((entry) => (entry.id === order.id ? { ...entry, stage: data.order.stage, status: data.order.status } : entry)));
      router.refresh();
    } catch {
      setError("We couldn’t reach the server. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="jata-toolbar">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Filter orders">
          {["ALL", ...stages].map((stage) => (
            <button
              key={stage}
              type="button"
              className={`jata-btn ${filter === stage ? "jata-btn-primary" : "jata-btn-secondary"}`}
              aria-pressed={filter === stage}
              onClick={() => setFilter(stage)}
            >
              {stage === "ALL" ? "All" : STAGE_LABELS[stage as OrderStage] || stage}
              {stage === "NEW" && newCount ? ` (${newCount})` : ""}
            </button>
          ))}
        </div>
        <p className="text-sm text-zinc-600">{orders.length} orders</p>
      </div>

      {error ? <p className="jata-error text-sm" role="alert">{error}</p> : null}

      {visible.length === 0 ? (
        <div className="jata-empty">
          <p className="text-sm font-semibold">No orders here yet</p>
          <p className="mt-1 text-sm text-zinc-600">
            Orders appear the moment a customer pays. Share your link to start receiving them.
          </p>
        </div>
      ) : (
        <ul className="space-y-3">
          {visible.map((order) => (
            <li key={order.id} className="jata-card">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-bold">{order.orderReference}</p>
                  <p className="text-sm text-zinc-600">
                    {order.customerName || "Customer"} · {maskPhone(order.customerPhone)}
                  </p>
                  <p className="text-xs text-zinc-500">{formatDateTime(order.createdAt)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-bold">{formatKES(order.totalKES)}</p>
                  <p className={`text-xs font-semibold ${order.paymentStatus === "PAID" ? "text-emerald-700" : "text-amber-700"}`}>
                    {order.paymentStatus === "PAID" ? "Paid" : "Unpaid"}
                  </p>
                  <p className="text-xs text-zinc-500">{STAGE_LABELS[order.stage as OrderStage] || order.stage}</p>
                </div>
              </div>

              <ul className="mt-3 space-y-1 text-sm">
                {order.items.map((item) => (
                  <li key={item.id} className="flex justify-between gap-2">
                    <span>
                      {item.quantity} × {item.name}
                      {item.variantDesc ? <span className="text-zinc-500"> · {item.variantDesc}</span> : null}
                    </span>
                    <span>{formatKES(item.unitPriceKES * item.quantity)}</span>
                  </li>
                ))}
              </ul>

              <dl className="mt-3 grid gap-1 text-sm sm:grid-cols-3">
                <div><dt className="inline text-zinc-500">Subtotal: </dt><dd className="inline">{formatKES(order.subtotalKES)}</dd></div>
                <div><dt className="inline text-zinc-500">Delivery: </dt><dd className="inline">{formatKES(order.deliveryFeeKES)}</dd></div>
                <div><dt className="inline text-zinc-500">Discount: </dt><dd className="inline">{formatKES(order.discountKES)}</dd></div>
              </dl>

              {order.fulfilmentType ? (
                <p className="mt-2 text-sm">
                  <span className="font-semibold">{order.fulfilmentType === "DELIVERY" ? "Delivery" : "Pickup"}</span>
                  {order.deliveryLocation ? ` · ${order.deliveryLocation}` : ""}
                </p>
              ) : null}
              {order.deliveryInstructions ? <p className="text-sm text-zinc-600">{order.deliveryInstructions}</p> : null}
              {order.notes ? <p className="text-sm text-zinc-600">Customer note: {order.notes}</p> : null}

              <div className="mt-3 flex flex-wrap gap-2">
                {stages
                  .filter((stage) => stage !== order.stage && isValidStageTransition(order.stage, stage))
                  .map((stage) => (
                    <button
                      key={stage}
                      type="button"
                      className="jata-btn jata-btn-secondary"
                      disabled={busyId === order.id}
                      onClick={() => move(order, stage as OrderStage)}
                    >
                      Mark {STAGE_LABELS[stage as OrderStage] || stage}
                    </button>
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <p className="jata-hint">
        Only a valid next step is offered, so an order can never skip or reverse a stage by accident.
      </p>
    </div>
  );
}
