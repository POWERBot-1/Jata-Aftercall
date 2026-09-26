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
    const title = sanitizeText(body.title || "", 120);
    if (!title) return NextResponse.json({ error: "Offer title required" }, { status: 400 });
    const subtitle = body.subtitle ? sanitizeText(body.subtitle, 120) : null;

    const offer = await prisma.offer.upsert({
      where: { businessId },
      update: { title, subtitle, isActive: body.isActive !== undefined ? !!body.isActive : true },
      create: { businessId, title, subtitle, isActive: true },
    });
    return NextResponse.json({ offer });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.offerFailed);
    if (mapped.status === 500) console.error("offer save failed");
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId");
  if (!businessId) return NextResponse.json({ error: "businessId required" }, { status: 400 });
  const offer = await prisma.offer.findUnique({ where: { businessId } });
  return NextResponse.json({ offer });
}

export async function DELETE(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId");
  if (!businessId) return NextResponse.json({ error: "businessId required" }, { status: 400 });
  await assertBusinessOwnership(businessId, session);
  await prisma.offer.delete({ where: { businessId } }).catch(() => null);
  return NextResponse.json({ ok: true });
}
