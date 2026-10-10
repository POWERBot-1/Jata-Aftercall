/**
 * Storefront checkout (§25, §26, §27, §52)
 *
 * Guest checkout: no customer account is required. Nothing here trusts a browser-supplied price, total or
 * delivery fee. The server prices the basket, and the customer must confirm that exact total first:
 *
 *  1. A required Idempotency-Key identifies this checkout attempt. A retry with the same key returns the same
 *     outcome and never creates a second order, stock decrement or payment row (lib/checkout-transaction.ts).
 *  2. A new attempt is priced now. If the total differs from the one the customer confirmed (for example, a sale
 *     ended after they reviewed the basket), nothing is written and the new total is returned for confirmation.
 *  3. The order, items, stock decrement, pending payment row and idempotency record are created in ONE database
 *     transaction. No network call happens inside it.
 *  4. The payment provider is called after the commit. If the process dies between the commit and the provider
 *     call, a retry with the same key resumes the provider step for the existing payment.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { PAYMENT_CURRENCY } from "@/lib/paymentCurrency";
import { priceBasket, type PricedLine } from "@/lib/experience/pricing";
import {
  createOrderPaymentRecord,
  notifyNewOrder,
  PAYMENT_PURPOSE,
  startOrderPayment,
  type InitializeOrderPaymentInput,
  type OrderPaymentRecord,
} from "@/lib/experience/payments";
import { recordEvent, hashSession } from "@/lib/analytics";
import { formatKES } from "@/lib/format";
import {
  commitOrderOnce,
  findIdempotencyRecord,
  markCheckoutCompleted,
  requestHashOf,
  StockConflictError,
  type IdempotencyRecordView,
} from "@/lib/checkout-transaction";
import { clientIp, loadPublishedShop, parseCustomerDetails, parseRequestedItems, throttled } from "@/lib/storefront-checkout";

export const dynamic = "force-dynamic";

const SCOPE = "storefront.checkout" as const;

function orderReference(): string {
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const random = Math.random().toString(36).toUpperCase().slice(2, 8).padEnd(6, "0");
  return `JATA-ORD-${stamp}-${random}`;
}

function conflictForReusedKey() {
  return NextResponse.json(
    { error: "This checkout reference was already used for a different order. Start a new checkout." },
    { status: 409 },
  );
}

type CheckoutContext = {
  businessId: string;
  slug: string;
  customerName: string;
  email: string;
  amountKES: number;
  fulfilment: "PICKUP" | "DELIVERY";
  ip: string;
  userAgent: string | null;
  referer: string | null;
};

/**
 * After the order is committed: call the provider (outside any transaction), record the attempt, and store the
 * response against the idempotency key so a retry returns it unchanged.
 */
async function completeProviderStep(params: {
  ctx: CheckoutContext;
  recordId: string | null;
  order: { id: string; orderReference: string; totalKES: number; status: string; paymentStatus: string };
  payment: Extract<OrderPaymentRecord, { kind: "record" }>;
  subtotalKES?: number;
  deliveryFeeKES?: number;
  discountKES?: number;
  unavailable?: Array<{ productId: string; reason: string }>;
  summary?: string;
}) {
  const { ctx, order, payment } = params;
  const providerInput: InitializeOrderPaymentInput = {
    businessId: ctx.businessId,
    orderId: order.id,
    amountKES: order.totalKES,
    email: ctx.email,
    customerName: ctx.customerName,
    purpose: PAYMENT_PURPOSE.ORDER,
    callbackPath: `/b/${ctx.slug}/order/${order.orderReference}`,
    metadata: { orderReference: order.orderReference, fulfilment: ctx.fulfilment },
  };
  const provider = await startOrderPayment(payment, providerInput);

  const sessionHash = hashSession({ ip: ctx.ip, userAgent: ctx.userAgent });
  await Promise.all([
    recordEvent({ businessId: ctx.businessId, eventType: "CHECKOUT_STARTED", ip: ctx.ip, userAgent: ctx.userAgent, sessionHash, source: ctx.referer }),
    recordEvent({ businessId: ctx.businessId, eventType: "ORDER_CREATED", ip: ctx.ip, userAgent: ctx.userAgent, sessionHash, subjectId: order.id }),
  ]);
  if (provider.kind === "ok") {
    await recordEvent({ businessId: ctx.businessId, eventType: "PAYMENT_STARTED", ip: ctx.ip, sessionHash, subjectId: order.id });
  }
  await notifyNewOrder({
    businessId: ctx.businessId,
    orderReference: order.orderReference,
    customerName: ctx.customerName,
    totalKES: order.totalKES,
    orderId: order.id,
    summary: params.summary ?? "",
  });

  const base = {
    orderId: order.id,
    orderReference: order.orderReference,
    totalKES: order.totalKES,
    subtotalKES: params.subtotalKES ?? order.totalKES,
    deliveryFeeKES: params.deliveryFeeKES ?? 0,
    discountKES: params.discountKES ?? 0,
    currency: PAYMENT_CURRENCY,
    unavailable: params.unavailable ?? [],
    status: order.status,
    paymentStatus: order.paymentStatus,
  };
  const response =
    provider.kind === "error"
      ? { status: 200, body: { ...base, paymentError: provider.error } }
      : {
          status: 201,
          body: {
            ...base,
            paymentReference: provider.reference,
            authorizationUrl: provider.authorizationUrl,
            mock: provider.mock,
          },
        };
  if (params.recordId) await markCheckoutCompleted(params.recordId, response);
  return NextResponse.json(response.body, { status: response.status });
}

/** A retry with a key that already produced an order. Returns the stored outcome, or resumes the provider step. */
async function replayCheckout(record: IdempotencyRecordView, requestHash: string, ctx: CheckoutContext) {
  if (record.requestHash !== requestHash) return conflictForReusedKey();
  if (record.state === "COMPLETED" && record.responseJson) {
    const stored = JSON.parse(record.responseJson) as { status: number; body: unknown };
    return NextResponse.json(stored.body, { status: stored.status });
  }
  // The order was committed but the provider step never recorded its outcome (for example, the process stopped).
  const order = record.orderId
    ? await prisma.order.findUnique({
        where: { id: record.orderId },
        select: { id: true, orderReference: true, totalKES: true, status: true, paymentStatus: true, businessId: true },
      })
    : null;
  const payment = record.paymentId
    ? await prisma.payment.findUnique({ where: { id: record.paymentId }, select: { id: true, reference: true, amount: true, status: true } })
    : null;
  if (!order || !payment || order.businessId !== ctx.businessId) {
    return NextResponse.json({ error: "We couldn’t place that order. Please try again." }, { status: 500 });
  }
  if (payment.status !== "PENDING") {
    return NextResponse.json({
      orderId: order.id,
      orderReference: order.orderReference,
      totalKES: order.totalKES,
      status: order.status,
      paymentStatus: order.paymentStatus,
      paymentError: "This payment was not started. Start a new checkout to pay.",
    }, { status: 200 });
  }
  const business = await prisma.business.findUnique({ where: { id: ctx.businessId }, select: { ownerId: true } });
  if (!business) return NextResponse.json({ error: "This shop is not accepting orders right now." }, { status: 404 });
  return completeProviderStep({
    ctx,
    recordId: record.id,
    order,
    payment: { kind: "record", paymentId: payment.id, reference: payment.reference, amount: payment.amount, ownerId: business.ownerId },
  });
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

  const idempotencyKey = (req.headers.get("idempotency-key") || "").trim().slice(0, 120);
  if (!idempotencyKey) {
    return NextResponse.json({ error: "Your checkout could not be identified. Refresh the page and try again." }, { status: 400 });
  }

  try {
    const shop = await loadPublishedShop(slug);
    if (!shop) return NextResponse.json({ error: "This shop is not accepting orders right now." }, { status: 404 });
    const { business, document } = shop;

    const rawItems = Array.isArray(body.items) ? body.items : [];
    if (rawItems.length === 0) return NextResponse.json({ error: "Your order is empty." }, { status: 400 });
    const items = parseRequestedItems(rawItems);

    const fulfilment = body.fulfilment === "DELIVERY" ? "DELIVERY" : "PICKUP";
    if (fulfilment === "DELIVERY" && document.settings.deliveryEnabled === false) {
      return NextResponse.json({ error: "This business does not offer delivery." }, { status: 400 });
    }
    if (fulfilment === "PICKUP" && document.settings.pickupEnabled === false) {
      return NextResponse.json({ error: "This business is delivery-only." }, { status: 400 });
    }

    const customer = parseCustomerDetails(body);
    if ("error" in customer) return NextResponse.json({ error: customer.error }, { status: 400 });

    const deliveryLocation = typeof body.location === "string" ? body.location.trim().slice(0, 160) : null;
    const deliveryInstructions = typeof body.instructions === "string" ? body.instructions.trim().slice(0, 300) : null;
    const notes = typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : null;
    if (fulfilment === "DELIVERY" && !deliveryLocation) {
      return NextResponse.json({ error: "Add a delivery location so we know where to bring your order." }, { status: 400 });
    }

    const requestHash = requestHashOf({
      scope: SCOPE,
      slug: business.slug,
      items: items.map((item) => ({
        productId: item.productId ?? null,
        variantId: item.variantId ?? null,
        quantity: item.quantity,
        addOnIds: [...(item.addOnIds ?? [])].sort(),
        notes: item.notes ?? null,
      })),
      fulfilment,
      customer,
      location: deliveryLocation,
      instructions: deliveryInstructions,
      notes,
    });

    const ctx: CheckoutContext = {
      businessId: business.id,
      slug: business.slug,
      customerName: customer.name,
      email: customer.email || `${customer.phone.replace(/\D/g, "")}@customer.jata.local`,
      amountKES: 0,
      fulfilment,
      ip,
      userAgent: req.headers.get("user-agent"),
      referer: req.headers.get("referer"),
    };

    // A retry of an attempt that already produced an order is answered from the record, before any repricing.
    // The customer was charged the amount they confirmed the first time.
    const prior = await findIdempotencyRecord(business.id, SCOPE, idempotencyKey);
    if (prior) return replayCheckout(prior, requestHash, ctx);

    // New attempt: price it now, at this instant.
    const pricing = await priceBasket({ businessId: business.id, items, fulfilment, settings: document.settings });
    if (pricing.lineItems.length === 0) {
      return NextResponse.json(
        { error: pricing.unavailable[0]?.reason || "Those items are no longer available.", unavailable: pricing.unavailable },
        { status: 409 },
      );
    }
    if (pricing.minOrderKES && pricing.subtotalKES < pricing.minOrderKES) {
      return NextResponse.json({
        error: `This business has a minimum order of ${formatKES(pricing.minOrderKES)}.`,
        pricing: { subtotalKES: pricing.subtotalKES, minOrderKES: pricing.minOrderKES },
      }, { status: 400 });
    }

    // The customer must confirm the exact amount. If it no longer matches, nothing is written.
    const confirmed = Number(body.expectedTotalKES);
    if (!Number.isSafeInteger(confirmed)) {
      return NextResponse.json({ error: "Review your total and confirm it before placing the order.", totalKES: pricing.totalKES }, { status: 400 });
    }
    if (confirmed !== pricing.totalKES) {
      return NextResponse.json({
        error: "The price has changed since you reviewed your order. Review the new total and confirm it.",
        priceChanged: true,
        totalKES: pricing.totalKES,
        subtotalKES: pricing.subtotalKES,
        deliveryFeeKES: pricing.deliveryFeeKES,
        discountKES: pricing.discountKES,
        currency: pricing.currency,
        lines: pricing.lineItems.map((line: PricedLine) => ({ name: line.name, quantity: line.quantity, unitPriceKES: line.unitPriceKES, lineSubtotalKES: line.lineSubtotalKES })),
        unavailable: pricing.unavailable,
      }, { status: 409 });
    }

    const reference = orderReference();
    ctx.amountKES = pricing.totalKES;

    let committed;
    try {
      committed = await commitOrderOnce({
        businessId: business.id,
        scope: SCOPE,
        idempotencyKey,
        requestHash,
        stockLines: pricing.lineItems
          .filter((line: PricedLine) => Boolean(line.productId))
          .map((line: PricedLine) => ({ productId: line.productId, quantity: line.quantity, name: line.name })),
        create: async (tx: any) => {
          const order = await tx.order.create({
            data: {
              orderReference: reference,
              businessId: business.id,
              customerName: customer.name,
              customerPhone: customer.phone,
              customerEmail: customer.email || null,
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
          const payment = await createOrderPaymentRecord(
            {
              businessId: business.id,
              orderId: order.id,
              amountKES: pricing.totalKES,
              email: ctx.email,
              customerName: customer.name,
              purpose: PAYMENT_PURPOSE.ORDER,
              callbackPath: `/b/${business.slug}/order/${reference}`,
              metadata: { orderReference: reference, fulfilment },
            },
            tx,
          );
          if (payment.kind === "error") throw new Error(payment.error);
          return { id: order.id, paymentId: payment.paymentId, order, payment };
        },
      });
    } catch (error) {
      if (error instanceof StockConflictError) {
        return NextResponse.json({ error: error.message, unavailable: [{ productId: error.productId, reason: error.message }] }, { status: 409 });
      }
      throw error;
    }

    if (committed.kind === "KEY_REUSED") return conflictForReusedKey();
    if (committed.kind === "REPLAY") return replayCheckout(committed.record, requestHash, ctx);

    const created = committed.value as unknown as {
      order: { id: string; orderReference: string; totalKES: number; status: string; paymentStatus: string };
      payment: OrderPaymentRecord;
    };
    if (created.payment.kind !== "record") {
      return NextResponse.json({ error: "We couldn’t place that order. Please try again." }, { status: 500 });
    }
    return completeProviderStep({
      ctx,
      recordId: committed.record?.id ?? null,
      order: { ...created.order, orderReference: reference },
      payment: created.payment,
      subtotalKES: pricing.subtotalKES,
      deliveryFeeKES: pricing.deliveryFeeKES,
      discountKES: pricing.discountKES,
      unavailable: pricing.unavailable,
      summary: pricing.lineItems.map((line: PricedLine) => `${line.name} ×${line.quantity}`).join(", "),
    });
  } catch (error) {
    console.error("storefront checkout failed", error instanceof Error ? error.name : "unknown");
    return NextResponse.json({ error: "We couldn’t place that order. Please try again." }, { status: 500 });
  }
}
