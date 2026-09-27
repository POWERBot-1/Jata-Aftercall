import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import OnboardingForm from "@/components/OnboardingForm";
import { PageShell } from "@/components/ui/PageShell";
import { resolveOnboardingRedirect } from "@/lib/subscriptionFlow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  try {
    const businesses = await prisma.business.findMany({
      where: { ownerId: session.userId },
      include: { subscription: true },
    });
    const owned = businesses.length;
    if (owned > 0) {
      const dest = resolveOnboardingRedirect({
        ownedBusinessCount: owned,
        businesses: businesses.map((b) => ({
          id: b.id,
          hasActiveSubscription: b.subscription?.status === "ACTIVE",
        })),
      });
      if (dest) redirect(dest);
    }
  } catch {
    // fallback to simple count if DB unavailable
    try {
      const owned = await prisma.business.count({ where: { ownerId: session.userId } });
      if (owned > 0) {
        // if we cannot determine subscription, go to dashboard (not loop)
        redirect("/dashboard");
      }
    } catch {
      // ignore
    }
  }

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
