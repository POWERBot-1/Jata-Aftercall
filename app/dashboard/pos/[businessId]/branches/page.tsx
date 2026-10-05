import Link from "next/link";
import { formatKES } from "@/lib/format";
import { listBranches, salesTotals, stockWithProducts } from "@/lib/pos/store";
import { loadPosPageWorkspace } from "@/lib/pos/workspace";
import { BranchPanel } from "@/components/pos/BranchPanel";
import { PosRefusal } from "@/components/pos/PosRefusal";

/**
 * Locations (§16).
 *
 * Every business has one location from day one, so stock and sales always have a home. More than
 * one is offered only when the configuration switched it on, and each shows its own stock and its
 * own takings — a staff member assigned to one location never sees the others (§75).
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Locations" };

type Props = { params: Promise<{ businessId: string }> };

export default async function PosBranchesPage({ params }: Props) {
  const { businessId } = await params;
  // Locations carry per-branch stock values (§16) — the inventory module's read.
  const gate = await loadPosPageWorkspace(businessId, "VIEW_INVENTORY");
  if (!gate.workspace) return <PosRefusal message={gate.refusal} basePath={gate.basePath} />;
  const workspace = gate.workspace;
  const configuration = workspace.configuration;

  // A bound staff member sees their own location; an unbound actor sees the whole business (§75).
  const [branches, stock, totals] = await Promise.all([
    listBranches(businessId, undefined, { only: workspace.branchId }),
    configuration.inventory.enabled ? stockWithProducts(businessId, undefined, { branchId: workspace.branchId }) : Promise.resolve([]),
    salesTotals(businessId, {}, undefined, { branchId: workspace.branchId }),
  ]);

  const rows = branches as any[];
  const limit = Math.max(1, configuration.branches.count || 1);
  const remaining = Math.max(0, limit - rows.length);

  return (
    <div className="space-y-4">
      <div>
        <p className="jata-kicker">{workspace.terminology.branches}</p>
        <h2 className="text-xl font-bold">{workspace.terminology.branches}</h2>
        <p className="pos-note">
          {configuration.branches.perBranchStock
            ? "Stock is kept per location, and moving it writes two entries that cancel out."
            : "One stock room for the whole business."}
        </p>
      </div>

      {rows.length === 0 ? (
        <div className="pos-empty">
          <strong>No location yet</strong>
          <p>Add the place you trade from, and stock and sales will belong to it.</p>
        </div>
      ) : (
        <div className="pos-rows">
          {rows.map((branch) => {
            const items = (stock as any[]).filter((item) => (item.branchId ?? "") === (branch.id ?? ""));
            const value = items.reduce((total, item) => total + Number(item.quantity ?? 0) * Number(item.product?.costKES ?? 0), 0);
            const count = items.reduce((total, item) => total + Number(item.quantity ?? 0), 0);
            return (
              <div className="pos-row" key={branch.id}>
                <div className="pos-row-main">
                  <strong>{branch.name}{branch.isPrimary ? " · main" : ""}</strong>
                  <small>{[branch.location, branch.phone].filter(Boolean).join(" · ") || "No address yet"}</small>
                </div>
                <div className="pos-row-values">
                  {configuration.inventory.enabled ? <span>{count} units · {formatKES(value)}</span> : null}
                  <span className="pos-pill" data-tone={branch.isActive ? "success" : "neutral"}>{branch.isActive ? "Open" : "Closed"}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <BranchPanel
        businessId={businessId}
        word={workspace.terminology.branch}
        canCreate={workspace.permissions.includes("EDIT_CONFIGURATION")}
        multiLocation={Boolean(configuration.branches.enabled && configuration.inventory.locations)}
        remaining={remaining}
      />

      <section className="jata-card p-4">
        <p className="jata-kicker">Across the business</p>
        <dl className="jata-stat-grid mt-2">
          <div className="jata-stat"><dt>{workspace.terminology.sales}</dt><dd>{totals.count}</dd></div>
          <div className="jata-stat"><dt>Taken</dt><dd>{formatKES(totals.totalKES)}</dd></div>
          <div className="jata-stat"><dt>Still owed</dt><dd>{formatKES(totals.balanceKES)}</dd></div>
          <div className="jata-stat"><dt>{workspace.terminology.branches}</dt><dd>{rows.length}</dd></div>
        </dl>
        <Link href={`${workspace.basePath}/inventory`} className="jata-btn jata-btn-secondary mt-3">Open the stock room</Link>
      </section>
    </div>
  );
}
