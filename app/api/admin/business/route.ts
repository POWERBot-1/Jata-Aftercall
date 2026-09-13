import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { logAudit } from "@/lib/audit";

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });

  try {
    const body = await req.json();
    const { businessId, isPublished, status } = body as { businessId?: string; isPublished?: boolean; status?: string };
    if (!businessId) return NextResponse.json({ error: "businessId required" }, { status: 400 });

    const data: Record<string, unknown> = {};
    if (isPublished !== undefined) data.isPublished = !!isPublished;
    if (status !== undefined) {
      if (!["PENDING", "ACTIVE", "SUSPENDED"].includes(status)) return NextResponse.json({ error: "Invalid status" }, { status: 400 });
      data.status = status;
    }

    const updated = await prisma.business.update({ where: { id: businessId }, data: data as any });
    await logAudit({ actorId: session.userId, action: `ADMIN_BUSINESS_${isPublished !== undefined ? "PUBLISH" : "STATUS"}`, targetType: "BUSINESS", targetId: businessId, metadata: data as Record<string, unknown> });
    return NextResponse.json({ business: updated });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
