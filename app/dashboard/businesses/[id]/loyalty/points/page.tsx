import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { loadWorkspace } from "@/lib/experience/workspace";
import { StudioTabs } from "@/components/dashboard/StudioTabs";
import { PointsBoard } from "@/components/business-hub/PointsBoard";
import { loadRequestableCatalogue } from "@/lib/business-hub/catalogue";
import { listCards } from "@/lib/business-hub/loyalty";
import {
  getOrCreateProgramme,
  listAccounts,
  listLedger,
  listRedemptions,
  listRewards,
  pointsStats,
} from "@/lib/business-hub/loyaltyPoints";

export const metadata: Metadata = { title: "Loyalty points" };
export const dynamic = "force-dynamic";

/**
 * Points and rewards (Loyalty 2.0) — the owner's screen.
 *
 * Visiting creates the programme row if it does not exist, the same way the stamp page does, and
 * that row arrives switched off with no earning rate. Nothing here awards a point, and the stamp
 * programme on the sibling page is untouched by this screen.
 */
export default async function LoyaltyPointsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const workspace = await loadWorkspace(id);
  if (!workspace) notFound();

  const [programme, accounts, rewards, ledger, redemptions, stats, catalogue, cards] = await Promise.all([
    getOrCreateProgramme(id),
    listAccounts(id),
    listRewards(id, { includeInactive: true }),
    listLedger(id, { take: 50 }),
    listRedemptions(id, { take: 50 }),
    pointsStats(id),
    loadRequestableCatalogue(id, { take: 200 }),
    listCards(id),
  ]);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <p className="jata-kicker">Business page</p>
        <h1 className="text-xl font-bold">Loyalty points</h1>
        <p className="text-sm text-zinc-600">
          A second way to reward repeat customers, alongside your stamp card. You set the rate, the rewards and the
          rules — nothing is awarded until you record a verified purchase, and the two programmes never mix.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href={`/dashboard/businesses/${id}/loyalty`} className="jata-btn jata-btn-secondary">
            <ArrowLeft size={15} aria-hidden="true" /> Stamp card
          </Link>
          <Link href={`/b/${workspace.business.slug}`} target="_blank" className="jata-btn jata-btn-secondary">
            <ExternalLink size={15} aria-hidden="true" /> View my business page
          </Link>
        </div>
      </header>

      <StudioTabs businessId={id} capabilities={workspace.profile.capabilities} />

      <PointsBoard
        businessId={id}
        programme={programme}
        accounts={accounts}
        rewards={rewards}
        ledger={ledger}
        redemptions={redemptions}
        stats={stats}
        catalogue={catalogue.map((item) => ({ id: item.id, kind: item.kind, name: item.name }))}
        cards={cards.map((card) => ({ id: card.id, customerName: card.customerName, code: card.code }))}
      />
    </div>
  );
}
