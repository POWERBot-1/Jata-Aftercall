import { notFound } from "next/navigation";
import { AutopilotFixtureClient } from "@/components/autopilot/fixture/AutopilotFixtureClient";
import { createFixtureSession } from "@/lib/autopilot/fixtures/autopilotFixtureSessions";
import { buildFixtureOverview } from "@/lib/autopilot/fixtures/autopilotFixtureModel";
import {
  FIXTURE_ROLES,
  FIXTURE_SCENARIO_IDS,
  type FixtureRole,
  type FixtureScenarioId,
} from "@/lib/autopilot/fixtures/autopilotFixtureModel";

/**
 * FICTIONAL Autopilot fixture page (development and test only).
 * Renders the REAL AutopilotCommandCenter with fictional data. Production returns 404.
 */
export const dynamic = "force-dynamic";
export const metadata = { title: "FIXTURE — JATA Autopilot Command Center", robots: { index: false, follow: false } };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

export default async function AutopilotFixturePage({ searchParams }: { searchParams: SearchParams }) {
  if (process.env.NODE_ENV === "production") notFound();
  const sp = await searchParams;
  const scenarioParam = typeof sp.scenario === "string" ? sp.scenario : "ready";
  const roleParam = typeof sp.role === "string" ? sp.role : "OWNER";
  const tenantParam = sp.tenant === "b" ? "b" : "a";
  const scenario: FixtureScenarioId = (FIXTURE_SCENARIO_IDS as readonly string[]).includes(scenarioParam)
    ? (scenarioParam as FixtureScenarioId)
    : "ready";
  const role: FixtureRole = (FIXTURE_ROLES as readonly string[]).includes(roleParam)
    ? (roleParam as FixtureRole)
    : "OWNER";
  const { id, state } = createFixtureSession({ scenario, role, tenant: tenantParam });
  const businessId = state.activeBusinessId;
  return (
    <AutopilotFixtureClient
      sessionId={id}
      businessId={businessId}
      scenario={scenario}
      role={role}
      tenant={tenantParam}
      initialData={buildFixtureOverview(state, businessId)}
    />
  );
}
