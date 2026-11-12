import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { loadWorkspace } from "@/lib/experience/workspace";
import { usesServiceEnquiries } from "@/lib/experience/enquiries";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { EnquiryBoard } from "@/components/dashboard/EnquiryBoard";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace || !usesServiceEnquiries(workspace.profile.key)) notFound();
  return { title: "Professional enquiries" };
}

/** Owner-only request ledger. Receiving an enquiry never confirms an appointment or payment. */
export default async function BusinessEnquiriesPage({ params }: Props) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace || !usesServiceEnquiries(workspace.profile.key)) notFound();

  return (
    <div className="space-y-4">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-[color:var(--ws-text)]">Enquiries</h1>
        <p className="text-sm text-[color:var(--ws-muted)]">
          Customer requests for a reply only. No appointment or payment is confirmed, and customers are not added to marketing lists.
        </p>
      </header>
      <StudioTabs businessId={workspace.business.id} capabilities={workspace.profile.capabilities} showEnquiries />
      <EnquiryBoard businessId={workspace.business.id} />
    </div>
  );
}
