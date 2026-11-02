import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { simulatedResultCopy } from "@/lib/subscription/fixtures/subscriptionFixture";

/**
 * SIMULATED payment result page — DEVELOPMENT ONLY. Stands in for the Paystack return page in the fixture so no
 * payment provider is contacted. Never verifies, collects or activates anything. `notFound()` in production.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Simulated payment result (development only)",
  robots: { index: false, follow: false },
};

export default async function SimulatedPaymentResultPage({ searchParams }: { searchParams: Promise<{ outcome?: string; ref?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const copy = simulatedResultCopy(params.outcome);
  return (
    <main id="main" className="mx-auto max-w-md space-y-4 p-4">
      <p role="note" className="jata-card p-3 text-sm font-semibold">FICTIONAL FIXTURE — simulated, not a payment provider page.</p>
      <h1 className="text-xl font-bold">{copy.title}</h1>
      <p className="text-sm">{copy.body}</p>
      <p className="text-xs" data-fixture-ref>Fixture reference: {params.ref ?? "none"}</p>
      <a className="jata-btn jata-btn-ghost" href="/dev/subscription-fixture">Back to the fixture</a>
    </main>
  );
}
