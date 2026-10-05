import { NextResponse } from "next/server";
import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { logPosAudit } from "@/lib/pos/audit";
import { createBranch, ensurePrimaryBranch, listBranches } from "@/lib/pos/store";
import { bool, text } from "@/lib/pos/validation";

/**
 * Locations (§16).
 *
 * A business always has at least one stock location, so sales and stock have a home from the very
 * first day. Multi-location stock is only offered when the configuration switched it on; the
 * server refuses to create a second location for a business that has not.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { fast: true },
    fallback: "We couldn't load your locations.",
    handler: async ({ ctx }) => {
      // A staff member bound to a location is shown that location and none other (§16, §75);
      // an unbound actor (owner, admin) sees the whole business.
      const branches = await listBranches(businessId, undefined, { only: ctx.branchId });
      return posOk({
        branches,
        multiLocation: Boolean(ctx.configuration.inventory.locations) && ctx.configuration.branches.enabled,
        count: ctx.configuration.branches.count,
        word: ctx.terminology.branch,
        plural: ctx.terminology.branches,
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
    fallback: "We couldn't add that location.",
    handler: async ({ ctx, actor, body }) => {
      const name = text(body, "name", 120);
      if (!name) return fromOutcome({ ok: false, message: `Give the ${ctx.terminology.branch.toLowerCase()} a name.` });

      const branches = await listBranches(businessId);
      if (branches.length === 0) {
        // The first location is created for the business, whatever it is called.
        const created = await ensurePrimaryBranch(businessId, name);
        return fromOutcome({ ok: true, warnings: [] }, { branch: created }, 201);
      }

      if (!ctx.configuration.branches.enabled || !ctx.configuration.inventory.locations) {
        return fromOutcome({
          ok: false,
          message: "Your POS is set up for one location. Turn on more locations in your setup first.",
          code: "MULTI_LOCATION_OFF",
        });
      }
      const limit = Math.max(2, ctx.configuration.branches.count || 2);
      if (branches.length >= limit) {
        return fromOutcome({
          ok: false,
          message: `Your setup allows ${limit} locations. Change your setup to add another.`,
          code: "LOCATION_LIMIT",
        });
      }
      if (branches.some((branch: any) => String(branch.name).toLowerCase() === name.toLowerCase())) {
        return fromOutcome({ ok: false, message: `You already have a ${ctx.terminology.branch.toLowerCase()} called ${name}.` });
      }

      const branch = await createBranch(businessId, {
        name,
        code: text(body, "code", 24),
        location: text(body, "location", 160),
        phone: text(body, "phone", 32),
        isPrimary: bool(body, "isPrimary"),
      });
      await logPosAudit({
        businessId,
        actorId: actor.actorId,
        actorName: actor.actorName,
        action: "POS_CONFIGURATION_SAVED",
        targetType: "BRANCH",
        targetId: branch.id,
        metadata: { name, branches: branches.length + 1 },
      });
      return fromOutcome({ ok: true, warnings: [] }, { branch }, 201);
    },
  });
}
