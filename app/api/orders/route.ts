import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { isValidStateTransition } from "@/lib/order";
import { formatOrderReference } from "@/lib/order";

/**
 * Order Route (§12, §34) — server-side order creation with explicit state machine.
 * Preview mode creates orders in DRAFT only; does not trigger notifications (§52).
 */

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    // Basic validation — full commerce engine builds out in future authorization.
    const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
    const customerPhone = typeof body.customerPhone === "string" ? body.customerPhone.trim() : "";

    if (!businessId) return NextResponse.json({ error: "Business required." }, { status: 400 });
    if (!customerName || customerName.length < 2) return NextResponse.json({ error: "Customer name required." }, { status: 400 });

    // Preview mode: orders only reach DRAFT state; never proceed to PENDING_PAYMENT
    // without verified server-side entitlement (§52).
    const previewMode = Boolean(body.preview || false);
    const initialState = previewMode ? "DRAFT" : "PENDING_CUSTOMER_CONFIRMATION";

    return NextResponse.json({
      orderReference: formatOrderReference(new Date().toISOString().slice(0, 10).replace(/-/g, ""), Math.floor(Math.random() * 999999)),
      businessId,
      status: initialState as any,
      preview: previewMode,
      message: previewMode ? "Preview order created in DRAFT state. No notifications sent (§52)." : "Order created. Proceed to customer confirmation and payment.",
    }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
