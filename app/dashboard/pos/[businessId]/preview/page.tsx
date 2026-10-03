import Link from "next/link";
import { buildPreviewSandbox, previewHeadline } from "@/lib/pos/preview";
import { markPreview } from "@/lib/pos/provisioning";
import { loadPosWorkspaceCached } from "@/lib/pos/workspace";
import { PreviewClient } from "@/components/pos/PreviewClient";

/**
 * Preview (§4 step 5, §23, §42, §44).
 *
 * The owner sees the POS their answers produced, with sample data, before paying. Opening it
 * moves the configuration into the PREVIEW lifecycle state — an explicit, audited step, because
 * a preview is not production and must never be mistaken for one.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Preview your POS" };

type Props = { params: Promise<{ businessId: string }> };

export default async function PosPreviewPage({ params }: Props) {
  const { businessId } = await params;
  const workspace = await loadPosWorkspaceCached(businessId);
  const status = workspace.record?.status ?? "DRAFT";

  // Only mark the transition when it is actually a transition, so the audit log stays readable.
  if (status === "CONFIGURED" || status === "AWAITING_PAYMENT") {
    await markPreview(businessId, workspace.session.userId);
  }

  const sandbox = buildPreviewSandbox(workspace.configuration, workspace.business.name);

  return (
    <div className="space-y-4">
      <div>
        <p className="jata-kicker">Step 4 of 5</p>
        <h2 className="text-xl font-bold">This is your POS</h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          {previewHeadline(workspace.configuration)} Everything below is sample data — nothing is
          saved to your business until you choose the plan and pay.
        </p>
      </div>

      {!workspace.record ? (
        <div className="jata-card p-6">
          <p className="font-semibold">Answer a few questions first</p>
          <p className="mt-1 text-sm text-zinc-600">JATA needs to know how your business works before it can show you your POS.</p>
          <Link href={`${workspace.basePath}/configure`} className="jata-btn jata-btn-primary mt-4">Start the questions</Link>
        </div>
      ) : (
        <PreviewClient sandbox={sandbox} basePath={workspace.basePath} entitled={workspace.entitlement.entitled} />
      )}
    </div>
  );
}
