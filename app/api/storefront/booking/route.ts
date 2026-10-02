/**
 * Storefront booking & enquiry (§9, §11, §29)
 *
 * Service businesses book time, not carts. Real-estate enquiries and viewing requests use
 * the same path with the property named as the subject, so the owner sees every request in
 * one board instead of managing a second inbox (§11, §12).
 */

import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import { normalizeExperienceDocument } from "@/lib/experience/document";
import { bookingEndAt, freeSlotsFor, parseAvailability, validateBookingRequest } from "@/lib/experience/booking";
import { initializeOrderPayment, notifyNewBooking, PAYMENT_PURPOSE } from "@/lib/experience/payments";
import { recordEvent, hashSession } from "@/lib/analytics";
import { sanitizeText } from "@/lib/validation";

export const dynamic = "force-dynamic";

const hits = new Map<string, { count: number; reset: number }>();
function throttled(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now > entry.reset) {
    hits.set(ip, { count: 1, reset: now + 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > 20;
}

function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/** Public: the next free slots for a service, so the customer's picker matches the server's rules. */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const slug = searchParams.get("slug")?.trim() || "";
  const serviceId = searchParams.get("serviceId")?.trim() || "";
  const date = searchParams.get("date")?.trim() || "";
  if (!slug || !serviceId || !date) return NextResponse.json({ slots: [] });

  try {
    const business = await prisma.business.findUnique({ where: { slug }, select: { id: true, isPublished: true, status: true } });
    if (!business || !business.isPublished || business.status === "SUSPENDED") return NextResponse.json({ slots: [] });
    const service = await prisma.service.findFirst({
      where: { id: serviceId, businessId: business.id, isActive: true },
      select: { id: true, durationMinutes: true, availability: true },
    });
    if (!service) return NextResponse.json({ slots: [] });

    const dayStart = new Date(`${date}T00:00:00`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
    const taken = await prisma.booking.findMany({
      where: { businessId: business.id, serviceId: service.id, startAt: { gte: dayStart, lt: dayEnd } },
      select: { startAt: true, endAt: true, status: true },
    });
    const slots = freeSlotsFor({
      date,
      availability: parseAvailability(service.availability),
      durationMinutes: service.durationMinutes,
      taken,
    });
    return NextResponse.json({ slots });
  } catch {
    return NextResponse.json({ slots: [] });
  }
}

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (throttled(ip)) return NextResponse.json({ error: "Too many attempts. Please wait a moment and try again." }, { status: 429 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "We couldn’t read that request. Please try again." }, { status: 400 });
  }

  const slug = typeof body.slug === "string" ? body.slug.trim().slice(0, 60) : "";
  if (!slug) return NextResponse.json({ error: "This business could not be found." }, { status: 400 });

  try {
    const business = await prisma.business.findUnique({
      where: { slug },
      select: { id: true, slug: true, name: true, isPublished: true, status: true },
    });
    if (!business || !business.isPublished || business.status === "SUSPENDED") {
      return NextResponse.json({ error: "This business is not taking requests right now." }, { status: 404 });
    }
    const experience = await prisma.businessExperience.findUnique({
      where: { businessId: business.id },
      select: { publishedJson: true, status: true, categoryKey: true },
    });
    if (!experience?.publishedJson || experience.status !== "PUBLISHED") {
      return NextResponse.json({ error: "This business is not taking requests right now." }, { status: 404 });
    }
    const document = normalizeExperienceDocument(JSON.parse(experience.publishedJson), experience.categoryKey);

    const serviceId = typeof body.serviceId === "string" ? body.serviceId.trim() : "";
    const itemId = typeof body.itemId === "string" ? body.itemId.trim() : "";
    let serviceName = "";
    let durationMinutes: number | null = null;
    let depositKES = 0;
    let staffName: string | null = null;

    if (serviceId) {
      const service = await prisma.service.findFirst({
        where: { id: serviceId, businessId: business.id, isActive: true, bookingEnabled: true },
        select: { id: true, title: true, durationMinutes: true, depositKES: true, staffName: true },
      });
      if (!service) return NextResponse.json({ error: "That service is no longer available." }, { status: 409 });
      serviceName = service.title;
      durationMinutes = service.durationMinutes;
      depositKES = Math.max(0, Math.round(Number(service.depositKES || 0)));
      staffName = service.staffName || null;
    } else if (itemId) {
      // Property enquiry / viewing request (§11): the listing is the subject.
      const item = await prisma.product.findFirst({
        where: { id: itemId, businessId: business.id, isActive: true },
        select: { id: true, name: true },
      });
      if (!item) return NextResponse.json({ error: "That listing is no longer available." }, { status: 409 });
      serviceName = `Viewing — ${item.name}`;
    } else {
      serviceName = sanitizeText(String(body.subject || "Enquiry"), 80) || "Enquiry";
    }

    const validation = validateBookingRequest({
      serviceId: serviceId || undefined,
      date: typeof body.date === "string" ? body.date : undefined,
      time: typeof body.time === "string" ? body.time : undefined,
      customerName: typeof body.customerName === "string" ? body.customerName : undefined,
      customerPhone: typeof body.customerPhone === "string" ? body.customerPhone : undefined,
      customerEmail: typeof body.customerEmail === "string" ? body.customerEmail : undefined,
    });
    if (validation.kind === "error") return NextResponse.json({ error: validation.error }, { status: 400 });
    const startAt = validation.startAt;

    // Re-check availability server-side: the browser's slot list is never authoritative.
    if (serviceId) {
      const dayStart = new Date(`${body.date}T00:00:00`);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      const [service, taken] = await Promise.all([
        prisma.service.findFirst({ where: { id: serviceId, businessId: business.id }, select: { availability: true } }),
        prisma.booking.findMany({
          where: { businessId: business.id, serviceId, startAt: { gte: dayStart, lt: dayEnd } },
          select: { startAt: true, endAt: true, status: true },
        }),
      ]);
      const available = freeSlotsFor({
        date: String(body.date),
        availability: parseAvailability(service?.availability),
        durationMinutes,
        taken,
      });
      if (!available.includes(String(body.time))) {
        return NextResponse.json({ error: "That time has just been taken. Please choose another." }, { status: 409 });
      }
    }

    const booking = await prisma.booking.create({
      data: {
        businessId: business.id,
        serviceId: serviceId || null,
        serviceName,
        customerName: String(body.customerName).trim().slice(0, 80),
        customerPhone: String(body.customerPhone).trim().slice(0, 30),
        customerEmail: typeof body.customerEmail === "string" ? body.customerEmail.trim().slice(0, 160) || null : null,
        staffName: typeof body.staffName === "string" ? body.staffName.trim().slice(0, 60) || staffName : staffName,
        startAt,
        endAt: bookingEndAt(startAt, durationMinutes ?? document.settings.bookingSlotMinutes ?? 30),
        notes: typeof body.notes === "string" ? body.notes.trim().slice(0, 500) : null,
        status: depositKES > 0 ? "PENDING" : "CONFIRMED",
        depositKES,
        paymentStatus: depositKES > 0 ? "UNPAID" : "UNPAID",
      },
      select: { id: true, serviceName: true, startAt: true, status: true, depositKES: true },
    });

    const sessionHash = hashSession({ ip, userAgent: req.headers.get("user-agent") });
    await recordEvent({ businessId: business.id, eventType: "BOOKING_CREATED", ip, userAgent: req.headers.get("user-agent"), sessionHash, subjectId: serviceId || itemId || booking.id });
    await notifyNewBooking({ businessId: business.id, customerName: booking.serviceName ? String(body.customerName) : "A customer", serviceName: booking.serviceName, startAt: booking.startAt, bookingId: booking.id });

    let authorizationUrl: string | null = null;
    let paymentReference: string | null = null;
    let mock = false;
    if (depositKES > 0) {
      const payment = await initializeOrderPayment({
        businessId: business.id,
        bookingId: booking.id,
        amountKES: depositKES,
        email: (typeof body.customerEmail === "string" && body.customerEmail) || `${String(body.customerPhone).replace(/\D/g, "")}@customer.jata.local`,
        customerName: String(body.customerName),
        purpose: PAYMENT_PURPOSE.BOOKING_DEPOSIT,
        callbackPath: `/b/${business.slug}/booking/${booking.id}`,
        metadata: { bookingId: booking.id },
      });
      if (payment.kind === "ok") {
        authorizationUrl = payment.authorizationUrl;
        paymentReference = payment.reference;
        mock = payment.mock;
        await prisma.booking.update({ where: { id: booking.id }, data: { paymentId: payment.paymentId } });
      }
    }

    return NextResponse.json({
      booking: { id: booking.id, serviceName: booking.serviceName, startAt: booking.startAt, status: booking.status, depositKES: booking.depositKES },
      authorizationUrl,
      paymentReference,
      mock,
      message: depositKES > 0 ? "Booking received. Pay the deposit to confirm it." : "Booking confirmed.",
    }, { status: 201 });
  } catch {
    console.error("storefront booking failed");
    return NextResponse.json({ error: "We couldn’t send that request. Please try again." }, { status: 500 });
  }
}
