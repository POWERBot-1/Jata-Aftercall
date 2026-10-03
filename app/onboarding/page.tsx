import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import { publiclyListedPlans } from "@/lib/pricing";
import OnboardingForm from "@/components/OnboardingForm";
import { PageShell } from "@/components/ui/PageShell";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Set up your business page" };

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  // AFTERCALL plans only — the Business POS is chosen from inside the POS workspace (POS spec §67).
  const plans = publiclyListedPlans(await prisma.planConfig.findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } }));

  return <PageShell
    title="Set up your business page"
    subtitle="Seven short steps. Your answers are saved as you go, so you can go back, refresh, or finish later without losing anything."
    backHref="/dashboard"
    backLabel="Dashboard"
    width="xwide"
  ><OnboardingForm plans={plans.map(({ id, name, priceKES, durationDays }) => ({ id, name, priceKES, durationDays }))} draftScope={session.userId} /></PageShell>;
}
