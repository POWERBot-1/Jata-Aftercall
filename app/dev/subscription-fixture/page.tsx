import { notFound } from "next/navigation";
import type { Metadata } from "next";
import SubscriptionFixtureClient from "@/components/subscription/fixture/SubscriptionFixtureClient";
import { isSubscriptionFixtureOutcome } from "@/lib/subscription/fixtures/subscriptionFixture";

/**
 * Registration and checkout fixture — DEVELOPMENT ONLY. `notFound()` in production. Renders the real forms with
 * fictional data and simulated responses. No payment, charge, subscription, entitlement or account is created.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Registration and checkout fixture (development only)",
  robots: { index: false, follow: false },
};

export default async function SubscriptionFixturePage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const outcome = isSubscriptionFixtureOutcome(params.outcome) ? params.outcome : "success";
  return (
    <div className="mx-auto max-w-xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Registration and checkout — fictional fixture</h1>
      <SubscriptionFixtureClient outcome={outcome} />
    </div>
  );
}
