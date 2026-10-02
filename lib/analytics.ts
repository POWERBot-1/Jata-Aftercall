import prisma from "./db";
import crypto from "crypto";

/**
 * Analytics event model (§31, §32, §57)
 *
 * One extensible event table serves every category — analytics are never hard-coded per
 * business type. Only the minimum needed to measure a business is stored: no names, no
 * phone numbers, no emails. IPs are hashed and sessions are salted hashes (§57).
 */
export const EVENT_TYPES = [
  // Existing JATA AFTERCALL events
  "PAGE_VIEW",
  "WHATSAPP_CLICK",
  "CALL_CLICK",
  "DIRECTIONS_CLICK",
  "SHARE_CLICK",
  "SERVICE_CLICK",
  // Interactive Business funnel (§32)
  "PRODUCT_VIEW",
  "SERVICE_VIEW",
  "SEARCH",
  "ADD_TO_CART",
  "REMOVE_FROM_CART",
  "CHECKOUT_STARTED",
  "PAYMENT_STARTED",
  "PAYMENT_SUCCESS",
  "ORDER_CREATED",
  "BOOKING_CREATED",
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

export function isEventType(value: unknown): value is EventType {
  return typeof value === "string" && (EVENT_TYPES as readonly string[]).includes(value);
}

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(`ip:${ip}`).digest("hex").slice(0, 16);
}

/**
 * Salted session key. Lets a conversion funnel be counted (visitor → checkout → paid)
 * without storing any personal data (§57).
 */
export function hashSession(parts: { ip?: string | null; userAgent?: string | null; salt?: string }): string | null {
  const value = [parts.ip || "", parts.userAgent || ""].join("|");
  if (value.replace(/\|/g, "").trim().length === 0) return null;
  const salt = parts.salt || process.env.AUTH_SECRET || "jata-analytics";
  return crypto.createHash("sha256").update(`${salt}:${value}`).digest("hex").slice(0, 20);
}

export async function recordEvent(params: {
  businessId: string;
  eventType: EventType | string;
  ip?: string | null;
  userAgent?: string | null;
  source?: string | null;
  subjectId?: string | null;
  sessionHash?: string | null;
}) {
  await prisma.analyticsEvent.create({
    data: {
      businessId: params.businessId,
      eventType: String(params.eventType).slice(0, 40),
      ipHash: hashIp(params.ip),
      userAgent: params.userAgent?.slice(0, 300) || null,
      source: params.source?.slice(0, 300) || null,
      subjectId: params.subjectId?.slice(0, 64) || null,
      sessionHash: params.sessionHash?.slice(0, 40) || null,
    },
  });
}

export type BusinessMetrics = {
  views: number;
  whatsapp: number;
  calls: number;
  directions: number;
  shares: number;
  serviceClicks: number;
  productViews: number;
  serviceViews: number;
  searches: number;
  addToCart: number;
  checkoutStarted: number;
  paymentStarted: number;
  paymentSuccess: number;
  orders: number;
  bookings: number;
  total: number;
};

export const EMPTY_METRICS: BusinessMetrics = {
  views: 0, whatsapp: 0, calls: 0, directions: 0, shares: 0, serviceClicks: 0,
  productViews: 0, serviceViews: 0, searches: 0, addToCart: 0, checkoutStarted: 0,
  paymentStarted: 0, paymentSuccess: 0, orders: 0, bookings: 0, total: 0,
};

export async function getBusinessMetrics(businessId: string): Promise<BusinessMetrics> {
  const groups = await prisma.analyticsEvent.groupBy({
    by: ["eventType"],
    where: { businessId },
    _count: { eventType: true },
  });
  const map: Record<string, number> = {};
  for (const g of groups) map[g.eventType] = g._count.eventType;
  const metrics: BusinessMetrics = {
    views: map["PAGE_VIEW"] || 0,
    whatsapp: map["WHATSAPP_CLICK"] || 0,
    calls: map["CALL_CLICK"] || 0,
    directions: map["DIRECTIONS_CLICK"] || 0,
    shares: map["SHARE_CLICK"] || 0,
    serviceClicks: map["SERVICE_CLICK"] || 0,
    productViews: map["PRODUCT_VIEW"] || 0,
    serviceViews: map["SERVICE_VIEW"] || 0,
    searches: map["SEARCH"] || 0,
    addToCart: map["ADD_TO_CART"] || 0,
    checkoutStarted: map["CHECKOUT_STARTED"] || 0,
    paymentStarted: map["PAYMENT_STARTED"] || 0,
    paymentSuccess: map["PAYMENT_SUCCESS"] || 0,
    orders: map["ORDER_CREATED"] || 0,
    bookings: map["BOOKING_CREATED"] || 0,
    total: 0,
  };
  metrics.total = Object.values(map).reduce((a, b) => a + b, 0);
  return metrics;
}

/** Events in a window, grouped by type — used by the owner dashboard (§31). */
export async function getBusinessMetricsSince(businessId: string, since: Date): Promise<BusinessMetrics> {
  const groups = await prisma.analyticsEvent.groupBy({
    by: ["eventType"],
    where: { businessId, createdAt: { gte: since } },
    _count: { eventType: true },
  });
  const map: Record<string, number> = {};
  for (const g of groups) map[g.eventType] = g._count.eventType;
  return {
    ...EMPTY_METRICS,
    views: map["PAGE_VIEW"] || 0,
    whatsapp: map["WHATSAPP_CLICK"] || 0,
    calls: map["CALL_CLICK"] || 0,
    directions: map["DIRECTIONS_CLICK"] || 0,
    shares: map["SHARE_CLICK"] || 0,
    serviceClicks: map["SERVICE_CLICK"] || 0,
    productViews: map["PRODUCT_VIEW"] || 0,
    serviceViews: map["SERVICE_VIEW"] || 0,
    searches: map["SEARCH"] || 0,
    addToCart: map["ADD_TO_CART"] || 0,
    checkoutStarted: map["CHECKOUT_STARTED"] || 0,
    paymentStarted: map["PAYMENT_STARTED"] || 0,
    paymentSuccess: map["PAYMENT_SUCCESS"] || 0,
    orders: map["ORDER_CREATED"] || 0,
    bookings: map["BOOKING_CREATED"] || 0,
    total: Object.values(map).reduce((a, b) => a + b, 0),
  };
}

/** Most-viewed subjects (products/services) for the performance panel (§31). */
export async function getTopSubjects(businessId: string, eventType: EventType = "PRODUCT_VIEW", limit = 5) {
  const groups = await prisma.analyticsEvent.groupBy({
    by: ["subjectId"],
    where: { businessId, eventType, subjectId: { not: null } },
    _count: { subjectId: true },
    orderBy: { _count: { subjectId: "desc" } },
    take: limit,
  });
  return groups
    .filter((group) => Boolean(group.subjectId))
    .map((group) => ({ subjectId: group.subjectId as string, count: group._count.subjectId }));
}

/** Conversion rate: sessions that started checkout vs sessions that paid (§31). */
export function conversionRate(checkoutStarted: number, orders: number): number {
  if (!checkoutStarted) return 0;
  return Math.min(100, Math.round((orders / checkoutStarted) * 1000) / 10);
}
