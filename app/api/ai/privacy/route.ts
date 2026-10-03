import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { assertBusinessRole } from "@/lib/tenant";
import { deleteCustomerConversationsForBusiness } from "@/lib/ai-conversation";
import { logAudit } from "@/lib/audit";

export async function DELETE(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await req.json();
    const { businessId, customerPhone } = body || {};
    if (!businessId || !customerPhone) {
      return NextResponse.json({ error: "businessId and customerPhone required." }, { status: 400 });
    }

    const roleCheck = await assertBusinessRole({
      userId: user.id,
      businessId,
      userRole: user.role,
      action: "manage_settings",
    });
    if (!roleCheck.allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const deletedCount = deleteCustomerConversationsForBusiness(businessId, String(customerPhone));

    await logAudit({
      actorId: user.id,
      action: "CUSTOMER_DATA_DELETED",
      targetType: "CUSTOMER_PRIVACY",
      targetId: businessId,
      metadata: { businessId, deletedConversations: deletedCount },
    });

    return NextResponse.json({
      ok: true,
      businessId,
      deletedConversations: deletedCount,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process customer privacy request.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
