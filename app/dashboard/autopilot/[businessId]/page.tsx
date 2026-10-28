import Link from "next/link";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { assertBusinessRole, TenantError } from "@/lib/tenant";
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
import { WorkspaceEmpty } from "@/components/workspace/WorkspaceUI";
import { WORKSPACE_PHOTOS } from "@/lib/workspaceImagery";
import {
  AutopilotCommandCenter,
  type AutopilotOverviewPayload,
} from "@/components/autopilot/AutopilotCommandCenter";

export const dynamic = "force-dynamic";

export const metadata = { title: "JATA Autopilot Command Center" };

type Props = { params: Promise<{ businessId: string }> };

export default async function AutopilotBusinessCommandCenterPage({ params }: Props) {
  const session = await getSession();
  if (!session) redirect("/login");

  const { businessId } = await params;

  let role: string;
  try {
    role = await assertBusinessRole(businessId, session, "read");
  } catch (err) {
    const msg =
      err instanceof TenantError
        ? "You do not have access to this business Command Center."
        : "Unable to load this business right now.";
    return (
      <WorkspaceEmpty
        title="Command Center unavailable"
        text={msg}
        photo={WORKSPACE_PHOTOS.retail}
        actions={
          <Link href="/dashboard/autopilot" className="jata-btn jata-btn-primary">
            Back to your businesses
          </Link>
        }
      />
    );
  }

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

  const initialData: AutopilotOverviewPayload = {
    actorRole: role,
    globalKillSwitchActive: isGlobalAutopilotKillSwitchActive(),
    entitlement,
    plans: [
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
    ],
    config,
    industryPacks: ALL_INDUSTRY_PACK_KEYS.map((k) => ({
      key: k,
      name: INDUSTRY_PACKS[k].name,
      hasRegulatedGuardrail: Boolean(INDUSTRY_PACKS[k].regulatedGuardrail),
    })),
    diagnosis: diagnosis as any,
    proposals,
    usage: usage as any,
    channels: getAutopilotChannelMatrix(),
    auditEvents,
  };

  return <AutopilotCommandCenter businessId={businessId} initialData={initialData} />;
}
