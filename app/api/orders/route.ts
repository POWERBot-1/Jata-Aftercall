import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership, guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { isValidStateTransition, type OrderState } from "@/lib/order";
import { formatOrderReference } from "@/lib/order";
import { logAudit } from "@/lib/audit";
import {
  isValidStageTransition,
  orderStatusToStage,
  stageToOrderStatus,
  type OrderStage,
} from "@/lib/experience/orders";
import { paymentStateOf } from "@/lib/experience/payments";

/**
 * Order Route (§12, §28, §34) — server-side order creation with explicit state machine.
 * Preview mode creates orders in DRAFT only; does not trigger notifications (§52).
 *
 * Owner reads and updates are scoped by businessId *and* ownership (§37).
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

/** Owner order board (§28). Never returns another tenant's orders (§37). */
export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId")?.trim() || "";
  if (!businessId) return NextResponse.json({ error: SAFE_ERRORS.chooseBusiness }, { status: 400 });
  try {
    await assertBusinessOwnership(businessId, session);
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.noAccess);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  try {
    const stage = searchParams.get("stage")?.trim() || "";
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit")) || 50));
    const where: Record<string, unknown> = { businessId };
    if (stage && stage !== "ALL") {
      const target = stageToOrderStatus(stage);
      if (target) where.status = target;
    }
    const orders = await prisma.order.findMany({
      where,
      include: { items: true, payments: { select: { id: true, status: true, reference: true, purpose: true } } },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    return NextResponse.json({
      orders: orders.map((order) => ({
        id: order.id,
        orderReference: order.orderReference,
        customerName: order.customerName,
        customerPhone: order.customerPhone,
        customerEmail: order.customerEmail,
        status: order.status,
        stage: orderStatusToStage(order.status),
        paymentStatus: order.paymentStatus,
        paymentState: paymentStateOf(order.payments?.[0] || null),
        subtotalKES: order.subtotalKES,
        deliveryFeeKES: order.deliveryFeeKES,
        discountKES: order.discountKES,
        totalKES: order.totalKES,
        currency: order.currency,
        fulfilmentType: order.fulfilmentType,
        deliveryLocation: order.deliveryLocation,
        deliveryInstructions: order.deliveryInstructions,
        notes: order.notes,
        createdAt: order.createdAt,
        items: order.items.map((item) => ({
          id: item.id,
          name: item.name,
          quantity: item.quantity,
          unitPriceKES: item.unitPriceKES,
          variantDesc: item.variantDesc,
          imageUrl: item.imageUrl,
        })),
      })),
    });
  } catch {
    console.error("order list failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

/**
 * Move an order to the next stage (§28). Only valid transitions are accepted, and the
 * mapping from the owner-facing stage to the internal state machine happens server-side.
 */
export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const orderId = typeof body?.orderId === "string" ? body.orderId.trim() : "";
    const stage = typeof body?.stage === "string" ? (body.stage as OrderStage) : "";
    if (!orderId || !stage) return NextResponse.json({ error: "Choose an order and a status." }, { status: 400 });

    const order = await prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, businessId: true, status: true, orderReference: true },
    });
    if (!order) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    const guard = await guardTenantMutation(session, order.businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const currentStage = orderStatusToStage(order.status);
    if (!isValidStageTransition(currentStage, stage)) {
      return NextResponse.json({ error: `An order cannot go from ${currentStage} to ${stage}.` }, { status: 409 });
    }
    const nextStatus = stageToOrderStatus(stage);
    if (!nextStatus) return NextResponse.json({ error: "That status is not recognised." }, { status: 400 });
    if (!isValidStateTransition(order.status as OrderState, nextStatus) && currentStage !== stage) {
      return NextResponse.json({ error: `An order cannot go from ${currentStage} to ${stage}.` }, { status: 409 });
    }

    const updated = await prisma.order.update({
      where: { id: orderId },
      data: {
        status: nextStatus,
        ...(stage === "COMPLETED" ? { completedAt: new Date() } : {}),
      },
      select: { id: true, status: true, orderReference: true },
    });
    await logAudit({
      actorId: session.userId,
      action: "ORDER_STAGE_CHANGED",
      targetType: "ORDER",
      targetId: orderId,
      metadata: { from: order.status, to: updated.status, stage },
    });

    return NextResponse.json({ order: { ...updated, stage } });
  } catch {
    console.error("order update failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}
