import Link from "next/link";
import { notFound } from "next/navigation";
import { PosAccessError } from "@/lib/pos/guard";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { PosNav } from "@/components/pos/PosNav";
import { PosBanner } from "@/components/pos/PosBanner";

/**
 * The POS shell (§23).
 *
 * One authorization per request, shared by every screen inside it. The tenant comes from the
 * session and the URL segment; nothing in this layout trusts a business id from the browser
 * (§5, §75).
 */

export const dynamic = "force-dynamic";

type Props = { children: React.ReactNode; params: Promise<{ businessId: string }> };

async function loadOrExplain(businessId: string) {
  try {
    return { workspace: await loadPosWorkspaceCached(businessId), error: null as PosAccessError | null };
  } catch (error) {
    if (error instanceof PosAccessError) return { workspace: null, error };
    throw error;
  }
}

export default async function PosLayout({ children, params }: Props) {
  const { businessId } = await params;
  const { workspace, error } = await loadOrExplain(businessId);

  // A business that does not exist and one this person may not see get the same answer (§56).
  if (error?.status === 404 || !workspace) {
    if (error?.status === 404) notFound();
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-bold">You can&apos;t open this POS</h1>
        <p className="text-sm text-zinc-600">{error?.message ?? "That business was not found."}</p>
        <Link href="/dashboard/pos" className="jata-btn jata-btn-secondary">Choose another business</Link>
      </div>
    );
  }

  return (
    <div className="pos-shell">
      <header className="pos-header">
        <div>
          <p className="jata-kicker">Business POS</p>
          <h1 className="pos-title">{workspace.business.name}</h1>
          <p className="pos-subtitle">
            {workspace.configuration.business.typeLabel || "Your business"}
            {workspace.configuration.business.otherDescription ? ` · ${workspace.configuration.business.otherDescription}` : ""}
          </p>
        </div>
        <div className="pos-header-side">
          <span className="jata-status" data-tone={workspace.entitlement.entitled ? "success" : "warn"}>{workspace.lifecycleLabel}</span>
          <Link href={`${workspace.basePath}/settings`} className="jata-btn jata-btn-ghost">Settings</Link>
        </div>
      </header>

      <PosNav items={workspace.navigation} basePath={workspace.basePath} />

      <PosBanner
        notice={workspace.notice}
        tone={workspace.noticeTone}
        href={workspace.noticeHref}
        lifecycleLabel={workspace.lifecycleLabel}
        entitlementReason={workspace.entitlement.reason}
        entitled={workspace.entitlement.entitled}
      />

      <div className="pos-body">{children}</div>
    </div>
  );
}
