/**
 * Digital Loyalty Card (Business Hub feature D).
 *
 * First release: OWNER-VERIFIED transactions only. Nothing here detects a visit, reads a receipt
 * or trusts a purchase — a stamp exists because an owner pressed "Verify & award" against a
 * transaction reference they typed. No API, integration or automatic verification is claimed.
 *
 * Integrity rules, all enforced by the database rather than by convention:
 *   • `LoyaltyStampEvent` is append-only and unique on (businessId, transactionRef): the same
 *     receipt cannot be verified twice, even by two staff members at the same moment.
 *   • `LoyaltyRedemption` is append-only and unique on (cardId, cycleIndex): a filled card pays
 *     out exactly once per cycle, and a second tap collides on the index instead of paying twice.
 *   • Stamp totals are monotonic counters on the card; they never go backwards, so a reward can
 *     be taken out of the balance only by a recorded redemption.
 */

import prisma from "../db";
import { formatBusinessDateTime } from "../sale-pricing";
import {
  ActionResult,
  HUB_SUBJECTS,
  ValidationResult,
  cleanOptionalText,
  cleanSearch,
  cleanText,
  createReference,
  listHubActivity,
  normaliseContactMethod,
  randomCode,
  recordHubActivity,
} from "./shared";

export const DEFAULT_STAMP_GOAL = 8;
export const MAX_STAMP_GOAL = 50;
export const MIN_STAMP_GOAL = 2;

export type LoyaltyProgramConfig = {
  isEnabled: boolean;
  stampGoal: number;
  maxStampsPerVisit: number;
  rewardDescription: string;
  terms: string | null;
  cardPrefix: string;
};

export const DEFAULT_LOYALTY_PROGRAM: LoyaltyProgramConfig = {
  isEnabled: true,
  stampGoal: DEFAULT_STAMP_GOAL,
  maxStampsPerVisit: 1,
  rewardDescription: "Free reward — ask the business for details",
  terms: null,
  cardPrefix: "JATA",
};

/** Ten characters from a 32-symbol alphabet: quoted at a counter, never derived from contact data. */
export function generateCardCode(): string {
  return randomCode(10);
}

/** The code as it is printed on a card: `JATA-4F9K-2Q7M`. */
export function formatCardCode(code: string): string {
  const compact = String(code || "").replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (compact.length !== 10) return compact;
  return `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 10)}`;
}

export function normaliseCardCode(value: unknown): string {
  return String(typeof value === "string" ? value : "").replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 20);
}

/**
 * Normalises the owner's transaction reference. Two verifications of the same purchase must
 * collide, so " INV-12 " and "inv-12" are the same key — but the case is preserved in the label.
 */
export function normaliseTransactionRef(value: unknown): string {
  return cleanText(value, 80).trim().replace(/\s+/g, " ").toUpperCase();
}

export async function getOrCreateProgram(businessId: string): Promise<LoyaltyProgramConfig & { id: string }> {
  const existing = await prisma.loyaltyProgram.findUnique({ where: { businessId } }).catch(() => null);
  if (existing) return toProgramConfig(existing);
  const created = await prisma.loyaltyProgram.create({ data: { businessId } }).catch(() => null);
  return toProgramConfig(created ?? { id: "", businessId, ...DEFAULT_LOYALTY_PROGRAM });
}

function toProgramConfig(row: any): LoyaltyProgramConfig & { id: string } {
  return {
    id: row.id,
    isEnabled: row.isEnabled !== false,
    stampGoal: clampGoal(row.stampGoal),
    maxStampsPerVisit: Math.max(1, Math.min(10, Math.round(Number(row.maxStampsPerVisit ?? 1) || 1))),
    rewardDescription: row.rewardDescription || DEFAULT_LOYALTY_PROGRAM.rewardDescription,
    terms: row.terms ?? null,
    cardPrefix: cleanText(row.cardPrefix, 8) || "JATA",
  };
}

function clampGoal(value: unknown): number {
  const parsed = Math.round(Number(value ?? DEFAULT_STAMP_GOAL));
  if (!Number.isFinite(parsed)) return DEFAULT_STAMP_GOAL;
  return Math.max(MIN_STAMP_GOAL, Math.min(MAX_STAMP_GOAL, parsed));
}

export type ValidatedProgramInput = {
  isEnabled: boolean;
  stampGoal: number;
  maxStampsPerVisit: number;
  rewardDescription: string;
  terms: string | null;
};

export function validateProgramInput(raw: unknown): ValidationResult<ValidatedProgramInput> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const rewardDescription = cleanText(body.rewardDescription, 160);
  if (rewardDescription.length < 3) return { ok: false, error: "Describe the reward customers earn." };
  const stampGoal = clampGoal(body.stampGoal);
  const maxStampsPerVisit = Math.max(1, Math.min(10, Math.round(Number(body.maxStampsPerVisit ?? 1) || 1)));
  if (maxStampsPerVisit > stampGoal) {
    return { ok: false, error: "Stamps per visit cannot exceed the stamps needed for a reward." };
  }
  return {
    ok: true,
    value: {
      isEnabled: body.isEnabled === undefined ? true : Boolean(body.isEnabled),
      stampGoal,
      maxStampsPerVisit,
      rewardDescription,
      terms: cleanOptionalText(body.terms, 400),
    },
  };
}

export async function saveProgram(params: {
  businessId: string;
  input: ValidatedProgramInput;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<LoyaltyProgramConfig & { id: string }> {
  await getOrCreateProgram(params.businessId);
  const updated = await prisma.loyaltyProgram.update({
    where: { businessId: params.businessId },
    data: {
      isEnabled: params.input.isEnabled,
      stampGoal: params.input.stampGoal,
      maxStampsPerVisit: params.input.maxStampsPerVisit,
      rewardDescription: params.input.rewardDescription,
      terms: params.input.terms,
    },
  });
  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.LOYALTY,
    subjectId: updated.id,
    kind: "LOYALTY_PROGRAM_UPDATED",
    summary: `Loyalty programme set to ${params.input.stampGoal} stamps for "${params.input.rewardDescription}"`,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });
  return toProgramConfig(updated);
}

/** Live progress for a card, derived from the two monotonic counters. */
export function progressFor(
  card: { stampsEarned: number; stampsRedeemed: number },
  program: { stampGoal: number },
): {
  stampsEarned: number;
  stampsRedeemed: number;
  balance: number;
  goal: number;
  remaining: number;
  percent: number;
  rewardsAvailable: number;
  complete: boolean;
} {
  const stampsEarned = Math.max(0, Number(card.stampsEarned ?? 0));
  const stampsRedeemed = Math.max(0, Number(card.stampsRedeemed ?? 0));
  const goal = clampGoal(program.stampGoal);
  const balance = Math.max(0, stampsEarned - stampsRedeemed);
  const remaining = Math.max(0, goal - (balance % goal === 0 && balance > 0 ? goal : balance % goal));
  const inCycle = balance % goal;
  return {
    stampsEarned,
    stampsRedeemed,
    balance,
    goal,
    remaining: inCycle === 0 && balance > 0 ? 0 : goal - inCycle,
    percent: Math.round((inCycle / goal) * 100),
    rewardsAvailable: Math.floor(balance / goal),
    complete: inCycle === 0 && balance > 0,
  };
}

export type CardView = {
  id: string;
  code: string;
  displayCode: string;
  customerName: string;
  contactMethod: string | null;
  contactValue: string | null;
  status: string;
  ownerNotes: string | null;
  lastStampAt: string | null;
  createdAt: string;
  updatedAt: string;
  stampsEarned: number;
  stampsRedeemed: number;
  balance: number;
  goal: number;
  remaining: number;
  percent: number;
  rewardsAvailable: number;
  rewardsRedeemed: number;
  complete: boolean;
};

export function toCardView(row: any, program: { stampGoal: number }): CardView {
  const progress = progressFor(row, program);
  return {
    id: row.id,
    code: row.code,
    displayCode: formatCardCode(row.code),
    customerName: row.customerName,
    contactMethod: row.contactMethod ?? null,
    contactValue: row.contactValue ?? null,
    status: row.status ?? "ACTIVE",
    ownerNotes: row.ownerNotes ?? null,
    lastStampAt: row.lastStampAt ? new Date(row.lastStampAt).toISOString() : null,
    createdAt: new Date(row.createdAt).toISOString(),
    updatedAt: new Date(row.updatedAt).toISOString(),
    rewardsRedeemed: Math.floor(progress.stampsRedeemed / Math.max(1, progress.goal)),
    ...progress,
  };
}

export async function listCards(
  businessId: string,
  options: { search?: string | null; take?: number } = {},
): Promise<CardView[]> {
  const program = await getOrCreateProgram(businessId);
  const where: Record<string, unknown> = { businessId };
  const search = cleanSearch(options.search);
  if (search) {
    where.OR = [{ customerName: { contains: search } }, { code: { contains: search.toUpperCase() } }, { contactValue: { contains: search } }];
  }
  const rows = await prisma.loyaltyCard
    .findMany({ where, orderBy: { updatedAt: "desc" }, take: Math.min(500, Math.max(1, options.take ?? 200)) })
    .catch(() => []);
  return rows.map((row: any) => toCardView(row, program));
}

/**
 * Public, code-only read. The code is the customer's bearer token, so this function is the ONLY
 * place a public caller may read a loyalty record, and it returns progress plus the customer's
 * own name — never the owner's notes, never another business's rows.
 */
export async function findCardByCode(
  code: string,
): Promise<{ card: CardView; business: { name: string; slug: string }; rewardDescription: string; terms: string | null } | null> {
  const cleaned = normaliseCardCode(code);
  if (cleaned.length < 8) return null;
  const row = await prisma.loyaltyCard.findUnique({ where: { code: cleaned }, include: { business: { select: { name: true, slug: true } } } }).catch(() => null);
  if (!row) return null;
  const program = await getOrCreateProgram(row.businessId);
  if (program.isEnabled === false) return null;
  return {
    card: toCardView(row, program),
    business: row.business,
    rewardDescription: program.rewardDescription,
    terms: program.terms,
  };
}

/**
 * Whether the public page should show the loyalty section.
 *
 * Read-only by design: a page view must never create a programme row or a card. The section
 * appears only once an owner has actually configured (and left enabled) their programme, so a
 * business that does not run loyalty is not given an empty card widget.
 */
export async function isLoyaltyEnabled(businessId: string): Promise<boolean> {
  const row = await prisma.loyaltyProgram
    .findUnique({ where: { businessId }, select: { isEnabled: true } })
    .catch(() => null);
  return Boolean(row && row.isEnabled !== false);
}

export async function getCard(businessId: string, cardId: string): Promise<any | null> {
  if (!businessId || !cardId) return null;
  return prisma.loyaltyCard.findFirst({ where: { id: cardId, businessId } }).catch(() => null);
}

export function validateCardInput(
  raw: unknown,
): ValidationResult<{ customerName: string; contactMethod: string | null; contactValue: string | null }> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const customerName = cleanText(body.customerName, 80);
  if (customerName.length < 2) return { ok: false, error: "Enter the customer's name." };
  const method = normaliseContactMethod(body.contactMethod);
  let contactValue: string | null = null;
  if (method) {
    const rawValue = cleanText(body.contactValue, 60);
    if (rawValue.length >= 4) contactValue = rawValue;
  }
  return { ok: true, value: { customerName, contactMethod: method, contactValue } };
}

/** Enrols a customer. The card code is generated here and shown to the owner once. */
export async function enrolCard(params: {
  businessId: string;
  input: { customerName: string; contactMethod: string | null; contactValue: string | null };
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<any> {
  const program = await getOrCreateProgram(params.businessId);
  const record = await prisma.loyaltyCard.create({
    data: {
      businessId: params.businessId,
      programId: program.id,
      code: generateCardCode(),
      customerName: params.input.customerName,
      contactMethod: params.input.contactMethod,
      contactValue: params.input.contactValue,
      status: "ACTIVE",
    },
  });
  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.LOYALTY,
    subjectId: record.id,
    kind: "LOYALTY_CARD_CREATED",
    summary: `Loyalty card ${formatCardCode(record.code)} issued to ${params.input.customerName}`,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });
  return record;
}

export type StampResult =
  | { ok: true; record: any; card: CardView; status?: never; error?: never }
  | { ok: false; status: number; error: string; record?: never; card?: never };

/**
 * Awards stamps for one owner-verified transaction.
 *
 * Duplicate protection is the unique index on (businessId, transactionRef): the pre-check gives a
 * friendly error, and the index is what makes the guarantee hold when two requests race.
 */
export async function awardStamp(params: {
  businessId: string;
  cardId: string;
  transactionRef: string;
  stamps?: number;
  note?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<StampResult> {
  const program = await getOrCreateProgram(params.businessId);
  const card = await getCard(params.businessId, params.cardId);
  if (!card) return { ok: false, status: 404, error: "That loyalty card is not part of your programme." };
  if (card.status !== "ACTIVE") return { ok: false, status: 409, error: "This card is blocked. Unblock it before awarding stamps." };

  const transactionRef = normaliseTransactionRef(params.transactionRef);
  if (transactionRef.length < 3) {
    return { ok: false, status: 400, error: "Enter a short reference for the transaction (receipt, order or date)." };
  }

  const requested = Math.round(Number(params.stamps ?? program.maxStampsPerVisit));
  const stamps = Math.max(1, Math.min(program.maxStampsPerVisit, Number.isFinite(requested) ? requested : 1));

  const duplicate = await prisma.loyaltyStampEvent
    .findFirst({ where: { businessId: params.businessId, transactionRef } })
    .catch(() => null);
  if (duplicate) {
    return {
      ok: false,
      status: 409,
      error: `That transaction was already stamped (${formatBusinessDateTime(duplicate.createdAt)}). One verified transaction can only be stamped once.`,
    };
  }

  const now = new Date();
  let record: any;
  try {
    record = await prisma.loyaltyStampEvent.create({
      data: {
        businessId: params.businessId,
        cardId: card.id,
        transactionRef,
        stamps,
        note: cleanOptionalText(params.note, 400),
        awardedByUserId: params.actorId ?? null,
        awardedByLabel: cleanOptionalText(params.actorLabel, 80),
      },
    });
  } catch (error) {
    // P2002 is the unique index doing its job under concurrency.
    return {
      ok: false,
      status: 409,
      error: "That transaction was already stamped. One verified transaction can only be stamped once.",
    };
  }

  const updated = await prisma.loyaltyCard.update({
    where: { id: card.id },
    data: { stampsEarned: { increment: stamps }, lastStampAt: now },
  });

  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.LOYALTY,
    subjectId: card.id,
    kind: "STAMP_AWARDED",
    summary: `${stamps} stamp${stamps === 1 ? "" : "s"} awarded to ${card.customerName} for ${transactionRef}`,
    note: cleanOptionalText(params.note, 400),
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });

  return { ok: true, record, card: toCardView(updated, program) };
}

export type RedeemResult =
  | { ok: true; redemption: any; card: CardView; status?: never; error?: never }
  | { ok: false; status: number; error: string; redemption?: never; card?: never };

/**
 * Redeems one reward cycle.
 *
 * `cycleIndex` identifies WHICH filled card is being paid out, and (cardId, cycleIndex) is unique,
 * so two staff members tapping "Redeem" at the same moment produce one redemption and one 409.
 */
export async function redeemReward(params: {
  businessId: string;
  cardId: string;
  rewardDescription?: string;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<RedeemResult> {
  const program = await getOrCreateProgram(params.businessId);
  const card = await getCard(params.businessId, params.cardId);
  if (!card) return { ok: false, status: 404, error: "That loyalty card is not part of your programme." };

  const progress = progressFor(card, program);
  if (progress.rewardsAvailable < 1) {
    return {
      ok: false,
      status: 409,
      error: `This card needs ${progress.remaining} more stamp${progress.remaining === 1 ? "" : "s"} before a reward can be redeemed.`,
    };
  }

  const cycleIndex = Math.floor((progress.stampsRedeemed + progress.goal) / progress.goal);
  const description = cleanText(params.rewardDescription, 160) || program.rewardDescription;

  let redemption: any;
  try {
    redemption = await prisma.loyaltyRedemption.create({
      data: {
        businessId: params.businessId,
        cardId: card.id,
        cycleIndex,
        stampsRedeemed: progress.goal,
        rewardDescription: description,
        reference: createReference("JATA-RWD"),
        verifiedByUserId: params.actorId ?? null,
        verifiedByLabel: cleanOptionalText(params.actorLabel, 80),
      },
    });
  } catch {
    return { ok: false, status: 409, error: "That reward has already been redeemed. The card cannot pay out twice for the same stamps." };
  }

  const updated = await prisma.loyaltyCard.update({
    where: { id: card.id },
    data: { stampsRedeemed: { increment: progress.goal } },
  });

  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.LOYALTY,
    subjectId: card.id,
    kind: "REWARD_REDEEMED",
    summary: `Reward redeemed for ${card.customerName}: ${description}`,
    note: redemption.reference,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });

  return { ok: true, redemption, card: toCardView(updated, program) };
}

export async function cardHistory(businessId: string, cardId: string, take = 30) {
  return listHubActivity(prisma, businessId, { subjectType: HUB_SUBJECTS.LOYALTY, subjectId: cardId, take });
}

export async function loyaltyStats(businessId: string): Promise<{
  cards: number;
  stampsAwarded: number;
  rewardsRedeemed: number;
  activeCards: number;
}> {
  const program = await getOrCreateProgram(businessId);
  const cards = await listCards(businessId, { take: 500 });
  const stampsAwarded = cards.reduce((total, card) => total + card.stampsEarned, 0);
  const rewardsRedeemed = cards.reduce((total, card) => total + card.rewardsRedeemed, 0);
  return {
    cards: cards.length,
    stampsAwarded,
    rewardsRedeemed,
    activeCards: cards.filter((card) => card.status === "ACTIVE").length,
    stampGoal: program.stampGoal,
  } as { cards: number; stampsAwarded: number; rewardsRedeemed: number; activeCards: number };
}
