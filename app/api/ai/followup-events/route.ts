import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { canAccessBusiness, canBusinessRolePerform, getBusinessRoleForUser } from "@/lib/tenant";

/** Authorized tenant operator kill switch: pause follow-up event processing, preserving tasks and events. */
export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const businessId = typeof body?.businessId === "string" ? body.businessId.trim() : "";
    if (!businessId) return NextResponse.json({ error: "businessId required." }, { status: 400 });
    if (!(await canAccessBusiness(user.id, businessId, user.role))) {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }
    const role = await getBusinessRoleForUser(user.id, businessId, user.role);
    if (!canBusinessRolePerform(role, "operate")) return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    const config = await prisma.aIConfiguration.upsert({
      where: { businessId },
      create: { businessId, followupEventsEnabled: false },
      update: { followupEventsEnabled: false },
      select: { followupEventsEnabled: true },
    });
    return NextResponse.json({ paused: !config.followupEventsEnabled, preservedTasks: true, preservedEvents: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not pause follow-up events.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
