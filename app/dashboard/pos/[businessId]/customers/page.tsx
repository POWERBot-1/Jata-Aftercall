import { emptyStateFor } from "@/lib/pos/presentation";
import { formSpec } from "@/lib/pos/forms";
import { listCustomers } from "@/lib/pos/store";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { RecordBoard } from "@/components/pos/RecordBoard";

/**
 * Customers (§14, §46). Called guests, clients, patients or vehicle owners depending on the
 * business — the record underneath is identical, which is why one screen serves every trade.
 */

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ new?: string; credit?: string }> };

export default async function PosCustomersPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadPosWorkspaceCached(businessId);
  const configuration = workspace.configuration;
  const spec = formSpec(configuration, "customer");

  const customers = await listCustomers(businessId, { take: 400, creditOnly: query.credit === "1" });

  return (
    <div className="space-y-3">
      <div className="pos-toolbar">
        <div>
          <p className="jata-kicker">{spec.plural}</p>
          <h2 className="text-xl font-bold">{spec.plural}</h2>
          <p className="pos-note">
            {configuration.credit.enabled
              ? "Who buys from you, what they owe, and how often they come back."
              : "Who buys from you, and how often they come back."}
          </p>
        </div>
      </div>

      <RecordBoard
        businessId={businessId}
        basePath={workspace.basePath}
        apiPath={`/api/pos/${encodeURIComponent(businessId)}/customers`}
        detailPath="customers"
        word={spec.word}
        plural={spec.plural}
        fields={spec.fields}
        rows={customers as any[]}
        titleKey="name"
        subtitleKeys={["phone", "customerNumber", "segment"]}
        valueColumns={configuration.credit.enabled ? [{ key: "balanceKES", money: true }] : []}
        canEdit={workspace.permissions.includes("MANAGE_CUSTOMERS")}
        openNew={query.new === "1"}
        emptyState={emptyStateFor(configuration, "customers", workspace.basePath)}
      />
    </div>
  );
}
