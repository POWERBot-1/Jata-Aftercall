import { reportCatalogueFor } from "@/lib/pos/reporting";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { ReportsClient } from "@/components/pos/ReportsClient";

/**
 * Reports (§35).
 *
 * Only the reports this business is configured for are offered. Each one states whether its
 * numbers are recorded facts, calculated from them, or an estimate because an input is missing —
 * a report never guesses (§71: analytical, never predictive).
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Reports" };

type Props = { params: Promise<{ businessId: string }>; searchParams: Promise<{ report?: string }> };

export default async function PosReportsPage({ params, searchParams }: Props) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadPosWorkspaceCached(businessId);

  if (!workspace.permissions.includes("VIEW_REPORTS")) {
    return (
      <div className="jata-card p-6">
        <p className="jata-kicker">Not allowed</p>
        <h2 className="text-lg font-bold">Reports are for the owner and managers</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Ask the owner of {workspace.business.name} if you need to see these numbers.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="jata-kicker">Reports</p>
        <h2 className="text-xl font-bold">What the numbers say</h2>
        <p className="pos-note">
          Everything here comes from what you recorded. Where a figure is calculated or estimated,
          the report says so.
        </p>
      </div>

      <ReportsClient
        businessId={businessId}
        catalogue={reportCatalogueFor(workspace.configuration)}
        canCloseDay={workspace.permissions.includes("CLOSE_DAY")}
        initialReport={query.report ?? null}
      />
    </div>
  );
}
