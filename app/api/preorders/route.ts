import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { createPreOrderSummary } from "@/lib/preorder";

/**
 * Pre-Order Route (§15) — clear customer-facing pre-order experience.
 * The customer sees that the transaction is a pre-order before confirming.
 */

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const productName = typeof body.productName === "string" ? body.productName.trim() : "";
    const quantity = Math.max(1, Math.round(Number(body.quantity) || 1));
    const fullPriceKES = Number.isSafeInteger(body.fullPriceKES) ? Math.max(0, body.fullPriceKES) : null;
    const depositRequiredKES = Number.isSafeInteger(body.depositRequiredKES) ? Math.max(0, body.depositRequiredKES) : null;

    if (!businessId) return NextResponse.json({ error: "Business required." }, { status: 400 });
    if (!productName || productName.length < 2) return NextResponse.json({ error: "Product name required." }, { status: 400 });

    // Pre-orders must only be allowed when the business explicitly configured
    // preOrderAllowed (§15). In a full build, this checks the product's preOrderAllowed flag.
    const summary = createPreOrderSummary({ productName, quantity, fullPriceKES: fullPriceKES || 0, depositRequiredKES: depositRequiredKES || 0, variantDesc: typeof body.variantDesc === "string" ? body.variantDesc.trim() || undefined : undefined });

    return NextResponse.json({
      preOrderSummary: summary,
      label: summary.label,
      message: "This is a PRE-ORDER. The item is not immediately available. You will be notified when it is ready for fulfilment (§15).",
      totalKES: summary.totalKES,
      depositKES: summary.depositKES,
      businessId,
    }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
