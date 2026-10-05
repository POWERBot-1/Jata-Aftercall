import { emptyStateFor } from "@/lib/pos/presentation";
import { formSpec } from "@/lib/pos/forms";
import { listSuppliers } from "@/lib/pos/store";
import { loadPosPageWorkspace } from "@/lib/pos/workspace";
import { PosRefusal } from "@/components/pos/PosRefusal";
import { RecordBoard } from "@/components/pos/RecordBoard";

/** Suppliers (§12, §30). What you owe them is kept in a separate ledger from what customers owe you. */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string }> };

export default async function PosSuppliersPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  // Suppliers are the suppliers module's read (§17).
  const gate = await loadPosPageWorkspace(businessId, "VIEW_SUPPLIERS");
  if (!gate.workspace) return <PosRefusal message={gate.refusal} basePath={gate.basePath} />;
  const workspace = gate.workspace;
  const configuration = workspace.configuration;
  const spec = formSpec(configuration, "supplier");
  const suppliers = await listSuppliers(businessId, { take: 300 });

  return (
    <div className="space-y-3">
      <div>
        <p className="jata-kicker">{spec.plural}</p>
        <h2 className="text-xl font-bold">{spec.plural}</h2>
        <p className="pos-note">
          {configuration.suppliers.credit
            ? `Who you buy from, and what you owe them (usually ${configuration.suppliers.termsDays} days).`
            : "Who you buy from."}
        </p>
      </div>

      <RecordBoard
        businessId={businessId}
        basePath={workspace.basePath}
        apiPath={`/api/pos/${encodeURIComponent(businessId)}/suppliers`}
        word={spec.word}
        plural={spec.plural}
        fields={spec.fields}
        rows={suppliers as any[]}
        titleKey="name"
        subtitleKeys={["phone", "location"]}
        valueColumns={configuration.suppliers.credit ? [{ key: "balanceKES", money: true }, { key: "termsDays", suffix: "days" }] : []}
        canEdit={workspace.permissions.includes("MANAGE_SUPPLIERS")}
        openNew={query.new === "1"}
        emptyState={emptyStateFor(configuration, "suppliers", workspace.basePath)}
      />
    </div>
  );
}
