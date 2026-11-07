import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { setOrderRequestNotes, updateOrderRequestStatus } from "@/lib/business-hub/orderRequests";
import { cleanOptionalText, cleanText } from "@/lib/business-hub/shared";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Owner update of one order request: status and/or internal note.
 *
 * The request is loaded through `getOrderRequest(businessId, id)`, so an id belonging to another
 * business matches nothing and answers 404 — the hub can never write across tenants.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ businessId: string; requestId: string }> }) {
  const { businessId, requestId } = await params;
  const auth = await authorizeOwner(businessId, "manage_orders");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your customer hub is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that update." }, 400);

  const hasStatus = typeof body.status === "string" && body.status.trim().length > 0;
  const hasNotes = Object.prototype.hasOwnProperty.call(body, "notes");
  if (!hasStatus && !hasNotes) return reply({ error: "Send a status or a note to update." }, 400);

  const actor = { actorId: auth.actor.userId, actorLabel: auth.actor.label };

  try {
    if (hasStatus) {
      const result = await updateOrderRequestStatus({
        businessId,
        id: requestId,
        status: cleanText(body.status, 20).toUpperCase(),
        ...actor,
      });
      if (!result.ok) return reply({ error: result.error }, result.status);
      await logAudit({
        actorId: auth.actor.userId,
        action: "BUSINESS_HUB_ORDER_REQUEST_STATUS",
        targetType: "OrderRequest",
        targetId: requestId,
        metadata: { businessId, status: result.record.status },
      }).catch(() => undefined);
      if (hasNotes) {
        await setOrderRequestNotes({ businessId, id: requestId, notes: cleanOptionalText(body.notes, 2000), ...actor });
      }
      return reply({ request: result.record }, 200);
    }

    const result = await setOrderRequestNotes({ businessId, id: requestId, notes: cleanOptionalText(body.notes, 2000), ...actor });
    if (!result.ok) return reply({ error: result.error }, result.status);
    return reply({ request: result.record }, 200);
  } catch {
    return reply({ error: "We couldn't save that update. Please try again." }, 503);
  }
}
