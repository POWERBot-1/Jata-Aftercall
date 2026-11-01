import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PosFixtureTill } from "@/components/pos/PosFixtureTill";
import { isFixtureOutcome } from "@/lib/pos/fixtures/tillFixture";

/**
 * Development-only POS fixture harness. Renders the real till with FICTIONAL data and a simulated
 * sale transport. `notFound()` in production: it is never reachable by customers or owners, and it
 * cannot read or write any business data.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "POS fixture (development only)",
  robots: { index: false, follow: false },
};

export default async function PosFixturePage({ searchParams }: { searchParams: Promise<{ outcome?: string; motion?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const requested = params.outcome;
  const motion = params.motion === "lite" ? "lite" : "auto";
  const outcome = isFixtureOutcome(requested) ? requested : "success";
  return (
    <main id="main" className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-xl font-bold">POS till — fictional fixture</h1>
      <PosFixtureTill outcome={outcome} motion={motion} />
    </main>
  );
}
