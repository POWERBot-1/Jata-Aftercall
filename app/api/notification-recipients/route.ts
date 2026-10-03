import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertBusinessRole, canAccessBusiness } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";

const RECIPIENT_LABELS = ["primary", "secondary", "owner", "staff", "general", "PRIMARY", "SECONDARY", "OWNER", "STAFF", "GENERAL"] as const;

export async function GET(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const recipients = await prisma.notificationRecipient.findMany({
      where: { businessId },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json({ recipients });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch recipients.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const body = await req.json();
    const { businessId, label, phone, email, whatsappEnabled, smsEnabled, emailEnabled } = body || {};

    if (!businessId || (!phone && !email)) {
      return NextResponse.json(
        { error: "businessId and at least one contact (phone or email) required." },
        { status: 400 },
      );
    }

    const roleCheck = await assertBusinessRole({
      userId: user.id,
      businessId,
      userRole: user.role,
      action: "manage_settings",
    });
    if (!roleCheck.allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const normalizedLabel =
      typeof label === "string" && (RECIPIENT_LABELS as readonly string[]).includes(label.toUpperCase())
        ? label.toUpperCase()
        : "PRIMARY";

    const existing = await prisma.notificationRecipient
      ?.findFirst?.({ where: { businessId, label: normalizedLabel } })
      .catch(() => null);

    const recipient = existing
      ? await prisma.notificationRecipient.update({
          where: { id: existing.id },
          data: {
            phone: phone || null,
            email: email || null,
            whatsappEnabled: whatsappEnabled !== undefined ? Boolean(whatsappEnabled) : true,
            smsEnabled: smsEnabled !== undefined ? Boolean(smsEnabled) : false,
            emailEnabled: emailEnabled !== undefined ? Boolean(emailEnabled) : false,
            isActive: true,
          },
        })
      : await prisma.notificationRecipient.create({
          data: {
            businessId,
            label: normalizedLabel,
            phone: phone || null,
            email: email || null,
            whatsappEnabled: whatsappEnabled !== undefined ? Boolean(whatsappEnabled) : true,
            smsEnabled: smsEnabled !== undefined ? Boolean(smsEnabled) : false,
            emailEnabled: emailEnabled !== undefined ? Boolean(emailEnabled) : false,
            isActive: true,
          },
        });

    await logAudit({
      actorId: user.id,
      action: "NOTIFICATION_RECIPIENT_UPDATED",
      targetType: "NOTIFICATION_RECIPIENT",
      targetId: recipient.id,
      metadata: { businessId, label: recipient.label, phone: recipient.phone, email: recipient.email },
    });

    return NextResponse.json({ recipient });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to add recipient.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
