import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import { AdminPage } from "@/components/admin/AdminUI";
import { WorkspacePanel, WorkspaceStat } from "@/components/workspace/WorkspaceUI";

export const dynamic = "force-dynamic";

/**
 * Platform overview.
 *
 * Every tile is a count or a sum the database actually returned — customers, businesses,
 * publication state, subscriptions, recorded page events and settled revenue. No growth curve is
 * drawn because the schema keeps events, not a daily roll-up: a chart here would be invented.
 */
export default async function AdminOverview() {
  await requireAdminPage();
  const [users, businesses, published, payments, subsActive, subsExpired, analytics] = await Promise.all([
    prisma.user.count(),
    prisma.business.count(),
    prisma.business.count({ where: { isPublished: true } }),
    prisma.payment.count(),
    prisma.subscription.count({ where: { status: "ACTIVE" } }),
    prisma.subscription.count({ where: { status: { in: ["EXPIRED", "SUSPENDED"] } } }),
    prisma.analyticsEvent.groupBy({ by: ["eventType"], _count: { eventType: true } }).catch(() => []),
  ]);

  const totalViews = analytics.find((a) => a.eventType === "PAGE_VIEW")?._count.eventType || 0;
  const waClicks = analytics.find((a) => a.eventType === "WHATSAPP_CLICK")?._count.eventType || 0;
  const callClicks = analytics.find((a) => a.eventType === "CALL_CLICK")?._count.eventType || 0;
  const dirClicks = analytics.find((a) => a.eventType === "DIRECTIONS_CLICK")?._count.eventType || 0;
  const revenuePaid = await prisma.payment.aggregate({ where: { status: "PAID" }, _sum: { amount: true } }).catch(() => ({ _sum: { amount: 0 } }));

  const accounts: Array<[string, string, string]> = [
    ["Total customers", formatNumber(users), "Every registered account"],
    ["Businesses", formatNumber(businesses), "Across all owners"],
    ["Published pages", formatNumber(published), "Live to customers"],
    ["Active subscriptions", formatNumber(subsActive), "Status ACTIVE"],
    ["Expiring / expired", formatNumber(subsExpired), "Needs a renewal"],
  ];
  const activity: Array<[string, string, string]> = [
    ["Payments recorded", formatNumber(payments), "All statuses, all time"],
    ["Settled revenue (KES)", revenuePaid._sum.amount ? formatNumber(revenuePaid._sum.amount / 100) : "0", "Sum of PAID only"],
    ["Page views", formatNumber(totalViews), "Recorded by owner pages"],
    ["WhatsApp taps", formatNumber(waClicks), "Recorded button taps"],
    ["Calls / directions", `${formatNumber(callClicks)} / ${formatNumber(dirClicks)}`, "Recorded button taps"],
  ];

  return (
    <AdminPage kicker="Platform admin" title="Admin overview" meta="Counts and sums only. Every figure below is read from the database at request time.">
      <WorkspacePanel title="Accounts and access" meta="Coverage, not growth">
        <div className="ws-stats ws-stats--5">
          {accounts.map(([label, value, hint]) => (
            <WorkspaceStat key={label} label={label} value={value} hint={hint} />
          ))}
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="Activity recorded by owner pages" meta="Measured, never estimated">
        <div className="ws-stats ws-stats--5">
          {activity.map(([label, value, hint]) => (
            <WorkspaceStat key={label} label={label} value={value} hint={hint} metric={label === "Page views" ? "views" : label === "WhatsApp taps" ? "whatsapp" : undefined} />
          ))}
        </div>
        <p className="ws-muted ws-tiny">
          There is no daily roll-up in the schema, so no trend line is drawn. An empty figure means nothing has been recorded — not zero demand.
        </p>
      </WorkspacePanel>

      <WorkspacePanel title="System health" meta="Operational checks">
        <p className="ws-muted">
          The health endpoint reports database reachability and configuration state. Every admin action in this console is audited with the acting account.
        </p>
        <div className="flex flex-wrap gap-2">
          <Link href="/health" target="_blank" className="ws-btn-outline ws-btn-outline--ink">Open /health</Link>
          <Link href="/admin/payments/wallet" className="ws-btn-outline ws-btn-outline--ink">Payment wallet</Link>
          <Link href="/admin/plans" className="ws-btn-outline ws-btn-outline--ink">Plans &amp; pricing</Link>
        </div>
      </WorkspacePanel>
    </AdminPage>
  );
}
