/**
 * Orders, bookings, payments and entitlement states (§27, §28, §29, §45)
 *
 * These are the state machines the business runs on. They are pure functions so the rules can
 * be tested without a database — and so a client cannot skip a step by sending a status.
 */

import { describe, expect, it } from "vitest";
import {
  ORDER_STAGES,
  isValidStageTransition,
  nextStageFor,
  orderStagesFor,
  orderStatusToStage,
  stageToOrderStatus,
} from "@/lib/experience/orders";
import {
  BOOKING_STATUS_LABELS,
  DEFAULT_AVAILABILITY,
  bookingEndAt,
  freeSlotsFor,
  isValidBookingTransition,
  parseAvailability,
  validateBookingRequest,
} from "@/lib/experience/booking";
import { paymentStateOf } from "@/lib/experience/payments";
import {
  INTERACTIVE_DURATION_DAYS,
  INTERACTIVE_PLAN_KEY,
  INTERACTIVE_PRICE_KES,
  assertInteractivePlanPricing,
  deriveEntitlement,
} from "@/lib/experience/entitlement";

function futureDate(offsetDays: number): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

describe("order state machine", () => {
  it("offers the stages a category actually uses", () => {
    expect(orderStagesFor("food")).toContain("READY");
    expect(orderStagesFor("salon")).not.toContain("READY");
    expect(orderStagesFor("nonsense").length).toBeGreaterThan(2);
  });

  it("only allows forward movement", () => {
    expect(isValidStageTransition("NEW", "ACCEPTED")).toBe(true);
    expect(isValidStageTransition("ACCEPTED", "PROCESSING")).toBe(true);
    expect(isValidStageTransition("PROCESSING", "READY")).toBe(true);
    expect(isValidStageTransition("NEW", "COMPLETED")).toBe(false);
    expect(isValidStageTransition("COMPLETED", "NEW")).toBe(false);
    expect(isValidStageTransition("CANCELLED", "COMPLETED")).toBe(false);
    expect(isValidStageTransition("NEW", "NONSENSE")).toBe(false);
  });

  it("maps owner stages onto the existing order states", () => {
    expect(stageToOrderStatus("NEW")).toBe("CONFIRMED");
    expect(stageToOrderStatus("READY")).toBe("READY");
    expect(orderStatusToStage("CONFIRMED")).toBe("NEW");
    expect(orderStatusToStage("DRAFT")).toBe("NEW");
    for (const stage of ORDER_STAGES) {
      expect(ORDER_STAGES).toContain(orderStatusToStage(stageToOrderStatus(stage) || "CONFIRMED"));
    }
  });

  it("suggests the next step for a category", () => {
    expect(nextStageFor("food", "NEW")).toBe("ACCEPTED");
    expect(nextStageFor("food", "COMPLETED")).toBeNull();
  });
});

describe("booking rules", () => {
  it("validates a booking request before anything is written", () => {
    const ok = validateBookingRequest({
      serviceId: "s1",
      date: futureDate(1),
      time: "10:00",
      customerName: "Amina",
      customerPhone: "0722123456",
    });
    expect(ok.kind).toBe("ok");

    // A service is optional: properties and quote businesses take enquiries too (§11).
    expect(validateBookingRequest({ date: futureDate(1), time: "10:00", customerName: "Amina", customerPhone: "0722123456" }).kind).toBe("ok");
    expect(validateBookingRequest({ time: "10:00", customerName: "Amina", customerPhone: "0722123456" }).kind).toBe("error");
    expect(validateBookingRequest({ date: futureDate(1), time: "25:00", customerName: "Amina", customerPhone: "0722123456" }).kind).toBe("error");
    expect(validateBookingRequest({ date: "not-a-date", time: "10:00", customerName: "Amina", customerPhone: "0722123456" }).kind).toBe("error");
    expect(validateBookingRequest({ date: futureDate(1), time: "10:00", customerName: "A", customerPhone: "0722123456" }).kind).toBe("error");
    expect(validateBookingRequest({ date: futureDate(1), time: "10:00", customerName: "Amina", customerPhone: "123" }).kind).toBe("error");
  });

  it("never offers a slot that is already taken", () => {
    const date = futureDate(1);
    const day = new Date(`${date}T10:00:00`);
    const taken = [{ startAt: day, endAt: new Date(day.getTime() + 60 * 60_000), status: "CONFIRMED" }];
    const slots = freeSlotsFor({ date, availability: DEFAULT_AVAILABILITY, durationMinutes: 60, taken });
    expect(slots).not.toContain("10:00");
    expect(slots).toContain("11:00");
  });

  it("hides past times and closed days", () => {
    const today = futureDate(0);
    const now = new Date();
    for (const slot of freeSlotsFor({ date: today, availability: DEFAULT_AVAILABILITY, durationMinutes: 60 })) {
      const [hours, minutes] = slot.split(":").map(Number);
      const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
      expect(start.getTime()).toBeGreaterThan(now.getTime());
    }
    // Sunday (day 0) is closed by default — find the next one regardless of today's weekday.
    const sunday = new Date();
    do {
      sunday.setDate(sunday.getDate() + 1);
    } while (sunday.getDay() !== 0);
    const sundayString = `${sunday.getFullYear()}-${String(sunday.getMonth() + 1).padStart(2, "0")}-${String(sunday.getDate()).padStart(2, "0")}`;
    expect(freeSlotsFor({ date: sundayString, availability: DEFAULT_AVAILABILITY, durationMinutes: 60 })).toHaveLength(0);
  });

  it("falls back to safe defaults for malformed availability", () => {
    expect(parseAvailability(null)).toEqual(DEFAULT_AVAILABILITY);
    expect(parseAvailability("not json")).toEqual(DEFAULT_AVAILABILITY);
    expect(parseAvailability(JSON.stringify({ days: [1], slots: ["nope"] })).slots).toEqual(DEFAULT_AVAILABILITY.slots);
    expect(parseAvailability(JSON.stringify({ slotMinutes: 5 })).slotMinutes).toBe(DEFAULT_AVAILABILITY.slotMinutes);
  });

  it("moves a booking only along allowed transitions", () => {
    expect(isValidBookingTransition("PENDING", "CONFIRMED")).toBe(true);
    expect(isValidBookingTransition("PENDING", "COMPLETED")).toBe(false);
    expect(isValidBookingTransition("CONFIRMED", "NO_SHOW")).toBe(true);
    expect(isValidBookingTransition("COMPLETED", "CONFIRMED")).toBe(false);
    expect(BOOKING_STATUS_LABELS.NO_SHOW).toBe("No show");
  });

  it("always books a sensible minimum slot", () => {
    const start = new Date("2030-01-01T09:00:00");
    expect(bookingEndAt(start, 5).getTime() - start.getTime()).toBe(15 * 60_000);
    expect(bookingEndAt(start, 45).getTime() - start.getTime()).toBe(45 * 60_000);
    expect(bookingEndAt(start, null).getTime() - start.getTime()).toBe(30 * 60_000);
  });
});

describe("payment states", () => {
  it("maps stored payment rows onto the explicit state machine", () => {
    expect(paymentStateOf(null)).toBe("NOT_STARTED");
    expect(paymentStateOf({ status: "PENDING" })).toBe("PENDING");
    expect(paymentStateOf({ status: "PAID" })).toBe("SUCCESS");
    expect(paymentStateOf({ status: "FAILED" })).toBe("FAILED");
    expect(paymentStateOf({ status: "EXPIRED" })).toBe("EXPIRED");
    expect(paymentStateOf({ status: "REFUNDED" })).toBe("CANCELLED");
  });
});

describe("subscription entitlement", () => {
  it("prices the Interactive Business package exactly as specified", () => {
    expect(INTERACTIVE_PRICE_KES).toBe(999);
    expect(INTERACTIVE_DURATION_DAYS).toBe(30);
    expect(INTERACTIVE_PLAN_KEY).toBe("INTERACTIVE_BUSINESS");
    expect(assertInteractivePlanPricing({ key: INTERACTIVE_PLAN_KEY, priceKES: 999, durationDays: 30 })).toBe(true);
    expect(assertInteractivePlanPricing({ key: INTERACTIVE_PLAN_KEY, priceKES: 1000, durationDays: 30 })).toBe(false);
    expect(assertInteractivePlanPricing(null)).toBe(false);
  });

  it("never entitles a business without a subscription", () => {
    const state = deriveEntitlement({ subscription: null });
    expect(state.entitled).toBe(false);
    expect(state.status).toBe("NONE");
  });

  it("does not entitle a business on another plan", () => {
    const state = deriveEntitlement({
      subscription: { status: "ACTIVE", plan: { key: "AI_BUSINESS_FRONT_DESK" }, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect(state.entitled).toBe(false);
  });

  it("waits for payment on a subscription that is not active yet", () => {
    const state = deriveEntitlement({
      subscription: { status: "PENDING", plan: { key: INTERACTIVE_PLAN_KEY }, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect(state.entitled).toBe(false);
    expect(state.status).toBe("PENDING");
  });

  it("entitles an active Interactive subscription", () => {
    const state = deriveEntitlement({
      subscription: { status: "ACTIVE", plan: { key: INTERACTIVE_PLAN_KEY }, expiresAt: new Date(Date.now() + 86_400_000) },
    });
    expect(state.entitled).toBe(true);
    expect(state.status).toBe("ACTIVE");
  });

  it("reports expiry and grace without deleting anything", () => {
    const expired = deriveEntitlement({
      subscription: { status: "ACTIVE", plan: { key: INTERACTIVE_PLAN_KEY }, expiresAt: new Date(Date.now() - 86_400_000) },
    });
    expect(expired.entitled).toBe(false);
    expect(["EXPIRED", "PAST_DUE"]).toContain(expired.status);

    const pastDue = deriveEntitlement({
      subscription: { status: "PAST_DUE", plan: { key: INTERACTIVE_PLAN_KEY }, expiresAt: new Date(Date.now() - 86_400_000), graceUntil: new Date(Date.now() + 86_400_000) },
    });
    expect(pastDue.status).toBe("PAST_DUE");
  });
});
