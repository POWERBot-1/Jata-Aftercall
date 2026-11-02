"use client";

/**
 * Renders the REAL AIFrontDeskWorkspace with fictional props. Its `/api/*` requests are answered by the
 * simulated transport in lib/ai/fixtures/aiFrontDeskFixture.ts. Unknown `/api/*` requests fail closed (404).
 * Non-API requests (Next.js navigation, assets) pass through unchanged. Development only (page is 404 in production).
 */
import AIFrontDeskWorkspace from "@/components/ai/AIFrontDeskWorkspace";
import {
  AI_FIXTURE_BUSINESS_ID,
  AI_FIXTURE_NOTICE,
  type AiFixtureOutcome,
  aiFixtureCatalogue,
  aiFixturePlan,
  aiFixtureProfile,
  aiFixturePublication,
  aiFixtureEntitlement,
  aiFixtureReadiness,
  aiFixtureResponses,
  simulateAiFixtureApi,
} from "@/lib/ai/fixtures/aiFrontDeskFixture";

let activeOutcome: AiFixtureOutcome = "success";
let installed = false;

/** Installs the fixture transport once per page. Runs before the workspace's effects so its first requests are simulated. */
function installAiFixtureTransport(outcome: AiFixtureOutcome) {
  activeOutcome = outcome;
  if (installed || typeof window === "undefined") return;
  installed = true;
  const realFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(raw, window.location.href);
    if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/")) return realFetch(input, init);
    const method = (init?.method ?? "GET").toUpperCase();
    let body: Record<string, unknown> = {};
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        body = {};
      }
    }
    const simulated = await simulateAiFixtureApi({ outcome: activeOutcome, method, path: url.pathname, body });
    return (
      simulated ??
      new Response(JSON.stringify({ error: "FICTIONAL FIXTURE: this request is not part of the fixture. Nothing was sent." }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      })
    );
  };
}

export default function AIFrontDeskFixtureClient({ outcome }: { outcome: AiFixtureOutcome }) {
  installAiFixtureTransport(outcome);
  return (
    <div className="grid gap-3">
      <p role="note" className="jata-card p-3 text-sm font-semibold">
        {AI_FIXTURE_NOTICE}
      </p>
      <p className="text-xs" data-fixture-outcome={outcome}>
        Simulated outcome for the next request: <strong>{outcome}</strong>.
      </p>
      <AIFrontDeskWorkspace
        simulated
        businessId={AI_FIXTURE_BUSINESS_ID}
        businessSlug="fixture-salon"
        initialProfile={aiFixtureProfile}
        initialResponses={aiFixtureResponses}
        initialCatalogue={aiFixtureCatalogue}
        initialPublication={aiFixturePublication}
        initialEntitlement={aiFixtureEntitlement}
        initialReadiness={aiFixtureReadiness}
        plan={aiFixturePlan}
      />
    </div>
  );
}
