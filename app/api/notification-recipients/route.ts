/**
 * Notification Recipient Configuration (§63) — nominated business number.
 * Every business configures primary/secondary/staff recipients.
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";
import { logAudit } from "@/lib/audit";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId");
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const recipients = await prisma.notificationRecipient.findMany({
    where: { businessId: businessId! },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ recipients });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const label = typeof body.label === "string" ? body.label.trim() : "PRIMARY";
    const phone = typeof body.phone === "string" ? body.phone.trim() || null : null;
    const email = typeof body.email === "string" ? body.email.trim() || null : null;
    const whatsappEnabled = typeof body.whatsappEnabled === "boolean" ? body.whatsappEnabled : true;
    const smsEnabled = typeof body.smsEnabled === "boolean" ? body.smsEnabled : true;
    const emailEnabled = typeof body.emailEnabled === "boolean" ? body.emailEnabled : true;

    if (!businessId) return NextResponse.json({ error: "Business required." }, { status: 400 });

    const existing = await prisma.notificationRecipient.findFirst({ where: { businessId: businessId!, label } });
    if (existing) {
      const updated = await prisma.notificationRecipient.update({
        where: { id: existing.id },
        data: { phone, email, whatsappEnabled, smsEnabled, emailEnabled, isActive: true },
      });
      await logAudit({ actorId: session.userId, action: "NOTIFICATION_RECIPIENT_UPDATED", targetType: "NOTIFICATION_RECIPIENT", targetId: updated.id });
      return NextResponse.json({ recipient: updated });
    }

    const created = await prisma.notificationRecipient.create({
      data: { businessId: businessId!, label, phone, email, whatsappEnabled, smsEnabled, emailEnabled, isActive: true },
    });
    await logAudit({ actorId: session.userId, action: "NOTIFICATION_RECIPIENT_CREATED", targetType: "NOTIFICATION_RECIPIENT", targetId: created.id });
    return NextResponse.json({ recipient: created }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
