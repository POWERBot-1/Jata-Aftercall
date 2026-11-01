import { controlJson } from "@/lib/control/http";
import prisma from "@/lib/db";
import { requireControlPermission, controlAccessError, scopedBusinessIds } from "@/lib/control/access";

export const dynamic = "force-dynamic";
const LIMIT = 50;

export async function GET(request: Request) {
  const access = await requireControlPermission("audit.read");
  if (access.ok === false) return controlJson(controlAccessError(access), { status: access.status });
  const scope = scopedBusinessIds(access.identity.grants, "audit.read");
  const url = new URL(request.url);
  const cursor = url.searchParams.get("cursor") || undefined;
  const action = (url.searchParams.get("action") || "").trim().slice(0, 80);
  if (!scope.global && !scope.ids.length) return controlJson({ items: [], nextCursor: null, source: "Append-only control audit events", asOf: new Date().toISOString() });
  try {
    const where = {
      ...(scope.global ? {} : { scopeBusinessId: { in: scope.ids } }),
      ...(action ? { action: { contains: action, mode: "insensitive" as const } } : {}),
    };
    const items = await prisma.controlAuditEvent.findMany({
      where,
      select: { id: true, actorId: true, actorRole: true, action: true, targetType: true, targetId: true, scopeBusinessId: true, outcome: true, reason: true, beforeState: true, afterState: true, metadata: true, correlationId: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: LIMIT + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    const hasMore = items.length > LIMIT;
    const page = hasMore ? items.slice(0, LIMIT) : items;
    return controlJson({ items: page, nextCursor: hasMore ? page[page.length - 1]?.id ?? null : null, source: "Append-only control audit events", asOf: new Date().toISOString() });
  } catch {
    return controlJson({ error: "The audit history is unavailable." }, { status: 503 });
  }
}
