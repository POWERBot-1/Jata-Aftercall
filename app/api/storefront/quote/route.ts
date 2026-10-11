/**
 * Storefront price quote (§26). Read-only: it prices the basket with the same server rules as checkout and writes
 * nothing. The customer reviews this total and confirms it; checkout then charges only that amount, or refuses
 * with the new price if it has changed (for example, a sale ended in the meantime).
 */
import { NextResponse } from "next/server";
import { priceBasket } from "@/lib/experience/pricing";
import { clientIp, loadPublishedShop, parseRequestedItems, throttled } from "@/lib/storefront-checkout";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (throttled(clientIp(req), 60)) {
    return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });
  }
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "We couldn’t read that basket. Please try again." }, { status: 400 });
  }
  const slug = typeof body.slug === "string" ? body.slug.trim().slice(0, 60) : "";
  if (!slug) return NextResponse.json({ error: "This shop could not be found." }, { status: 400 });

  try {
    const shop = await loadPublishedShop(slug);
    if (!shop) return NextResponse.json({ error: "This shop is not accepting orders right now." }, { status: 404 });
    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) return NextResponse.json({ error: "Your order is empty." }, { status: 400 });
    const fulfilment = body.fulfilment === "DELIVERY" ? "DELIVERY" : "PICKUP";
    if (fulfilment === "DELIVERY" && shop.document.settings.deliveryEnabled === false) {
      return NextResponse.json({ error: "This business does not offer delivery." }, { status: 400 });
    }
    if (fulfilment === "PICKUP" && shop.document.settings.pickupEnabled === false) {
      return NextResponse.json({ error: "This business is delivery-only." }, { status: 400 });
    }

    const pricing = await priceBasket({
      businessId: shop.business.id,
      items: parseRequestedItems(rawItems),
      fulfilment,
      settings: shop.document.settings,
    });
    return NextResponse.json({
      currency: pricing.currency,
      subtotalKES: pricing.subtotalKES,
      deliveryFeeKES: pricing.deliveryFeeKES,
      discountKES: pricing.discountKES,
      totalKES: pricing.totalKES,
      minOrderKES: pricing.minOrderKES,
      lines: pricing.lineItems.map((line) => ({
        productId: line.productId,
        name: line.name,
        quantity: line.quantity,
        unitPriceKES: line.unitPriceKES,
        lineSubtotalKES: line.lineSubtotalKES,
      })),
      unavailable: pricing.unavailable,
    });
  } catch {
    console.error("storefront quote failed");
    return NextResponse.json({ error: "We couldn’t price that basket. Please try again." }, { status: 500 });
  }
}
