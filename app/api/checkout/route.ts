import { NextResponse } from "next/server";
import crypto from "crypto";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership, TenantError } from "@/lib/tenant";
import { initializeTransaction, toKobo } from "@/lib/paystack";
import { getBaseUrl } from "@/lib/url";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });

  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid checkout request." }, { status: 400 }); }
  const businessId = typeof body.businessId === "string" ? body.businessId.trim() : "";
  const planId = typeof body.planId === "string" ? body.planId.trim() : "";
  if (!businessId || !planId) return NextResponse.json({ error: "Choose a business and subscription plan before checkout." }, { status: 400 });

  try {
    await assertBusinessOwnership(businessId, session);
    const [business, plan, user] = await Promise.all([
      prisma.business.findUnique({ where: { id: businessId }, select: { id: true } }),
      prisma.planConfig.findUnique({ where: { id: planId } }),
      prisma.user.findUnique({ where: { id: session.userId }, select: { email: true } }),
    ]);
    if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });
    if (!plan) return NextResponse.json({ error: "The selected plan is not available." }, { status: 404 });
    if (!plan.isActive || !Number.isSafeInteger(plan.priceKES) || plan.priceKES <= 0 || plan.durationDays <= 0) {
      return NextResponse.json({ error: "The selected plan is not currently available." }, { status: 400 });
    }
    if (!user?.email) return NextResponse.json({ error: "Your account needs a valid email before checkout." }, { status: 400 });

    const recentPending = await prisma.payment.findFirst({
      where: { businessId, userId: session.userId, planId: plan.id, status: "PENDING", createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) } },
      select: { reference: true },
    });
    if (recentPending) {
      return NextResponse.json({ error: "A payment for this plan is already in progress. Check its status before starting another." }, { status: 409 });
    }

    const reference = `jata_${crypto.randomUUID().replace(/-/g, "")}`;
    const amount = toKobo(plan.priceKES);
    const payment = await prisma.payment.create({
      data: { reference, businessId, userId: session.userId, planId: plan.id, amount, currency: "KES", status: "PENDING" },
      select: { id: true, reference: true, amount: true, currency: true, status: true },
    });

    if (!process.env.PAYSTACK_SECRET_KEY) {
      if (process.env.NODE_ENV === "production") {
        await prisma.payment.update({ where: { id: payment.id }, data: { status: "FAILED" } });
        return NextResponse.json({ error: "Online payments are temporarily unavailable. Please try again later." }, { status: 503 });
      }
      return NextResponse.json({
        payment,
        authorization_url: `${getBaseUrl()}/checkout/mock?reference=${encodeURIComponent(reference)}`,
        reference,
        mock: true,
      });
    }

    try {
      const initialized = await initializeTransaction({
        email: user.email,
        amount,
        reference,
        callbackUrl: `${getBaseUrl()}/checkout/callback`,
        metadata: { businessId, userId: session.userId, planId: plan.id },
      });
      return NextResponse.json({ payment, authorization_url: initialized.authorization_url, reference });
    } catch {
      await prisma.payment.updateMany({ where: { id: payment.id, status: "PENDING" }, data: { status: "FAILED" } });
      return NextResponse.json({ error: "Paystack could not start this payment. Please try again." }, { status: 502 });
    }
  } catch (error) {
    if (error instanceof TenantError) {
      return NextResponse.json({ error: error.status === 404 ? "Business not found." : "You are not authorized to pay for this business." }, { status: error.status });
    }
    console.error("checkout request failed");
    return NextResponse.json({ error: "Checkout could not be started. Please try again." }, { status: 500 });
  }
}
