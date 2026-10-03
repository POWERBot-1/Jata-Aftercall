import Link from "next/link";
import { notFound } from "next/navigation";
import { formatKES, formatDateTime } from "@/lib/format";
import { channelLabel } from "@/lib/pos/receipt";
import { findOrder } from "@/lib/pos/store";
import { nextStates, stateLabel } from "@/lib/pos/workflow";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { MoveOrderPanel } from "@/components/pos/MoveOrderPanel";

/**
 * One order (§28, §29). Everything that has happened to it, and the moves the workflow allows
 * from where it stands now.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ businessId: string; orderId: string }> };

export default async function PosOrderDetailPage({ params }: Props) {
  const { businessId, orderId } = await params;
  const workspace = await loadPosWorkspaceCached(businessId);
  const order = await findOrder(businessId, orderId);
  if (!order) notFound();

  const states = nextStates(order.workflowKey, order.stateKey).map((state) => ({
    key: state.key,
    label: state.label,
    hint: state.hint ?? "",
  }));

  return (
    <div className="space-y-4">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{workspace.terminology.order} {order.reference}</p>
          <h2 className="text-xl font-bold">{stateLabel(order.workflowKey, order.stateKey)}</h2>
          <p className="pos-note">
            {formatDateTime(order.createdAt)} · {channelLabel(order.channel)}
            {order.customerName ? ` · ${order.customerName}` : ""}
            {order.customerPhone ? ` · ${order.customerPhone}` : ""}
            {order.fulfilment ? ` · ${String(order.fulfilment).toLowerCase()}` : ""}
          </p>
        </div>
        <Link href={`${workspace.basePath}/orders`} className="jata-btn jata-btn-ghost">
          ← All {workspace.terminology.orders.toLowerCase()}
        </Link>
      </div>

      <div className="pos-scroll">
        <table className="pos-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
          <tbody>
            {(order.items ?? []).map((item: any) => (
              <tr key={item.id}>
                <td>{item.name}{item.modifiers ? <small className="pos-note"> · {item.modifiers}</small> : null}</td>
                <td>{item.quantity}{item.unitKey ? ` ${item.unitKey}` : ""}</td>
                <td>{formatKES(Number(item.unitPriceKES ?? 0))}</td>
                <td>{formatKES(Number(item.totalKES ?? 0))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="jata-stat-grid">
        <div className="jata-stat"><dt>Total</dt><dd>{formatKES(Number(order.totalKES ?? 0))}</dd></div>
        <div className="jata-stat"><dt>Deposit</dt><dd>{formatKES(Number(order.depositKES ?? 0))}</dd></div>
        <div className="jata-stat">
          <dt>Balance</dt>
          <dd>{formatKES(Math.max(0, Number(order.totalKES ?? 0) - Number(order.depositKES ?? 0)))}</dd>
        </div>
        <div className="jata-stat"><dt>Due</dt><dd>{order.expectedAt ? formatDateTime(order.expectedAt) : "—"}</dd></div>
      </dl>

      {order.address ? (
        <section className="jata-card p-4">
          <p className="jata-kicker">Where to</p>
          <p className="text-sm">{order.address}</p>
        </section>
      ) : null}

      {order.notes ? (
        <section className="jata-card p-4">
          <p className="jata-kicker">Notes</p>
          <p className="text-sm">{order.notes}</p>
        </section>
      ) : null}

      <MoveOrderPanel
        businessId={businessId}
        orderId={order.id}
        word={workspace.terminology.order}
        states={states}
        history={(order.events ?? []).map((entry: any) => ({
          id: entry.id,
          fromState: entry.fromState ?? null,
          toState: entry.toState,
          note: entry.note ?? null,
          createdAt: entry.createdAt,
        }))}
        canManage={workspace.permissions.includes("MANAGE_ORDERS")}
        canCancel={workspace.permissions.includes("CANCEL_ORDER")}
        entitled={workspace.entitlement.entitled}
      />
    </div>
  );
}
