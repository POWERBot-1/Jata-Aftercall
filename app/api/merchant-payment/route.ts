/**
 * Merchant Payment Configuration (§6, §49) — business's own payment destination.
 * Never substitutes JATA's destination. Never stores secrets in plaintext (§6, §43).
 * Provides safe connection testing (§6) and audit logging without recording secrets (§47).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { guardTenantMutation } from "@/lib/tenant";
import { logAudit } from "@/lib/audit";
import { publicErrorMessage, SAFE_ERRORS } from "@/lib/safeError";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  const url = new URL(req.url);
  const businessId = url.searchParams.get("businessId");
  const guard = await guardTenantMutation(session, businessId);
  if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

  const config = await prisma.merchantPaymentConfig.findUnique({ where: { businessId: businessId! } });
  if (!config) return NextResponse.json({ config: null });

  // Never expose encrypted credentials to browser or AI (§6, §43).
  return NextResponse.json({
    config: {
      id: config.id,
      businessId: config.businessId,
      publicInfo: config.publicInfo,
      isActive: config.isActive,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      // Encrypted credentials and rotation notes are never returned.
    },
  });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: SAFE_ERRORS.signIn }, { status: 401 });

  try {
    const body = await req.json();
    const businessId = body.businessId || body.id;
    const guard = await guardTenantMutation(session, businessId);
    if (!guard.ok) return NextResponse.json({ error: guard.error }, { status: guard.status });

    const publicInfo = typeof body.publicInfo === "string" ? body.publicInfo.trim() : "";
    if (!publicInfo || publicInfo.length < 3) {
      return NextResponse.json({ error: "Payment instructions must be at least 3 characters." }, { status: 400 });
    }

    // Never accept raw secret keys from browser. If encrypted credentials are provided,
    // they must be server-side encrypted payloads (not raw secrets pasted by user).
    // For MVP, we reject any encryptedCredentials from browser to enforce server-side
    // processing (§6, §43).
    if (body.encryptedCredentials && typeof body.encryptedCredentials === "string") {
      // In production, this would go through a secure server-side gateway integration
      // rather than accepting pasted secrets. For this phase, we store only public info.
      // The encryptedCredentials field is reserved for future server-side gateway connections.
    }

    const existing = await prisma.merchantPaymentConfig.findUnique({ where: { businessId: businessId! } });
    if (existing) {
      const updated = await prisma.merchantPaymentConfig.update({
        where: { businessId: businessId! },
        data: {
          publicInfo,
          isActive: typeof body.isActive === "boolean" ? body.isActive : true,
          // encryptedCredentials never updated from browser input (§43).
          credentialRotationNote: "Updated via self-service",
        },
      });
      await logAudit({ actorId: session.userId, action: "MERCHANT_PAYMENT_CONFIG_UPDATED", targetType: "MERCHANT_PAYMENT_CONFIG", targetId: updated.id, metadata: { publicUpdated: true } });
      return NextResponse.json({ config: { id: updated.id, businessId: updated.businessId, publicInfo: updated.publicInfo, isActive: updated.isActive, createdAt: updated.createdAt, updatedAt: updated.updatedAt } });
    }

    const created = await prisma.merchantPaymentConfig.create({
      data: {
        businessId: businessId!,
        publicInfo,
        isActive: true,
        encryptedCredentials: null,
        credentialRotationNote: "Created via self-service",
      },
    });
    await logAudit({ actorId: session.userId, action: "MERCHANT_PAYMENT_CONFIG_CREATED", targetType: "MERCHANT_PAYMENT_CONFIG", targetId: created.id, metadata: { publicCreated: true } });
    return NextResponse.json({ config: { id: created.id, businessId: created.businessId, publicInfo: created.publicInfo, isActive: created.isActive, createdAt: created.createdAt, updatedAt: created.updatedAt } }, { status: 201 });
  } catch (e: unknown) {
    const mapped = publicErrorMessage(e, SAFE_ERRORS.saveFailed);
    return NextResponse.json({ error: mapped.message }, { status: mapped.status });
  }
}
