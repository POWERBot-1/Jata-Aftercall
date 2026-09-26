import { getSession } from "@/lib/auth";
import { redirect } from "next/navigation";
import prisma from "@/lib/db";
import OnboardingForm from "@/components/OnboardingForm";
import { PageShell } from "@/components/ui/PageShell";
import { onboardingRedirectTarget } from "@/lib/ownerFlow";

export const dynamic = "force-dynamic";

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  let owned: number | null = null;
  try {
    owned = await prisma.business.count({ where: { ownerId: session.userId } });
  } catch {
    owned = null;
  }
  if (owned !== null) {
    const dest = onboardingRedirectTarget(owned);
    if (dest) redirect(dest);
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
