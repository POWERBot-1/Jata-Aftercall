import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { assertBusinessRole, TenantError } from "@/lib/tenant";
import { rateLimitByIdentity } from "@/lib/rate-limit";
import { getPlanByKey } from "@/lib/pricing";
import {
  AUTOPILOT_PLAN_CATALOG,
  getAutopilotEntitlement,
} from "@/lib/autopilot/entitlement";
import {
  getAutopilotConfig,
  listAutopilotProposals,
} from "@/lib/autopilot/actions";
import { runGroundedBusinessDiagnosis } from "@/lib/autopilot/diagnosis";
import { getAutopilotUsageSummary } from "@/lib/autopilot/usage";
import { getAutopilotChannelMatrix } from "@/lib/autopilot/channels";
import { listAutopilotAuditEvents } from "@/lib/autopilot/audit";
import { ALL_INDUSTRY_PACK_KEYS, INDUSTRY_PACKS } from "@/lib/autopilot/industry-packs";
import { isGlobalAutopilotKillSwitchActive } from "@/lib/autopilot/policy";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Authentication required." }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId")?.trim() || "";
  if (!businessId) {
    return NextResponse.json({ error: "businessId is required." }, { status: 400 });
  }

  const rl = rateLimitByIdentity(`${session.userId}:${businessId}`, {
    key: "autopilot_overview",
    max: 60,
    windowMs: 60_000,
  });
  if (!rl.allowed) {
    return NextResponse.json(
      { error: "Overview rate limit reached. Wait a moment before refreshing." },
      { status: 429 },
    );
  }

  try {
    const role = await assertBusinessRole(businessId, session, "read");
    const [entitlement, config] = await Promise.all([
      getAutopilotEntitlement(businessId),
      getAutopilotConfig(businessId),
    ]);

    const [diagnosis, proposals, usage, auditEvents, stdPlan, proPlan, entPlan] =
      await Promise.all([
        runGroundedBusinessDiagnosis({
          businessId,
          explicitIndustryPackKey: config.industryPackKey,
        }),
        listAutopilotProposals(businessId, 30),
        getAutopilotUsageSummary({
          businessId,
          tierKey: entitlement.entitled ? entitlement.tier : "PREVIEW",
          dailySpendCapMinorKES: config.dailySpendCapMinorKES,
        }),
        listAutopilotAuditEvents(businessId, 25),
        getPlanByKey("JATA_AUTOPILOT").catch(() => null),
        getPlanByKey("JATA_AUTOPILOT_PRO").catch(() => null),
        getPlanByKey("JATA_AUTOPILOT_ENTERPRISE").catch(() => null),
      ]);

    const plans = [
      {
        id: stdPlan?.id ?? null,
        key: "JATA_AUTOPILOT",
        tier: "STANDARD",
        name: stdPlan?.name ?? AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT.name,
        priceKES: stdPlan?.priceKES ?? AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT.priceKES,
        durationDays: stdPlan?.durationDays ?? 30,
        description: AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT.description,
      },
      {
        id: proPlan?.id ?? null,
        key: "JATA_AUTOPILOT_PRO",
        tier: "PRO",
        name: proPlan?.name ?? AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT_PRO.name,
        priceKES: proPlan?.priceKES ?? AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT_PRO.priceKES,
        durationDays: proPlan?.durationDays ?? 30,
        description: AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT_PRO.description,
      },
      {
        id: entPlan?.id ?? null,
        key: "JATA_AUTOPILOT_ENTERPRISE",
        tier: "ENTERPRISE",
        name: entPlan?.name ?? AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT_ENTERPRISE.name,
        priceKES:
          entPlan?.priceKES ?? AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT_ENTERPRISE.priceKES,
        durationDays: entPlan?.durationDays ?? 30,
        description: AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT_ENTERPRISE.description,
      },
    ];

    return NextResponse.json({
      actorRole: role,
      globalKillSwitchActive: isGlobalAutopilotKillSwitchActive(),
      entitlement,
      plans,
      config,
      industryPacks: ALL_INDUSTRY_PACK_KEYS.map((k) => ({
        key: k,
        name: INDUSTRY_PACKS[k].name,
        hasRegulatedGuardrail: Boolean(INDUSTRY_PACKS[k].regulatedGuardrail),
      })),
      diagnosis,
      proposals,
      usage,
      channels: getAutopilotChannelMatrix(),
      auditEvents,
    });
  } catch (err) {
    if (err instanceof TenantError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Unable to load JATA Autopilot overview." },
      { status: 500 },
    );
  }
}
