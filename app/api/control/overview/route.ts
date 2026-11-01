import { controlJson } from "@/lib/control/http";
import prisma from "@/lib/db";
import { requireAnyControlPermission, controlAccessError, hasControlPermission, scopedBusinessIds } from "@/lib/control/access";
import type { ControlPermission } from "@/lib/control/permissions";

export const dynamic = "force-dynamic";
const READ_PERMISSIONS: ControlPermission[] = [
  "businesses.read", "subscriptions.read", "payments.read", "agents.read", "commissions.read",
  "communications.read", "providers.read", "audit.read", "exceptions.read", "system.health.read",
];

type Section<T> = { state: "VERIFIED" | "PENDING" | "FAILED" | "UNAVAILABLE"; source: string; asOf: string; data: T | null; note?: string };
const asOf = () => new Date().toISOString();
function unavailable<T>(source: string, note: string): Section<T> { return { state: "UNAVAILABLE", source, asOf: asOf(), data: null, note }; }
function measured<T>(source: string, data: T, state: Section<T>["state"] = "VERIFIED", note?: string): Section<T> { return { state, source, asOf: asOf(), data, ...(note ? { note } : {}) }; }

export async function GET() {
  const access = await requireAnyControlPermission(READ_PERMISSIONS);
  if (access.ok === false) return controlJson(controlAccessError(access), { status: access.status });
  const { grants } = access.identity;
  const sections: Record<string, Section<any>> = {};
  const can = (permission: ControlPermission) => hasControlPermission(grants, permission);
  const safe = async <T,>(key: string, source: string, fn: () => Promise<T>, state?: (value: T) => Section<T>["state"], note?: string) => {
    if (!can(key as ControlPermission)) return;
    try {
      const data = await fn();
      sections[key] = measured(source, data, state?.(data) ?? "VERIFIED", note);
    } catch {
      sections[key] = unavailable(source, "The authoritative query failed; no value is inferred.");
    }
  };

  const businessScope = scopedBusinessIds(grants, "businesses.read");
  if (businessScope.allowed) {
    if (!businessScope.global && !businessScope.ids.length) sections.businesses = measured("Business records", { total: 0, published: 0, suspended: 0, recent: [] });
    else {
      await safe("businesses.read", "Business records", async () => {
        const where = businessScope.global ? {} : { id: { in: businessScope.ids } };
        const [total, published, suspended, recent] = await Promise.all([
          prisma.business.count({ where }),
          prisma.business.count({ where: { ...where, isPublished: true } }),
          prisma.business.count({ where: { ...where, status: "SUSPENDED" } }),
          prisma.business.findMany({ where, select: { id: true, name: true, category: true, status: true, isPublished: true, createdAt: true }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 8 }),
        ]);
        return { total, published, suspended, recent };
      }, undefined, "Owner names, emails, phone numbers, payment details and other personal data are not exposed; owner-visibility policy remains pending.");
    }
  }

  for (const [permission, model, source, statusField] of [
    ["subscriptions.read", "subscription", "Subscription records", "status"],
    ["payments.read", "payment", "Payment records", "status"],
  ] as const) {
    const scope = scopedBusinessIds(grants, permission);
    if (!scope.allowed) continue;
    if (!scope.global && !scope.ids.length) {
      sections[permission] = measured(source, { byStatus: [], total: 0 });
      continue;
    }
    await safe(permission, source, async () => {
      const where = scope.global ? {} : { businessId: { in: scope.ids } };
      const client = prisma[model];
      const [total, byStatus] = await Promise.all([
        client.count({ where }),
        client.groupBy({ by: [statusField], where, _count: { _all: true } }),
      ]);
      return { total, byStatus: byStatus.map((row: any) => ({ status: row.status, count: row._count._all })) };
    }, (data) => data.byStatus.some((row: any) => row.status === "FAILED") ? "FAILED" : data.byStatus.some((row: any) => row.status === "PENDING" || row.status === "EXPIRING") ? "PENDING" : "VERIFIED");
  }

  const agentsScope = scopedBusinessIds(grants, "agents.read");
  if (agentsScope.allowed && !agentsScope.global) {
    sections["agents.read"] = unavailable("Agent application and referral evidence", "Agent applications have no tenant key for safe filtering; this module requires an explicit platform-wide grant.");
  } else if (agentsScope.global) {
    await safe("agents.read", "Agent application and referral evidence", async () => {
      const [total, byStatus, byAgentStatus, referrals] = await Promise.all([
        prisma.agentApplication.count(),
        prisma.agentApplication.groupBy({ by: ["status"], _count: { _all: true } }),
        prisma.agentApplication.groupBy({ by: ["agentStatus"], _count: { _all: true } }),
        prisma.agentReferralAttribution.count(),
      ]);
      return {
        total,
        byStatus: byStatus.map((row: any) => ({ status: row.status, count: row._count._all })),
        byAgentStatus: byAgentStatus.map((row: any) => ({ status: row.agentStatus, count: row._count._all })),
        consentedRegistrationAttributions: referrals,
      };
    }, (data) => data.byStatus.some((row: any) => row.status === "PENDING") ? "PENDING" : "VERIFIED", "Referral counts are consented registration evidence, not commission-eligible events.");
  }

  const commissionsScope = scopedBusinessIds(grants, "commissions.read");
  if (commissionsScope.allowed && !commissionsScope.global && !commissionsScope.ids.length) {
    sections["commissions.read"] = measured("Immutable commission-ledger storage", { total: 0, byEntryType: [] }, "PENDING", "No business scope is attached to this grant.");
  } else if (commissionsScope.allowed) {
    await safe("commissions.read", "Immutable commission-ledger storage", async () => {
      const where = commissionsScope.global ? {} : { payment: { businessId: { in: commissionsScope.ids } } };
      const [total, byEntryType] = await Promise.all([
        prisma.agentCommissionLedgerEntry.count({ where }),
        prisma.agentCommissionLedgerEntry.groupBy({ by: ["entryType"], where, _count: { _all: true } }),
      ]);
      return { total, byEntryType: byEntryType.map((row: any) => ({ entryType: row.entryType, count: row._count._all })) };
    }, () => "PENDING", "Stored rows are not approved commission policy, payable balances, reconciliation, or payout eligibility; no amounts are totaled.");
  }

  if (can("communications.read")) {
    const global = scopedBusinessIds(grants, "communications.read").global;
    sections.communications = global
      ? await (async () => {
          try {
            const byState = await prisma.agentAdminNotificationDelivery.groupBy({ by: ["state"], _count: { _all: true } });
            const uncertain = byState.some((row: any) => ["UNKNOWN", "FAILED"].includes(row.state));
            return measured("Agent notification outbox states", { byState: byState.map((row: any) => ({ state: row.state, count: row._count._all })) }, uncertain ? "FAILED" : "PENDING", "Queue/claim status is not proof of delivery; recipient identities are not queried.");
          } catch { return unavailable("Agent notification outbox states", "The authoritative query failed; no delivery is inferred."); }
        })()
      : unavailable("Agent notification outbox states", "This source has no tenant key for safe scoped filtering; global permission is required.");
  }

  const providerScope = scopedBusinessIds(grants, "providers.read");
  if (providerScope.allowed) sections.providers = unavailable("Vercel / Neon / Paystack / messaging / storage provider probes", providerScope.global ? "No authenticated provider health probe with a verified source and last-success timestamp is configured. No credentials or simulated status are shown." : "Provider status is platform-wide; an explicit platform-wide grant is required. No provider probe or simulated status is shown.");

  const systemScope = scopedBusinessIds(grants, "system.health.read");
  if (systemScope.allowed && !systemScope.global) sections.system = unavailable("Application runtime and database connection", "Platform health is not tenant-keyed; an explicit platform-wide grant is required.");
  if (systemScope.global) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      sections.system = measured("Application runtime and database connection", { application: "RESPONDING", database: "REACHABLE", observedAt: asOf() });
    } catch {
      sections.system = unavailable("Application runtime and database connection", "The database health query failed.");
    }
  }

  if (can("exceptions.read")) {
    const global = scopedBusinessIds(grants, "exceptions.read").global;
    sections.exceptions = global
      ? await (async () => {
          try {
            const [failedPayments, pendingAgents, notificationStates] = await Promise.all([
              prisma.payment.count({ where: { status: { in: ["FAILED", "REFUNDED"] } } }),
              prisma.agentApplication.count({ where: { status: "PENDING" } }),
              prisma.agentAdminNotificationDelivery.groupBy({ by: ["state"], where: { state: { in: ["FAILED", "UNKNOWN"] } }, _count: { _all: true } }),
            ]);
            return measured("Operational exception sources", { failedOrRefundedPaymentRecords: failedPayments, pendingAgentApplications: pendingAgents, failedOrUnknownNotificationRows: notificationStates.reduce((sum: number, row: any) => sum + row._count._all, 0) }, pendingAgents || notificationStates.length ? "PENDING" : failedPayments ? "FAILED" : "VERIFIED", "Counts classify stored records only; they do not authorize financial action or prove delivery.");
          } catch { return unavailable("Operational exception sources", "One or more authoritative exception queries failed."); }
        })()
      : unavailable("Operational exception sources", "This source set includes platform-wide records; explicit global permission is required.");
  }

  if (can("audit.read")) {
    const scope = scopedBusinessIds(grants, "audit.read");
    if (scope.global || scope.ids.length) {
      try {
        const where = scope.global ? {} : { scopeBusinessId: { in: scope.ids } };
        const [total, recent] = await Promise.all([
          prisma.controlAuditEvent.count({ where }),
          prisma.controlAuditEvent.findMany({ where, select: { id: true, actorId: true, actorRole: true, action: true, targetType: true, targetId: true, scopeBusinessId: true, outcome: true, reason: true, correlationId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 10 }),
        ]);
        sections.audit = measured("Append-only control audit events", { total, recent });
      } catch { sections.audit = unavailable("Append-only control audit events", "The audit store could not be read; absence of data is not reported as zero."); }
    }
  }

  return controlJson({ asOf: asOf(), roles: [...new Set(grants.map((grant) => grant.role))], permissions: [...new Set(grants.flatMap((grant) => grant.permissionKeys))], sections });
}
