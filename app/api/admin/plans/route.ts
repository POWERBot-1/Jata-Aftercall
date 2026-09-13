import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { sanitizeText } from "@/lib/validation";
import { logAudit } from "@/lib/audit";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  try {
    const body = await req.json();
    const key = sanitizeText((body.key || "").toUpperCase(), 20);
    const name = sanitizeText(body.name || "", 80);
    const priceKES = parseInt(String(body.priceKES), 10);
    const durationDays = parseInt(String(body.durationDays), 10);
    if (!key || !name) return NextResponse.json({ error: "key and name required" }, { status: 400 });
    if (!priceKES || priceKES < 1) return NextResponse.json({ error: "priceKES must be >0" }, { status: 400 });
    if (!durationDays || durationDays < 1) return NextResponse.json({ error: "durationDays >0" }, { status: 400 });

    const existing = await prisma.planConfig.findUnique({ where: { key } });
    if (existing) return NextResponse.json({ error: "Plan key already exists" }, { status: 409 });

    const plan = await prisma.planConfig.create({ data: { key, name, priceKES, durationDays } });
    await logAudit({ actorId: session.userId, action: "ADMIN_PLAN_CREATED", targetType: "PLAN", targetId: plan.id });
    return NextResponse.json({ plan }, { status: 201 });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}

export async function PATCH(req: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") return NextResponse.json({ error: "Admin only" }, { status: 403 });
  try {
    const body = await req.json();
    const id = body.id;
    if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = sanitizeText(body.name, 80);
    if (body.priceKES !== undefined) {
      const v = parseInt(String(body.priceKES), 10);
      if (!v || v < 1) return NextResponse.json({ error: "Invalid priceKES" }, { status: 400 });
      data.priceKES = v;
    }
    if (body.durationDays !== undefined) {
      const v = parseInt(String(body.durationDays), 10);
      if (!v || v < 1) return NextResponse.json({ error: "Invalid durationDays" }, { status: 400 });
      data.durationDays = v;
    }
    if (body.isActive !== undefined) data.isActive = !!body.isActive;
    if (body.key !== undefined) data.key = sanitizeText(String(body.key).toUpperCase(), 20);

    const plan = await prisma.planConfig.update({ where: { id }, data: data as any });
    await logAudit({ actorId: session.userId, action: "ADMIN_PLAN_UPDATED", targetType: "PLAN", targetId: id });
    return NextResponse.json({ plan });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: "Failed" }, { status: 500 });
  }
}
