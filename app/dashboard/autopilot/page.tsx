import Link from "next/link";
import { redirect } from "next/navigation";
import {
  ArrowRight,
  BrainCircuit,
  RotateCcw,
  ShieldAlert,
  Sparkles,
} from "lucide-react";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getOwnedBusinessIds } from "@/lib/tenant";
import { formatKES } from "@/lib/format";
import {
  AUTOPILOT_PLAN_CATALOG,
  getAutopilotEntitlement,
} from "@/lib/autopilot/entitlement";
import { resolveIndustryPack } from "@/lib/autopilot/industry-packs";
import { StatusPill } from "@/components/ui/StatusPill";
import {
  WorkspaceEmpty,
  WorkspaceHero,
  WorkspacePanel,
} from "@/components/workspace/WorkspaceUI";
import { WorkspaceDoor } from "@/components/workspace/WorkspaceDoor";
import {
  WORKSPACE_HERO_PHOTO,
  WORKSPACE_PHOTOS,
  categoryLabel,
  photoForCategory,
} from "@/lib/workspaceImagery";

export const dynamic = "force-dynamic";

export const metadata = { title: "JATA Autopilot" };

export default async function AutopilotIndexPage() {
  const session = await getSession();
  if (!session) redirect("/login");

  const ownedIds = await getOwnedBusinessIds(session);
  const businesses = await prisma.business.findMany({
    where: { id: { in: ownedIds } },
    select: { id: true, name: true, category: true, location: true, coverUrl: true },
    orderBy: { name: "asc" },
  });

  const entitlements = await Promise.all(
    businesses.map(async (b) => {
      try {
        return await getAutopilotEntitlement(b.id);
      } catch {
        return null;
      }
    }),
  );

  const activeCount = entitlements.filter((e) => e?.entitled).length;

  return (
    <div className="ws-stack">
      <WorkspaceHero
        compact
        kicker="JATA Autopilot"
        title={
          <>
            Your AI business <em>command center</em>, grounded in real records.
          </>
        }
        subtitle={`Diagnose sales, stock, and unanswered customer questions across 15 Industry Packs — then review, approve, execute, and roll back safe actions with full auditability. Starts at ${formatKES(
          AUTOPILOT_PLAN_CATALOG.JATA_AUTOPILOT.priceKES,
        )}/month per business, separate from your page and POS plans.`}
        photo={WORKSPACE_HERO_PHOTO}
        actions={
          <>
            <Link href="#autopilot-businesses" className="ws-btn-amber">
              <Sparkles size={16} aria-hidden="true" /> Open Command Center
            </Link>
            <Link href="/dashboard" className="ws-btn-outline">
              Back to overview
            </Link>
          </>
        }
        meta={`${businesses.length} ${businesses.length === 1 ? "business" : "businesses"} · ${activeCount} with active Autopilot · Assisted mode by default`}
      />

      {businesses.length === 0 ? (
        <WorkspaceEmpty
          title="Add a business first"
          text="JATA Autopilot operates per business with strict tenant isolation. Create your business first, then open its Command Center."
          photo={WORKSPACE_PHOTOS.retail}
          actions={
            <Link href="/onboarding" className="jata-btn jata-btn-primary">
              Add a business
            </Link>
          }
        />
      ) : (
        <section
          id="autopilot-businesses"
          aria-labelledby="autopilot-businesses-title"
          className="scroll-mt-28"
        >
          <h2 id="autopilot-businesses-title" className="sr-only">
            Your businesses
          </h2>
          <ul className="ws-stack">
            {businesses.map((business, idx) => {
              const state = entitlements[idx];
              const pack = resolveIndustryPack(business.category);
              const href = `/dashboard/autopilot/${encodeURIComponent(business.id)}`;
              const pillTone = state?.entitled
                ? "success"
                : state?.subscriptionStatus === "PAST_DUE"
                  ? "warning"
                  : state?.subscriptionStatus === "SUSPENDED"
                    ? "danger"
                    : "neutral";
              const pillText = state?.entitled
                ? `${state.tier} Active`
                : state?.subscriptionStatus === "PENDING"
                  ? "Payment Pending"
                  : state?.subscriptionStatus === "EXPIRED"
                    ? "Expired"
                    : "Preview Mode";

              return (
                <WorkspaceDoor
                  key={business.id}
                  coverUrl={business.coverUrl}
                  photo={photoForCategory(business.category)}
                  title={business.name}
                  meta={
                    [categoryLabel(business.category), business.location, pack.name]
                      .filter(Boolean)
                      .join(" · ") || "Business"
                  }
                  pills={<StatusPill tone={pillTone}>{pillText}</StatusPill>}
                  note={
                    <p className="ws-muted ws-tiny">
                      {state?.entitled
                        ? state.banner.detail
                        : "Inspect grounded 30-day diagnosis and draft proposals in Preview Mode, or subscribe to run live actions."}
                    </p>
                  }
                  actions={
                    <Link className="jata-btn jata-btn-primary" href={href}>
                      {state?.entitled ? "Open Command Center" : "Preview Command Center"}{" "}
                      <ArrowRight size={15} aria-hidden="true" />
                    </Link>
                  }
                />
              );
            })}
          </ul>
        </section>
      )}

      <WorkspacePanel
        title="How JATA Autopilot protects your business"
        meta="Deterministic guardrails before every action"
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <GuardTile
            icon={<BrainCircuit size={15} />}
            title="Zero invented numbers"
            text="Every metric is tagged RECORDED, CALCULATED, ESTIMATE, or MISSING DATA from real database rows."
          />
          <GuardTile
            icon={<Sparkles size={15} />}
            title="Approval queue first"
            text="Defaults to Assisted mode so you review plain-English rationale and impact before execution."
          />
          <GuardTile
            icon={<RotateCcw size={15} />}
            title="1-click rollback"
            text="Before-snapshots let you revert offer and FAQ updates or cancel pending queued notifications."
          />
          <GuardTile
            icon={<ShieldAlert size={15} />}
            title="Emergency pause & spend caps"
            text="Instant tenant pause, daily KES AI budget ceiling, and strict receipt-screenshot non-settlement."
          />
        </div>
      </WorkspacePanel>
    </div>
  );
}

function GuardTile({
  icon,
  title,
  text,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-xl border border-[color:var(--ws-line)] bg-[color:var(--ws-paper)] px-3 py-2.5">
      <p className="flex items-center gap-1.5 text-[0.8rem] font-bold">
        <span aria-hidden="true" className="text-[color:var(--ws-amber-deep)]">
          {icon}
        </span>
        {title}
      </p>
      <p className="ws-muted ws-tiny mt-0.5">{text}</p>
    </div>
  );
}
