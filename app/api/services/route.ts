import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership, guardTenantMutation } from "@/lib/tenant";
import { sanitizeText } from "@/lib/validation";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";

export async function POST(req: Request) {
  const session = await getSession();
  try {
    const body = await req.json();
    const businessId = body.businessId;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const title = sanitizeText(body.title || "", 80);
    if (!title || title.length < 2) return NextResponse.json({ error: "Service title required" }, { status: 400 });
    const description = body.description ? sanitizeText(body.description, 500) : null;
    const priceLabel = body.priceLabel ? sanitizeText(body.priceLabel, 40) : null;
    const priceFrom = body.priceFrom ? parseInt(String(body.priceFrom), 10) : null;

    const service = await prisma.service.create({
      data: { businessId, title, description, priceLabel, priceFrom: priceFrom && !isNaN(priceFrom) ? priceFrom : null, sortOrder: body.sortOrder || 0 },
    });
    return NextResponse.json({ service }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.serviceFailed);
    if (mapped.status === 500) console.error("service save failed");
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
  return NextResponse.json({ ok: true });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId");
  if (!businessId) return NextResponse.json({ error: "businessId required" }, { status: 400 });
  // Public read allowed — but dashboard caller should have auth; we don't gate GET strictly
  const services = await prisma.service.findMany({ where: { businessId }, orderBy: { sortOrder: "asc" } });
  return NextResponse.json({ services });
}
