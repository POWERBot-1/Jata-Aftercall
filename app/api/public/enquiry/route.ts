import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { rateLimit, trustedClientIp } from "@/lib/rate-limit";
import { recordEvent, hashSession } from "@/lib/analytics";
import { isSameSiteRequest, OFFLINE_WRITE_ERROR, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import { createEnquiry, validateEnquiryInput } from "@/lib/business-hub/enquiries";
import { submissionFingerprint } from "@/lib/business-hub/shared";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** Public enquiry intake for the classic Business Page (Smart Customer Hub, feature B). */
export async function POST(req: Request) {
  const limit = rateLimit(req, { key: "hub-enquiry", max: 12, windowMs: 60_000 });
  if (!limit.allowed) return reply({ error: "Too many requests. Please wait a minute and try again." }, 429);
  if (!isSameSiteRequest(req)) return reply({ error: "Send your enquiry from this business's page." }, 403);

  const raw = await readJsonBody(req);
  if (!raw) return reply({ error: "We couldn't read that enquiry. Nothing was sent." }, 400);
  if (typeof raw.website === "string" && raw.website.trim().length > 0) {
    return reply({ received: true, reference: null }, 202);
  }
  if (!hasDurableDatabase()) return reply({ error: OFFLINE_WRITE_ERROR }, 503);

  const slug = typeof raw.slug === "string" ? raw.slug.trim().slice(0, 120) : "";
  if (!slug) return reply({ error: "This enquiry is missing the business page." }, 400);

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
    return reply({ error: "This business is not taking enquiries right now." }, 404);
  }

  const parsed = validateEnquiryInput(raw);
  if (!parsed.ok) return reply({ error: parsed.error }, 400);

  const ip = trustedClientIp(req.headers) ?? "unknown";
  const fingerprint = submissionFingerprint({ ip, userAgent: req.headers.get("user-agent") });

  try {
    const { idempotent, record } = await createEnquiry({
      businessId: business.id,
      input: parsed.value,
      ipHash: fingerprint.ipHash,
      sessionHash: fingerprint.sessionHash,
      source: "BUSINESS_PAGE",
    });
    if (!idempotent) {
      await recordEvent({
        businessId: business.id,
        eventType: "ENQUIRY_SUBMITTED",
        source: "business-hub-enquiry",
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
        message: "Enquiry sent. The business will reply directly. Nothing has been booked or paid for.",
      },
      idempotent ? 200 : 201,
    );
  } catch {
    return reply({ error: OFFLINE_WRITE_ERROR }, 503);
  }
}
