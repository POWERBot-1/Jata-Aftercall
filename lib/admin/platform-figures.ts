/**
 * Platform money figures for the admin console (R-ADM-01).
 *
 * `Payment` is one table for several kinds of money (see `purpose` in prisma/schema.prisma):
 *   SUBSCRIPTION     — a business paying Jata for a plan. This is Jata's revenue.
 *   ORDER            — a customer paying a business for an order (merchant takings, not Jata revenue).
 *   BOOKING_DEPOSIT  — a customer paying a business a booking deposit (merchant takings, not Jata revenue).
 *
 * The admin overview used to show `SUM(amount) WHERE status = 'PAID'` as "Settled revenue (KES)",
 * which added customers' order and deposit payments to Jata's subscription revenue and would have
 * added any non-KES amount as if it were shillings. It also printed "0" when the query failed.
 *
 * This module keeps the kinds apart, never converts currencies (no exchange rate is stored and
 * none is invented), reports purposes it does not recognise rather than dropping them, and lets
 * the caller show "unavailable" instead of zero when the database cannot answer.
 *
 * Amounts are stored in the smallest unit (cents: `toKobo(KES)`), so KES = amount / 100.
 */
export const REPORTING_CURRENCY = "KES" as const;
export const PLATFORM_REVENUE_PURPOSES = ["SUBSCRIPTION"] as const;
export const MERCHANT_TAKINGS_PURPOSES = ["ORDER", "BOOKING_DEPOSIT"] as const;

export type PaidGroup = { purpose: string | null; currency: string | null; count: number; amountMinor: number };

export type PlatformMoneyFigures = {
  /** Jata subscription revenue settled by a verified provider confirmation, KES cents. */
  subscriptionRevenueMinor: number;
  subscriptionPayments: number;
  /** Customer payments to businesses (orders, booking deposits), KES cents. Not Jata revenue. */
  merchantTakingsMinor: number;
  merchantPayments: number;
  /** PAID rows in another currency: counted, never converted or added. */
  otherCurrency: Array<{ currency: string; purpose: string; count: number; amountMinor: number }>;
  /** PAID KES rows whose purpose is not a known kind: counted, never classified as revenue. */
  unclassified: Array<{ purpose: string; count: number; amountMinor: number }>;
  /** Every PAID row is in exactly one bucket above; these let a test prove nothing was lost. */
  totalPaidRows: number;
};

function isOneOf<T extends readonly string[]>(list: T, value: string): value is T[number] {
  return (list as readonly string[]).includes(value);
}

/** Pure classification of `GROUP BY purpose, currency` over PAID payments. */
export function classifyPaidPayments(groups: PaidGroup[]): PlatformMoneyFigures {
  const figures: PlatformMoneyFigures = {
    subscriptionRevenueMinor: 0,
    subscriptionPayments: 0,
    merchantTakingsMinor: 0,
    merchantPayments: 0,
    otherCurrency: [],
    unclassified: [],
    totalPaidRows: 0,
  };
  for (const group of groups) {
    const purpose = group.purpose ?? "(none)";
    const currency = (group.currency ?? "(none)").toUpperCase();
    const count = Number(group.count) || 0;
    const amountMinor = Number(group.amountMinor) || 0;
    figures.totalPaidRows += count;
    if (currency !== REPORTING_CURRENCY) {
      figures.otherCurrency.push({ currency, purpose, count, amountMinor });
    } else if (isOneOf(PLATFORM_REVENUE_PURPOSES, purpose)) {
      figures.subscriptionRevenueMinor += amountMinor;
      figures.subscriptionPayments += count;
    } else if (isOneOf(MERCHANT_TAKINGS_PURPOSES, purpose)) {
      figures.merchantTakingsMinor += amountMinor;
      figures.merchantPayments += count;
    } else {
      figures.unclassified.push({ purpose, count, amountMinor });
    }
  }
  const order = (a: { count: number }, b: { count: number }) => b.count - a.count;
  figures.otherCurrency.sort(order);
  figures.unclassified.sort(order);
  return figures;
}

type PaymentGroupByClient = {
  payment: {
    groupBy: (args: any) => Promise<Array<{ purpose: string | null; currency: string | null; _count: { _all: number }; _sum: { amount: number | null } }>>;
  };
};

/** Reads the PAID groups. Throws when the database cannot answer — callers must show "unavailable". */
export async function readPlatformMoneyFigures(client: PaymentGroupByClient): Promise<PlatformMoneyFigures> {
  const rows = await client.payment.groupBy({
    by: ["purpose", "currency"],
    where: { status: "PAID" },
    _count: { _all: true },
    _sum: { amount: true },
  });
  return classifyPaidPayments(rows.map((row) => ({
    purpose: row.purpose,
    currency: row.currency,
    count: row._count._all,
    amountMinor: row._sum.amount ?? 0,
  })));
}

/** Human label for a payment purpose; unknown values are shown verbatim, never relabelled. */
export function paymentPurposeLabel(purpose: string | null | undefined): string {
  switch (purpose) {
    case "SUBSCRIPTION": return "Plan subscription";
    case "ORDER": return "Customer order";
    case "BOOKING_DEPOSIT": return "Booking deposit";
    default: return purpose || "—";
  }
}

/** Whole-unit amount for display; minor units are never shown as if they were whole shillings. */
export function minorToMajor(amountMinor: number): number {
  return amountMinor / 100;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** Statuses that still grant the plan (see lib/experience/entitlement.ts) and therefore need renewing. */
const LIVE_SUBSCRIPTION_STATUSES: readonly string[] = ["ACTIVE", "EXPIRING"];

/**
 * Renewal work-list counts. "Due within N days" means an ACTIVE or EXPIRING subscription whose expiry is still
 * ahead and inside the window; a subscription that has already lapsed is "overdue", not "due".
 * (The page used to count every row with expiry < now + 14 days, so lapsed and cancelled rows
 * inflated the "due" figure.)
 */
export function renewalCounts(
  subscriptions: Array<{ status: string; expiresAt: Date | null }>,
  now: Date = new Date(),
  windowDays = 14,
): { dueSoon: number; overdue: number } {
  const nowMs = now.getTime();
  const horizon = nowMs + windowDays * DAY_MS;
  let dueSoon = 0;
  let overdue = 0;
  for (const sub of subscriptions) {
    if (!sub.expiresAt || !LIVE_SUBSCRIPTION_STATUSES.includes(sub.status)) continue;
    const at = sub.expiresAt.getTime();
    if (at < nowMs) overdue += 1;
    else if (at <= horizon) dueSoon += 1;
  }
  return { dueSoon, overdue };
}
