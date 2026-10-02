/**
 * Booking engine (§9, §29)
 *
 * Service businesses are never forced into a shopping cart. A booking carries a service,
 * a date, a time, a customer and — where the business asks for one — a deposit.
 *
 * Availability is configured per service and validated server-side against existing
 * bookings, so two customers cannot take the same slot (§37 tenant-scoped reads).
 */

import { getExperienceProfile } from "./categories";
import type { CategoryKey } from "./types";

export const BOOKING_STATUSES = ["PENDING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

export function isBookingStatus(value: unknown): value is BookingStatus {
  return typeof value === "string" && (BOOKING_STATUSES as readonly string[]).includes(value);
}

const VALID_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  PENDING: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["IN_PROGRESS", "COMPLETED", "CANCELLED", "NO_SHOW"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED", "NO_SHOW"],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
};

export function isValidBookingTransition(from: string, to: string): boolean {
  if (!isBookingStatus(from) || !isBookingStatus(to)) return false;
  if (from === to) return true;
  return VALID_TRANSITIONS[from].includes(to);
}

export const BOOKING_STATUS_LABELS: Record<BookingStatus, string> = {
  PENDING: "Pending",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  CANCELLED: "Cancelled",
  NO_SHOW: "No show",
};

export type Availability = {
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** "09:00" style start times. */
  slots: string[];
  slotMinutes: number;
  capacity: number;
};

export const DEFAULT_AVAILABILITY: Availability = {
  days: [1, 2, 3, 4, 5, 6],
  slots: ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00", "16:00", "17:00"],
  slotMinutes: 60,
  capacity: 1,
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseAvailability(raw: string | null | undefined): Availability {
  if (!raw) return DEFAULT_AVAILABILITY;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const days = Array.isArray(parsed.days)
      ? parsed.days.map((day) => Math.round(Number(day))).filter((day) => day >= 0 && day <= 6)
      : DEFAULT_AVAILABILITY.days;
    const slots = Array.isArray(parsed.slots)
      ? parsed.slots.map((slot) => String(slot)).filter((slot) => TIME_PATTERN.test(slot))
      : DEFAULT_AVAILABILITY.slots;
    const slotMinutes = Math.round(Number(parsed.slotMinutes));
    const capacity = Math.round(Number(parsed.capacity));
    return {
      days: days.length ? Array.from(new Set(days)) : DEFAULT_AVAILABILITY.days,
      slots: slots.length ? slots : DEFAULT_AVAILABILITY.slots,
      slotMinutes: Number.isFinite(slotMinutes) && slotMinutes >= 15 && slotMinutes <= 240 ? slotMinutes : DEFAULT_AVAILABILITY.slotMinutes,
      capacity: Number.isFinite(capacity) && capacity >= 1 && capacity <= 20 ? capacity : 1,
    };
  } catch {
    return DEFAULT_AVAILABILITY;
  }
}

/** Next `count` days the business is open, starting today. */
export function openDays(availability: Availability, count = 14, from: Date = new Date()): string[] {
  const days: string[] = [];
  for (let offset = 0; offset < 60 && days.length < count; offset += 1) {
    const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
    if (availability.days.includes(date.getDay())) {
      days.push(date.toISOString().slice(0, 10));
    }
  }
  return days;
}

/** Slots still free on a date, given existing bookings and service duration. */
export function freeSlotsFor(params: {
  date: string;
  availability: Availability;
  durationMinutes?: number | null;
  taken?: Array<{ startAt: Date | string; endAt?: Date | string | null; status?: string }>;
  now?: Date;
}): string[] {
  const { availability } = params;
  const day = new Date(`${params.date}T00:00:00`);
  if (Number.isNaN(day.getTime())) return [];
  // A closed day has no slots at all, whatever the customer's browser sends.
  if (availability.days.length > 0 && !availability.days.includes(day.getDay())) return [];
  const now = params.now ?? new Date();
  const duration = Math.max(15, Math.round(Number(params.durationMinutes || availability.slotMinutes || 30)));
  const taken = params.taken || [];

  const takenRanges = taken
    .filter((booking) => booking.status !== "CANCELLED")
    .map((booking) => {
      const start = new Date(booking.startAt).getTime();
      const end = booking.endAt ? new Date(booking.endAt).getTime() : start + duration * 60_000;
      return { start, end };
    });

  return availability.slots.filter((slot) => {
    const [hours, minutes] = slot.split(":").map(Number);
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hours, minutes).getTime();
    const end = start + duration * 60_000;
    if (start < now.getTime()) return false;
    const overlaps = takenRanges.some((range) => start < range.end && end > range.start);
    if (!overlaps) return true;
    const activeOverlaps = takenRanges.filter((range) => start < range.end && end > range.start).length;
    return activeOverlaps < availability.capacity;
  });
}

export function bookingEndAt(startAt: Date, durationMinutes?: number | null): Date {
  const duration = Math.max(15, Math.round(Number(durationMinutes || 30)));
  return new Date(startAt.getTime() + duration * 60_000);
}

export type BookingRequest = {
  serviceId?: string;
  date?: string;
  time?: string;
  customerName?: string;
  customerPhone?: string;
  customerEmail?: string;
  notes?: string;
  staffName?: string;
};

/**
 * String discriminant rather than a boolean: this repo compiles with `strict: false`, where
 * boolean-literal narrowing of unions is unreliable.
 */
export type BookingValidation = { kind: "ok"; startAt: Date } | { kind: "error"; error: string };

/** Validate a customer booking request before anything is written (§47). */
export function validateBookingRequest(input: BookingRequest): BookingValidation {
  const name = (input.customerName || "").trim();
  const phone = (input.customerPhone || "").trim();
  if (name.length < 2) return { kind: "error", error: "Enter your name so the business knows who to expect." };
  if (phone.replace(/\D/g, "").length < 9) return { kind: "error", error: "Enter a valid phone number." };
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return { kind: "error", error: "Choose a date for your booking." };
  if (!input.time || !TIME_PATTERN.test(input.time)) return { kind: "error", error: "Choose a time for your booking." };
  const [year, month, day] = input.date.split("-").map(Number);
  const [hours, minutes] = input.time.split(":").map(Number);
  const startAt = new Date(year, month - 1, day, hours, minutes);
  if (Number.isNaN(startAt.getTime())) return { kind: "error", error: "That date and time could not be read." };
  if (startAt.getTime() < Date.now() - 60_000) return { kind: "error", error: "Choose a time in the future." };
  return { kind: "ok", startAt };
}

/** Booking is available for this business type (§12: some businesses are quote-only). */
export function bookingEnabledFor(categoryKey: CategoryKey | string | null | undefined): boolean {
  return getExperienceProfile(categoryKey).capabilities.includes("booking");
}
