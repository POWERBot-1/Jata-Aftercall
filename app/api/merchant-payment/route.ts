import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getCurrentUser } from "@/lib/auth";
import { assertBusinessRole, canAccessBusiness } from "@/lib/tenant";
import { encryptMerchantCredentials, formatPublicPaymentSummary } from "@/lib/merchant-payment";
import { logAudit } from "@/lib/audit";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const businessId = searchParams.get("businessId");
    if (!businessId) {
      return NextResponse.json({ error: "businessId required." }, { status: 400 });
    }

    const user = await getCurrentUser().catch(() => null);
    // Tenant data is never served to an anonymous caller: the session is mandatory here.
    if (!user) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }
    const allowed = await canAccessBusiness(user.id, businessId, user.role);
    if (!allowed) {
      return NextResponse.json({ error: "Forbidden — tenant isolation enforced." }, { status: 403 });
    }

    const config = await prisma.merchantPaymentConfig.findUnique({
      where: { businessId },
      // Never return encryptedCredentials to browser or AI (§10, §14, §43)
      select: { id: true, publicInfo: true, isActive: true, createdAt: true, updatedAt: true },
    });

    return NextResponse.json({ config });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to fetch payment config.";
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
    const { businessId, publicInfo, privateCredentials, isActive } = body || {};
    if (!businessId || !publicInfo) {
      return NextResponse.json({ error: "businessId and publicInfo required." }, { status: 400 });
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

    const formattedPublic = formatPublicPaymentSummary(publicInfo);
    const encryptedCredentials = privateCredentials
      ? typeof privateCredentials === "string"
        ? encryptMerchantCredentials({ raw: privateCredentials })
        : encryptMerchantCredentials(privateCredentials)
      : undefined;

    const config = await prisma.merchantPaymentConfig.upsert({
      where: { businessId },
      update: {
        publicInfo: formattedPublic,
        ...(encryptedCredentials !== undefined ? { encryptedCredentials } : {}),
        ...(isActive !== undefined ? { isActive: Boolean(isActive) } : {}),
      },
      create: {
        businessId,
        publicInfo: formattedPublic,
        encryptedCredentials: encryptedCredentials || null,
        isActive: isActive !== undefined ? Boolean(isActive) : true,
      },
      select: { id: true, publicInfo: true, isActive: true, updatedAt: true },
    });

    await logAudit({
      actorId: user.id,
      action: "MERCHANT_PAYMENT_CONFIG_UPDATED",
      targetType: "MERCHANT_PAYMENT_CONFIG",
      targetId: config.id,
      metadata: { businessId, publicInfo: config.publicInfo },
    });

    return NextResponse.json({ config });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to save payment config.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
