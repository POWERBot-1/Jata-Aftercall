/**
 * Storefront booking & enquiry (§9, §11, §29)
 *
 * Two customers must never be able to take the same appointment, and a booking without a
 * deposit must still reach the owner as a real request.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { addCalendarDays, calendarDayInZone, dayOfWeekForCalendarDay, wallClockToInstant } from "@/lib/experience/bookingTime";

const mocks = vi.hoisted(() => ({
  business: { id: "business-a", slug: "fade-lounge", name: "Fade Lounge", isPublished: true, status: "ACTIVE" },
  experience: {
    publishedJson: JSON.stringify({
      categoryKey: "salon", themeKey: "salon-barber", brand: { businessName: "Fade Lounge" },
      settings: { phone: "0722000000", bookingSlotMinutes: 30 }, sections: [],
    }),
    status: "PUBLISHED",
    categoryKey: "salon",
  },
  service: { id: "s1", title: "Haircut", durationMinutes: 60, depositKES: 0, staffName: "Brian", availability: null },
  taken: [] as Array<{ startAt: Date; endAt: Date; status: string }>,
  bookingCreate: vi.fn(),
  bookingUpdate: vi.fn(),
  initialize: vi.fn(),
  notify: vi.fn(),
  recordEvent: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  default: {
    business: { findUnique: vi.fn(async () => mocks.business) },
    businessExperience: { findUnique: vi.fn(async () => mocks.experience) },
    service: { findFirst: vi.fn(async () => mocks.service) },
    product: { findFirst: vi.fn(async () => ({ id: "p1", name: "3-bedroom in Kilimani" })) },
    booking: { findMany: vi.fn(async () => mocks.taken), create: mocks.bookingCreate, update: mocks.bookingUpdate },
  },
}));

vi.mock("@/lib/experience/payments", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/experience/payments")>();
  return { ...actual, initializeOrderPayment: mocks.initialize, notifyNewBooking: mocks.notify };
});

vi.mock("@/lib/analytics", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/analytics")>();
  return { ...actual, recordEvent: mocks.recordEvent, hashIp: () => "ip-hash", hashSession: () => "session-hash" };
});

import { GET, POST } from "@/app/api/storefront/booking/route";

let counter = 0;
function request(body: unknown) {
  counter += 1;
  return new Request("https://jata.test/api/storefront/booking", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", "x-forwarded-for": `10.1.0.${counter % 250}` },
  });
}
function get(url: string) {
  return new Request(url);
}

/** A future *business* day (Nairobi), so the fixture never depends on the host clock (§J.1). */
function futureDate(offsetDays: number): string {
  let day = addCalendarDays(calendarDayInZone(new Date()), offsetDays);
  if (offsetDays > 0 && dayOfWeekForCalendarDay(day) === 0) day = addCalendarDays(day, 1);
  return day;
}

/** A stored booking instant: the route now stores the Nairobi wall clock's UTC instant. */
function takenBooking(date: string, time = "11:00", status = "CONFIRMED", minutes = 60) {
  const startAt = wallClockToInstant(date, time)!;
  return { startAt, endAt: new Date(startAt.getTime() + minutes * 60_000), status };
}

const payload = {
  slug: "fade-lounge",
  serviceId: "s1",
  date: futureDate(1),
  time: "11:00",
  customerName: "Amina",
  customerPhone: "0722123456",
};

beforeEach(() => {
  vi.stubEnv("VERCEL", "1"); // Synthetic X-Forwarded-For headers model the trusted platform edge.
  vi.clearAllMocks();
  mocks.business.isPublished = true;
  mocks.business.status = "ACTIVE";
  mocks.experience.status = "PUBLISHED";
  mocks.service.depositKES = 0;
  mocks.service.title = "Haircut";
  mocks.service.staffName = "Brian";
  mocks.taken = [];
  mocks.bookingCreate.mockImplementation(async ({ data }: any) => ({ id: "booking-1", ...data }));
  mocks.bookingUpdate.mockResolvedValue({ id: "booking-1" });
  mocks.initialize.mockResolvedValue({ kind: "ok", reference: "JATA-BOOK-1", authorizationUrl: "https://paystack.test/authorize", mock: false, paymentId: "pay-1" });
  mocks.notify.mockResolvedValue(undefined);
  mocks.recordEvent.mockResolvedValue(undefined);
});

describe("GET /api/storefront/booking — availability", () => {
  it("only offers slots the business has free", async () => {
    const response = await GET(get(`https://jata.test/api/storefront/booking?slug=fade-lounge&serviceId=s1&date=${futureDate(1)}`));
    const body = await response.json();
    expect(body.slots).toContain("11:00");
  });

  it("removes a slot that another customer has already taken", async () => {
    const date = futureDate(1);
    mocks.taken = [takenBooking(date)];
    const response = await GET(get(`https://jata.test/api/storefront/booking?slug=fade-lounge&serviceId=s1&date=${date}`));
    const body = await response.json();
    expect(body.slots).not.toContain("11:00");
  });

  it("ignores cancelled bookings when calculating availability", async () => {
    const date = futureDate(1);
    mocks.taken = [takenBooking(date, "11:00", "CANCELLED")];
    const response = await GET(get(`https://jata.test/api/storefront/booking?slug=fade-lounge&serviceId=s1&date=${date}`));
    expect((await response.json()).slots).toContain("11:00");
  });
});

describe("POST /api/storefront/booking", () => {
  it("books a slot and confirms it when no deposit is required", async () => {
    const response = await POST(request(payload));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.booking.status).toBe("CONFIRMED");
    expect(body.authorizationUrl).toBeNull();
    const created = mocks.bookingCreate.mock.calls[0][0].data;
    expect(created.businessId).toBe("business-a");
    expect(created.serviceName).toBe("Haircut");
    expect(mocks.notify).toHaveBeenCalled();
  });

  it("rejects inline image data in customer booking text before persistence", async () => {
    const response = await POST(request({ ...payload, notes: "Reference data:image/png;base64,iVBORw0KGgo=" }));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
  });

  it("rejects inline image data in the resolved service name before persistence", async () => {
    mocks.service.title = "data:image/png;base64,iVBORw0KGgo=";
    const response = await POST(request(payload));
    expect(response.status).toBe(503);
    expect((await response.json()).code).toBe("inline_media_persistence_disabled");
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("re-checks the slot server-side, so a race cannot double-book", async () => {
    const date = payload.date;
    mocks.taken = [takenBooking(date)];
    const response = await POST(request(payload));
    expect(response.status).toBe(409);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("takes a deposit and leaves the booking pending until it is paid", async () => {
    mocks.service.depositKES = 500;
    const response = await POST(request(payload));
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.booking.status).toBe("PENDING");
    expect(body.authorizationUrl).toContain("paystack.test");
    expect(mocks.initialize).toHaveBeenCalledWith(expect.objectContaining({ amountKES: 500 }));
  });

  it("records a property viewing request without a service", async () => {
    const response = await POST(request({
      slug: "fade-lounge",
      itemId: "p1",
      date: futureDate(2),
      time: "10:00",
      customerName: "Amina",
      customerPhone: "0722123456",
    }));
    expect(response.status).toBe(201);
    const created = mocks.bookingCreate.mock.calls[0][0].data;
    expect(created.serviceName).toContain("3-bedroom in Kilimani");
  });

  it("validates the customer before writing anything", async () => {
    expect((await POST(request({ ...payload, customerName: "A" }))).status).toBe(400);
    expect((await POST(request({ ...payload, customerPhone: "12" }))).status).toBe(400);
    expect((await POST(request({ ...payload, time: "99:99" }))).status).toBe(400);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });

  it("refuses bookings for an unpublished business", async () => {
    mocks.business.isPublished = false;
    expect((await POST(request(payload))).status).toBe(404);
    expect(mocks.bookingCreate).not.toHaveBeenCalled();
  });
});
