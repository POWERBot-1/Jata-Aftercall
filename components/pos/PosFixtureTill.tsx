"use client";

/**
 * Development-only harness wrapper. Renders the REAL `TillClient` with fictional fixture props and
 * a simulated sale transport. It never calls the sales endpoint and never stores anything.
 * Imported only by app/dev/pos-fixture (404 in production).
 */
import { TillClient } from "@/components/pos/TillClient";
import {
  FIXTURE_BASE_PATH,
  FIXTURE_BUSINESS_ID,
  FIXTURE_NOTICE,
  fixtureCustomers,
  fixtureFlags,
  fixtureMethods,
  fixtureProducts,
  fixtureSimulatedResponse,
  fixtureWords,
  type FixtureOutcome,
} from "@/lib/pos/fixtures/tillFixture";

export function PosFixtureTill({ outcome }: { outcome: FixtureOutcome }) {
  return (
    <section aria-label="Fictional POS fixture" className="space-y-3">
      <p role="note" className="rounded-xl border border-dashed border-[color:var(--jata-line)] px-3 py-2 text-sm font-semibold">
        {FIXTURE_NOTICE} Simulated outcome for the next completion: <strong data-fixture-outcome={outcome}>{outcome}</strong>.
      </p>
      <TillClient
        businessId={FIXTURE_BUSINESS_ID}
        basePath={FIXTURE_BASE_PATH}
        products={fixtureProducts}
        customers={fixtureCustomers}
        methods={fixtureMethods}
        words={fixtureWords}
        flags={fixtureFlags}
        entitled
        entitlementReason="fixture"
        nextReceiptNumber="FIXTURE-0001"
        wallet={{ destinations: [] }}
        submitSaleRequest={async (_businessId, body) => fixtureSimulatedResponse(outcome, body)}
      />
    </section>
  );
}

export default PosFixtureTill;
