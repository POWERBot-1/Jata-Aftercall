import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { StudioFixtureClient } from "@/components/studio/fixture/StudioFixtureClient";
import { isFixtureOutcome, isFixtureState } from "@/lib/studio/fixtures/studioFixture";

/**
 * Website Studio fixture harness — DEVELOPMENT ONLY. `notFound()` in production. It renders the real Studio
 * components with fictional data and simulated writes. It never reads or writes a business, uploads an image,
 * or publishes a website.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Website Studio fixture (development only)",
  robots: { index: false, follow: false },
};

export default async function StudioFixturePage({ searchParams }: { searchParams: Promise<{ state?: string; outcome?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const state = isFixtureState(params.state) ? params.state : "dashboard";
  const outcome = isFixtureOutcome(params.outcome) ? params.outcome : "success";
  return (
    <main id="main" className="jc-page mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-xl font-bold">Website Studio — fictional fixture</h1>
      <StudioFixtureClient state={state} outcome={outcome} />
    </main>
  );
}
