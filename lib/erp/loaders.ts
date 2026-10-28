/**
 * Read models for the ERP screens.
 *
 * Every loader is tenant-scoped by businessId and tolerant of an unavailable database: a screen
 * that cannot read shows an honest empty/error state instead of inventing a figure. The loaders
 * never calculate financial totals in the UI — they call the accounting functions that the tests
 * exercise.
 */

import prisma from "../db";
import { balanceSheet, profitAndLoss, trialBalance } from "./accounting";
import { receivablesAgeing } from "./invoicing";
import { loadTaxRules } from "./invoicing";
import { parseStorefrontSettings } from "./storefront";
import { walletSummary } from "../messaging/billing";
import { listNotifications, notificationVisibleTo, unreadNotificationCount } from "./notifications";
import { taskSummary } from "./tasks";
import { approvalSummary, listApprovalRequests } from "./approvals";
import { hasErpPermission } from "./access";

async function safe<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try {
    return await promise;
  } catch {
    return fallback;
  }
}

export async function loadMessagingOverview(businessId: string) {
  const [campaigns, wallet, senders, templates, connections, contacts, recipients, audienceCount] = await Promise.all([
    safe(prisma.msgCampaign.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 50 }), []),
    safe(walletSummary(prisma, businessId), { balanceCents: 0, reservedCents: 0, availableCents: 0, currency: "KES" }),
    safe(prisma.msgSenderId.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } }), []),
    safe(prisma.msgTemplate.findMany({ where: { businessId, status: "ACTIVE" }, orderBy: { createdAt: "asc" } }), []),
    safe(prisma.msgChannelConnection.findMany({ where: { businessId } }), []),
    safe(prisma.msgContact.count({ where: { businessId, status: "ACTIVE" } }), 0),
    safe(prisma.msgCampaignRecipient.findMany({ where: { businessId }, select: { status: true, costCents: true, segments: true } }), []),
    safe(prisma.msgAudience.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 20 }), []),
  ]);
  const stats = recipients.reduce<Record<string, number>>((total, recipient: any) => {
    total[recipient.status] = (total[recipient.status] ?? 0) + 1;
    return total;
  }, {});
  return {
    campaigns,
    wallet,
    senders,
    templates,
    connections,
    contacts,
    audiences: audienceCount,
    stats: {
      sent: (stats.SENT ?? 0) + (stats.SUBMITTED ?? 0),
      delivered: stats.DELIVERED ?? 0,
      failed: stats.FAILED ?? 0,
      unknown: stats.UNKNOWN ?? 0,
      queued: stats.QUEUED ?? 0,
      blocked: stats.BLOCKED ?? 0,
      segments: recipients.reduce((total: number, recipient: any) => total + Number(recipient.segments ?? 0), 0),
      spentCents: recipients.reduce((total: number, recipient: any) => total + (["SUBMITTED", "SENT", "DELIVERED", "READ"].includes(recipient.status) ? Number(recipient.costCents ?? 0) : 0), 0),
    },
  };
}

export async function loadContacts(businessId: string) {
  const [contacts, consents, suppressions, customers] = await Promise.all([
    safe(prisma.msgContact.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 500 }), []),
    safe(prisma.msgConsentRecord.findMany({ where: { businessId }, orderBy: { capturedAt: "desc" } }), []),
    safe(prisma.msgSuppression.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } }), []),
    safe(prisma.posCustomer.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true, phone: true }, take: 500 }), []),
  ]);
  const consentByContact = new Map<string, { marketingSms: boolean; marketingWhatsApp: boolean }>();
  for (const consent of consents) {
    const current = consentByContact.get(consent.contactId) ?? { marketingSms: false, marketingWhatsApp: false };
    if (consent.purpose === "MARKETING" && consent.granted) {
      if (consent.channel === "SMS") current.marketingSms = true;
      if (consent.channel === "WHATSAPP") current.marketingWhatsApp = true;
    }
    consentByContact.set(consent.contactId, current);
  }
  const suppressedPhones = new Set(suppressions.map((row: any) => row.phoneNormalized));
  return {
    contacts: contacts.map((contact: any) => ({
      ...contact,
      tags: safeParseArray(contact.tagsJson),
      marketingConsent: consentByContact.get(contact.id) ?? { marketingSms: false, marketingWhatsApp: false },
      suppressed: suppressedPhones.has(contact.phoneNormalized),
    })),
    consentCount: consents.filter((consent: any) => consent.granted).length,
    suppressionCount: suppressions.length,
    suppressions,
    customers,
  };
}

function safeParseArray(json: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(json || "[]");
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

export async function loadSenderIdentity(businessId: string) {
  const [senders, events, connections, documents, configuration] = await Promise.all([
    safe(prisma.msgSenderId.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } }), []),
    safe(prisma.msgSenderIdEvent.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 100 }), []),
    safe(prisma.msgChannelConnection.findMany({ where: { businessId } }), []),
    safe(prisma.erpKycDocument.findMany({ where: { businessId, status: { not: "DELETED" } } }), []),
    safe(prisma.erpConfiguration.findUnique({ where: { businessId } }), null),
  ]);
  return {
    senders,
    events,
    connections,
    documents,
    configuration,
    primary: senders[0] ?? null,
    missingItems: senders[0] ? safeParseArray(senders[0].missingItemsJson) : [],
  };
}

export async function loadAccounting(businessId: string) {
  const now = new Date();
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  const [tb, pnl, bs, journals, periods, accounts] = await Promise.all([
    safe(trialBalance(prisma, businessId, {}), { rows: [], totalDebitCents: 0, totalCreditCents: 0, balanced: true, from: null, to: null }),
    safe(profitAndLoss(prisma, businessId, { from: yearStart, to: now }), { income: [], expenses: [], totalIncomeCents: 0, totalExpenseCents: 0, netProfitCents: 0, from: yearStart, to: now }),
    safe(balanceSheet(prisma, businessId, { to: now }), { assets: [], liabilities: [], equity: [], totalAssetsCents: 0, totalLiabilitiesCents: 0, totalEquityCents: 0, netIncomeCents: 0, balanced: true, asOf: now }),
    safe(prisma.erpJournal.findMany({ where: { businessId }, orderBy: { entryDate: "desc" }, take: 40 }), []),
    safe(prisma.erpPeriod.findMany({ where: { businessId }, orderBy: [{ fiscalYear: "desc" }, { month: "desc" }], take: 12 }), []),
    safe(prisma.erpAccount.findMany({ where: { businessId }, orderBy: { code: "asc" } }), []),
  ]);
  return { trialBalance: tb, profitAndLoss: pnl, balanceSheet: bs, journals, periods, accounts };
}

export async function loadInvoices(businessId: string) {
  const [invoices, payments, credits, ageing, customers] = await Promise.all([
    safe(prisma.erpInvoice.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 100 }), []),
    safe(prisma.erpPayment.findMany({ where: { businessId }, orderBy: { receivedAt: "desc" }, take: 100 }), []),
    safe(prisma.erpCreditNote.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 50 }), []),
    safe(receivablesAgeing(prisma, businessId), { rows: [], totals: { CURRENT: 0, "1_30": 0, "31_60": 0, "61_90": 0, OVER_90: 0 }, totalCents: 0, asOf: new Date() }),
    safe(prisma.posCustomer.findMany({ where: { businessId, isActive: true }, select: { id: true, name: true, phone: true }, take: 300 }), []),
  ]);
  return { invoices, payments, credits, ageing, customers };
}

export async function loadExpenses(businessId: string) {
  const [expenses, accounts] = await Promise.all([
    safe(prisma.erpExpense.findMany({ where: { businessId }, orderBy: { occurredAt: "desc" }, take: 100 }), []),
    safe(prisma.erpAccount.findMany({ where: { businessId, type: "EXPENSE" }, orderBy: { code: "asc" } }), []),
  ]);
  return {
    expenses,
    accounts,
    totalCents: expenses.reduce((total: number, expense: any) => total + Number(expense.amountCents ?? 0), 0),
  };
}

export async function loadAutomation(businessId: string) {
  const [rules, runs, contacts] = await Promise.all([
    safe(prisma.erpAutomationRule.findMany({ where: { businessId }, orderBy: { createdAt: "desc" } }), []),
    safe(prisma.erpAutomationRun.findMany({ where: { businessId }, orderBy: { startedAt: "desc" }, take: 50 }), []),
    safe(prisma.msgContact.count({ where: { businessId } }), 0),
  ]);
  return { rules, runs, contacts };
}

export async function loadCompliance(businessId: string) {
  const [profile, taxRules, invoiceCounts, configuration] = await Promise.all([
    safe(prisma.erpComplianceProfile.findUnique({ where: { businessId } }), null),
    safe(loadTaxRules(prisma, businessId), []),
    safe(prisma.erpInvoice.findMany({ where: { businessId }, select: { etimsStatus: true } }), []),
    safe(prisma.erpConfiguration.findUnique({ where: { businessId } }), null),
  ]);
  const counts = {
    awaitingSubmission: invoiceCounts.filter((invoice: any) => ["QUEUED", "SUBMITTING", "PENDING_ACK"].includes(String(invoice.etimsStatus))).length,
    accepted: invoiceCounts.filter((invoice: any) => String(invoice.etimsStatus) === "ACCEPTED").length,
    rejected: invoiceCounts.filter((invoice: any) => String(invoice.etimsStatus) === "REJECTED").length,
    uncertain: invoiceCounts.filter((invoice: any) => String(invoice.etimsStatus) === "UNCERTAIN").length,
  };
  return { profile, taxRules, counts, configuration };
}

export async function loadStore(businessId: string) {
  const [configuration, business, orders, products, inventory] = await Promise.all([
    safe(prisma.erpConfiguration.findUnique({ where: { businessId } }), null),
    safe(prisma.business.findUnique({ where: { id: businessId }, select: { name: true, slug: true, logoUrl: true } }), null),
    safe(prisma.erpStoreOrder.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 100 }), []),
    safe(prisma.posProduct.findMany({ where: { businessId, isActive: true }, orderBy: { sortOrder: "asc" }, take: 200 }), []),
    safe(prisma.posInventoryItem.findMany({ where: { businessId } }), []),
  ]);
  return {
    configuration,
    business,
    orders,
    products,
    inventory,
    settings: parseStorefrontSettings(configuration?.storefrontJson),
    productCount: products.length,
  };
}

/**
 * The fulfilment queue: orders that still need a decision, plus the last few closed ones so the
 * counter can answer "did you get my order?" without opening the shop settings page.
 */
export async function loadOrderQueue(businessId: string) {
  const [orders, items] = await Promise.all([
    safe(prisma.erpStoreOrder.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 200 }), []),
    safe(prisma.erpStoreOrderItem.findMany({ where: { businessId }, take: 2000 }), []),
  ]);
  const byOrder = new Map<string, any[]>();
  for (const item of items) {
    const list = byOrder.get(item.orderId) ?? [];
    list.push(item);
    byOrder.set(item.orderId, list);
  }
  const withItems = orders.map((order: any) => ({ ...order, items: byOrder.get(order.id) ?? [] }));
  const open = withItems.filter((order: any) => ["PENDING", "CONFIRMED", "READY"].includes(String(order.status)));
  const closed = withItems.filter((order: any) => !["PENDING", "CONFIRMED", "READY"].includes(String(order.status)));
  return {
    open,
    closed: closed.slice(0, 25),
    counts: {
      pending: withItems.filter((order: any) => String(order.status) === "PENDING").length,
      accepted: withItems.filter((order: any) => String(order.status) === "CONFIRMED").length,
      ready: withItems.filter((order: any) => String(order.status) === "READY").length,
      openValueCents: open.reduce((total: number, order: any) => total + Number(order.totalCents ?? 0), 0),
    },
  };
}

export async function loadSettings(businessId: string) {
  const [configuration, business, members, auditEvents, subscription, invoiceCount] = await Promise.all([
    safe(prisma.erpConfiguration.findUnique({ where: { businessId } }), null),
    safe(prisma.business.findUnique({ where: { id: businessId }, select: { name: true, slug: true, location: true } }), null),
    safe(prisma.businessMember.findMany({ where: { businessId } }), []),
    safe(prisma.erpAuditEvent.findMany({ where: { businessId }, orderBy: { createdAt: "desc" }, take: 50 }), []),
    safe(prisma.erpSubscription.findUnique({ where: { businessId } }), null),
    safe(prisma.erpInvoice.count({ where: { businessId } }), 0),
  ]);
  return { configuration, business, members, auditEvents, subscription, invoiceCount };
}

export async function loadCampaignDetail(businessId: string, campaignId: string) {
  const campaign = await safe(prisma.msgCampaign.findUnique({ where: { id: campaignId } }), null);
  if (!campaign || campaign.businessId !== businessId) return null;
  const [recipients, events, sender, template] = await Promise.all([
    safe(prisma.msgCampaignRecipient.findMany({ where: { campaignId }, take: 500 }), []),
    safe(prisma.msgMessageEvent.findMany({ where: { campaignId }, orderBy: { receivedAt: "desc" }, take: 100 }), []),
    campaign.senderIdId ? safe(prisma.msgSenderId.findUnique({ where: { id: campaign.senderIdId } }), null) : Promise.resolve(null),
    campaign.templateId ? safe(prisma.msgTemplate.findUnique({ where: { id: campaign.templateId } }), null) : Promise.resolve(null),
  ]);
  const counts = recipients.reduce<Record<string, number>>((total, recipient: any) => {
    total[recipient.status] = (total[recipient.status] ?? 0) + 1;
    return total;
  }, {});
  return { campaign, recipients, events, sender, template, counts };
}

/** Businesses the signed-in user may open, for the product landing page. */
export async function loadErpBusinesses(userId: string, isAdmin: boolean) {
  const owned = await safe(prisma.business.findMany({ where: isAdmin ? {} : { ownerId: userId }, select: { id: true, name: true, slug: true, location: true }, take: 50 }), []);
  const memberships = await safe(prisma.businessMember.findMany({ where: { userId }, select: { businessId: true } }), []);
  const memberIds = memberships.map((membership: any) => membership.businessId).filter((id: string) => !owned.some((business: any) => business.id === id));
  const memberBusinesses = memberIds.length
    ? await safe(prisma.business.findMany({ where: { id: { in: memberIds } }, select: { id: true, name: true, slug: true, location: true } }), [])
    : [];
  const businesses = [...owned, ...memberBusinesses];
  const ids = businesses.map((business: any) => business.id);
  const [configurations, subscriptions] = await Promise.all([
    ids.length ? safe(prisma.erpConfiguration.findMany({ where: { businessId: { in: ids } } }), []) : Promise.resolve([]),
    ids.length ? safe(prisma.erpSubscription.findMany({ where: { businessId: { in: ids } } }), []) : Promise.resolve([]),
  ]);
  return businesses.map((business: any) => ({
    ...business,
    configured: configurations.some((configuration: any) => configuration.businessId === business.id),
    subscription: subscriptions.find((subscription: any) => subscription.businessId === business.id) ?? null,
  }));
}

/**
 * The task board.
 *
 * Reads only this tenant's tasks and resolves assignee names from the business's own owner and
 * members — never from a global user list, which would leak other tenants' people.
 *
 * Open work and finished work are read separately: open work is the board (bounded, all of it),
 * finished work is history and is paginated, because a business that has existed for a year has
 * thousands of finished tasks and nobody scrolls to the end of that.
 */
export async function loadTaskBoard(
  businessId: string,
  options: { viewerId?: string | null; assignee?: "me" | "all"; finishedPage?: number } = {},
) {
  const pageSize = 25;
  const finishedPage = Math.max(1, Number(options.finishedPage ?? 1) || 1);
  const assignedFilter = options.assignee === "me" && options.viewerId ? { assignedTo: options.viewerId } : {};

  const [owner, members, configuration, open, finished, finishedTotal] = await Promise.all([
    safe(prisma.business.findUnique({ where: { id: businessId }, select: { ownerId: true, owner: { select: { id: true, name: true, email: true } } } }), null),
    safe(prisma.businessMember.findMany({ where: { businessId }, select: { userId: true, role: true, user: { select: { id: true, name: true, email: true } } } }), []),
    safe(prisma.erpConfiguration.findUnique({ where: { businessId }, select: { teamRolesJson: true } }), null),
    safe(
      prisma.erpTask.findMany({
        where: { businessId, status: { in: ["OPEN", "IN_PROGRESS"] }, ...assignedFilter },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: 200,
      }),
      [],
    ),
    safe(
      prisma.erpTask.findMany({
        where: { businessId, status: { in: ["DONE", "CANCELLED"] }, ...assignedFilter },
        orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
        skip: (finishedPage - 1) * pageSize,
        take: pageSize,
      }),
      [],
    ),
    safe(prisma.erpTask.count({ where: { businessId, status: { in: ["DONE", "CANCELLED"] }, ...assignedFilter } }), 0),
  ]);

  const roles: Record<string, string> = (() => {
    try {
      const parsed = JSON.parse(String(configuration?.teamRolesJson ?? "{}"));
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch {
      return {};
    }
  })();

  const assignees: Array<{ id: string; name: string; role: string }> = [];
  const seen = new Set<string>();
  const push = (id: string | null | undefined, name: string | null | undefined, email: string | null | undefined, role: string) => {
    if (!id || seen.has(id)) return;
    seen.add(id);
    assignees.push({ id, name: String(name || email || "Team member"), role });
  };
  push(owner?.owner?.id ?? owner?.ownerId, owner?.owner?.name, owner?.owner?.email, "OWNER");
  for (const member of members as any[]) {
    push(member.userId ?? member.user?.id, member.user?.name, member.user?.email, String(roles[member.userId] ?? member.role ?? "STAFF").toUpperCase());
  }

  // Permission is decided by the caller from the workspace role; the loader never asserts it.
  return {
    open: open as any[],
    finished: finished as any[],
    finishedTotal,
    finishedPage,
    finishedPages: Math.max(1, Math.ceil(finishedTotal / pageSize)),
    assignees,
    filter: options.assignee === "me" ? "me" : "all",
  };
}

/**
 * The notification centre. Read state is per person, so two people opening the same shared notice do
 * not consume each other's unread badge.
 */
export async function loadNotificationCentre(
  businessId: string,
  viewer: { userId: string; role: string },
  options: { unreadOnly?: boolean } = {},
) {
  const [list, total] = await Promise.all([
    listNotifications(prisma, { businessId, viewer, unreadOnly: options.unreadOnly, limit: 100 }).catch(() => ({ notifications: [], unread: 0, scanned: 0 })),
    safe(prisma.erpNotification.count({ where: { businessId } }), 0),
  ]);
  return { ...list, stored: total, unreadOnly: Boolean(options.unreadOnly) };
}

/** The bell count for the shell. Cheap enough for every page load, and it matches the screen. */
export async function loadNotificationBadge(businessId: string, viewer: { userId: string; role: string }) {
  return unreadNotificationCount(prisma, { businessId, viewer }).catch(() => 0);
}

/**
 * "What needs you today" for the home screen: the person's own open work, the tenant's overdue count,
 * unread notices and the newest few notices. Every figure is a count of stored rows for this tenant.
 */
export async function loadWorkDashboard(businessId: string, viewer: { userId: string; role: string }) {
  const [mine, summary, unread, latest, approvals] = await Promise.all([
    safe(
      prisma.erpTask.findMany({
        where: { businessId, assignedTo: viewer.userId, status: { in: ["OPEN", "IN_PROGRESS"] } },
        orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }],
        take: 5,
      }),
      [],
    ),
    safe(taskSummary(prisma, businessId), { open: 0, overdue: 0, unassigned: 0 }),
    safe(unreadNotificationCount(prisma, { businessId, viewer }), 0),
    safe(
      prisma.erpNotification.findMany({
        where: { businessId, OR: [{ recipientId: viewer.userId }, { recipientId: null }] },
        orderBy: { createdAt: "desc" },
        take: 12,
        include: { reads: { where: { userId: viewer.userId }, select: { userId: true } } },
      }),
      [],
    ),
    approvalSummary(prisma, businessId, {
      viewer,
      scope: hasErpPermission(viewer.role as any, "VIEW_FINANCE") ? "all" : "mine",
    }).catch(() => ({ pending: 0, approved: 0, rejected: 0 })),
  ]);

  const visible = (latest as any[]).filter((row) => notificationVisibleTo(row, viewer)).slice(0, 5);
  const nowMs = Date.now();
  return {
    // Overdue is decided here, from stored dates, so the page never computes time during render.
    myTasks: (mine as any[]).map((task) => ({
      ...task,
      overdue: Boolean(task.dueAt && new Date(task.dueAt).getTime() < nowMs),
    })),
    summary,
    approvals,
    unread,
    latest: visible.map((row) => ({
      ...row,
      read: (Array.isArray(row.reads) && row.reads.length > 0) || (!row.recipientId && Boolean(row.readAt)),
    })),
  };
}

/**
 * The approval queue.
 *
 * Who sees what is decided here, on the server: a finance-capable role sees every request in the
 * tenant, everybody else sees only what they asked for or what was addressed to them by name. The
 * amount is part of the row, so this scoping is a data-protection control, not a display preference.
 */
export async function loadApprovalCentre(businessId: string, viewer: { userId: string; role: string }) {
  const scope: "all" | "mine" = hasErpPermission(viewer.role as any, "VIEW_FINANCE") ? "all" : "mine";
  const [requests, summary] = await Promise.all([
    listApprovalRequests(prisma, { businessId, decider: viewer, limit: 100, scope }).catch(() => []),
    approvalSummary(prisma, businessId, { viewer, scope }).catch(() => ({ pending: 0, approved: 0, rejected: 0 })),
  ]);
  return {
    requests: requests as any[],
    pending: (requests as any[]).filter((row) => row.status === "PENDING"),
    decided: (requests as any[]).filter((row) => row.status !== "PENDING"),
    summary,
    scope,
    canApprove: hasErpPermission(viewer.role as any, "APPROVE_SPEND"),
  };
}
