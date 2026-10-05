/**
 * The POS workspace (§23, §24, §34, §44, §61)
 *
 * One server-side load per screen. Everything a POS page renders is derived here from the
 * authorized tenant context and the effective configuration — navigation, cards, quick
 * actions, the setup checklist and the numbers behind them. Client components receive plain
 * data and never re-derive permissions or totals (§56).
 */

import * as React from "react";
import { getBusinessPosPlan } from "@/lib/pricing";
import { getSession } from "@/lib/auth";
import type { SessionPayload } from "@/lib/auth";
import { PosAccessError, requirePosAccess, requirePosAccessFromRequest, type PosAccessOptions, type PosContext } from "./guard";
import type { PermissionKey } from "./permissions";
import { POS_PLAN_DURATION_DAYS, POS_PLAN_KEY, POS_PLAN_NAME, POS_PLAN_PRICE_KES, POS_LIFECYCLE_LABELS } from "./entitlement";
import {
  buildNavigation,
  deriveDashboardCards,
  deriveQuickActions,
  orderStatesFor,
  reportDefinitions,
  setupSteps,
  type NavItem,
  type QuickAction,
  type ReportDefinition,
  type SetupStep,
} from "./presentation";
import { resolveTerminology, type Terminology } from "./terminology";
import { configurationReadiness } from "./questionnaire";
import { configurationHeadline, configurationSummary } from "./configuration";
import { paymentMethodOptions } from "./money";
import { lowStock, posCounts, salesTotals, type PosCounts, type PosClient } from "./store";
import type { DashboardCardKey, PosConfiguration } from "./types";
import prisma from "@/lib/db";

export function posBasePath(businessId: string): string {
  return `/dashboard/pos/${encodeURIComponent(businessId)}`;
}

export type PosWorkspace = PosContext & {
  basePath: string;
  navigation: NavItem[];
  quickActions: QuickAction[];
  dashboardCards: DashboardCardKey[];
  reports: ReportDefinition[];
  steps: (SetupStep & { href: string; done: boolean })[];
  counts: PosCounts;
  today: { count: number; totalKES: number; balanceKES: number };
  alerts: { lowStock: number };
  creditOutstandingKES: number;
  supplierOutstandingKES: number;
  plan: { key: string; name: string; priceKES: number; durationDays: number };
  /** True once a configuration is published and the subscription permits trading (§44). */
  ready: boolean;
  /** One plain-language line for the banner; null when nothing needs saying (§38). */
  notice: string | null;
  noticeTone: "info" | "warn" | "danger" | "success";
  noticeHref: string | null;
};

function startOfToday(now: Date = new Date()): Date {
  const date = new Date(now);
  date.setHours(0, 0, 0, 0);
  return date;
}

async function outstandingTotals(businessId: string, client: PosClient = prisma) {
  const [customers, suppliers] = await Promise.all([
    client.posCustomer.findMany({ where: { businessId, creditEnabled: true }, select: { balanceKES: true } }),
    client.posSupplier.findMany({ where: { businessId }, select: { balanceKES: true } }),
  ]);
  const sum = (rows: any[]) => rows.reduce((total, row) => total + Math.max(0, Number(row.balanceKES ?? 0)), 0);
  return { creditOutstandingKES: sum(customers), supplierOutstandingKES: sum(suppliers) };
}

/**
 * Loads and authorizes a POS screen. Throws `PosAccessError` (mapped to a safe HTTP response by
 * the API layer, or `notFound()` by pages) rather than leaking whether another tenant exists.
 */
export async function loadPosWorkspace(businessId: string, options: PosAccessOptions = {}): Promise<PosWorkspace> {
  const session = await getSession();
  return loadPosWorkspaceForSession(businessId, session, options);
}

function loadWorkspaceFast(businessId: string, options: PosAccessOptions = {}): Promise<PosWorkspace> {
  return loadPosWorkspace(businessId, { fast: true, ...options });
}

/**
 * Per-request memoized load, so the POS shell and the page inside it share one authorization and
 * one set of counts instead of repeating them (§58 — the screens have to feel fast on a phone).
 *
 * React's `cache` dedupes a single server render pass and exists only from React 19 onwards; this
 * repository still pins React 18, where importing it yields `undefined` and calling it at module
 * scope crashes every POS screen on load. It is therefore used when the runtime provides it and
 * skipped when it does not.
 *
 * The fallback is deliberately *not* a module-level map: a memo that outlives the request would
 * hand one person's role, permissions and branch scoping to the next caller (§5, §56). Losing the
 * dedupe costs one extra read; leaking an authorization context would not be acceptable.
 */
const requestCache = typeof (React as { cache?: unknown }).cache === "function"
  ? ((React as unknown as { cache: <T extends (...args: any[]) => any>(fn: T) => T }).cache)
  : null;

export const loadPosWorkspaceCached: (businessId: string, options?: PosAccessOptions) => Promise<PosWorkspace> = requestCache
  ? requestCache(loadWorkspaceFast)
  : loadWorkspaceFast;

/**
 * The answer a server-rendered POS page gets (§11, §36, §56).
 *
 * Flat, like every other POS result, because `strictNullChecks` is off: exactly one of
 * `workspace` and `refusal` is present.
 */
export type PosPageGate = {
  businessId: string;
  basePath: string;
  /** The module-read permission this page required — the same one its API read requires. */
  permission: PermissionKey;
  workspace?: PosWorkspace;
  /** Plain-language sentence, safe to show the person who was refused (§38). */
  refusal?: string;
};

/** Refusals that mean "this screen is not for you", as opposed to "this tenant is not yours". */
const PAGE_REFUSAL_CODES = new Set(["PERMISSION", "STAFF_INACTIVE"]);

/**
 * Load a POS page's workspace and enforce the module's read permission in one step (§11).
 *
 * The screen-level APIs already refuse a read the actor's role does not hold. A page that reads
 * the store behind the workspace loader must answer the same way, or a cashier who types the URL
 * sees data the equivalent API call refuses. The check runs inside `requirePosAccess` — the same
 * permission engine and the same audit entry — *before* any store read, so a refused page loads
 * nothing and renders the "not for you" state instead.
 *
 * Anything that is not a role refusal (a signed-out session, another tenant, an unexpected
 * failure) is re-thrown so the POS shell keeps explaining it exactly as it does today.
 */
export async function loadPosPageWorkspace(businessId: string, permission: PermissionKey): Promise<PosPageGate> {
  const gate: PosPageGate = { businessId, basePath: posBasePath(businessId), permission };
  try {
    return { ...gate, workspace: await loadPosWorkspaceCached(businessId, { permission, fast: true }) };
  } catch (error) {
    if (error instanceof PosAccessError && PAGE_REFUSAL_CODES.has(error.code)) {
      return { ...gate, refusal: error.message };
    }
    throw error;
  }
}

export async function loadPosWorkspaceForSession(
  businessId: string,
  session: SessionPayload | null,
  options: PosAccessOptions = {},
): Promise<PosWorkspace> {
  const context = session
    ? await requirePosAccess(businessId, session, options)
    : await requirePosAccessFromRequest(businessId, options);

  const basePath = posBasePath(businessId);
  const configuration: PosConfiguration = context.configuration;
  const terminology: Terminology = context.terminology ?? resolveTerminology(configuration);
  const counts = await posCounts(businessId);
  const [today, stock, outstanding] = await Promise.all([
    // "Today" is the actor's own scope: a staff member bound to a location sees that
    // location's takings, an unbound actor sees the whole business (§16, §75).
    salesTotals(businessId, { from: startOfToday() }, prisma, { branchId: context.branchId }),
    configuration.inventory.enabled ? lowStock(businessId, prisma, { branchId: context.branchId }) : Promise.resolve([]),
    outstandingTotals(businessId),
  ]);

  const readiness = configurationReadiness(context.record?.answers ?? {});
  const completed = new Set<string>();
  if (counts.products > 0) completed.add("products");
  if (counts.customers > 0) completed.add("customers");
  if (counts.suppliers > 0) completed.add("suppliers");
  if (counts.staff > 0) completed.add("staff");
  if (counts.sales > 0) completed.add("first_sale");
  if (context.record?.publishedVersion) completed.add("configuration");

  const workspace: PosWorkspace = {
    ...context,
    basePath,
    terminology,
    navigation: buildNavigation(configuration, basePath),
    quickActions: deriveQuickActions(configuration, basePath),
    dashboardCards: deriveDashboardCards(configuration),
    reports: reportDefinitions(configuration),
    steps: setupSteps(configuration, basePath, completed),
    counts,
    today: { count: today.count, totalKES: today.totalKES, balanceKES: today.balanceKES },
    alerts: { lowStock: stock.length },
    creditOutstandingKES: outstanding.creditOutstandingKES,
    supplierOutstandingKES: outstanding.supplierOutstandingKES,
    plan: {
      key: POS_PLAN_KEY,
      name: POS_PLAN_NAME,
      priceKES: POS_PLAN_PRICE_KES,
      durationDays: POS_PLAN_DURATION_DAYS,
    },
    ready: context.lifecycle === "LIVE" && Boolean(context.record?.publishedVersion),
    notice: null,
    noticeTone: "info",
    noticeHref: null,
  };

  const notice = workspaceNotice(workspace, readiness.missing.length);
  return { ...workspace, ...notice };
}

/**
 * The banner a screen shows before anything else (§44, §60, §61). It always says what to do
 * next in the owner's own words, and it never uses platform internals (§38).
 */
export function workspaceNotice(
  workspace: Pick<PosWorkspace, "lifecycle" | "basePath" | "record" | "counts" | "terminology" | "configuration">,
  remainingQuestions: number,
): { notice: string | null; noticeTone: PosWorkspace["noticeTone"]; noticeHref: string | null } {
  const { lifecycle, basePath, record, counts, terminology } = workspace;

  switch (lifecycle) {
    case "DRAFT":
    case "CONFIGURED":
      return {
        notice: remainingQuestions > 0
          ? `${remainingQuestions} more question${remainingQuestions === 1 ? "" : "s"} and your POS is configured.`
          : "Your POS is configured. Preview it, then choose a plan to go live.",
        noticeTone: "info",
        noticeHref: remainingQuestions > 0 ? `${basePath}/configure` : `${basePath}/preview`,
      };
    case "PREVIEW":
      return {
        notice: "This is a preview with sample data. Nothing here is saved to your business.",
        noticeTone: "info",
        noticeHref: `${basePath}/plan`,
      };
    case "AWAITING_PAYMENT":
      return {
        notice: "Your plan is chosen. Complete the payment to switch your POS on.",
        noticeTone: "warn",
        noticeHref: `${basePath}/plan`,
      };
    case "PAYMENT_CONFIRMED":
    case "PROVISIONING":
      return {
        notice: "Payment received. We're switching your POS on — this takes a moment.",
        noticeTone: "info",
        noticeHref: null,
      };
    case "SUSPENDED":
      return {
        notice: "Your POS is paused because the plan lapsed. Renew to carry on trading.",
        noticeTone: "danger",
        noticeHref: `${basePath}/plan`,
      };
    case "CANCELLED":
      return {
        notice: "This POS was cancelled. Your records are still here; renew to trade again.",
        noticeTone: "danger",
        noticeHref: `${basePath}/plan`,
      };
    case "LIVE":
    default:
      break;
  }

  if (counts.products === 0) {
    return {
      notice: `Add your first ${terminology.product.toLowerCase()} and you can take a ${terminology.sale.toLowerCase()} in under a minute.`,
      noticeTone: "info",
      noticeHref: `${basePath}/products?new=1`,
    };
  }
  if (counts.sales === 0) {
    return {
      notice: `Everything is ready. Record your first ${terminology.sale.toLowerCase()}.`,
      noticeTone: "success",
      noticeHref: `${basePath}/sell`,
    };
  }
  if (record && record.publishedVersion > 0 && record.draftVersion > record.publishedVersion) {
    return {
      notice: "You have unpublished changes to how your POS works.",
      noticeTone: "warn",
      noticeHref: `${basePath}/configure`,
    };
  }
  return { notice: null, noticeTone: "info", noticeHref: null };
}

/** The lifecycle word the owner sees, so screens never print a raw state constant (§38). */
export function lifecycleWord(lifecycle: PosWorkspace["lifecycle"]): string {
  const entry = POS_LIFECYCLE_LABELS[lifecycle];
  return typeof entry === "string" ? entry : entry?.label ?? String(lifecycle);
}

/** Plan copy for the POS plan screen — resolved server-side, never from the browser (§45, §56). */
export async function posPlanDetails() {
  const plan = await getBusinessPosPlan();
  return {
    id: plan?.id ?? null,
    key: plan?.key ?? POS_PLAN_KEY,
    name: plan?.name ?? POS_PLAN_NAME,
    priceKES: plan?.priceKES ?? POS_PLAN_PRICE_KES,
    durationDays: plan?.durationDays ?? POS_PLAN_DURATION_DAYS,
    available: Boolean(plan?.isActive),
  };
}

/**
 * The JSON-safe projection a client component receives (§56). Permissions, totals and the
 * lifecycle are computed on the server; the browser is given the answer, never the inputs.
 */
export function serializeWorkspace(workspace: PosWorkspace) {
  return {
    basePath: workspace.basePath,
    business: {
      id: workspace.business.id,
      name: workspace.business.name,
      slug: workspace.business.slug,
      phone: workspace.business.phone,
      location: workspace.business.location,
      logoUrl: workspace.business.logoUrl,
    },
    roleKey: workspace.roleKey,
    permissions: workspace.permissions,
    staffId: workspace.staffId,
    staffName: workspace.staffName,
    branchId: workspace.branchId,
    lifecycle: workspace.lifecycle,
    lifecycleLabel: workspace.lifecycleLabel,
    entitlement: {
      entitled: workspace.entitlement.entitled,
      status: workspace.entitlement.status,
      reason: workspace.entitlement.reason,
      nextAction: workspace.entitlement.nextAction,
      expiresAt: workspace.entitlement.expiresAt ? new Date(workspace.entitlement.expiresAt).toISOString() : null,
    },
    configuration: {
      businessTypeKey: workspace.configuration.business.typeKey,
      businessTypeLabel: workspace.configuration.business.typeLabel,
      otherDescription: workspace.configuration.business.otherDescription,
      capabilities: workspace.configuration.capabilities,
      draftVersion: workspace.record?.draftVersion ?? 1,
      publishedVersion: workspace.record?.publishedVersion ?? 0,
      summary: configurationSummary(workspace.configuration),
      headline: configurationHeadline(workspace.configuration),
    },
    terminology: workspace.terminology,
    navigation: workspace.navigation,
    quickActions: workspace.quickActions,
    dashboardCards: workspace.dashboardCards,
    reports: workspace.reports.map((report) => ({ key: report.key, label: report.label, basis: report.basis, blurb: report.blurb })),
    steps: workspace.steps,
    counts: workspace.counts,
    today: workspace.today,
    alerts: workspace.alerts,
    creditOutstandingKES: workspace.creditOutstandingKES,
    supplierOutstandingKES: workspace.supplierOutstandingKES,
    plan: workspace.plan,
    ready: workspace.ready,
    notice: workspace.notice,
    noticeTone: workspace.noticeTone,
    noticeHref: workspace.noticeHref,
    paymentMethods: paymentMethodOptions(workspace.configuration),
    orderStates: orderStatesFor(workspace.configuration),
  };
}

export type SerializedWorkspace = ReturnType<typeof serializeWorkspace>;
