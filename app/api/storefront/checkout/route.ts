/**
 * Storefront checkout (§25, §26, §27, §52)
 *
 * Guest checkout: no customer account is required. The customer sends item ids and
 * quantities; the server loads the authoritative catalogue, computes every amount, and only
 * then creates the order and starts a payment (§26).
 *
 * Nothing here trusts a browser-supplied price, total, or delivery fee.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { PAYMENT_CURRENCY } from "@/lib/paymentCurrency";
import { normalizeExperienceDocument } from "@/lib/experience/document";
import { priceBasket, type PricedLine, type RequestedItem } from "@/lib/experience/pricing";
import { initializeOrderPayment, notifyNewOrder, PAYMENT_PURPOSE } from "@/lib/experience/payments";
import { hashIp, hashSession, recordEvent } from "@/lib/analytics";
import { formatKES } from "@/lib/format";

export const dynamic = "force-dynamic";

// Lightweight in-memory throttle — protects the order path from obvious abuse (§47).
const hits = new Map<string, { count: number; reset: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.reset) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 20;
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function orderReference(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).toUpperCase().slice(2, 8).padEnd(6, "0");
  return `JATA-ORD-${stamp}-${random}`;
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (throttled(ip)) return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "We couldn’t read that order. Please try again." }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim().slice(0, 60) : "";
  if (!slug) return NextResponse.json({ error: "This shop could not be found." }, { status: 400 });

  try {
    // Only a published business with a published experience can take orders (§3, §59).
    const business = await prisma.business.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, isPublished: true, status: true, whatsapp: true, phone: true },
    });
    if (!business || !business.isPublished || business.status === "SUSPENDED") {
      return NextResponse.json({ error: "This shop is not accepting orders right now." }, { status: 404 });
    }

    const experience = await prisma.businessExperience.findUnique({
      where: { businessId: business.id },
      select: { publishedJson: true, categoryKey: true, status: true },
    });
    if (!experience?.publishedJson || experience.status !== "PUBLISHED") {
      return NextResponse.json({ error: "This shop is not accepting orders right now." }, { status: 404 });
    }
    const document = normalizeExperienceDocument(JSON.parse(experience.publishedJson), experience.categoryKey);

    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) return NextResponse.json({ error: "Your order is empty." }, { status: 400 });

    const items: RequestedItem[] = rawItems.slice(0, 60).map((entry) => {
      const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
      return {
        productId: typeof item.productId === "string" ? item.productId : undefined,
        variantId: typeof item.variantId === "string" ? item.variantId : undefined,
        quantity: Number(item.quantity) || 1,
        addOnIds: Array.isArray(item.addOnIds) ? item.addOnIds.map(String).slice(0, 10) : [],
        notes: typeof item.notes === "string" ? item.notes.slice(0, 300) : undefined,
      };
    });

    const fulfilment = body.fulfilment === "DELIVERY" ? "DELIVERY" : "PICKUP";
    if (fulfilment === "DELIVERY" && document.settings.deliveryEnabled === false) {
      return NextResponse.json({ error: "This business does not offer delivery." }, { status: 400 });
    }
    if (fulfilment === "PICKUP" && document.settings.pickupEnabled === false) {
      return NextResponse.json({ error: "This business is delivery-only." }, { status: 400 });
    }

    const customer = (body.customer && typeof body.customer === "object" ? body.customer : {}) as Record<string, unknown>;
    const customerName = String(customer.name || "").trim().slice(0, 80);
    const customerPhone = String(customer.phone || "").trim().slice(0, 30);
    const customerEmail = String(customer.email || "").trim().slice(0, 160);
    if (customerName.length < 2) return NextResponse.json({ error: "Enter your name so the business knows who to expect." }, { status: 400 });
    if (customerPhone.replace(/\D/g, "").length < 9) return NextResponse.json({ error: "Enter a valid phone number." }, { status: 400 });
    if (customerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return NextResponse.json({ error: "Enter a valid email address, or leave it blank." }, { status: 400 });
    }

    // ── Server-authoritative pricing (§26) ──
    const pricing = await priceBasket({ businessId: business.id, items, fulfilment, settings: document.settings });
    if (pricing.lineItems.length === 0) {
      return NextResponse.json({
        error: pricing.unavailable[0]?.reason || "Those items are no longer available.",
        unavailable: pricing.unavailable,
      }, { status: 409 });
    }
    if (pricing.minOrderKES && pricing.subtotalKES < pricing.minOrderKES) {
      return NextResponse.json({
        error: `This business has a minimum order of ${formatKES(pricing.minOrderKES)}.`,
        pricing: { subtotalKES: pricing.subtotalKES, minOrderKES: pricing.minOrderKES },
      }, { status: 400 });
    }

    const deliveryLocation = typeof body.location === "string" ? body.location.trim().slice(0, 160) : null;
    const deliveryInstructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 300) : null;
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : null;
    if (fulfilment === "DELIVERY" && !deliveryLocation) {
      return NextResponse.json({ error: "Add a delivery location so we know where to bring your order." }, { status: 400 });
    }

    const reference = orderReference();
    const order = await prisma.order.create({
      data: {
        orderReference: reference,
        businessId: business.id,
        customerName,
        customerPhone,
        customerEmail: customerEmail || null,
        status: "PENDING_PAYMENT",
        paymentStatus: "UNPAID",
        subtotalKES: pricing.subtotalKES,
        deliveryFeeKES: pricing.deliveryFeeKES,
        discountKES: pricing.discountKES,
        totalKES: pricing.totalKES,
        currency: PAYMENT_CURRENCY,
        fulfilmentType: fulfilment,
        deliveryLocation,
        deliveryInstructions,
        notes,
        source: "STOREFRONT",
        items: {
          create: pricing.lineItems.map((line: PricedLine) => ({
            productId: line.productId,
            variantId: line.variantId || null,
            name: line.name,
            variantDesc: line.variantDesc || null,
            quantity: line.quantity,
            unitPriceKES: line.unitPriceKES,
            addOns: line.addOns.length ? JSON.stringify(line.addOns) : null,
            imageUrl: line.imageUrl || null,
          })),
        },
      },
      select: { id: true, orderReference: true, totalKES: true, status: true, paymentStatus: true },
    });

    const sessionHash = hashSession({ ip, userAgent: req.headers.get("user-agent") });
    await Promise.all([
      recordEvent({ businessId: business.id, eventType: "CHECKOUT_STARTED", ip, userAgent: req.headers.get("user-agent"), sessionHash, source: req.headers.get("referer") }),
      recordEvent({ businessId: business.id, eventType: "ORDER_CREATED", ip, userAgent: req.headers.get("user-agent"), sessionHash, subjectId: order.id }),
    ]);

    const email = customerEmail || `${customerPhone.replace(/\D/g, "")}@customer.jata.local`;
    const payment = await initializeOrderPayment({
      businessId: business.id,
      orderId: order.id,
      amountKES: pricing.totalKES,
      email,
      customerName,
      purpose: PAYMENT_PURPOSE.ORDER,
      callbackPath: `/b/${business.slug}/order/${reference}`,
      metadata: { orderReference: reference, fulfilment },
    });

    await notifyNewOrder({
      businessId: business.id,
      orderReference: reference,
      customerName,
      totalKES: pricing.totalKES,
      orderId: order.id,
      summary: pricing.lineItems.map((line: PricedLine) => `${line.name} ×${line.quantity}`).join(", "),
    });

    if (payment.kind === "error") {
      // The order exists and is visible to the owner as unpaid — nothing is lost (§27).
      return NextResponse.json({
        orderId: order.id,
        orderReference: reference,
        totalKES: pricing.totalKES,
        paymentError: payment.error,
        status: order.status,
        paymentStatus: order.paymentStatus,
      }, { status: 200 });
    }

    await recordEvent({ businessId: business.id, eventType: "PAYMENT_STARTED", ip, sessionHash, subjectId: order.id });

    return NextResponse.json({
      orderId: order.id,
      orderReference: reference,
      totalKES: pricing.totalKES,
      subtotalKES: pricing.subtotalKES,
      deliveryFeeKES: pricing.deliveryFeeKES,
      discountKES: pricing.discountKES,
      currency: pricing.currency,
      unavailable: pricing.unavailable,
      paymentReference: payment.reference,
      authorizationUrl: payment.authorizationUrl,
      mock: payment.mock,
      status: order.status,
      paymentStatus: order.paymentStatus,
    }, { status: 201 });
  } catch {
    console.error("storefront checkout failed");
    return NextResponse.json({ error: "We couldn’t place that order. Please try again." }, { status: 500 });
  }
}
