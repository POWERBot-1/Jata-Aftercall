import { notFound } from "next/navigation";
import type { Metadata } from "next";
import AIFrontDeskFixtureClient from "@/components/ai/fixture/AIFrontDeskFixtureClient";
import { isAiFixtureOutcome } from "@/lib/ai/fixtures/aiFrontDeskFixture";

/**
 * AI Business Front Desk fixture — DEVELOPMENT ONLY. `notFound()` in production. Renders the real workspace with
 * fictional data and a simulated transport. Replies are simulated and labelled; nothing is saved, sent or published.
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "AI Front Desk fixture (development only)",
  robots: { index: false, follow: false },
};

export default async function AiFrontDeskFixturePage({ searchParams }: { searchParams: Promise<{ outcome?: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const params = await searchParams;
  const outcome = isAiFixtureOutcome(params.outcome) ? params.outcome : "success";
  return (
    <main id="main" className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-xl font-bold">AI Business Front Desk — fictional fixture</h1>
      <AIFrontDeskFixtureClient outcome={outcome} />
    </main>
  );
}
