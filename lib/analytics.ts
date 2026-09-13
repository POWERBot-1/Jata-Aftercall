import prisma from "./db";
import crypto from "crypto";

export const EVENT_TYPES = [
  "PAGE_VIEW",
  "WHATSAPP_CLICK",
  "CALL_CLICK",
  "DIRECTION_CLICK",
  "SHARE_CLICK",
  "SERVICE_CLICK",
] as const;

export type EventType = typeof EVENT_TYPES[number];

export function hashIp(ip: string | null | undefined): string | null {
  if (!ip) return null;
  return crypto.createHash("sha256").update(ip).digest("hex").slice(0, 16);
}

export async function recordEvent(params: {
  businessId: string;
  eventType: EventType;
  ip?: string | null;
  userAgent?: string | null;
  source?: string | null;
}) {
  await prisma.analyticsEvent.create({
    data: {
      businessId: params.businessId,
      eventType: params.eventType,
      ipHash: hashIp(params.ip),
      userAgent: params.userAgent?.slice(0, 300) || null,
      source: params.source?.slice(0, 300) || null,
    },
  });
}

export async function getBusinessMetrics(businessId: string) {
  const groups = await prisma.analyticsEvent.groupBy({
    by: ["eventType"],
    where: { businessId },
    _count: { eventType: true },
  });
  const map: Record<string, number> = {};
  for (const g of groups) map[g.eventType] = g._count.eventType;
  return {
    views: map["PAGE_VIEW"] || 0,
    whatsapp: map["WHATSAPP_CLICK"] || 0,
    calls: map["CALL_CLICK"] || 0,
    directions: map["DIRECTION_CLICK"] || 0,
    shares: map["SHARE_CLICK"] || 0,
    serviceClicks: map["SERVICE_CLICK"] || 0,
    total: Object.values(map).reduce((a, b) => a + b, 0),
  };
}
