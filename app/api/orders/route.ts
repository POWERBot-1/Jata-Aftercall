import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import * as authLib from "@/lib/auth";
import * as tenantLib from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import {
  assertOrderStageTransition,
  deriveOrderStage,
  ORDER_STAGES,
  stageToPersistedStatus,
} from "@/lib/experience/orders";
import {
  createAuthoritativeOrder,
  formatOrderReference,
  isValidStateTransition,
  type OrderState,
} from "@/lib/order";
import { getExtendedAIConfig } from "@/lib/ai-config";

function sanitizeText(value: unknown, max = 300) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

async function authorizeBusiness(businessId: string) {
  const session =
    (await authLib.getSession?.().catch(() => null)) ||
    (await authLib.getCurrentUser?.().catch(() => null));
  if (!session) return { ok: false as const, status: 401, error: "Authentication required" };
  const userId = (session as any).userId || (session as any).id;

  if (typeof tenantLib.guardTenantMutation === "function") {
    const guarded = await tenantLib.guardTenantMutation(
      { userId, email: session.email || "", role: session.role },
      businessId,
    );
    if (!guarded.ok) {
      return { ok: false as const, status: guarded.status, error: guarded.error };
    }
    return { ok: true as const, user: { id: userId, email: session.email, role: session.role } };
  }

  if (typeof tenantLib.canAccessBusiness === "function") {
    const allowed = await tenantLib.canAccessBusiness(userId, businessId, session.role);
    if (!allowed) return { ok: false as const, status: 403, error: "Forbidden" };
  }
  return { ok: true as const, user: { id: userId, email: session.email, role: session.role } };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = sanitizeText(searchParams.get("businessId"), 80);
    const stageFilter = sanitizeText(searchParams.get("stage"), 40);
    if (!businessId) {
      return NextResponse.json({ error: "businessId is required" }, { status: 400 });
    }
    const auth = await authorizeBusiness(businessId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const orders = await prisma.order.findMany({
      where: { businessId },
      include: { items: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    const enriched = orders.map((order) => ({
      ...order,
      stage: deriveOrderStage(order),
    }));
    const filtered = stageFilter ? enriched.filter((order) => order.stage === stageFilter) : enriched;
    return NextResponse.json({
      orders: filtered,
      stages: ORDER_STAGES,
    });
  } catch (error) {
    console.error("Failed to list orders:", error);
    return NextResponse.json({ error: "Failed to list orders" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const businessId = sanitizeText(body.businessId, 80);
    if (!businessId) {
      return NextResponse.json({ error: "businessId is required" }, { status: 400 });
    }
    const auth = await authorizeBusiness(businessId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const customerName = sanitizeText(body.customerName, 80);
    const customerPhone = sanitizeText(body.customerPhone, 30);
    if (!customerName) {
      return NextResponse.json({ error: "customerName is required" }, { status: 400 });
    }

    const preview = Boolean(body.preview);

    // Enforce emergency pause controls on live order creation (§45)
    if (!preview) {
      const aiConfig = await prisma.aIConfiguration?.findUnique?.({ where: { businessId } }).catch(() => null);
      const ext = await getExtendedAIConfig(businessId, aiConfig);
      if (ext.pauseAllOrdering || ext.operationalStatus === "PAUSED" || ext.operationalStatus === "MAINTENANCE") {
        return NextResponse.json(
          { error: "Ordering is currently paused for this business." },
          { status: 423 },
        );
      }
    }

    // If structured items, idempotencyKey, or preview mode are provided, use the authoritative AI Front Desk order engine (§16, §17, §28)
    if (Array.isArray(body.items) || body.idempotencyKey || preview) {
      const created = await createAuthoritativeOrder({
        businessId,
        customerName,
        customerPhone: customerPhone || null,
        customerEmail: sanitizeText(body.customerEmail, 120) || null,
        items: Array.isArray(body.items) ? body.items : [],
        deliveryFeeKES: Number(body.deliveryFeeKES) || 0,
        discountKES: Number(body.discountKES) || 0,
        fulfilmentType: body.fulfilmentType === "DELIVERY" ? "DELIVERY" : "PICKUP",
        deliveryLocation: sanitizeText(body.deliveryLocation, 200) || null,
        deliveryInstructions: sanitizeText(body.deliveryInstructions, 500) || null,
        idempotencyKey: sanitizeText(body.idempotencyKey, 120) || null,
        preview,
        confirmedByCustomer: Boolean(body.confirmedByCustomer),
        actorId: auth.user.id,
      });

      return NextResponse.json(
        {
          order: {
            ...created,
            stage: deriveOrderStage({ status: created.status, paymentStatus: created.paymentStatus }),
          },
          preview: created.preview,
          idempotent: created.idempotent,
        },
        { status: 201 },
      );
    }

    const totalKES = Math.max(0, Math.round(Number(body.totalKES) || 0));
    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const orderReference = formatOrderReference(datePrefix, Math.floor(100000 + Math.random() * 899999));

    const order = await prisma.order.create({
      data: {
        orderReference,
        businessId,
        customerName,
        customerPhone: customerPhone || null,
        customerEmail: sanitizeText(body.customerEmail, 120) || null,
        status: "PENDING_PAYMENT",
        paymentStatus: "UNPAID",
        subtotalKES: totalKES,
        totalKES,
        fulfilmentType: body.fulfilmentType === "DELIVERY" ? "DELIVERY" : "PICKUP",
        deliveryLocation: sanitizeText(body.deliveryLocation, 200) || null,
        deliveryInstructions: sanitizeText(body.deliveryInstructions, 500) || null,
      },
      include: { items: true },
    });

    await logAudit({
      actorId: auth.user.id,
      action: "ORDER_CREATED",
      targetType: "ORDER",
      targetId: order.id,
      metadata: { businessId, orderReference, totalKES },
    });

    return NextResponse.json(
      { order: { ...order, stage: deriveOrderStage(order) } },
      { status: 201 },
    );
  } catch (error) {
    console.error("Failed to create order:", error);
    const message = error instanceof Error ? error.message : "Failed to create order";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  try {
    const body = await req.json();
    const orderId = sanitizeText(body.orderId || body.id, 80);
    const requestedStage = sanitizeText(body.stage, 40);
    const requestedStatus = sanitizeText(body.status, 40) as OrderState | "";
    if (!orderId) {
      return NextResponse.json({ error: "orderId is required" }, { status: 400 });
    }

    const existing = await prisma.order.findUnique({ where: { id: orderId } });
    if (!existing) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }
    const auth = await authorizeBusiness(existing.businessId);
    if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

    let nextPersisted: { status: OrderState; paymentStatus?: string };

    if (requestedStage) {
      const currentStage = deriveOrderStage(existing);
      const transition = assertOrderStageTransition(currentStage, requestedStage);
      if (transition.ok === false) {
        return NextResponse.json({ error: (transition as { error: string }).error }, { status: 409 });
      }
      nextPersisted = stageToPersistedStatus(
        (transition as { stage: any }).stage,
        existing.paymentStatus,
      );
    } else if (requestedStatus) {
      if (!isValidStateTransition(existing.status as OrderState, requestedStatus)) {
        return NextResponse.json(
          { error: `Invalid order state transition from ${existing.status} to ${requestedStatus}` },
          { status: 409 },
        );
      }
      nextPersisted = { status: requestedStatus };
    } else {
      return NextResponse.json({ error: "stage or status is required" }, { status: 400 });
    }

    const updated = await prisma.order.update({
      where: { id: existing.id },
      data: {
        status: nextPersisted.status,
        ...(nextPersisted.paymentStatus ? { paymentStatus: nextPersisted.paymentStatus } : {}),
        ...(nextPersisted.status === "COMPLETED" ? { completedAt: new Date() } : {}),
      },
      include: { items: true },
    });

    await logAudit({
      actorId: auth.user.id,
      action: "ORDER_STAGE_CHANGED",
      targetType: "ORDER",
      targetId: updated.id,
      metadata: {
        businessId: updated.businessId,
        fromStatus: existing.status,
        toStatus: updated.status,
        stage: deriveOrderStage(updated),
      },
    });

    return NextResponse.json({ order: { ...updated, stage: deriveOrderStage(updated) } });
  } catch (error) {
    console.error("Failed to update order:", error);
    return NextResponse.json({ error: "Failed to update order" }, { status: 500 });
  }
}
