import prisma from "@/lib/db";
import { getOwnedBusinessIds } from "@/lib/tenant";
import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { copyConfigurationTo, saveTemplate } from "@/lib/pos/provisioning";
import { CLONE_SCOPES, TEMPLATE_LIBRARY, describeCloneScope } from "@/lib/pos/templates";
import { bool, sanitizeClonePayload, sanitizeTemplatePayload } from "@/lib/pos/validation";

/**
 * Copying a configuration (§25, §26, §50, test matrix P).
 *
 * GET lists what may be copied and where it may be copied to — only businesses the signed-in
 * person actually belongs to. POST copies structure across, or saves this business's setup as
 * the owner's own template. Transactions, balances, credentials and tenant ids are never
 * copied: the scope list is enforced server-side and anything else is refused.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "EDIT_CONFIGURATION", fast: true },
    fallback: "We couldn't load your templates.",
    handler: async ({ ctx }) => {
      const ownedIds = await getOwnedBusinessIds(ctx.session);
      const others = await prisma.business.findMany({
        where: { id: { in: ownedIds.filter((id) => id !== businessId) } },
        select: { id: true, name: true, category: true },
        orderBy: { name: "asc" },
      });
      const saved = await prisma.posTemplate.findMany({
        where: { ownerId: ctx.session.userId },
        select: { id: true, key: true, name: true, description: true, businessTypeKey: true, updatedAt: true },
        orderBy: { updatedAt: "desc" },
        take: 25,
      });
      return posOk({
        scopes: CLONE_SCOPES,
        explained: describeCloneScope(CLONE_SCOPES.map((scope) => scope.key)),
        builtInTemplates: TEMPLATE_LIBRARY.map((template) => ({
          key: template.key,
          name: template.name,
          description: template.description,
          businessTypeKey: template.businessTypeKey,
        })),
        savedTemplates: saved,
        targetBusinesses: others,
      });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "EDIT_CONFIGURATION" },
    fallback: "We couldn't copy that setup.",
    handler: async ({ ctx, body }) => {
      if (bool(body, "save")) {
        const template = sanitizeTemplatePayload(body);
        const saved = await saveTemplate({ businessId, actorId: ctx.session.userId, name: template.name });
        return fromOutcome(
          { ok: saved.ok, message: saved.reason, code: saved.ok ? undefined : "TEMPLATE_REFUSED" },
          { id: saved.id ?? null },
          201,
        );
      }

      const clone = sanitizeClonePayload(body);
      if (!clone.targetBusinessId) return fromOutcome({ ok: false, message: "Choose the business to copy into." });
      const result = await copyConfigurationTo({
        sourceBusinessId: businessId,
        targetBusinessId: clone.targetBusinessId,
        actorId: ctx.session.userId,
        session: ctx.session,
        scope: clone.scopes,
      });
      return fromOutcome(
        // An authorization refusal answers 403; a refused scope answers 400 with the reason (§5, §50).
        { ok: result.ok, message: result.reason, code: result.ok ? undefined : result.code ?? "CLONE_REFUSED" },
        { targetBusinessId: clone.targetBusinessId },
      );
    },
  });
}
