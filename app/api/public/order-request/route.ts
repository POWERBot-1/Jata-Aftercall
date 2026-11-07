import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { rateLimit, trustedClientIp } from "@/lib/rate-limit";
import { recordEvent, hashSession } from "@/lib/analytics";
import { isSameSiteRequest, OFFLINE_WRITE_ERROR, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { loadCatalogueForPricing } from "@/lib/business-hub/catalogue";
import {
  ORDER_REQUEST_STATUS_HINTS,
  createOrderRequest,
  getOrderRequestByReference,
  isOrderRequestStatus,
  validateOrderRequestInput,
} from "@/lib/business-hub/orderRequests";
import { submissionFingerprint } from "@/lib/business-hub/shared";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/**
 * Public order-request intake (Business Hub A).
 *
 * Unauthenticated by design — a customer must not need an account to ask for a quote. Everything
 * that keeps that safe is here: rate limit, same-site origin check, honeypot, body-size cap,
 * published-only businesses, and server-side pricing from the owner's own catalogue rows.
 */
export async function POST(req: Request) {
  const limit = rateLimit(req, { key: "hub-order-request", max: 10, windowMs: 60_000 });
  if (!limit.allowed) return reply({ error: "Too many requests. Please wait a minute and try again." }, 429);
  if (!isSameSiteRequest(req)) return reply({ error: "Send your request from this business's page." }, 403);

  const raw = await readJsonBody(req);
  if (!raw) return reply({ error: "We couldn't read that request. Nothing was sent." }, 400);
  // Honeypot: a real browser never fills the hidden field, a bot always does.
  if (typeof raw.website === "string" && raw.website.trim().length > 0) {
    return reply({ received: true, reference: null, status: "NEW" }, 202);
  }
  if (!hasDurableDatabase()) return reply({ error: OFFLINE_WRITE_ERROR }, 503);

  const slug = typeof raw.slug === "string" ? raw.slug.trim().slice(0, 120) : "";
  if (!slug) return reply({ error: "This request is missing the business page." }, 400);

  let business: { id: string; isPublished: boolean; status: string } | null = null;
  try {
    business = await prisma.business.findUnique({
      where: { slug },
      select: { id: true, isPublished: true, status: true },
    });
  } catch {
    return reply({ error: OFFLINE_WRITE_ERROR }, 503);
  }
  if (!business || !business.isPublished || business.status === "SUSPENDED") {
    return reply({ error: "This business is not taking order requests right now." }, 404);
  }

  const products = await loadCatalogueForPricing(business.id);
  const parsed = validateOrderRequestInput(raw, products);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  const ip = trustedClientIp(req.headers) ?? "unknown";
  const fingerprint = submissionFingerprint({ ip, userAgent: req.headers.get("user-agent") });

  try {
    const { idempotent, record } = await createOrderRequest({
      businessId: business.id,
      input: parsed.value,
      ipHash: fingerprint.ipHash,
      sessionHash: fingerprint.sessionHash,
      source: "BUSINESS_PAGE",
    });
    if (!idempotent) {
      await recordEvent({
        businessId: business.id,
        eventType: "CHECKOUT_STARTED",
        source: "business-hub-order-request",
        ip,
        userAgent: req.headers.get("user-agent"),
        sessionHash: hashSession({ ip, userAgent: req.headers.get("user-agent") }),
      }).catch(() => undefined);
    }
    return reply(
      {
        received: true,
        idempotent,
        reference: record.reference,
        status: record.status,
        statusHint: ORDER_REQUEST_STATUS_HINTS[(record.status as keyof typeof ORDER_REQUEST_STATUS_HINTS) ?? "NEW"],
        estimatedTotalKES: record.estimatedTotalKES,
        itemCount: record.itemCount,
        createdAt: record.createdAt,
        message:
          "Request sent. The business will contact you to confirm availability and price. No payment has been taken and nothing is confirmed yet.",
      },
      idempotent ? 200 : 201,
    );
  } catch {
    return reply({ error: OFFLINE_WRITE_ERROR }, 503);
  }
}

/**
 * Public read-back by reference. The reference is unguessable (date + 6 random characters) and
 * the payload carries only what the customer typed: no owner notes, no internal ids.
 */
export async function GET(req: Request) {
  const reference = new URL(req.url).searchParams.get("ref")?.trim().slice(0, 40) ?? "";
  if (!reference) return reply({ error: "A request reference is required." }, 400);
  const record = await getOrderRequestByReference(reference);
  if (!record) return reply({ error: "We couldn't find that request reference." }, 404);
  const status = isOrderRequestStatus(record.status) ? record.status : "NEW";
  return reply(
    {
      reference: record.reference,
      status,
      statusHint: ORDER_REQUEST_STATUS_HINTS[status],
      customerName: record.customerName,
      estimatedTotalKES: record.estimatedTotalKES,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      items: (record.items ?? []).map((item: any) => ({
        name: item.name,
        quantity: item.quantity,
        unitPriceKES: item.unitPriceKES,
        lineTotalKES: item.lineTotalKES,
        imageUrl: item.imageUrl ?? null,
      })),
      message: "This is an order request, not a payment. The business confirms price and availability directly.",
    },
    200,
  );
}
