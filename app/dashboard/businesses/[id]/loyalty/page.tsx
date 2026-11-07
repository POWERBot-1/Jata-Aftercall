import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { LoyaltyBoard } from "@/components/business-hub/LoyaltyBoard";
import { getOrCreateProgram, listCards, loyaltyStats } from "@/lib/business-hub/loyalty";
import { ExternalLink } from "lucide-react";

export const metadata: Metadata = { title: "Loyalty" };
export const dynamic = "force-dynamic";

/**
 * Loyalty management (Business Hub D).
 *
 * Visiting this screen creates the programme row if it does not exist yet (an idempotent upsert on
 * the owner's own business). It never touches a card, a stamp or a subscription.
 */
export default async function LoyaltyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  const [program, cards, stats] = await Promise.all([
    getOrCreateProgram(id),
    listCards(id),
    loyaltyStats(id),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Business page</p>
        <h1 className="text-xl font-bold">Loyalty</h1>
        <p className="text-sm text-zinc-600">
          Reward repeat customers with a digital stamp card. You verify each qualifying purchase and award the stamp —
          one transaction can only ever be stamped once.
        </p>
        <Link href={`/b/${workspace.business.slug}`} target="_blank" className="jata-btn jata-btn-secondary">
          <ExternalLink size={15} aria-hidden="true" /> View my business page
        </Link>
      </header>

      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />

      <LoyaltyBoard businessId={id} program={program} cards={cards} stats={stats} />
    </div>
  );
}
