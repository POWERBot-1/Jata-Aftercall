import { controlJson } from "@/lib/control/http";
import prisma from "@/lib/db";
import { requireControlPermission, controlAccessError, scopedBusinessIds, type ControlGrant } from "@/lib/control/access";
import { createControlAuditEvent } from "@/lib/control/audit";
import { getCorrelationId, hasSameOrigin } from "@/lib/control/security";
import { rateLimitByIdentity } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const access = await requireControlPermission("businesses.read");
  if (access.ok === false) return controlJson(controlAccessError(access), { status: access.status });
  const scope = scopedBusinessIds(access.identity.grants, "businesses.read");
  if (!scope.allowed) return controlJson({ error: "Business access denied." }, { status: 403 });
  const url = new URL(request.url);
  const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
  const cursor = url.searchParams.get("cursor") || undefined;
  if (!scope.global && scope.ids.length === 0) return controlJson({ items: [], nextCursor: null, source: "Business records", asOf: new Date().toISOString() });
  try {
    const items = await prisma.business.findMany({
      where: {
        ...(scope.global ? {} : { id: { in: scope.ids } }),
        ...(query ? { OR: [{ name: { contains: query, mode: "insensitive" } }, { slug: { contains: query, mode: "insensitive" } }] } : {}),
      },
      select: { id: true, name: true, slug: true, category: true, status: true, isPublished: true, createdAt: true, updatedAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > PAGE_SIZE;
    const page = hasMore ? items.slice(0, PAGE_SIZE) : items;
    return controlJson({ items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null, source: "Business records", asOf: new Date().toISOString() });
  } catch {
    return controlJson({ error: "Business records are unavailable." }, { status: 503 });
  }
}

export async function PATCH(request: Request) {
  if (!hasSameOrigin(request)) return controlJson({ error: "Same-origin request required." }, { status: 403 });
  let body: any;
  try { body = await request.json(); } catch { return controlJson({ error: "Invalid JSON body." }, { status: 400 }); }
  if (!body || typeof body !== "object" || Array.isArray(body)) return controlJson({ error: "Invalid request body." }, { status: 400 });
  const businessId = typeof body.businessId === "string" ? body.businessId.trim() : "";
  const nextStatus = body.status === "SUSPENDED" ? "SUSPENDED" : body.status === "ACTIVE" ? "ACTIVE" : "";
  const action = nextStatus === "SUSPENDED" ? "suspend" : nextStatus === "ACTIVE" ? "reinstate" : "";
  if (!businessId || businessId.length > 128 || !action) return controlJson({ error: "businessId and status SUSPENDED or ACTIVE are required." }, { status: 400 });
  if (body.confirmation !== (action === "suspend" ? "SUSPEND" : "REINSTATE")) return controlJson({ error: "Explicit confirmation is required." }, { status: 400 });
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";
  if (reason.length < 12 || reason.length > 500) return controlJson({ error: "Provide an operational reason of 12–500 characters." }, { status: 400 });

  const permission = action === "suspend" ? "businesses.suspend" : "businesses.reinstate";
  const access = await requireControlPermission(permission, businessId);
  if (access.ok === false) return controlJson(controlAccessError(access), { status: access.status });
  const limited = rateLimitByIdentity(`${access.identity.session.userId}:${businessId}`, { key: `control-business-${action}`, max: 5, windowMs: 10 * 60_000 });
  if (!limited.allowed) return limited.response ?? controlJson({ error: "Too many administrative attempts." }, { status: 429 });
  const correlationId = getCorrelationId(request.headers);

  try {
    const result = await prisma.$transaction(async (tx) => {
      const candidateGrantIds = access.identity.grants.filter((candidate) => candidate.permissionKeys.includes(permission)
        && (candidate.scopeBusinessId === null || candidate.scopeBusinessId === businessId)).map((candidate) => candidate.id);
      if (!candidateGrantIds.length) return { error: "DENIED" as const };
      const liveGrants = await tx.$queryRaw<ControlGrant[]>`
        SELECT "id", "role", "permissionKeys", "scopeBusinessId"
        FROM "ControlRoleGrant"
        WHERE "id" = ANY(${candidateGrantIds}::text[])
          AND "userId" = ${access.identity.session.userId}
          AND "revokedAt" IS NULL
          AND "permissionKeys" @> ARRAY[${permission}]::text[]
          AND ("scopeBusinessId" IS NULL OR "scopeBusinessId" = ${businessId})
        ORDER BY "createdAt" DESC
        LIMIT 1
        FOR SHARE
      `;
      const activeGrant = liveGrants[0];
      if (!activeGrant) return { error: "DENIED" as const };
      const grant = activeGrant;
      const business = await tx.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, status: true, isPublished: true } });
      if (!business) return { error: "NOT_FOUND" as const };
      if (action === "reinstate" && business.status !== "SUSPENDED") return { error: "NOT_SUSPENDED" as const };
      if (action === "suspend" && business.status === "SUSPENDED") return { error: "ALREADY_SUSPENDED" as const };
      const changed = await tx.business.updateMany({ where: { id: businessId, status: business.status }, data: { status: nextStatus } });
      if (changed.count !== 1) return { error: "CONCURRENT_CHANGE" as const };
      const updated = await tx.business.findUnique({ where: { id: businessId }, select: { id: true, name: true, status: true, isPublished: true } });
      if (!updated) return { error: "CONCURRENT_CHANGE" as const };
      await createControlAuditEvent(tx, {
        actorId: access.identity.session.userId,
        grant,
        action: `BUSINESS_${action.toUpperCase()}`,
        targetType: "BUSINESS",
        targetId: businessId,
        scopeBusinessId: businessId,
        outcome: "SUCCESS",
        reason,
        beforeState: { status: business.status, isPublished: business.isPublished },
        afterState: { status: updated.status, isPublished: updated.isPublished },
        metadata: { businessName: business.name },
        correlationId,
      });
      return { business: updated };
    });
    if ("error" in result) {
      const status = result.error === "NOT_FOUND" ? 404 : result.error === "DENIED" ? 403 : 409;
      const detail = result.error === "NOT_FOUND" ? "Business not found." : result.error === "DENIED" ? "Business scope denied." : result.error === "CONCURRENT_CHANGE" ? "The business changed concurrently; reload before retrying." : `Business cannot be ${action === "suspend" ? "suspended" : "reinstated"} from its current state.`;
      return controlJson({ error: detail }, { status });
    }
    return controlJson({ business: result.business, audit: "recorded" });
  } catch {
    return controlJson({ error: "The operation failed. No business status change was committed." }, { status: 503 });
  }
}
