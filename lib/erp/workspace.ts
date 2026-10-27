/**
 * Workspace loader and navigation view
 *
 * One authorisation and one read per request, shared by the shell and the screen. The counts here
 * are deliberately small and truthful: they come from the database, and a screen that cannot read
 * a table shows "not available" rather than a zero that looks like good news.
 */

import { cache } from "react";
import prisma from "../db";
import { getSession, type SessionPayload } from "../auth";
import { erpBasePath, requireErpAccess, ErpAccessError, type ErpContext } from "./access";
import { navigationFor, type NavView } from "./navigation";
import { industryPack, type IndustryPack } from "./industryPacks";
import { parseStorefrontSettings, type StorefrontSettings } from "./storefront";
import { deriveOnboarding, dashboardCards, type DerivedOnboarding, type DashboardCard } from "./onboarding";
import { ERP_PLAN_COMMERCIALS, ERP_PLAN_EXCLUSIONS, ERP_PLAN_INCLUSIONS } from "./entitlement";

export type ErpWorkspace = ErpContext & {
  basePath: string;
  packs: IndustryPack;
  pack: IndustryPack;
  nav: NavView;
  storefront: { slug: string | null; settings: StorefrontSettings };
  onboarding: DerivedOnboarding;
  cards: DashboardCard[];
  plan: { priceKES: number; inclusions: readonly string[]; exclusions: readonly string[]; commercials: Record<string, unknown> };
  notice: { tone: "info" | "warn" | "danger" | "success"; text: string; href: string | null } | null;
  counts: {
    contacts: number;
    contactsWithMarketingConsent: number;
    campaignsDraft: number;
    campaignsReady: number;
    campaignsLive: number;
    campaignsDone: number;
    delivered: number;
    failed: number;
    unknown: number;
    openInvoices: number;
    overdueInvoices: number;
    outstandingCents: number;
    walletAvailableCents: number;
    walletBalanceCents: number;
    walletReservedCents: number;
    journals: number;
    activeRules: number;
    pendingOrders: number;
    senderActive: boolean;
    senderStatus: string | null;
    channels: Array<{ channel: string; status: string; provider: string }>;
  };
};

async function safeCount(promise: Promise<unknown>): Promise<number | null> {
  try {
    const value: any = await promise;
    if (typeof value === "number") return value;
    if (typeof value?.length === "number") return value.length;
    return null;
  } catch {
    return null;
  }
}

export async function loadErpWorkspaceForSession(businessId: string, session: SessionPayload): Promise<ErpWorkspace> {
  const context = await requireErpAccess(businessId, session, { fast: true });
  const basePath = erpBasePath(businessId);
  const pack = industryPack(context.configuration?.industryPackKey);

  const [
    contacts,
    consentCount,
    campaigns,
    recipientStatuses,
    wallet,
    invoices,
    journals,
    rules,
    orders,
    senders,
    channels,
  ] = await Promise.all([
    safeCount(prisma.msgContact.count({ where: { businessId } })) ?? undefined,
    safeCount(prisma.msgConsentRecord.count({ where: { businessId, purpose: "MARKETING", granted: true } })) ?? undefined,
    prisma.msgCampaign.findMany({ where: { businessId }, select: { status: true } }).catch(() => []),
    prisma.msgCampaignRecipient.groupBy({ by: ["status"], where: { businessId }, _count: { _all: true } }).catch(() => []),
    prisma.msgWallet.findUnique({ where: { businessId } }).catch(() => null),
    prisma.erpInvoice.findMany({ where: { businessId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } }, select: { balanceCents: true, dueAt: true } }).catch(() => []),
    safeCount(prisma.erpJournal.count({ where: { businessId } })) ?? undefined,
    prisma.erpAutomationRule.findMany({ where: { businessId }, select: { status: true } }).catch(() => []),
    prisma.erpStoreOrder.findMany({ where: { businessId, status: { in: ["PENDING", "CONFIRMED", "READY"] } }, select: { status: true } }).catch(() => []),
    prisma.msgSenderId.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 3 }).catch(() => []),
    prisma.msgChannelConnection.findMany({ where: { businessId } }).catch(() => []),
  ]);

  const statusCount = (statuses: Array<{ status: string }>) => statuses.reduce<Record<string, number>>((total, row) => {
    total[row.status] = (total[row.status] ?? 0) + 1;
    return total;
  }, {});
  const campaignCounts = statusCount(campaigns as any[]);
  const recipientCounts: Record<string, number> = {};
  for (const row of recipientStatuses as any[]) recipientCounts[row.status] = Number(row._count?._all ?? row._count ?? 0);

  const now = new Date();
  const openInvoices = (invoices as any[]) ?? [];
  const overdue = openInvoices.filter((invoice) => invoice.dueAt && new Date(invoice.dueAt).getTime() < now.getTime());
  const balanceCents = Number(wallet?.balanceCents ?? 0);
  const reservedCents = Number(wallet?.reservedCents ?? 0);

  const storefrontSettings = parseStorefrontSettings(context.configuration?.storefrontJson);
  const sender = (senders as any[])[0] ?? null;
  const counts = {
    contacts: contacts ?? 0,
    contactsWithMarketingConsent: consentCount ?? 0,
    campaignsDraft: campaignCounts.DRAFT ?? 0,
    campaignsReady: (campaignCounts.AUDIENCE_VALIDATED ?? 0) + (campaignCounts.READY_FOR_REVIEW ?? 0) + (campaignCounts.AWAITING_APPROVAL ?? 0),
    campaignsLive: (campaignCounts.APPROVED ?? 0) + (campaignCounts.SCHEDULED ?? 0) + (campaignCounts.SENDING ?? 0) + (campaignCounts.PAUSED ?? 0),
    campaignsDone: (campaignCounts.COMPLETED ?? 0) + (campaignCounts.PARTIALLY_COMPLETED ?? 0) + (campaignCounts.FAILED ?? 0) + (campaignCounts.CANCELLED ?? 0),
    delivered: recipientCounts.DELIVERED ?? 0,
    failed: recipientCounts.FAILED ?? 0,
    unknown: recipientCounts.UNKNOWN ?? 0,
    openInvoices: openInvoices.length,
    overdueInvoices: overdue.length,
    outstandingCents: openInvoices.reduce((total, invoice) => total + Number(invoice.balanceCents ?? 0), 0),
    walletAvailableCents: Math.max(0, balanceCents - reservedCents),
    walletBalanceCents: balanceCents,
    walletReservedCents: reservedCents,
    journals: journals ?? 0,
    activeRules: (rules as any[]).filter((rule) => rule.status === "ACTIVE").length,
    pendingOrders: (orders as any[]).filter((order) => order.status === "PENDING").length,
    senderActive: String(sender?.status ?? "").toUpperCase() === "ACTIVE",
    senderStatus: sender?.status ?? null,
    channels: (channels as any[]).map((channel) => ({ channel: channel.channel, status: channel.status, provider: channel.provider })),
  };

  const onboarding = deriveOnboarding({
    workspaceConfigured: Boolean(context.configuration),
    profileComplete: Boolean(context.configuration?.legalName && context.configuration?.kraPin),
    chartOfAccounts: counts.journals > 0 || Boolean(context.configuration),
    taxRules: Boolean(context.configuration),
    senderActive: counts.senderActive,
    channelConnected: counts.channels.some((channel) => channel.status === "ACTIVE"),
    contactsAdded: counts.contacts > 0,
    consentRecorded: counts.contactsWithMarketingConsent > 0,
    firstCampaignDrafted: counts.campaignsDraft + counts.campaignsReady + counts.campaignsLive + counts.campaignsDone > 0,
    firstCampaignSent: recipientCounts.SUBMITTED !== undefined || recipientCounts.DELIVERED !== undefined || recipientCounts.SENT !== undefined,
    firstInvoiceIssued: counts.openInvoices > 0,
    storefrontOpened: storefrontSettings.enabled,
  });

  const cards = dashboardCards({
    businessId,
    basePath,
    counts,
    onboarding,
    senderStatus: counts.senderStatus,
    storefrontEnabled: storefrontSettings.enabled,
  });

  const nav = navigationFor({
    businessId,
    role: context.role,
    packKey: pack.key,
    disabledKeys: context.configuration?.featureFlagsJson
      ? Object.entries(safeParse(context.configuration.featureFlagsJson)).filter(([, value]) => value === false).map(([key]) => key)
      : [],
  });

  const notice =
    !context.entitlement.entitled
      ? { tone: "warn" as const, text: context.entitlement.reason, href: `${basePath}/settings#plan` }
      : !counts.senderActive && counts.campaignsLive > 0
        ? { tone: "warn" as const, text: "A campaign is waiting because no Sender ID is active. Nothing will send until the provider approves one.", href: `${basePath}/sender-identity` }
        : counts.unknown > 0
          ? { tone: "info" as const, text: `${counts.unknown} message${counts.unknown === 1 ? " has" : "s have"} an unknown provider outcome. Reconcile before resending.`, href: `${basePath}/messaging` }
          : null;

  return {
    ...context,
    basePath,
    plan: {
      priceKES: context.entitlement.priceKES,
      inclusions: ERP_PLAN_INCLUSIONS,
      exclusions: ERP_PLAN_EXCLUSIONS,
      commercials: ERP_PLAN_COMMERCIALS as unknown as Record<string, unknown>,
    },
    notice,
    packs: pack,
    pack,
    nav,
    storefront: { slug: context.configuration?.storefrontSlug ?? null, settings: storefrontSettings },
    onboarding,
    cards,
    counts,
  };
}

function safeParse(json: string): Record<string, boolean> {
  try {
    const parsed = JSON.parse(json || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** Cached per request so the layout and the page share one authorisation and one set of reads. */
export const loadErpWorkspaceCached = cache(async (businessId: string): Promise<ErpWorkspace> => {
  const session = await getSession();
  if (!session) throw new ErpAccessError("Please sign in to open your workspace.", 401, "UNAUTHENTICATED");
  return loadErpWorkspaceForSession(businessId, session);
});

/** Convenience alias used by the screens: the cached, authorised workspace. */
export const loadErpWorkspace = loadErpWorkspaceCached;

export type ErpPageGate = { workspace: ErpWorkspace; refusal: null } | { workspace: null; refusal: { status: number; message: string } };

/** Layout gate: never throws an access error; the shell renders the refusal. */
export async function loadErpPage(businessId: string): Promise<ErpPageGate> {
  const { workspace, error } = await loadErpWorkspaceResult(businessId);
  if (workspace) return { workspace, refusal: null };
  return { workspace: null, refusal: { status: error?.status ?? 500, message: error?.message ?? "We couldn't open this workspace." } };
}

/** Non-throwing wrapper for pages that prefer to render a refusal panel. */
export async function loadErpWorkspaceResult(businessId: string): Promise<{ workspace: ErpWorkspace | null; error: ErpAccessError | null }> {
  try {
    return { workspace: await loadErpWorkspaceCached(businessId), error: null };
  } catch (error) {
    if (error instanceof ErpAccessError) return { workspace: null, error };
    throw error;
  }
}
