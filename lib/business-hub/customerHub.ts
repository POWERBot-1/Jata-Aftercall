/**
 * Smart Customer Hub — one owner-facing view of every customer interaction (feature B).
 *
 * It deliberately does NOT depend on an external CRM: order requests, enquiries, promotions and
 * loyalty all live in the JATA database and are read through tenant-scoped queries. The hub is a
 * read model over those tables plus the shared activity trail; it owns no data of its own.
 */

import prisma from "../db";
import { listEnquiries } from "./enquiries";
import { getOrCreateProgram, listCards, loyaltyStats } from "./loyalty";
import { listOrderRequests, orderRequestStats } from "./orderRequests";
import { listPromotions } from "./promotions";
import { cleanSearch, listHubActivity } from "./shared";

export type CustomerHub = {
  orderRequests: any[];
  enquiries: any[];
  promotions: any[];
  loyalty: {
    program: any;
    cards: any[];
    stats: { cards: number; stampsAwarded: number; rewardsRedeemed: number; activeCards: number };
  };
  stats: Awaited<ReturnType<typeof orderRequestStats>>;
  activity: any[];
};

/**
 * Loads the hub for one business. Every sub-query is scoped by `businessId`, so a forged or
 * mistyped business id returns an empty hub rather than another tenant's customers.
 */
export async function loadCustomerHub(
  businessId: string,
  options: { status?: string | null; search?: string | null } = {},
): Promise<CustomerHub> {
  const search = cleanSearch(options.search);
  const [orderRequests, enquiries, promotions, program, cards, stats, activity] = await Promise.all([
    listOrderRequests(businessId, { status: options.status, search }).catch(() => []),
    listEnquiries(businessId, { status: options.status, search }).catch(() => []),
    listPromotions(businessId).catch(() => []),
    getOrCreateProgram(businessId).catch(() => null),
    listCards(businessId, { search }).catch(() => []),
    orderRequestStats(businessId).catch(() => null),
    listHubActivity(prisma, businessId, { take: 40 }).catch(() => []),
  ]);

  return {
    orderRequests,
    enquiries,
    promotions,
    loyalty: {
      program,
      cards,
      stats: await loyaltyStats(businessId).catch(() => ({ cards: 0, stampsAwarded: 0, rewardsRedeemed: 0, activeCards: 0 })),
    },
    stats:
      stats ?? {
        total: 0,
        byStatus: { NEW: 0, REVIEWING: 0, CONFIRMED: 0, DECLINED: 0, COMPLETED: 0, CANCELLED: 0 },
        confirmedOrCompleted: 0,
        conversionRate: 0,
        openRequests: 0,
        estimatedValueKES: 0,
      },
    activity,
  };
}
