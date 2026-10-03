import { handlePosRequest, posOk, queryInt, queryString } from "@/lib/pos/http";
import { auditActionLabel, listPosAudit } from "@/lib/pos/audit";

/**
 * The POS audit log (§37).
 *
 * Reading it is a high-risk permission of its own: the log records who did what, including
 * refused access. It is always scoped to this business, so an actor id in the query cannot widen
 * it to another tenant.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_AUDIT", fast: true },
    fallback: "We couldn't load the activity log.",
    handler: async ({ url }) => {
      const entries = await listPosAudit(businessId, {
        action: queryString(url, "action") ?? undefined,
        take: Math.min(queryInt(url, "take", 100), 500),
      });
      return posOk({
        entries: entries.map((entry: any) => ({
          id: entry.id,
          when: entry.createdAt,
          actor: entry.actorName ?? "System",
          action: entry.action,
          label: auditActionLabel(entry.action),
          targetType: entry.targetType,
          targetId: entry.targetId,
          branchId: entry.branchId,
          metadata: entry.metadata,
        })),
      });
    },
  });
}
