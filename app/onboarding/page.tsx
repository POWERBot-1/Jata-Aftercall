import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import OnboardingForm from "@/components/OnboardingForm";
import { PageShell } from "@/components/ui/PageShell";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");
  const plans = await prisma.planConfig.findMany({ where: { isActive: true }, orderBy: { priceKES: "asc" } });

  return <PageShell
    title="Set up your business page"
    subtitle="Add your details and location, save your business, then choose a subscription plan or publish without payment."
    backHref="/dashboard"
    backLabel="Dashboard"
    width="wide"
  ><OnboardingForm plans={plans.map(({ id, name, priceKES, durationDays }) => ({ id, name, priceKES, durationDays }))} /></PageShell>;
}
