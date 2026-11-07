import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { setEnquiryNotes, updateEnquiryStatus } from "@/lib/business-hub/enquiries";
import { cleanOptionalText, cleanText } from "@/lib/business-hub/shared";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** Owner update of one enquiry: status and/or internal note. */
export async function PATCH(req: Request, { params }: { params: Promise<{ businessId: string; enquiryId: string }> }) {
  const { businessId, enquiryId } = await params;
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
      const result = await updateEnquiryStatus({
        businessId,
        id: enquiryId,
        status: cleanText(body.status, 20).toUpperCase(),
        ...actor,
      });
      if (!result.ok) return reply({ error: result.error }, result.status);
      await logAudit({
        actorId: auth.actor.userId,
        action: "BUSINESS_HUB_ENQUIRY_STATUS",
        targetType: "CustomerEnquiry",
        targetId: enquiryId,
        metadata: { businessId, status: result.record.status },
      }).catch(() => undefined);
      if (hasNotes) {
        await setEnquiryNotes({ businessId, id: enquiryId, notes: cleanOptionalText(body.notes, 2000), ...actor });
      }
      return reply({ enquiry: result.record }, 200);
    }
    const result = await setEnquiryNotes({ businessId, id: enquiryId, notes: cleanOptionalText(body.notes, 2000), ...actor });
    if (!result.ok) return reply({ error: result.error }, result.status);
    return reply({ enquiry: result.record }, 200);
  } catch {
    return reply({ error: "We couldn't save that update. Please try again." }, 503);
  }
}
