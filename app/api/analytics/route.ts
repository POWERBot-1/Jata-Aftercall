import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import prisma from "@/lib/db";
import { assertBusinessOwnership } from "@/lib/tenant";
import { getBusinessMetrics } from "@/lib/analytics";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const businessId = searchParams.get("businessId");
  if (!businessId) return NextResponse.json({ error: "businessId required" }, { status: 400 });

  try {
    await assertBusinessOwnership(businessId, session);
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ error: err.message }, { status: err.status || 403 });
  }

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });

  const metrics = await getBusinessMetrics(businessId);
  const recent = await prisma.analyticsEvent.findMany({
    where: { businessId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { eventType: true, createdAt: true, source: true },
  });

  return NextResponse.json({ metrics, recent });
}
