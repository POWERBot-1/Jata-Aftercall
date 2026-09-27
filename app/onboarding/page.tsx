import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import OnboardingForm from "@/components/OnboardingForm";
import { PageShell } from "@/components/ui/PageShell";
import { resolveOnboardingDestination, type OnboardingBusinessSource } from "@/lib/subscriptionFlow";

export const dynamic = "force-dynamic";

type OwnedBusinessRow = { id: string; subscription: { status: string } | null };

// Prisma-backed reads for the redirect decision. Failures are handled inside
// resolveOnboardingDestination (falls back to a count, then to staying on onboarding).
const ownedBusinessSource: OnboardingBusinessSource = {
  async listOwnedBusinesses(userId) {
    const businesses: OwnedBusinessRow[] = await prisma.business.findMany({
      where: { ownerId: userId },
      include: { subscription: true },
    });
    return businesses.map((b) => ({ id: b.id, hasActiveSubscription: b.subscription?.status === "ACTIVE" }));
  },
  countOwnedBusinesses(userId) {
    return prisma.business.count({ where: { ownerId: userId } });
  },
};

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  // redirect() throws a NEXT_REDIRECT signal — it must stay outside any try/catch,
  // otherwise the signal is swallowed and the form renders for an owner who already has a business.
  const destination = await resolveOnboardingDestination(session.userId, ownedBusinessSource);
  if (destination) redirect(destination);

  return (
    <PageShell
      title="Set up your business page"
      subtitle="Three steps: business, services and offer, then publish. Payment is not required."
      backHref="/dashboard"
      backLabel="Dashboard"
      width="wide"
    >
      <OnboardingForm />
    </PageShell>
  );
}
