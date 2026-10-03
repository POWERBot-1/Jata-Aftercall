import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { buildCartFromLines, parseConversationalOrder, type CartLine } from "@/lib/cart";
import { getExtendedAIConfig, resolveDeliveryZoneFee } from "@/lib/ai-config";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      businessId,
      items,
      naturalLanguageOrder,
      customerPhone,
      customerName,
      deliveryZone,
      deliveryFeeKES,
      discountKES,
      preview,
    } = body || {};

    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const user = await getCurrentUser().catch(() => null);
    if (user) {
      const allowed = await canAccessBusiness(user.id, businessId, user.role);
      if (!allowed) {
        return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
      }
    }

    const resolvedLines: CartLine[] = [];

    if (typeof naturalLanguageOrder === "string" && naturalLanguageOrder.trim()) {
      const catalogue = await prisma.product?.findMany?.({ where: { businessId } }).catch(() => []) ?? [];
      const parsed = parseConversationalOrder(naturalLanguageOrder, catalogue);
      resolvedLines.push(...parsed.matchedLines);
    }

    if (Array.isArray(items)) {
      for (const raw of items) {
        if (!raw || typeof raw !== "object") continue;
        const qty = Math.max(1, Math.round(Number(raw.quantity) || 1));
        if (raw.productId && prisma.product?.findFirst) {
          const prod = await prisma.product
            .findFirst({ where: { id: raw.productId, businessId } })
            .catch(() => null);
          if (prod) {
            resolvedLines.push({
              productId: prod.id,
              name: prod.name,
              variantDesc: raw.variantDesc || undefined,
              quantity: qty,
              unitPriceKES: Math.max(0, Math.round(Number(prod.basePriceKES ?? prod.variantPriceKES ?? 0))),
            });
            continue;
          }
        }
        resolvedLines.push({
          productId: raw.productId || undefined,
          serviceId: raw.serviceId || undefined,
          name: String(raw.name || "Item"),
          variantDesc: raw.variantDesc || undefined,
          quantity: qty,
          unitPriceKES: Math.max(0, Math.round(Number(raw.unitPriceKES) || 0)),
        });
      }
    }

    if (resolvedLines.length === 0) {
      return NextResponse.json({ error: "businessId and non-empty items required." }, { status: 400 });
    }

    let resolvedDeliveryFee = typeof deliveryFeeKES === "number" ? Math.max(0, Math.round(deliveryFeeKES)) : 0;
    if (typeof deliveryZone === "string" && deliveryZone.trim()) {
      const aiConfig = await prisma.aIConfiguration?.findUnique?.({ where: { businessId } }).catch(() => null);
      const ext = await getExtendedAIConfig(businessId, aiConfig);
      const subtotalCheck = resolvedLines.reduce((sum, l) => sum + l.quantity * l.unitPriceKES, 0);
      const zoneFee = resolveDeliveryZoneFee(ext.delivery, deliveryZone, subtotalCheck);
      if (!zoneFee.allowed) {
        return NextResponse.json({ error: zoneFee.reason }, { status: 422 });
      }
      resolvedDeliveryFee = zoneFee.feeKES;
    }

    const calculation = buildCartFromLines(resolvedLines, {
      deliveryFeeKES: resolvedDeliveryFee,
      discountKES: typeof discountKES === "number" ? Math.max(0, Math.round(discountKES)) : 0,
    });

    if (preview) {
      return NextResponse.json({
        cart: {
          id: `preview_cart_${Date.now()}`,
          businessId,
          customerPhone: customerPhone || null,
          customerName: customerName || null,
          status: "PREVIEW",
          items: calculation.lineItems,
        },
        calculation,
        preview: true,
      });
    }

    const cart = await prisma.cart.create({
      data: {
        businessId,
        customerPhone: customerPhone || null,
        customerName: customerName || null,
        status: "ACTIVE",
        items: {
          create: calculation.lineItems.map((line) => ({
            productId: line.productId || null,
            serviceId: line.serviceId || null,
            name: line.name,
            variantDesc: line.variantDesc || null,
            quantity: line.quantity,
            unitPriceKES: line.unitPriceKES,
          })),
        },
      },
      include: { items: true },
    });

    return NextResponse.json({ cart, calculation, preview: false });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create cart.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const cartId = searchParams.get("cartId");
    const businessId = searchParams.get("businessId");
    if (!cartId) {
      return NextResponse.json({ error: "cartId required." }, { status: 400 });
    }

    const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: { items: true } });
    if (!cart) {
      return NextResponse.json({ error: "Cart not found." }, { status: 404 });
    }
    if (businessId && cart.businessId !== businessId) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const calculation = buildCartFromLines(
      cart.items.map((item) => ({
        productId: item.productId || undefined,
        serviceId: item.serviceId || undefined,
        name: item.name,
        variantDesc: item.variantDesc || undefined,
        quantity: item.quantity,
        unitPriceKES: item.unitPriceKES,
      })),
    );

    return NextResponse.json({ cart, calculation });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve cart.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
