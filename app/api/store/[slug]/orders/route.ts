import prisma from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { placeStoreOrder, StorefrontError } from "@/lib/erp/storefront";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * Public order endpoint.
 *
 * Rate limited per IP, honeypot protected, and every price is recomputed server-side. The response
 * contains the shop's totals and a private tracking token — never internal ids or the customer's
 * full phone number.
 */
export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const limiter = rateLimit(request, { key: `store-order:${slug}`, max: 8, windowMs: 60_000 });
  if (!limiter.allowed) return NextResponse.json({ error: "Too many orders from this connection. Wait a minute and try again." }, { status: 429 });

  let body: any;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "That order wasn't valid JSON." }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "That order was empty." }, { status: 400 });
  if (body.company) return NextResponse.json({ error: "We couldn't accept that order." }, { status: 400 });

  try {
    const idempotencyKey = typeof body.idempotencyKey === "string" && body.idempotencyKey.length >= 8 && body.idempotencyKey.length <= 80 ? body.idempotencyKey : null;
    const result = await placeStoreOrder(prisma, {
      slug,
      customerName: String(body.customerName ?? ""),
      customerPhone: String(body.customerPhone ?? ""),
      fulfilment: body.fulfilment === "DELIVERY" ? "DELIVERY" : "PICKUP",
      deliveryAddress: body.deliveryAddress ? String(body.deliveryAddress).slice(0, 300) : null,
      notes: body.notes ? String(body.notes).slice(0, 300) : null,
      items: Array.isArray(body.items) ? body.items.map((item: any) => ({ ref: String(item?.ref ?? ""), quantity: Number(item?.quantity ?? 0) })) : [],
      idempotencyKey,
    });
    return NextResponse.json(
      {
        orderNumber: result.order.orderNumber,
        status: result.order.status,
        totalCents: result.order.totalCents,
        token: result.order.publicToken,
        replayed: result.replayed,
      },
      { status: result.replayed ? 200 : 201, headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StorefrontError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: error.status, headers: { "cache-control": "no-store" } });
    }
    console.error("[store-order]", error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "We couldn't place that order just now. Nothing was charged." }, { status: 500 });
  }
}
