import { redirect } from "next/navigation";
import type { Metadata } from "next";
import Link from "next/link";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import AIDashboardClient from "@/components/AIDashboardClient";
import { WorkspaceHero } from "@/components/workspace/WorkspaceUI";
import { WORKSPACE_HERO_PHOTO } from "@/lib/workspaceImagery";
import { Bot, ExternalLink, Settings2 } from "lucide-react";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "AI Business Front Desk Dashboard — JATA Aftercall",
  description: "Manage AI conversations, orders, pre-orders, unanswered questions, demand intelligence, readiness, and live status.",
};

/**
 * The AI Front Desk screen.
 *
 * Two parts, one page: a workspace hero (so this screen belongs to the same product as the
 * dashboard, studio and POS) and the dark AI cockpit, which owns its own header, tabs and
 * conversation data. The cockpit stays dark on purpose — it is the one place the product
 * looks like a console — but it is no longer a separate full-screen shell with a second
 * navigation bar.
 */
export default async function AIDashboardPage({
  searchParams,
}: {
  searchParams?: Promise<{ businessId?: string }>;
}) {
  const sp = searchParams ? await searchParams : undefined;
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    redirect("/login?callbackUrl=/dashboard/ai");
  }

  const business = await prisma.business
    .findFirst({
      where: sp?.businessId
        ? { id: sp.businessId, ...(user.role === "ADMIN" ? {} : { ownerId: user.id }) }
        : { ownerId: user.id },
      select: { id: true, name: true, slug: true },
    })
    .catch(() => null);

  const businessSlug = business?.slug || "my-business";

  return (
    <div className="ws-stack">
      <WorkspaceHero
        compact
        kicker="AI Front Desk"
        title={
          <>
            Answers your customers can <em>trust</em>.
          </>
        }
        subtitle="Your front desk answers from your own services, prices, offer and opening hours — and shows you the questions it could not answer, so you can fix the page instead of guessing."
        photo={WORKSPACE_HERO_PHOTO}
        actions={
          <>
            <Link href={`/b/${businessSlug}/ai`} className="ws-btn-amber" target="_blank" rel="noopener noreferrer">
              <ExternalLink size={16} aria-hidden="true" /> Open customer view
            </Link>
            <Link href={`/onboarding/ai?businessId=${business?.id || ""}`} className="ws-btn-outline">
              <Settings2 size={16} aria-hidden="true" /> Configure AI
            </Link>
            <Link href="/dashboard" className="ws-btn-quiet">
              <Bot size={16} aria-hidden="true" /> Back to overview
            </Link>
          </>
        }
        meta={`${business?.name || "Your business"} · /b/${businessSlug}/ai · answers are grounded in your business data, never invented`}
      />
      <AIDashboardClient
        businessId={business?.id || sp?.businessId || ""}
        businessName={business?.name || "Your Business"}
        businessSlug={businessSlug}
        userEmail={user.email}
        isAdmin={user.role === "ADMIN"}
      />
    </div>
  );
}
