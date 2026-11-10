import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { QrIdentityPanel } from "@/components/business-hub/QrIdentityPanel";
import { ExternalLink } from "lucide-react";

export const metadata: Metadata = { title: "QR code" };
export const dynamic = "force-dynamic";

/** Business QR identity (Business Hub E) — preview and print. */
export default async function QrIdentityPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Business page</p>
        <h1 className="text-xl font-bold">QR code</h1>
        <p className="text-sm text-zinc-600">
          Print this on a poster, your packaging, receipts or the counter. Scanning it opens your Business Page directly.
        </p>
        <Link href={`/b/${workspace.business.slug}`} target="_blank" className="jata-btn jata-btn-secondary">
          <ExternalLink size={15} aria-hidden="true" /> View my business page
        </Link>
      </header>

      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />

      <QrIdentityPanel businessId={id} slug={workspace.business.slug} businessName={workspace.business.name} />
    </div>
  );
}
