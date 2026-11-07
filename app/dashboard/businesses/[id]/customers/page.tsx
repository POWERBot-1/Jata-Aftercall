import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { loadCustomerHub } from "@/lib/business-hub/customerHub";
import { CustomerHubBoard, type HubActivity, type HubEnquiry, type HubOrderRequest } from "@/components/business-hub/CustomerHubBoard";
import { ExternalLink } from "lucide-react";

export const metadata: Metadata = { title: "Customers" };
export const dynamic = "force-dynamic";

/**
 * Smart Customer Hub (Business Hub B).
 *
 * Unlike the Website Studio screens this does NOT require an Interactive Business experience:
 * the hub serves the KES149/KES999 Business Page, so every business gets it.
 */
export default async function CustomerHubPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  // Tenant-scoped: loadWorkspace verified ownership, and every hub read filters on `businessId`.
  const hub = await loadCustomerHub(id);

  const requests: HubOrderRequest[] = hub.orderRequests.map((entry: any) => ({
    id: entry.id,
    reference: entry.reference,
    customerName: entry.customerName,
    contactMethod: String(entry.contactMethod),
    contactValue: String(entry.contactValue),
    message: entry.message ?? null,
    status: String(entry.status),
    estimatedTotalKES: Number(entry.estimatedTotalKES ?? 0),
    ownerNotes: entry.ownerNotes ?? null,
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.updatedAt).toISOString(),
    items: (entry.items ?? []).map((item: any) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unitPriceKES: item.unitPriceKES,
      lineTotalKES: item.lineTotalKES,
    })),
  }));

  const enquiries: HubEnquiry[] = hub.enquiries.map((entry: any) => ({
    id: entry.id,
    reference: entry.reference,
    customerName: entry.customerName,
    contactMethod: String(entry.contactMethod),
    contactValue: String(entry.contactValue),
    subject: entry.subject ?? null,
    message: String(entry.message ?? ""),
    status: String(entry.status),
    ownerNotes: entry.ownerNotes ?? null,
    createdAt: new Date(entry.createdAt).toISOString(),
    updatedAt: new Date(entry.updatedAt).toISOString(),
  }));

  const activity: HubActivity[] = hub.activity.map((entry: any) => ({
    id: entry.id,
    subjectType: String(entry.subjectType),
    kind: String(entry.kind),
    summary: String(entry.summary),
    note: entry.note ?? null,
    actorLabel: entry.actorLabel ?? null,
    createdAt: new Date(entry.createdAt).toISOString(),
  }));

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Business page</p>
        <h1 className="text-xl font-bold">Customers</h1>
        <p className="text-sm text-zinc-600">
          Every order request and enquiry from your page, in one place. Update a status, add a private note, or reply by
          WhatsApp or phone — no separate CRM needed.
        </p>
        <Link href={`/b/${workspace.business.slug}`} target="_blank" className="jata-btn jata-btn-secondary">
          <ExternalLink size={15} aria-hidden="true" /> View my business page
        </Link>
      </header>

      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />

      <CustomerHubBoard
        businessId={id}
        requests={requests}
        enquiries={enquiries}
        activity={activity}
        stats={hub.stats}
        loyaltySummary={hub.loyalty.stats}
      />
    </div>
  );
}
