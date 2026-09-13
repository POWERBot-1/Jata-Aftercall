import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { getPlanById, getPlanByKey } from "@/lib/pricing";
import { initializeTransaction, toKobo } from "@/lib/paystack";
import crypto from "crypto";
import { getBaseUrl } from "@/lib/url";

export async function POST(req: Request) {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const body = await req.json();
    const { businessId, planKey, planId } = body as { businessId?: string; planKey?: string; planId?: string };

    if (!businessId) return NextResponse.json({ error: "businessId required" }, { status: 400 });

    const business = await prisma.business.findUnique({ where: { id: businessId } });
    if (!business) return NextResponse.json({ error: "Business not found" }, { status: 404 });
    if (business.ownerId !== session.userId && session.role !== "ADMIN") {
      return NextResponse.json({ error: "Tenant isolation: not your business" }, { status: 403 });
    }

    // Resolve plan server-side — never trust client amount
    let plan = null;
    if (planId) plan = await getPlanById(planId);
    else if (planKey) plan = await getPlanByKey(planKey);
    else plan = await prisma.planConfig.findFirst({ where: { isActive: true }, orderBy: { priceKES: "asc" } });

    if (!plan) {
      // fallback to DB-less pricing if seed missing
      return NextResponse.json({ error: "No active plan configured — contact admin" }, { status: 400 });
    }

    const amountKobo = toKobo(plan.priceKES);
    const reference = `jata_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    const base = getBaseUrl();

    // Create PENDING payment
    const user = await prisma.user.findUnique({ where: { id: session.userId } });
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });

    const payment = await prisma.payment.create({
      data: {
        reference,
        businessId,
        userId: session.userId,
        planId: plan.id,
        amount: amountKobo,
        currency: "KES",
        status: "PENDING",
      },
    });

    // If Paystack secret not configured (dev without keys), return mock authorization for testing
    if (!process.env.PAYSTACK_SECRET_KEY) {
      return NextResponse.json({
        payment,
        authorization_url: `${base}/checkout/mock?reference=${reference}&plan=${plan.key}`,
        reference,
        mock: true,
        message: "PAYSTACK_SECRET_KEY not set — mock checkout (use /api/paystack/verify?reference= to simulate success in dev)",
      });
    }

    const init = await initializeTransaction({
      email: user.email,
      amount: amountKobo,
      reference,
      callbackUrl: `${base}/checkout/callback?reference=${reference}`,
      metadata: {
        businessId,
        userId: session.userId,
        planId: plan.id,
        merchant: process.env.PAYSTACK_MERCHANT_ID || "2006074",
      },
    });

    return NextResponse.json({ payment, authorization_url: init.authorization_url, reference, access_code: init.access_code });
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Checkout failed" }, { status: 500 });
  }
}
