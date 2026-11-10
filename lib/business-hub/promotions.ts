/**
 * Promotional Spotlight (Business Hub feature C).
 *
 * Expiry is a READ-TIME rule, not a scheduled job: a promotion is live only while
 * `isActive && startsAt <= now < endsAt`. Nothing in the system can mark a row "expired" ahead of
 * time, so an expired promotion can never be presented as active — not by the page, not by the
 * dashboard, not by a stale cache of the list endpoint (it is served `no-store`).
 *
 * Times are entered and displayed in Africa/Nairobi through the shared business-time helpers in
 * `lib/sale-pricing.ts`, the same rule the catalogue sale windows use. Storage is UTC.
 */

import prisma from "../db";
import { formatBusinessDateTime, parseBusinessDateTime, toBusinessLocalInput } from "../sale-pricing";
import {
  HUB_SUBJECTS,
  ValidationResult,
  cleanOptionalText,
  cleanText,
  recordHubActivity,
} from "./shared";

export const PROMOTION_CTA_KINDS = ["NONE", "ORDER_REQUEST", "WHATSAPP", "CALL"] as const;
export type PromotionCtaKind = (typeof PROMOTION_CTA_KINDS)[number];

export type PromotionWindowState = "SCHEDULED" | "LIVE" | "EXPIRED" | "PAUSED";

export type PromotionView = {
  id: string;
  businessId: string;
  title: string;
  subtitle: string | null;
  body: string | null;
  badge: string | null;
  discountLabel: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaKind: PromotionCtaKind;
  ctaValue: string | null;
  productIds: string[];
  startsAt: string;
  endsAt: string;
  /** Values for a `datetime-local` input, in Africa/Nairobi. */
  startsAtInput: string;
  endsAtInput: string;
  isActive: boolean;
  priority: number;
  state: PromotionWindowState;
  isLive: boolean;
  windowLabel: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * The single expiry rule.
 *
 * Start-inclusive, end-exclusive: at `endsAt` the promotion is already off. `isActive` is the
 * owner's manual switch (pause), and it can never widen the window.
 */
export function promotionStateAt(
  promotion: { startsAt: Date | string; endsAt: Date | string; isActive?: boolean | null },
  now: Date = new Date(),
): PromotionWindowState {
  const start = new Date(promotion.startsAt).getTime();
  const end = new Date(promotion.endsAt).getTime();
  const instant = now.getTime();
  if (Number.isNaN(start) || Number.isNaN(end) || start >= end) return "EXPIRED";
  if (promotion.isActive === false) return "PAUSED";
  if (instant < start) return "SCHEDULED";
  if (instant >= end) return "EXPIRED";
  return "LIVE";
}

export function isPromotionLive(promotion: { startsAt: Date | string; endsAt: Date | string; isActive?: boolean | null }, now: Date = new Date()): boolean {
  return promotionStateAt(promotion, now) === "LIVE";
}

/** "Ends in 3 days" / "Starts 6 Nov 2026, 09:00" / "Ended 2 Nov 2026, 18:00". */
export function promotionWindowLabel(
  promotion: { startsAt: Date | string; endsAt: Date | string; isActive?: boolean | null },
  now: Date = new Date(),
): string {
  const state = promotionStateAt(promotion, now);
  if (state === "PAUSED") return "Paused";
  if (state === "SCHEDULED") return `Starts ${formatBusinessDateTime(new Date(promotion.startsAt))}`;
  if (state === "EXPIRED") return `Ended ${formatBusinessDateTime(new Date(promotion.endsAt))}`;
  const remaining = new Date(promotion.endsAt).getTime() - now.getTime();
  const hours = Math.floor(remaining / 3_600_000);
  if (hours < 1) return `Ends in ${Math.max(1, Math.round(remaining / 60_000))} min`;
  if (hours < 48) return `Ends in ${hours}h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Ends tomorrow" : `Ends in ${days} days`;
}

function parseIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().slice(0, 64))
      .filter(Boolean)
      .slice(0, 24);
  }
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parseIds(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

export function toPromotionView(row: any, now: Date = new Date()): PromotionView {
  const state = promotionStateAt(row, now);
  return {
    id: row.id,
    businessId: row.businessId,
    title: row.title,
    subtitle: row.subtitle ?? null,
    body: row.body ?? null,
    badge: row.badge ?? null,
    discountLabel: row.discountLabel ?? null,
    imageUrl: row.imageUrl ?? null,
    ctaLabel: row.ctaLabel ?? null,
    ctaKind: (PROMOTION_CTA_KINDS as readonly string[]).includes(row.ctaKind) ? row.ctaKind : "NONE",
    ctaValue: row.ctaValue ?? null,
    productIds: parseIds(row.productIds),
    startsAt: new Date(row.startsAt).toISOString(),
    endsAt: new Date(row.endsAt).toISOString(),
    startsAtInput: toBusinessLocalInput(new Date(row.startsAt)),
    endsAtInput: toBusinessLocalInput(new Date(row.endsAt)),
    isActive: row.isActive !== false,
    priority: Number(row.priority ?? 0),
    state,
    isLive: state === "LIVE",
    windowLabel: promotionWindowLabel(row, now),
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
  };
}

export type PromotionWriteInput = {
  title?: unknown;
  subtitle?: unknown;
  body?: unknown;
  badge?: unknown;
  discountLabel?: unknown;
  imageUrl?: unknown;
  ctaLabel?: unknown;
  ctaKind?: unknown;
  ctaValue?: unknown;
  productIds?: unknown;
  startsAt?: unknown;
  endsAt?: unknown;
  isActive?: unknown;
  priority?: unknown;
};

export type ValidatedPromotion = {
  title: string;
  subtitle: string | null;
  body: string | null;
  badge: string | null;
  discountLabel: string | null;
  imageUrl: string | null;
  ctaLabel: string | null;
  ctaKind: PromotionCtaKind;
  ctaValue: string | null;
  productIds: string[];
  startsAt: Date;
  endsAt: Date;
  isActive: boolean;
  priority: number;
};

export function validatePromotionInput(raw: unknown): ValidationResult<ValidatedPromotion> {
  const body = (raw && typeof raw === "object" ? raw : {}) as PromotionWriteInput;
  const title = cleanText(body.title, 90);
  if (title.length < 3) return { ok: false, error: "Give the promotion a short title." };

  const startsAt = parseBusinessDateTime(body.startsAt);
  const endsAt = parseBusinessDateTime(body.endsAt);
  if (!startsAt) return { ok: false, error: "Choose the date and time the promotion starts (Nairobi time)." };
  if (!endsAt) return { ok: false, error: "Choose the date and time the promotion ends (Nairobi time)." };
  if (endsAt.getTime() <= startsAt.getTime()) return { ok: false, error: "The promotion must end after it starts." };
  if (endsAt.getTime() - startsAt.getTime() > 366 * 24 * 60 * 60 * 1000) {
    return { ok: false, error: "A promotion can run for at most one year. Shorten the window." };
  }

  const ctaKind = typeof body.ctaKind === "string" ? body.ctaKind.trim().toUpperCase() : "NONE";
  const ctaLabel = cleanOptionalText(body.ctaLabel, 40);
  const ctaValue = cleanOptionalText(body.ctaValue, 120);
  if (ctaKind === "WHATSAPP" || ctaKind === "CALL") {
    const digits = (ctaValue ?? "").replace(/\D/g, "");
    if (digits.length < 9) return { ok: false, error: "Add the phone number the promotion button should use." };
  }

  return {
    ok: true,
    value: {
      title,
      subtitle: cleanOptionalText(body.subtitle, 120),
      body: cleanOptionalText(body.body, 600),
      badge: cleanOptionalText(body.badge, 24),
      discountLabel: cleanOptionalText(body.discountLabel, 40),
      imageUrl: cleanOptionalText(body.imageUrl, 600),
      ctaLabel,
      ctaKind: (PROMOTION_CTA_KINDS as readonly string[]).includes(ctaKind) ? (ctaKind as PromotionCtaKind) : "NONE",
      ctaValue,
      productIds: parseIds(body.productIds),
      startsAt,
      endsAt,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      priority: Math.max(0, Math.min(100, Math.round(Number(body.priority ?? 0) || 0))),
    },
  };
}

/** Owner list: everything, newest first, with the computed state so the board can sort by it. */
export async function listPromotions(businessId: string, now: Date = new Date()): Promise<PromotionView[]> {
  const rows = await prisma.promotion.findMany({ where: { businessId }, orderBy: [{ priority: "desc" }, { createdAt: "desc" }], take: 200 }).catch(() => []);
  return rows.map((row: any) => toPromotionView(row, now));
}

/**
 * Public list: live promotions only.
 *
 * The filter runs after the read so the rule lives in exactly one place (`promotionStateAt`).
 * A row whose window ended between the query and the render is still filtered out here.
 */
export async function listLivePromotions(businessId: string, now: Date = new Date()): Promise<PromotionView[]> {
  const all = await listPromotions(businessId, now);
  return all
    .filter((promotion) => promotion.isLive)
    .sort((a, b) => b.priority - a.priority || new Date(b.startsAt).getTime() - new Date(a.startsAt).getTime());
}

export async function createPromotion(params: {
  businessId: string;
  input: ValidatedPromotion;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<any> {
  const record = await prisma.promotion.create({
    data: {
      businessId: params.businessId,
      title: params.input.title,
      subtitle: params.input.subtitle,
      body: params.input.body,
      badge: params.input.badge,
      discountLabel: params.input.discountLabel,
      imageUrl: params.input.imageUrl,
      ctaLabel: params.input.ctaLabel,
      ctaKind: params.input.ctaKind,
      ctaValue: params.input.ctaValue,
      productIds: JSON.stringify(params.input.productIds),
      startsAt: params.input.startsAt,
      endsAt: params.input.endsAt,
      isActive: params.input.isActive,
      priority: params.input.priority,
    },
  });
  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.PROMOTION,
    subjectId: record.id,
    kind: "PROMOTION_CREATED",
    summary: `Promotion "${params.input.title}" created (ends ${formatBusinessDateTime(params.input.endsAt)})`,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });
  return record;
}

export async function getPromotion(businessId: string, id: string): Promise<any | null> {
  if (!businessId || !id) return null;
  return prisma.promotion.findFirst({ where: { id, businessId } }).catch(() => null);
}

export async function updatePromotion(params: {
  businessId: string;
  id: string;
  patch: Partial<ValidatedPromotion>;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<any | null> {
  const existing = await getPromotion(params.businessId, params.id);
  if (!existing) return null;
  const updated = await prisma.promotion.update({ where: { id: existing.id }, data: params.patch as any });
  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.PROMOTION,
    subjectId: existing.id,
    kind: "PROMOTION_UPDATED",
    summary: `Promotion "${updated.title}" updated`,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });
  return updated;
}

export async function deletePromotion(params: {
  businessId: string;
  id: string;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<boolean> {
  const existing = await getPromotion(params.businessId, params.id);
  if (!existing) return false;
  await prisma.promotion.delete({ where: { id: existing.id } });
  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.PROMOTION,
    subjectId: existing.id,
    kind: "PROMOTION_DELETED",
    summary: `Promotion "${existing.title}" deleted`,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });
  return true;
}
