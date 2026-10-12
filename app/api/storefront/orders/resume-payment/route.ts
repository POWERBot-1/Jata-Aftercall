import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { resumeOrderPayment } from "@/lib/experience/payments";

/**
 * Customer recovery for an unpaid storefront order: "Continue to payment" on the order page.
 * Tenant scoped: the shop is resolved from its public slug, and the order must belong to that shop.
 * The provider is asked before anything new is started (see resumeOrderPayment).
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { slug?: unknown; reference?: unknown } | null;
  const slug = typeof body?.slug === "string" ? body.slug.trim() : "";
  const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
  if (!slug || slug.length > 120 || !reference || reference.length > 100) {
    return NextResponse.json({ error: "We couldn’t find that order." }, { status: 400 });
  }
  const business = await prisma.business.findFirst({
    where: { slug, isPublished: true, status: "ACTIVE" },
    select: { id: true },
  });
  if (!business) return NextResponse.json({ error: "This shop is not accepting payments right now." }, { status: 404 });

  const result = await resumeOrderPayment({ businessId: business.id, orderReference: reference });
  switch (result.kind) {
    case "REDIRECT":
      return NextResponse.json({ authorizationUrl: result.authorizationUrl, paymentReference: result.paymentReference, orderReference: result.orderReference });
    case "PAID":
      return NextResponse.json({ paid: true });
    case "PROCESSING":
      return NextResponse.json({ error: result.message, processing: true }, { status: 409 });
    case "NOT_PAYABLE":
      return NextResponse.json({ error: result.message }, { status: 409 });
    case "NOT_FOUND":
      return NextResponse.json({ error: "We couldn’t find that order." }, { status: 404 });
    case "ERROR":
      return NextResponse.json({ error: "We couldn’t start your payment. Please try again shortly." }, { status: 502 });
  }
}
