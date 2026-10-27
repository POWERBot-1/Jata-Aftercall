/**
 * Public ordering storefront (§2.7, §5.6)
 *
 * The shop is a public surface, so it is treated as hostile input: prices are recomputed from the
 * catalogue on the server, quantities are clamped, delivery areas are checked, and every order is
 * idempotent. Stock is not deducted when an order is placed — it is deducted once, at confirmation,
 * inside a transaction with a recorded stock movement. A customer cannot see internal ids: the cart
 * refers to opaque product references.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { effectiveUnitPrice } from "../sale-pricing";
import { normalizeKePhone } from "../phone";
import { toCents, fromCents, roundHalfUp } from "./money";
import { nextDocumentNumber } from "./sequences";
import { logErpAudit } from "./audit";

export class StorefrontError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "STOREFRONT_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export type StorefrontSettings = {
  enabled: boolean;
  headline: string;
  about: string;
  deliveryFeeCents: number;
  minimumOrderCents: number;
  deliveryAreas: string[];
  allowDelivery: boolean;
  allowPickup: boolean;
  /** Local hours in Africa/Nairobi. */
  openHour: number;
  closeHour: number;
};

export const DEFAULT_STOREFRONT: StorefrontSettings = {
  enabled: false,
  headline: "Order from us",
  about: "",
  deliveryFeeCents: 0,
  minimumOrderCents: 0,
  deliveryAreas: [],
  allowDelivery: true,
  allowPickup: true,
  openHour: 8,
  closeHour: 20,
};

export function parseStorefrontSettings(json: string | null | undefined): StorefrontSettings {
  let parsed: Partial<StorefrontSettings> = {};
  try {
    parsed = JSON.parse(json || "{}");
  } catch {
    parsed = {};
  }
  const clampHour = (value: unknown, fallback: number, min: number, max: number): number => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
  };
  return {
    enabled: Boolean(parsed.enabled),
    headline: String(parsed.headline ?? DEFAULT_STOREFRONT.headline).slice(0, 120),
    about: String(parsed.about ?? "").slice(0, 400),
    deliveryFeeCents: toCents(fromCents(Number(parsed.deliveryFeeCents ?? 0))),
    minimumOrderCents: toCents(fromCents(Number(parsed.minimumOrderCents ?? 0))),
    deliveryAreas: Array.isArray(parsed.deliveryAreas) ? parsed.deliveryAreas.map((area) => String(area).slice(0, 60)).slice(0, 20) : [],
    allowDelivery: parsed.allowDelivery !== false,
    allowPickup: parsed.allowPickup !== false,
    openHour: clampHour(parsed.openHour, DEFAULT_STOREFRONT.openHour, 0, 23),
    closeHour: clampHour(parsed.closeHour, DEFAULT_STOREFRONT.closeHour, 1, 24),
  };
}

/**
 * The signing secret for public product references. In production an absent secret is an error,
 * not a fallback: a guessable reference would expose another business's product ids.
 */
export function storefrontSecret(env: NodeJS.ProcessEnv = process.env): { secret: string | null; developmentFallback: boolean } {
  const secret = env.STOREFRONT_REF_SECRET || env.AUTH_SECRET || env.NEXTAUTH_SECRET || null;
  if (secret && secret.length >= 16) return { secret, developmentFallback: false };
  if (env.NODE_ENV === "production") return { secret: null, developmentFallback: false };
  return { secret: `dev-storefront-${env.DATABASE_URL ?? "local"}`.slice(0, 32), developmentFallback: true };
}

export function publicProductRef(businessId: string, productId: string, env: NodeJS.ProcessEnv = process.env): string {
  const { secret } = storefrontSecret(env);
  if (!secret) throw new StorefrontError("The shop is not configured on this deployment.", 503, "STOREFRONT_UNCONFIGURED");
  return createHmac("sha256", secret).update(`${businessId}:${productId}`).digest("base64url").slice(0, 22);
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Map a public reference back to a product id, without exposing a list of ids. */
export function resolveProductRef(businessId: string, ref: string, products: Array<{ id: string }>, env: NodeJS.ProcessEnv = process.env): string | null {
  for (const product of products) {
    if (safeEqual(publicProductRef(businessId, product.id, env), ref)) return product.id;
  }
  return null;
}

export type PublicProduct = {
  ref: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  priceCents: number;
  listPriceCents: number;
  onSale: boolean;
  imageUrl: string | null;
  availability: "IN_STOCK" | "LOW_STOCK" | "OUT_OF_STOCK" | "MADE_TO_ORDER";
};

export function orderAcceptance(settings: StorefrontSettings, now: Date, timeZone = "Africa/Nairobi"): { open: boolean; reason: string } {
  if (!settings.enabled) return { open: false, reason: "The shop is closed right now." };
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hour12: false, timeZone })
      .formatToParts(now)
      .find((part) => part.type === "hour")?.value ?? "0",
  );
  if (hour < settings.openHour || hour >= settings.closeHour) {
    return { open: false, reason: `Orders are taken between ${String(settings.openHour).padStart(2, "0")}:00 and ${String(settings.closeHour).padStart(2, "0")}:00. Try again then.` };
  }
  return { open: true, reason: "Open for orders." };
}

export async function loadPublicCatalogue(client: any, slug: string) {
  const configuration = await client.erpConfiguration.findUnique({ where: { storefrontSlug: slug } });
  if (!configuration) throw new StorefrontError("That shop was not found.", 404, "STORE_NOT_FOUND");
  const settings = parseStorefrontSettings(configuration.storefrontJson);
  if (!settings.enabled) throw new StorefrontError("This shop is not taking orders right now.", 404, "STORE_CLOSED");
  const business = await client.business.findUnique({ where: { id: configuration.businessId }, select: { id: true, name: true, phone: true, location: true } });
  if (!business) throw new StorefrontError("That shop was not found.", 404, "STORE_NOT_FOUND");

  const products = await client.posProduct.findMany({ where: { businessId: configuration.businessId, isActive: true } });
  const inventory = await client.posInventoryItem.findMany({ where: { businessId: configuration.businessId } });
  const stock = new Map<string, number>();
  for (const row of inventory) stock.set(row.productId, (stock.get(row.productId) ?? 0) + Number(row.quantity ?? 0));
  const now = new Date();

  const visible: PublicProduct[] = [];
  for (const product of products) {
    const priced = effectiveUnitPrice(product, now);
    if (!priced || priced.unitPriceKES <= 0) continue;
    const available = stock.get(product.id);
    const availability: PublicProduct["availability"] = !product.trackInventory
      ? "MADE_TO_ORDER"
      : available === undefined || available <= 0
        ? "OUT_OF_STOCK"
        : available <= Number(product.reorderLevel ?? 0)
          ? "LOW_STOCK"
          : "IN_STOCK";
    if (availability === "OUT_OF_STOCK") continue;
    visible.push({
      ref: publicProductRef(business.id, product.id),
      name: product.name,
      description: product.description ?? null,
      category: product.category ?? null,
      unit: product.unitKey ?? "piece",
      priceCents: toCents(priced.unitPriceKES),
      listPriceCents: toCents(priced.listPriceKES ?? priced.unitPriceKES),
      onSale: priced.unitPriceKES < Number(priced.listPriceKES ?? priced.unitPriceKES),
      imageUrl: product.imageUrl ?? null,
      availability,
    });
  }

  return {
    businessId: business.id,
    businessName: business.name,
    phoneLast3: String(business.phone ?? "").slice(-3),
    location: business.location ?? null,
    settings,
    acceptance: orderAcceptance(settings, now),
    products: visible,
    categories: [...new Set(visible.map((product) => product.category).filter(Boolean))] as string[],
  };
}

export type PlaceOrderInput = {
  slug: string;
  customerName: string;
  customerPhone: string;
  fulfilment: "PICKUP" | "DELIVERY";
  deliveryAddress?: string | null;
  notes?: string | null;
  items: Array<{ ref: string; quantity: number }>;
  idempotencyKey?: string | null;
  now?: Date;
  /** Honeypot: a real customer never fills a hidden field. */
  trap?: string | null;
};

export async function placeStoreOrder(client: any, input: PlaceOrderInput) {
  if (input.trap) throw new StorefrontError("We couldn't accept that order.", 400, "REJECTED");
  const now = input.now ?? new Date();
  const configuration = await client.erpConfiguration.findUnique({ where: { storefrontSlug: input.slug } });
  if (!configuration) throw new StorefrontError("That shop was not found.", 404, "STORE_NOT_FOUND");
  const settings = parseStorefrontSettings(configuration.storefrontJson);
  const acceptance = orderAcceptance(settings, now);
  if (!acceptance.open) throw new StorefrontError(acceptance.reason, 409, "STORE_CLOSED");

  const businessId = configuration.businessId;
  const name = String(input.customerName ?? "").trim();
  if (name.length < 2 || name.length > 80) throw new StorefrontError("Please give the name for this order (2–80 characters).", 400, "NAME_REQUIRED");
  const phone = normalizeKePhone(input.customerPhone);
  if (!phone) throw new StorefrontError("That phone number does not look like a Kenyan mobile number.", 400, "PHONE_INVALID");
  const fulfilment = input.fulfilment === "DELIVERY" ? "DELIVERY" : "PICKUP";
  if (fulfilment === "DELIVERY" && !settings.allowDelivery) throw new StorefrontError("This shop does not deliver. Choose collection.", 409, "DELIVERY_UNAVAILABLE");
  if (fulfilment === "PICKUP" && !settings.allowPickup) throw new StorefrontError("This shop does not offer collection. Choose delivery.", 409, "PICKUP_UNAVAILABLE");

  const items = Array.isArray(input.items) ? input.items.slice(0, 50) : [];
  if (items.length === 0) throw new StorefrontError("Your basket is empty.", 400, "EMPTY_BASKET");

  const products = await client.posProduct.findMany({ where: { businessId } });
  const byId = new Map(products.map((product: any) => [product.id, product]));
  const inventory = await client.posInventoryItem.findMany({ where: { businessId } });
  const stock = new Map<string, number>();
  for (const row of inventory) stock.set(row.productId, (stock.get(row.productId) ?? 0) + Number(row.quantity ?? 0));

  const lines: Array<{ productId: string; name: string; sku: string | null; quantity: number; unitAmountCents: number; lineTotalCents: number }> = [];
  for (const item of items) {
    const quantity = Math.min(999, Math.max(1, Number(item.quantity) || 0));
    const productId = resolveProductRef(businessId, String(item.ref ?? ""), products);
    const product: any = productId ? byId.get(productId) : null;
    if (!product || product.isActive === false) throw new StorefrontError("One of the items is no longer available. Refresh the shop and try again.", 409, "PRODUCT_UNAVAILABLE");
    const priced = effectiveUnitPrice(product, now);
    if (!priced || priced.unitPriceKES <= 0) throw new StorefrontError(`${product.name} has no price right now.`, 409, "NO_PRICE");
    if (product.trackInventory) {
      const available = stock.get(product.id) ?? 0;
      if (available < quantity) throw new StorefrontError(`Only ${Math.max(0, Math.floor(available))} of ${product.name} available. Adjust your basket.`, 409, "INSUFFICIENT_STOCK");
    }
    const unitAmountCents = toCents(priced.unitPriceKES);
    lines.push({
      productId: product.id,
      name: product.name,
      sku: product.sku ?? null,
      quantity,
      unitAmountCents,
      lineTotalCents: unitAmountCents * quantity,
    });
  }

  const subtotalCents = lines.reduce((total, line) => total + line.lineTotalCents, 0);
  if (settings.minimumOrderCents > 0 && subtotalCents < settings.minimumOrderCents) {
    throw new StorefrontError(`The minimum order is KES ${(settings.minimumOrderCents / 100).toLocaleString("en-KE")}.`, 409, "BELOW_MINIMUM");
  }
  const deliveryCents = fulfilment === "DELIVERY" ? settings.deliveryFeeCents : 0;

  if (fulfilment === "DELIVERY") {
    const address = String(input.deliveryAddress ?? "").trim();
    if (address.length < 5) throw new StorefrontError("Add a delivery address so the rider can find you.", 400, "ADDRESS_REQUIRED");
    if (settings.deliveryAreas.length > 0) {
      const haystack = address.toLowerCase();
      const allowed = settings.deliveryAreas.some((area) => haystack.includes(area.toLowerCase()));
      if (!allowed) throw new StorefrontError(`We deliver to: ${settings.deliveryAreas.join(", ")}. Choose collection or give an address in those areas.`, 409, "OUTSIDE_DELIVERY_AREA");
    }
  }

  // Prices include VAT in Kenyan retail. The tax portion is recorded, not added on top.
  const taxableCents = lines.reduce((total, line) => {
    const product: any = byId.get(line.productId);
    return total + (product?.taxable ? line.lineTotalCents : 0);
  }, 0);
  const taxCents = roundHalfUp((taxableCents * 1600) / 11600);
  const totalCents = subtotalCents + deliveryCents;

  if (input.idempotencyKey) {
    const existing = await client.erpStoreOrder.findUnique({
      where: { businessId_idempotencyKey: { businessId, idempotencyKey: input.idempotencyKey } },
    }).catch(() => null);
    if (existing) {
      if (existing.customerPhone !== phone) throw new StorefrontError("That order reference belongs to another customer.", 409, "IDEMPOTENCY_CONFLICT");
      const existingItems = await client.erpStoreOrderItem.findMany({ where: { orderId: existing.id } });
      return { order: existing, items: existingItems, replayed: true };
    }
  }

  const result = await client.$transaction(async (tx: any) => {
    const orderNumber = await nextDocumentNumber(tx, businessId, "order");
    const order = await tx.erpStoreOrder.create({
      data: {
        businessId,
        orderNumber,
        publicToken: randomBytes(24).toString("base64url"),
        customerName: name,
        customerPhone: phone,
        fulfilment,
        deliveryAddress: fulfilment === "DELIVERY" ? String(input.deliveryAddress ?? "").trim() : null,
        notes: input.notes ? String(input.notes).slice(0, 500) : null,
        subtotalCents,
        taxCents,
        deliveryCents,
        totalCents,
        status: "PENDING",
        stockPolicy: "RESERVE_ON_CONFIRM",
        idempotencyKey: input.idempotencyKey ?? null,
      },
    });
    for (const line of lines) {
      await tx.erpStoreOrderItem.create({ data: { businessId, orderId: order.id, ...line } });
    }
    return order;
  });

  await client.erpNotification.create({
    data: {
      businessId,
      kind: "STORE_ORDER",
      title: `New order ${result.orderNumber}`,
      body: `${name} placed a ${fulfilment === "DELIVERY" ? "delivery" : "collection"} order for KES ${(totalCents / 100).toLocaleString("en-KE")}. Confirm it to deduct stock.`,
      href: `/dashboard/erp/${businessId}/store`,
      audienceRole: "OWNER",
    },
  }).catch(() => null);

  await logErpAudit({
    businessId,
    action: "STORE_ORDER_PLACED",
    targetType: "STORE_ORDER",
    targetId: result.id,
    after: { orderNumber: result.orderNumber, totalCents, lines: lines.length, fulfilment },
    client,
  });

  const items2 = await client.erpStoreOrderItem.findMany({ where: { orderId: result.id } });
  return { order: result, items: items2, replayed: false };
}

/**
 * Confirm an order: check stock again, deduct it with movements, mark the order confirmed. Running
 * it twice returns the existing confirmation instead of deducting twice.
 */
export async function confirmStoreOrder(client: any, input: { businessId: string; orderId: string; actorId?: string | null; actorName?: string | null }) {
  return client.$transaction(async (tx: any) => {
    const order = await tx.erpStoreOrder.findUnique({ where: { id: input.orderId } });
    if (!order || order.businessId !== input.businessId) throw new StorefrontError("That order was not found.", 404, "NOT_FOUND");
    if (order.status === "CONFIRMED" || order.status === "READY" || order.status === "FULFILLED") {
      const items = await tx.erpStoreOrderItem.findMany({ where: { orderId: order.id } });
      return { order, items, alreadyConfirmed: true };
    }
    if (order.status !== "PENDING") throw new StorefrontError("Only a pending order can be confirmed.", 409, "NOT_PENDING");

    const items = await tx.erpStoreOrderItem.findMany({ where: { orderId: order.id } });
    for (const item of items) {
      const product = await tx.posProduct.findUnique({ where: { id: item.productId } });
      if (!product || product.businessId !== input.businessId) throw new StorefrontError("A product on this order no longer exists.", 409, "PRODUCT_MISSING");
      if (!product.trackInventory) continue;
      const stockRow = await tx.posInventoryItem.findUnique({ where: { productId_branchId: { productId: product.id, branchId: "" } } }).catch(() => null);
      const available = Number(stockRow?.quantity ?? 0);
      if (available < Number(item.quantity)) {
        throw new StorefrontError(`Not enough stock for ${product.name}: ${available} left, ${item.quantity} ordered. The order stays pending.`, 409, "INSUFFICIENT_STOCK");
      }
      await tx.posInventoryItem.update({
        where: { productId_branchId: { productId: product.id, branchId: "" } },
        data: { quantity: { decrement: Number(item.quantity) } },
      });
      await tx.posInventoryMovement.create({
        data: {
          businessId: input.businessId,
          productId: product.id,
          branchId: "",
          reason: "SALE",
          delta: -Number(item.quantity),
          quantity: available - Number(item.quantity),
          unitKey: product.unitKey ?? null,
          refType: "STORE_ORDER",
          refId: order.id,
          note: `Online order ${order.orderNumber} confirmed`,
          createdById: input.actorId ?? null,
        },
      });
    }

    const updated = await tx.erpStoreOrder.update({ where: { id: order.id }, data: { status: "CONFIRMED" } });
    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      action: "STORE_ORDER_CONFIRMED",
      targetType: "STORE_ORDER",
      targetId: order.id,
      after: { orderNumber: order.orderNumber, totalCents: order.totalCents },
      client: tx,
    });
    return { order: updated, items, alreadyConfirmed: false };
  });
}

/**
 * Statuses an order may move to next. Exported so the dashboard renders exactly the buttons the
 * engine will accept — a screen that offers "preparing" for an engine that only knows
 * PENDING → CONFIRMED → READY → FULFILLED is a button that always fails.
 */
export const ORDER_TRANSITIONS: Record<string, string[]> = {
  PENDING: ["CONFIRMED", "REJECTED", "CANCELLED"],
  CONFIRMED: ["READY", "CANCELLED"],
  READY: ["FULFILLED", "CANCELLED"],
  FULFILLED: [],
  REJECTED: [],
  CANCELLED: [],
};

/** The next statuses for an order, newest-relevant first, for rendering the action menu. */
export function orderTransitions(status: string | null | undefined): string[] {
  return ORDER_TRANSITIONS[String(status ?? "").toUpperCase()] ?? [];
}

/** Human label for an order status. Kept beside the transitions so the two never drift. */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  PENDING: "New",
  CONFIRMED: "Accepted",
  READY: "Ready for collection",
  FULFILLED: "Fulfilled",
  REJECTED: "Rejected",
  CANCELLED: "Cancelled",
};

export async function advanceStoreOrder(client: any, input: { businessId: string; orderId: string; status: string; actorId?: string | null; actorName?: string | null; reason?: string }) {
  const order = await client.erpStoreOrder.findUnique({ where: { id: input.orderId } });
  if (!order || order.businessId !== input.businessId) throw new StorefrontError("That order was not found.", 404, "NOT_FOUND");
  const next = String(input.status ?? "").toUpperCase();
  const allowed = ORDER_TRANSITIONS[String(order.status)] ?? [];
  if (!allowed.includes(next)) {
    throw new StorefrontError(`An order that is ${String(order.status).toLowerCase()} cannot be moved to ${next.toLowerCase()}.`, 409, "INVALID_TRANSITION");
  }
  const updated = await client.erpStoreOrder.update({ where: { id: order.id }, data: { status: next } });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "STORE_ORDER_STATUS",
    targetType: "STORE_ORDER",
    targetId: order.id,
    before: { status: order.status },
    after: { status: next },
    reason: input.reason ?? null,
    client,
  });
  return updated;
}

/** What a customer may see about their own order. No internal ids, no other customers' data. */
export function publicOrderView(order: any, items: any[], business: { name: string; phone?: string | null }) {
  return {
    orderNumber: order.orderNumber,
    status: order.status,
    fulfilment: order.fulfilment,
    placedAt: order.createdAt,
    customerName: order.customerName,
    phoneLast3: String(order.customerPhone ?? "").slice(-3),
    subtotalCents: Number(order.subtotalCents),
    deliveryCents: Number(order.deliveryCents),
    taxCents: Number(order.taxCents),
    totalCents: Number(order.totalCents),
    businessName: business.name,
    businessPhoneLast3: String(business.phone ?? "").slice(-3),
    items: items.map((item) => ({ name: item.name, quantity: Number(item.quantity), unitAmountCents: Number(item.unitAmountCents), lineTotalCents: Number(item.lineTotalCents) })),
  };
}

export function storefrontUrl(baseUrl: string, slug: string): string {
  const base = String(baseUrl ?? "").replace(/\/$/, "");
  return `${base}/store/${slug}`;
}

export function trackingUrl(baseUrl: string, token: string): string {
  const base = String(baseUrl ?? "").replace(/\/$/, "");
  return `${base}/store/order/${token}`;
}
