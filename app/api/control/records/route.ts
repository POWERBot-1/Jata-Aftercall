import { controlJson } from "@/lib/control/http";
import prisma from "@/lib/db";
import { controlAccessError, requireControlPermission, scopedBusinessIds, type ControlGrant } from "@/lib/control/access";
import { createControlAuditEvent } from "@/lib/control/audit";
import { getCorrelationId } from "@/lib/control/security";
import type { ControlPermission } from "@/lib/control/permissions";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 25;
const SOURCES = {
  subscriptions: { permission: "subscriptions.read", target: "SUBSCRIPTION_RECORDS" },
  payments: { permission: "payments.read", target: "PAYMENT_RECORDS" },
  agents: { permission: "agents.read", target: "AGENT_APPLICATION_RECORDS" },
  commissions: { permission: "commissions.read", target: "COMMISSION_LEDGER_RECORDS" },
} as const satisfies Record<string, { permission: ControlPermission; target: string }>;
type RecordKind = keyof typeof SOURCES;

function isRecordKind(value: string | null): value is RecordKind {
  return value !== null && Object.hasOwn(SOURCES, value);
}

function scopedWhere(kind: RecordKind, global: boolean, ids: string[]) {
  if (global) return {};
  if (kind === "commissions") return { payment: { businessId: { in: ids } } };
  return { businessId: { in: ids } };
}

function selectGrantForScope(grants: ControlGrant[], permission: ControlPermission, businessId?: string): ControlGrant | undefined {
  return grants.find((grant) => grant.permissionKeys.includes(permission)
    && (businessId === undefined ? grant.scopeBusinessId === null : grant.scopeBusinessId === businessId || grant.scopeBusinessId === null));
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const kindValue = url.searchParams.get("kind");
  if (!isRecordKind(kindValue)) return controlJson({ error: "Choose a supported record kind." }, { status: 400 });
  const kind = kindValue;
  const { permission, target } = SOURCES[kind];
  const access = await requireControlPermission(permission);
  if (access.ok === false) return controlJson(controlAccessError(access), { status: access.status });

  const initialScope = scopedBusinessIds(access.identity.grants, permission);
  if (!initialScope.allowed) return controlJson({ error: "No explicit permission for this record view." }, { status: 403 });
  if (kind === "agents" && !initialScope.global) {
    return controlJson({ error: "Agent applications have no tenant key for safe filtering; a platform-wide grant is required." }, { status: 403 });
  }

  const cursor = url.searchParams.get("cursor") || undefined;
  if (cursor && (cursor.length > 128 || /[\u0000-\u001f]/.test(cursor))) return controlJson({ error: "Invalid page cursor." }, { status: 400 });
  const candidateGrantIds = access.identity.grants.filter((grant) => grant.permissionKeys.includes(permission)).map((grant) => grant.id);
  const correlationId = getCorrelationId(request.headers);

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Hold the active grant rows while reading and recording the view, so a concurrent
      // revocation/permission change cannot race this protected operation.
      const liveGrants = await tx.$queryRaw<ControlGrant[]>`
        SELECT "id", "role", "permissionKeys", "scopeBusinessId"
        FROM "ControlRoleGrant"
        WHERE "id" = ANY(${candidateGrantIds}::text[])
          AND "userId" = ${access.identity.session.userId}
          AND "revokedAt" IS NULL
          AND "permissionKeys" @> ARRAY[${permission}]::text[]
        ORDER BY "createdAt" DESC
        FOR SHARE
      `;
      const scope = scopedBusinessIds(liveGrants, permission);
      if (!scope.allowed) return { denied: true as const };
      if (kind === "agents" && !scope.global) return { denied: true as const };
      if (!scope.global && scope.ids.length === 0) {
        const grant = selectGrantForScope(liveGrants, permission);
        if (!grant) return { denied: true as const };
        await createControlAuditEvent(tx, {
          actorId: access.identity.session.userId, grant, action: "CONTROL_RECORDS_READ", targetType: target,
          outcome: "SUCCESS", correlationId, metadata: { kind, recordCount: 0, pageCursorUsed: Boolean(cursor) },
        });
        return { items: [], nextCursor: null };
      }

      const where = scopedWhere(kind, scope.global, scope.ids);
      const delegate: any = kind === "subscriptions" ? tx.subscription
        : kind === "payments" ? tx.payment
          : kind === "agents" ? tx.agentApplication
            : tx.agentCommissionLedgerEntry;
      if (!delegate) throw new Error("RECORD_SOURCE_UNAVAILABLE");
      if (cursor) {
        const cursorRecord = await delegate.findFirst({ where: { ...where, id: cursor }, select: { id: true } });
        if (!cursorRecord) return { invalidCursor: true as const };
      }

      let rows: any[];
      if (kind === "subscriptions") {
        rows = await tx.subscription.findMany({
          where, select: { id: true, businessId: true, status: true, startAt: true, expiresAt: true, createdAt: true, plan: { select: { key: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
      } else if (kind === "payments") {
        rows = await tx.payment.findMany({
          where, select: { id: true, businessId: true, status: true, purpose: true, createdAt: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
      } else if (kind === "agents") {
        rows = await tx.agentApplication.findMany({
          where, select: { id: true, status: true, agentStatus: true, createdAt: true, updatedAt: true },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
      } else {
        rows = await tx.agentCommissionLedgerEntry.findMany({
          where, select: { id: true, entryType: true, createdAt: true, payment: { select: { businessId: true } } },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: PAGE_SIZE + 1,
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
        });
      }
      const hasMore = rows.length > PAGE_SIZE;
      const page = hasMore ? rows.slice(0, PAGE_SIZE) : rows;
      const items = kind === "commissions" ? page.map(({ payment: _payment, ...row }) => row) : page;
      const scopeIdsOnPage = kind === "commissions"
        ? [...new Set(page.map((row) => row.payment?.businessId).filter((id): id is string => typeof id === "string"))]
        : kind === "agents" ? [] : [...new Set(page.map((row) => row.businessId).filter((id): id is string => typeof id === "string"))];
      const auditScopes: Array<{ grant: ControlGrant; businessId?: string; recordCount: number }> = scope.global
        ? [{ grant: selectGrantForScope(liveGrants, permission)!, recordCount: page.length }]
        : (scopeIdsOnPage.length ? scopeIdsOnPage : scope.ids).map((businessId) => ({
            grant: selectGrantForScope(liveGrants, permission, businessId)!, businessId,
            recordCount: page.filter((row) => kind === "commissions" ? row.payment?.businessId === businessId : row.businessId === businessId).length,
          }));
      for (const auditScope of auditScopes) {
        if (!auditScope.grant) continue;
        await createControlAuditEvent(tx, {
          actorId: access.identity.session.userId, grant: auditScope.grant, action: "CONTROL_RECORDS_READ", targetType: target,
          targetId: kind, scopeBusinessId: auditScope.businessId, outcome: "SUCCESS", correlationId,
          metadata: { kind, recordCount: auditScope.recordCount, pageCursorUsed: Boolean(cursor) },
        });
      }
      return { items, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null };
    });

    if ("denied" in result) return controlJson({ error: "Permission was revoked or narrowed before the record view completed." }, { status: 403 });
    if ("invalidCursor" in result) return controlJson({ error: "The page cursor is invalid or outside the authorized scope." }, { status: 400 });
    return controlJson({ ...result, kind, source: target, asOf: new Date().toISOString(), pageSize: PAGE_SIZE });
  } catch {
    return controlJson({ error: "Authoritative records are unavailable. No substitute data was used." }, { status: 503 });
  }
}
