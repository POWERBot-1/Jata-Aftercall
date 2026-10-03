import Link from "next/link";
import { emptyStateFor } from "@/lib/pos/presentation";
import { listCustomers, listOrders, listProducts } from "@/lib/pos/store";
import { nextStates } from "@/lib/pos/workflow";
import { resolveStates } from "@/lib/pos/workflow";
import { sanitizeRange } from "@/lib/pos/validation";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { OrderBoardClient } from "@/components/pos/OrderBoardClient";
import { NewOrderPanel } from "@/components/pos/NewOrderPanel";
import type { PosModuleKey } from "@/lib/pos/types";

/**
 * The order board (§28, §29).
 *
 * One screen serves Orders, Appointments, Jobs and Projects: the module decides the words and
 * which workflow's cards are shown, and the columns are the states that workflow defines. The
 * buttons on a card are exactly the moves the state machine allows from that state.
 */

export async function OrderScreen({
  businessId,
  module = "orders",
  workflowKey,
  openNew = false,
  stateFilter,
}: {
  businessId: string;
  module?: PosModuleKey;
  /** Restrict the board to one configured workflow (appointments, jobs, projects). */
  workflowKey?: string;
  openNew?: boolean;
  stateFilter?: string;
}) {
  const workspace = await loadPosWorkspaceCached(businessId);
  const configuration = workspace.configuration;
  const activeWorkflow = workflowKey ?? configuration.orders.workflowKey;
  const range = sanitizeRange({}, 30);

  const [orders, products, customers] = await Promise.all([
    listOrders(businessId, { range: { from: range.from, to: range.to }, workflowKey: workflowKey, take: 150 }),
    listProducts(businessId, { take: 300 }),
    configuration.customers.enabled ? listCustomers(businessId, { take: 200 }) : Promise.resolve([]),
  ]);

  const rows = orders as any[];
  const states = resolveStates({ orders: { ...configuration.orders, workflowKey: activeWorkflow } });
  const columns = states
    .filter((state) => !stateFilter || state.key === stateFilter)
    .map((state) => ({
      key: state.key,
      label: state.label,
      orders: rows
        .filter((order) => order.stateKey === state.key)
        .map((order) => ({
          id: order.id,
          reference: order.reference,
          customerName: order.customerName ?? null,
          channel: order.channel,
          stateKey: order.stateKey,
          totalKES: Number(order.totalKES ?? 0),
          createdAt: order.createdAt,
          fulfilment: order.fulfilment ?? null,
          itemCount: (order.items ?? []).length,
        })),
      next: nextStates(activeWorkflow, state.key).map((next) => ({ key: next.key, label: next.label })),
    }));

  const empty = emptyStateFor(configuration, module, workspace.basePath);
  const href = `${workspace.basePath}/${module}?new=1`;
  const plural = module === "appointments" ? "Appointments" : module === "jobs" ? "Jobs" : module === "projects" ? "Projects" : workspace.terminology.orders;
  const singular = module === "appointments" ? "appointment" : module === "jobs" ? "job" : module === "projects" ? "project" : workspace.terminology.order.toLowerCase();

  return (
    <div className="space-y-3">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{plural}</p>
          <h2 className="text-xl font-bold">{plural}</h2>
          <p className="pos-note">
            {rows.length} in the last 30 days · {columns.reduce((total, column) => total + column.orders.length, 0)} on the board
          </p>
        </div>
        <Link href={href} className="jata-btn jata-btn-primary">+ New {singular}</Link>
      </div>

      {openNew ? (
        <NewOrderPanel
          businessId={businessId}
          basePath={workspace.basePath}
          word={singular.charAt(0).toUpperCase() + singular.slice(1)}
          channels={configuration.orders.channels}
          deliveryEnabled={configuration.delivery.enabled}
          pickupEnabled={configuration.delivery.pickup}
          deposits={configuration.sales.deposits}
          dueDates={activeWorkflow !== "restaurant"}
          products={(products as any[]).map((product) => ({
            id: product.id,
            name: product.name,
            priceKES: Number(product.priceKES ?? 0),
            unitKey: product.unitKey ?? "piece",
          }))}
          customers={(customers as any[]).map((customer) => ({ id: customer.id, name: customer.name, phone: customer.phone ?? null }))}
          modifiers={configuration.industry.modules.includes("modifiers")}
        />
      ) : null}

      {rows.length === 0 && !openNew ? (
        <div className="pos-empty">
          <strong>{empty.title}</strong>
          <p>{empty.body}</p>
          <Link href={href} className="jata-btn jata-btn-primary">{empty.action.label}</Link>
        </div>
      ) : (
        <OrderBoardClient
          businessId={businessId}
          basePath={workspace.basePath}
          columns={columns}
          canManage={workspace.permissions.includes("MANAGE_ORDERS")}
          canCancel={workspace.permissions.includes("CANCEL_ORDER")}
          word={singular.charAt(0).toUpperCase() + singular.slice(1)}
          plural={plural}
          entitled={workspace.entitlement.entitled}
        />
      )}
    </div>
  );
}
