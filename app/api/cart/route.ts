import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { buildCartFromLines } from "@/lib/cart";

/**
 * Cart Route (§58) — conversational order building with deterministic pricing.
 */

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const lines = Array.isArray(body.items) ? body.items : [];
    if (lines.length === 0) return NextResponse.json({ error: "Cart is empty." }, { status: 400 });

    const lineInputs = lines.map((line: unknown) => {
      if (!line || typeof line !== "object") return null;
      const item = line as Record<string, unknown>;
      return {
        productId: typeof item.productId === "string" ? item.productId : undefined,
        serviceId: typeof item.serviceId === "string" ? item.serviceId : undefined,
        name: typeof item.name === "string" ? item.name.trim() : (typeof item.title === "string" ? item.title.trim() : "Unknown item"),
        quantity: Math.max(1, Math.round(Number(item.quantity) || 1)),
        unitPriceKES: Math.max(0, Math.round(Number(item.unitPriceKES || item.price) || 0)),
        variantDesc: typeof item.variantDesc === "string" ? item.variantDesc.trim() || undefined : undefined,
      };
    }).filter((l) => l !== null);

    if (lineInputs.length === 0) return NextResponse.json({ error: "No valid cart items." }, { status: 400 });

    const calculation = buildCartFromLines(lineInputs);

    return NextResponse.json({
      cartSummary: {
        lineItems: calculation.lineItems,
        subtotalKES: calculation.subtotalKES,
        deliveryFeeKES: calculation.deliveryFeeKES,
        discountKES: calculation.discountKES,
        totalKES: calculation.totalKES,
        currency: calculation.currency,
      },
      businessId,
      mode: body.preview ? "preview" : "live",
      previewWarning: body.preview ? "Preview mode: no real orders or notifications (§52)." : undefined,
    });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
