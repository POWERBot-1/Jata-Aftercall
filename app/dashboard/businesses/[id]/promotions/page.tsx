import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { PromotionBoard } from "@/components/business-hub/PromotionBoard";
import { listPromotions } from "@/lib/business-hub/promotions";
import { ExternalLink } from "lucide-react";

export const metadata: Metadata = { title: "Promotions" };
export const dynamic = "force-dynamic";

/** Promotional Spotlight management (Business Hub C). Times are Africa/Nairobi. */
export default async function PromotionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  const promotions = await listPromotions(id);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Business page</p>
        <h1 className="text-xl font-bold">Promotions</h1>
        <p className="text-sm text-zinc-600">
          Highlight offers, new products and announcements on your page. A promotion stops showing the moment its end
          time passes — expired offers never appear as active.
        </p>
        <Link href={`/b/${workspace.business.slug}`} target="_blank" className="jata-btn jata-btn-secondary">
          <ExternalLink size={15} aria-hidden="true" /> View my business page
        </Link>
      </header>

      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />

      <PromotionBoard businessId={id} promotions={promotions} />
    </div>
  );
}
