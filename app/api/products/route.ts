/**
 * Catalogue API (§17, §37)
 *
 * One product model serves every category; the experience profile decides which fields the
 * editor shows. Every query is scoped by businessId *and* ownership — a product id from
 * another tenant is not found, never leaked (§37).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession, type SessionPayload } from "@/lib/auth";
import { assertBusinessOwnership, guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { sanitizeText } from "@/lib/validation";
import { logAudit } from "@/lib/audit";
import { safeUrl } from "@/lib/experience/document";
import { getExperienceProfile } from "@/lib/experience/categories";
import { validateSaleWrite } from "@/lib/sale-pricing";

export const dynamic = "force-dynamic";

const STOCK_STATUSES = ["IN_STOCK", "LOW_STOCK", "OUT_OF_STOCK", "PRE_ORDER", "DISCONTINUED", "AVAILABLE_ON_REQUEST"] as const;

function intOrNull(value: unknown, min = 0, max = 100_000_000): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

function stringArray(value: unknown, limit = 20, maxLength = 60): string[] | null {
  if (value === undefined) return null;
  const list = Array.isArray(value) ? value : String(value).split(",");
  const cleaned = list
    .map((entry) => sanitizeText(String(entry), maxLength))
    .filter(Boolean)
    .slice(0, limit);
  return cleaned;
}

function jsonOrNull(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") {
    try {
      JSON.parse(value);
      return value.slice(0, 20_000);
    } catch {
      return null;
    }
  }
  try {
    return JSON.stringify(value).slice(0, 20_000);
  } catch {
    return null;
  }
}

type VariantInput = { id?: string; label?: string; priceKES?: number | null; stockStatus?: string; options?: unknown; sku?: string };

function parseVariants(value: unknown): VariantInput[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 40).map((entry) => {
    const item = (entry && typeof entry === "object" ? entry : {}) as Record<string, unknown>;
    const label = sanitizeText(String(item.label || ""), 80);
    const price = intOrNull(item.priceKES);
    return {
      id: typeof item.id === "string" ? item.id.slice(0, 40) : undefined,
      label,
      priceKES: price,
      stockStatus: STOCK_STATUSES.includes(String(item.stockStatus) as never) ? String(item.stockStatus) : "IN_STOCK",
      options: jsonOrNull(item.options ?? undefined),
      sku: item.sku ? sanitizeText(String(item.sku), 40) : undefined,
    };
  }).filter((variant) => variant.label.length > 0);
}

type ProductPayload = Record<string, unknown>;

/**
 * Sale fields are written only through validateSaleWrite (a sale needs a valid [start, end) window, Nairobi
 * time read, UTC stored). `stored` is the current row on update, null on create.
 * Returns null when the request does not touch the sale; `{ error }` when it is invalid.
 */
function saleDataFrom(
  body: ProductPayload,
  stored: { basePriceKES: number | null; variantPriceKES: number | null; salePriceKES: number | null; salePriceStartsAt: Date | null; salePriceEndsAt: Date | null } | null,
): { data: Record<string, unknown> } | { error: string } | null {
  const touched = body.salePriceKES !== undefined || body.salePriceStartsAt !== undefined || body.salePriceEndsAt !== undefined;
  if (!touched) return null;
  const sale = body.salePriceKES === undefined ? (stored?.salePriceKES ?? null) : intOrNull(body.salePriceKES);
  const windowSent = (body.salePriceStartsAt ?? null) !== null || (body.salePriceEndsAt ?? null) !== null;
  // An unchanged sale with no window sent is left exactly as stored. Nothing is rewritten, and a legacy sale
  // with no dates stays inactive (see lib/sale-pricing.ts). It does not block unrelated edits.
  if (stored && sale === (stored.salePriceKES ?? null) && !windowSent) return null;
  const result = validateSaleWrite({
    basePriceKES: body.basePriceKES !== undefined ? intOrNull(body.basePriceKES) : stored?.basePriceKES ?? null,
    variantPriceKES: stored?.variantPriceKES ?? null,
    salePriceKES: sale,
    startsAt: body.salePriceStartsAt,
    endsAt: body.salePriceEndsAt,
    stored: stored ?? undefined,
  });
  if (result.ok === false) return { error: result.error };
  return {
    data: {
      salePriceKES: result.salePriceKES,
      salePriceStartsAt: result.salePriceStartsAt,
      salePriceEndsAt: result.salePriceEndsAt,
    },
  };
}

function productDataFrom(body: ProductPayload) {
  const data: Record<string, unknown> = {};
  if (body.name !== undefined) data.name = sanitizeText(String(body.name), 120);
  if (body.description !== undefined) data.description = sanitizeText(String(body.description), 2000) || null;
  if (body.category !== undefined) data.category = sanitizeText(String(body.category), 60) || null;
  if (body.brand !== undefined) data.brand = sanitizeText(String(body.brand), 60) || null;
  if (body.portionSize !== undefined) data.portionSize = sanitizeText(String(body.portionSize), 40) || null;
  if (body.ingredients !== undefined) data.ingredients = sanitizeText(String(body.ingredients), 1000) || null;
  if (body.sku !== undefined) data.sku = sanitizeText(String(body.sku), 40) || null;
  if (body.basePriceKES !== undefined) data.basePriceKES = intOrNull(body.basePriceKES);
  if (body.prepMinutes !== undefined) data.prepMinutes = intOrNull(body.prepMinutes, 0, 1440);
  if (body.quantity !== undefined) data.quantity = intOrNull(body.quantity, 0, 1_000_000);
  if (body.minOrder !== undefined) data.minOrder = Math.max(1, intOrNull(body.minOrder, 1, 999) ?? 1);
  if (body.maxOrder !== undefined) data.maxOrder = intOrNull(body.maxOrder, 1, 999);
  if (body.sortOrder !== undefined) data.sortOrder = intOrNull(body.sortOrder, 0, 9999) ?? 0;
  if (body.imageUrl !== undefined) data.imageUrl = safeUrl(body.imageUrl) || null;
  if (body.images !== undefined) {
    const urls = Array.isArray(body.images)
      ? body.images.map((entry) => (typeof entry === "string" ? safeUrl(entry) : safeUrl((entry as { url?: unknown })?.url))).filter(Boolean).slice(0, 12)
      : [];
    data.images = urls.length ? JSON.stringify(urls.map((url) => ({ url }))) : null;
  }
  if (body.tags !== undefined) {
    const tags = stringArray(body.tags);
    data.tags = tags && tags.length ? JSON.stringify(tags) : null;
  }
  if (body.addOns !== undefined) data.addOns = jsonOrNull(body.addOns);
  if (body.variantOptions !== undefined) data.variantOptions = jsonOrNull(body.variantOptions);
  if (body.stockStatus !== undefined && STOCK_STATUSES.includes(String(body.stockStatus) as never)) data.stockStatus = String(body.stockStatus);
  if (body.isFeatured !== undefined) data.isFeatured = body.isFeatured === true;
  if (body.isActive !== undefined) data.isActive = body.isActive !== false;
  if (body.deliveryEligible !== undefined) data.deliveryEligible = body.deliveryEligible !== false;
  if (body.preOrderAllowed !== undefined) data.preOrderAllowed = body.preOrderAllowed === true;
  return data;
}

async function assertOwner(session: SessionPayload | null, businessId: string) {
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return guard;
  return { ok: true as const };
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const businessId = new URL(req.url).searchParams.get("businessId")?.trim() || "";
  if (!businessId) return NextResponse.json({ error: SAFE_ERRORS.chooseBusiness }, { status: 400 });
  try {
    await assertBusinessOwnership(businessId, session);
  } catch (error) {
    const mapped = publicErrorMessage(error, SAFE_ERRORS.noAccess);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }

  try {
    const [business, products] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId }, select: { category: true } }),
      prisma.product.findMany({
        where: { businessId },
        include: { variants: { orderBy: { sortOrder: "asc" } } },
        orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }, { createdAt: "desc" }],
        take: 200,
      }),
    ]);
    const profile = getExperienceProfile(business?.category);
    return NextResponse.json({ products, fields: profile.productFields, itemNoun: profile.itemNoun });
  } catch {
    console.error("product list failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = (await req.json()) as ProductPayload;
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    const guard = await assertOwner(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const name = sanitizeText(String(body?.name || ""), 120);
    if (name.length < 2) return NextResponse.json({ error: "Give this item a name." }, { status: 400 });

    const data = productDataFrom(body);
    const sale = saleDataFrom(body, null);
    if (sale && "error" in sale) return NextResponse.json({ error: sale.error }, { status: 400 });
    if (sale && !("error" in sale)) Object.assign(data, sale.data);
    const variants = parseVariants(body?.variants);
    const product = await prisma.product.create({
      data: {
        businessId,
        name,
        ...data,
        ...(variants.length
          ? {
              variants: {
                create: variants.map((variant, index) => ({
                  businessId,
                  label: variant.label,
                  priceKES: variant.priceKES,
                  stockStatus: variant.stockStatus as never,
                  options: variant.options ?? null,
                  sku: variant.sku ?? null,
                  sortOrder: index,
                })),
              },
            }
          : {}),
      },
      include: { variants: true },
    });
    await logAudit({ actorId: session.userId, action: "PRODUCT_CREATED", targetType: "PRODUCT", targetId: product.id, metadata: { businessId } });
    return NextResponse.json({ product }, { status: 201 });
  } catch {
    console.error("product create failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = (await req.json()) as ProductPayload;
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "Choose an item to update." }, { status: 400 });
    const guard = await assertOwner(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    // Ownership is re-checked against the stored row: the id in the body is never trusted.
    const existing = await prisma.product.findFirst({
      where: { id, businessId },
      select: { id: true, basePriceKES: true, variantPriceKES: true, salePriceKES: true, salePriceStartsAt: true, salePriceEndsAt: true },
    });
    if (!existing) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });

    const data = productDataFrom(body);
    const sale = saleDataFrom(body, existing);
    if (sale && "error" in sale) return NextResponse.json({ error: sale.error }, { status: 400 });
    if (sale && !("error" in sale)) Object.assign(data, sale.data);
    if (body?.name !== undefined) {
      const name = sanitizeText(String(body.name), 120);
      if (name.length < 2) return NextResponse.json({ error: "Give this item a name." }, { status: 400 });
      data.name = name;
    }

    const variants = body?.variants === undefined ? null : parseVariants(body.variants);
    const product = await prisma.$transaction(async (tx) => {
      if (variants) {
        await tx.productVariant.deleteMany({ where: { productId: id, businessId } });
        if (variants.length) {
          await tx.productVariant.createMany({
            data: variants.map((variant, index) => ({
              businessId,
              productId: id,
              label: variant.label,
              priceKES: variant.priceKES,
              stockStatus: variant.stockStatus as never,
              options: variant.options ?? null,
              sku: variant.sku ?? null,
              sortOrder: index,
            })),
          });
        }
      }
      return tx.product.update({ where: { id }, data: data as never, include: { variants: { orderBy: { sortOrder: "asc" } } } });
    });

    await logAudit({ actorId: session.userId, action: "PRODUCT_UPDATED", targetType: "PRODUCT", targetId: id, metadata: { businessId } });
    return NextResponse.json({ product });
  } catch {
    console.error("product update failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id")?.trim() || "";
  if (!id) return NextResponse.json({ error: "Choose an item to delete." }, { status: 400 });

  try {
    const existing = await prisma.product.findUnique({ where: { id }, select: { id: true, businessId: true } });
    if (!existing) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    const guard = await assertOwner(session, existing.businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    await prisma.product.delete({ where: { id } });
    await logAudit({ actorId: session.userId, action: "PRODUCT_DELETED", targetType: "PRODUCT", targetId: id, metadata: { businessId: existing.businessId } });
    return NextResponse.json({ ok: true });
  } catch {
    console.error("product delete failed");
    return NextResponse.json({ error: SAFE_ERRORS.saveFailed }, { status: 500 });
  }
}
