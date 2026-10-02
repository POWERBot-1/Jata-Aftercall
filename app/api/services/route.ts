import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership, guardTenantMutation } from "@/lib/tenant";
import { sanitizeText } from "@/lib/validation";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";
import { safeUrl } from "@/lib/experience/document";
import { getExperienceProfile } from "@/lib/experience/categories";

export const dynamic = "force-dynamic";

function intOrNull(value: unknown, min = 0, max = 100_000_000): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return null;
  return Math.max(min, Math.min(max, n));
}

/**
 * Service data for every category (§9, §18).
 * Fixed-price and quote-based services are both first-class: `pricingType` decides.
 */
function serviceDataFrom(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  if (body.title !== undefined) data.title = sanitizeText(String(body.title), 80);
  if (body.description !== undefined) data.description = sanitizeText(String(body.description), 1000) || null;
  if (body.category !== undefined) data.category = sanitizeText(String(body.category), 60) || null;
  if (body.staffName !== undefined) data.staffName = sanitizeText(String(body.staffName), 60) || null;
  if (body.priceLabel !== undefined) data.priceLabel = sanitizeText(String(body.priceLabel), 40) || null;
  if (body.priceFrom !== undefined) data.priceFrom = intOrNull(body.priceFrom);
  if (body.priceToKES !== undefined) data.priceToKES = intOrNull(body.priceToKES);
  if (body.depositKES !== undefined) data.depositKES = intOrNull(body.depositKES, 0, 1_000_000);
  if (body.durationMinutes !== undefined) data.durationMinutes = intOrNull(body.durationMinutes, 0, 1440);
  if (body.sortOrder !== undefined) data.sortOrder = intOrNull(body.sortOrder, 0, 9999) ?? 0;
  if (body.imageUrl !== undefined) data.imageUrl = safeUrl(body.imageUrl) || null;
  if (body.pricingType !== undefined) data.pricingType = body.pricingType === "QUOTE" ? "QUOTE" : "FIXED";
  if (body.availability !== undefined) data.availability = body.availability ? safeJson(body.availability) : null;
  if (body.bookingEnabled !== undefined) data.bookingEnabled = body.bookingEnabled !== false;
  if (body.isFeatured !== undefined) data.isFeatured = body.isFeatured === true;
  if (body.isActive !== undefined) data.isActive = body.isActive !== false;
  return data;
}

function safeJson(value: unknown): string | null {
  try {
    if (typeof value === "string") {
      JSON.parse(value);
      return value.slice(0, 20_000);
    }
    return JSON.stringify(value).slice(0, 20_000);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const title = sanitizeText(String(body?.title || ""), 80);
    if (!title || title.length < 2) return NextResponse.json({ error: "Service title required" }, { status: 400 });

    const service = await prisma.service.create({
      data: { businessId, title, ...serviceDataFrom(body) } as never,
    });
    await logAudit({ actorId: session.userId, action: "SERVICE_CREATED", targetType: "SERVICE", targetId: service.id, metadata: { businessId } });
    return NextResponse.json({ service }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.serviceFailed);
    if (mapped.status === 500) console.error("service save failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });
  try {
    const body = (await req.json()) as Record<string, unknown>;
    const id = typeof body?.id === "string" ? body.id.trim() : "";
    if (!id) return NextResponse.json({ error: "Choose a service to update." }, { status: 400 });

    const existing = await prisma.service.findUnique({ where: { id }, select: { id: true, businessId: true } });
    if (!existing) return NextResponse.json({ error: SAFE_ERRORS.notFound }, { status: 404 });
    const guard = await guardTenantMutation(session, existing.businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const data = serviceDataFrom(body);
    if (body?.title !== undefined) {
      const title = sanitizeText(String(body.title), 80);
      if (title.length < 2) return NextResponse.json({ error: "Service title is too short." }, { status: 400 });
      data.title = title;
    }
    const service = await prisma.service.update({ where: { id }, data: data as never });
    await logAudit({ actorId: session.userId, action: "SERVICE_UPDATED", targetType: "SERVICE", targetId: id });
    return NextResponse.json({ service });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.serviceFailed);
    if (mapped.status === 500) console.error("service update failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const svc = await prisma.service.findUnique({ where: { id } });
  if (!svc) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await assertBusinessOwnership(svc.businessId, session);
  await prisma.service.delete({ where: { id } });
  await logAudit({ actorId: session.userId, action: "SERVICE_DELETED", targetType: "SERVICE", targetId: id });
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId");
  if (!businessId) return NextResponse.json({ error: "businessId required" }, { status: 400 });

  // Public reads are limited to services of a published business; the dashboard caller is
  // additionally authenticated by the page that renders it (§37).
  const services = await prisma.service.findMany({
    where: { businessId },
    orderBy: [{ isFeatured: "desc" }, { sortOrder: "asc" }],
  });
  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { category: true, isPublished: true } });
  const profile = getExperienceProfile(business?.category);
  return NextResponse.json({ services, fields: profile.serviceFields, itemNoun: profile.itemNoun });
}
