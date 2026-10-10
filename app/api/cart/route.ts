import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness } from "@/lib/tenant";
import { buildCartFromLines, parseConversationalOrder, type CartLine } from "@/lib/cart";
import { getExtendedAIConfig, resolveDeliveryZoneFee } from "@/lib/ai-config";
import { unitPriceFor } from "@/lib/experience/pricing";

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
      preview,
    } = body || {};

    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    // Carts are a business-side tool. Guest shopping goes through the storefront checkout, which only serves
    // published businesses and prices the basket on the server. An anonymous caller may not create a cart.
    const user = await getCurrentUser().catch(() => null);
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
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
        // Services are booked through the booking flow; a client price for a service is never accepted here.
        if (raw.serviceId) {
          return NextResponse.json({ error: "Services are booked, not added to a cart." }, { status: 400 });
        }
        // Every line is a catalogue product of this business, priced from the catalogue. A client-supplied
        // name or price is never used, and a product id from another business is treated as not found.
        const prod = typeof raw.productId === "string" && raw.productId
          ? await prisma.product.findFirst({ where: { id: raw.productId, businessId } }).catch(() => null)
          : null;
        if (!prod) {
          return NextResponse.json({ error: "Only items in this business catalogue can be added to a cart." }, { status: 400 });
        }
        const unitPriceKES = unitPriceFor(prod, null);
        if (!(unitPriceKES > 0)) {
          return NextResponse.json({ error: `${prod.name} has no price set.` }, { status: 409 });
        }
        resolvedLines.push({
          productId: prod.id,
          name: prod.name,
          variantDesc: raw.variantDesc || undefined,
          quantity: Math.max(1, Math.round(Number(raw.quantity) || 1)),
          unitPriceKES,
        });
      }
    }

    if (resolvedLines.length === 0) {
      return NextResponse.json({ error: "businessId and non-empty items required." }, { status: 400 });
    }

    // The delivery fee comes only from a configured zone. A fee sent by the client is ignored.
    let resolvedDeliveryFee = 0;
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
      // §32: discounts come from configured promotions only — never from the browser.
      discountKES: 0,
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

    const dbCart = await prisma.cart.create({
      data: {
        businessId,
        customerId: customerPhone || customerName || null,
        status: "ACTIVE",
        items: {
          create: calculation.lineItems.map((line) => ({
            productId: line.productId || null,
            serviceId: line.serviceId || null,
            variantDesc: line.variantDesc || null,
            quantity: line.quantity,
            unitPriceKES: line.unitPriceKES,
          })),
        },
      },
      include: { items: true },
    });

    const cart = {
      ...dbCart,
      customerPhone: customerPhone || null,
      customerName: customerName || null,
      items: (dbCart.items || []).map((item: any, idx: number) => ({
        ...item,
        name: item.name || calculation.lineItems[idx]?.name || "Item",
      })),
    };

    return NextResponse.json({
      cart,
      cartSummary: calculation,
      calculation,
      preview: false,
    });
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
    // A cart is only ever read in the context of its business. Without a business id the lookup would be
    // by cart id alone, which can return another tenant's cart (customer id, items, status).
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const cart = await prisma.cart.findUnique({ where: { id: cartId }, include: { items: true } });
    if (!cart) {
      return NextResponse.json({ error: "Cart not found." }, { status: 404 });
    }
    if (cart.businessId !== businessId) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const calculation = buildCartFromLines(
      cart.items.map((item: any) => ({
        productId: item.productId || undefined,
        serviceId: item.serviceId || undefined,
        name: item.name || "Item",
        variantDesc: item.variantDesc || undefined,
        quantity: item.quantity,
        unitPriceKES: item.unitPriceKES,
      })),
    );

    return NextResponse.json({ cart, cartSummary: calculation, calculation });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to retrieve cart.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
