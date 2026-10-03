import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { createPreOrderSummary } from "@/lib/preorder";
import { createNotification } from "@/lib/notification";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      businessId,
      productId,
      productName,
      variantDesc,
      quantity,
      fullPriceKES,
      depositRequiredKES,
      customerPhone,
      customerName,
      expectedDate,
      fulfilmentNotes,
      preview,
    } = body || {};

    if (!businessId || !productName || !quantity || fullPriceKES === undefined) {
      return NextResponse.json(
        { error: "businessId, productName, quantity, fullPriceKES required." },
        { status: 400 },
      );
    }

    const user = await getCurrentUser().catch(() => null);
    if (user) {
      const allowed = await canAccessBusiness(user.id, businessId, user.role);
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
      }
    }

    const summary = createPreOrderSummary({
      productName,
      variantDesc,
      quantity: Number(quantity),
      fullPriceKES: Number(fullPriceKES),
      depositRequiredKES: depositRequiredKES !== undefined ? Number(depositRequiredKES) : undefined,
      expectedDate: expectedDate ? new Date(expectedDate) : undefined,
      fulfilmentNotes,
    });

    if (preview) {
      return NextResponse.json({
        preOrder: {
          id: `preview_preorder_${Date.now()}`,
          preOrderRef: `JATA-PRE-PREVIEW-${Date.now()}`,
          businessId,
          productId: productId || null,
          productName,
          variantDesc: variantDesc || null,
          quantity: summary.quantity,
          depositRequiredKES: summary.depositRequiredKES,
          fullPriceKES: summary.fullPriceKES,
          totalKES: summary.totalKES,
          status: "PENDING_DEPOSIT",
          preview: true,
        },
        summary,
        preview: true,
      });
    }

    const datePrefix = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    const count = await prisma.preOrder.count({ where: { businessId } }).catch(() => 0);
    const preOrderRef = `JATA-PRE-${datePrefix}-${String(count + 1).padStart(6, "0")}`;

    const preOrder = await prisma.preOrder.create({
      data: {
        preOrderRef,
        businessId,
        customerPhone: customerPhone || null,
        customerName: customerName || null,
        productId: productId || null,
        productName,
        variantDesc: variantDesc || null,
        quantity: summary.quantity,
        depositRequiredKES: summary.depositRequiredKES,
        fullPriceKES: summary.fullPriceKES,
        totalKES: summary.totalKES,
        expectedDate: summary.expectedDate || null,
        fulfilmentNotes: summary.fulfilmentNotes || null,
        status: "PENDING_DEPOSIT",
      },
    });

    // Separate notification delivery from pre-order persistence (§22)
    await createNotification({
      businessId,
      eventType: "PREORDER",
      title: summary.label,
      message: `Pre-order ${preOrderRef} (${summary.label} x${summary.quantity}) created. Total: KES ${summary.totalKES}.`,
      referenceId: preOrder.id,
    }).catch(() => {});

    return NextResponse.json({ preOrder, summary, preview: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create pre-order.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const preOrders = await prisma.preOrder.findMany({
      where: { businessId },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return NextResponse.json({ preOrders });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to list pre-orders.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
