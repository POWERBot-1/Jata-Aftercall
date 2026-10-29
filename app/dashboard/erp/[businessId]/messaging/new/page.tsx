import Link from "next/link";
import { loadErpWorkspace } from "@/lib/erp/workspace";
import { loadMessagingOverview } from "@/lib/erp/loaders";
import { CampaignComposer } from "@/components/erp/CampaignComposer";
import { Notice, PageHead } from "@/components/erp/ErpBits";
import { createCampaignAction } from "../../actions";

export const dynamic = "force-dynamic";

export default async function NewCampaignPage({ params, searchParams }: { params: Promise<{ businessId: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { businessId } = await params;
  const query = await searchParams;
  const workspace = await loadErpWorkspace(businessId);
  const overview = await loadMessagingOverview(businessId);
  const error = typeof query.error === "string" ? query.error : null;
  const base = workspace.basePath;

  return (
    <>
      <PageHead
        title="New campaign"
        description="Draft first. Check the real audience and cost. Approval and sending are separate, deliberate steps."
        actions={<Link href={`${base}/messaging`} className="erp-btn erp-btn-secondary erp-btn-sm">Back to campaigns</Link>}
      />

      {error ? <Notice tone="danger">{error}</Notice> : null}

      {overview.contacts === 0 ? (
        <Notice tone="warn" action={{ href: `${base}/customers`, label: "Add customers" }}>
          There are no contacts yet. Import a customer list — consent is only recorded when the file states where it came from.
        </Notice>
      ) : null}

      <CampaignComposer
        businessId={businessId}
        action={createCampaignAction}
        templates={overview.templates.map((template: any) => ({ id: template.id, name: template.name, channel: template.channel, category: template.category, body: template.body }))}
        senders={overview.senders.map((sender: any) => ({ id: sender.id, requestedId: sender.requestedId, status: String(sender.status) }))}
        channels={overview.connections.map((connection: any) => ({ channel: String(connection.channel), status: String(connection.status) }))}
        contacts={overview.contacts}
      />
    </>
  );
}
