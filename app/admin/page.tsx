import Link from "next/link";
import { formatNumber } from "@/lib/format";
import { requireAdminPage } from "@/lib/adminGuard";
import prisma from "@/lib/db";
import { AdminPage } from "@/components/admin/AdminUI";
import { WorkspacePanel, WorkspaceStat } from "@/components/workspace/WorkspaceUI";
import { minorToMajor, readPlatformMoneyFigures, type PlatformMoneyFigures } from "@/lib/admin/platform-figures";

export const dynamic = "force-dynamic";

/**
 * Platform overview.
 *
 * Every tile is a count or a sum the database actually returned — customers, businesses,
 * publication state, subscriptions, recorded page events and PAID-status payment amounts. No growth curve is
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
    // EXPIRING is still entitled (lib/experience/entitlement.ts) but needs renewal, so it belongs here.
    prisma.subscription.count({ where: { status: { in: ["EXPIRING", "EXPIRED", "SUSPENDED"] } } }),
    // A failed read is shown as "Unavailable", never as zero (R-ADM-01).
    prisma.analyticsEvent.groupBy({ by: ["eventType"], _count: { eventType: true } }).catch(() => null),
  ]);

  const UNAVAILABLE = "Unavailable";
  const eventCount = (type: string) => analytics ? formatNumber(analytics.find((a) => a.eventType === type)?._count.eventType || 0) : UNAVAILABLE;
  // Jata revenue and customers' payments to businesses share the Payment table; they are reported
  // separately and other currencies are counted, never converted (lib/admin/platform-figures.ts).
  const money: PlatformMoneyFigures | null = await readPlatformMoneyFigures(prisma).catch(() => null);
  const kes = (minor: number) => formatNumber(minorToMajor(minor));
  const otherCurrencyRows = money ? money.otherCurrency.reduce((sum, row) => sum + row.count, 0) + money.unclassified.reduce((sum, row) => sum + row.count, 0) : 0;

  const accounts: Array<[string, string, string]> = [
    ["Total customers", formatNumber(users), "Every registered account"],
    ["Businesses", formatNumber(businesses), "Across all owners"],
    ["Published pages", formatNumber(published), "Live to customers"],
    ["Active subscriptions", formatNumber(subsActive), "Status ACTIVE"],
    ["Expiring / expired", formatNumber(subsExpired), "Needs a renewal"],
  ];
  const activity: Array<[string, string, string]> = [
    ["Payments recorded", formatNumber(payments), "All statuses, all time"],
    ["PAID subscription payment amount (KES)", money ? kes(money.subscriptionRevenueMinor) : UNAVAILABLE, money ? `Payment.status = PAID · ${formatNumber(money.subscriptionPayments)} records` : "The payment query failed; no figure is inferred"],
    ["PAID customer payments to businesses (KES)", money ? kes(money.merchantTakingsMinor) : UNAVAILABLE, money ? `PAID orders and deposits · not Jata revenue · ${formatNumber(money.merchantPayments)} records` : "The payment query failed; no figure is inferred"],
    ["Page views", eventCount("PAGE_VIEW"), "Recorded by owner pages"],
    ["WhatsApp taps", eventCount("WHATSAPP_CLICK"), "Recorded button taps"],
    ["Calls / directions", analytics ? `${eventCount("CALL_CLICK")} / ${eventCount("DIRECTIONS_CLICK")}` : UNAVAILABLE, "Recorded button taps"],
  ];

  return (
    <AdminPage kicker="Platform admin" title="Admin overview" meta="Counts and PAID-status payment amounts only; not a cash-reconciliation or MRR/ARR report.">
      <WorkspacePanel title="Accounts and access" meta="Coverage, not growth">
        <div className="ws-stats ws-stats--5">
          {accounts.map(([label, value, hint]) => (
            <WorkspaceStat key={label} label={label} value={value} hint={hint} />
          ))}
        </div>
      </WorkspacePanel>

      <WorkspacePanel title="Activity recorded by owner pages" meta="Measured, never estimated">
        <div className="ws-stats ws-stats--3">
          {activity.map(([label, value, hint]) => (
            <WorkspaceStat key={label} label={label} value={value} hint={hint} metric={label === "Page views" ? "views" : label === "WhatsApp taps" ? "whatsapp" : undefined} />
          ))}
        </div>
        {otherCurrencyRows > 0 ? (
          <p className="ws-muted ws-tiny" data-testid="admin-unreported-payments">
            {formatNumber(otherCurrencyRows)} PAID-status {otherCurrencyRows === 1 ? "payment record is" : "payment records are"} in another currency or of an unrecognised kind and {otherCurrencyRows === 1 ? "is" : "are"} not included in either KES figure. No exchange rate is applied.
          </p>
        ) : null}
        <p className="ws-muted ws-tiny">
          These are PAID-status record amounts, not verified net cash collected, MRR or ARR. This view does not classify test/live mode per payment or reconcile provider settlement, refunds, chargebacks, fees or tax. There is no daily roll-up in the schema, so no trend line is drawn. An empty figure means nothing has been recorded — not zero demand.
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
