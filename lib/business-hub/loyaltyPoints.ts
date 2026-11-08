/**
 * Loyalty 2.0 — configurable points and rewards (Business Hub feature D, second mechanism).
 *
 * This module is a SECOND loyalty mechanism that lives beside the stamp card in
 * `lib/business-hub/loyalty.ts`. It never reads or writes `LoyaltyCard.stampsEarned` or
 * `stampsRedeemed`, and the stamp module never touches a points row: the two balances are
 * separate records and are never combined, added together or converted into each other.
 *
 * WHAT POINTS ARE NOT
 * -------------------
 *   • Points are not money. Nothing here initiates a payment, a refund or any financial transfer,
 *     and no screen may describe points as cash or as withdrawable value. Billing, plans,
 *     subscriptions and payment verification are outside this module's boundary entirely.
 *   • An order request is NOT a purchase. `app/api/public/order-request` takes no payment, so no
 *     code path in this module is reachable from it — points exist only for a verified purchase.
 *   • No earning rate, redemption rate, expiry period or reward value is invented anywhere. A new
 *     programme starts switched off with its rate unset, and activation is refused until the
 *     owner sets one.
 *
 * HOW A PURCHASE IS VERIFIED
 * --------------------------
 * `source: OWNER_VERIFIED` — a person with permission on the business records the purchase and
 * its reference in the hub. That is a human attestation, explicitly labelled as such in the UI and
 * in the ledger.
 * `source: PAYMENT_PROVIDER` — reserved for authoritative payment verification. It is not
 * implemented in this release; no caller may pass it, and `awardPoints` refuses it, so an
 * unverified payment webhook cannot be mistaken for proof.
 *
 * INTEGRITY
 * ---------
 *   • The ledger is append-only. A correction is a new compensating row that points at the row it
 *     corrects (`reversalOfId`); historical rows are never edited except to consume a lot.
 *   • Idempotency is a unique index on (businessId, idempotencyKey). A replayed request, a double
 *     tap or a retried webhook returns the original entry instead of awarding twice.
 *   • Spending is a compare-and-set: `UPDATE … WHERE availablePoints >= cost`. Two concurrent
 *     redemptions serialise on the row, and the loser matches zero rows and is refused. The
 *     balance can never be spent twice.
 *   • Expiry is idempotent per earning lot, and does nothing at all when the programme has expiry
 *     disabled.
 */

import prisma from "../db";
import { formatKes, formatNumber } from "../dateFormat";
import {
  HUB_SUBJECTS,
  ValidationResult,
  cleanOptionalText,
  cleanSearch,
  cleanText,
  createReference,
  listHubActivity,
  randomCode,
  recordHubActivity,
} from "./shared";

/** Ledger movements, as stored. `ADJUSTMENT_DIRECTION` is not a type: an adjustment is recorded as
 * MANUAL_ADJUSTMENT with a CREDIT or DEBIT direction. */
export const POINTS_TRANSACTION_TYPES = ["EARNED", "REDEEMED", "EXPIRED", "REVERSED", "MANUAL_ADJUSTMENT"] as const;
export const POINTS_SOURCES = [
  "OWNER_VERIFIED",
  "PAYMENT_PROVIDER",
  "CUSTOMER_REDEMPTION",
  "SYSTEM_EXPIRY",
  "OWNER_ADJUSTMENT",
  "REVERSAL",
] as const;
export const REWARD_KINDS = ["FIXED_POINTS", "DISCOUNT", "PRODUCT", "SERVICE"] as const;
export const REDEMPTION_STATUSES = ["PENDING", "FULFILLED", "CANCELLED"] as const;

/** Guard rails for the configuration form. They bound the input; they never supply a default rate. */
export const MIN_KES_PER_POINT = 1;
export const MAX_KES_PER_POINT = 100000;
export const MIN_POINTS_PER_UNIT = 1;
export const MAX_POINTS_PER_UNIT = 1000;
export const MAX_POINTS_PER_TRANSACTION = 100000;
export const MAX_EXPIRY_MONTHS = 120;
export const MIN_REDEEM_POINTS = 0;
export const MAX_REDEEM_POINTS = 1000000;
export const MAX_REWARD_COST = 1000000;
export const MIN_ADJUSTMENT_REASON = 5;

export type PointsProgrammeConfig = {
  id: string;
  isActive: boolean;
  kesPerPoint: number | null;
  pointsPerUnit: number | null;
  minPurchaseKES: number;
  maxPointsPerTransaction: number | null;
  minRedeemPoints: number;
  pointValueKES: number | null;
  expiryMonths: number | null;
  allowNegativeBalanceOnReversal: boolean;
  description: string | null;
  terms: string | null;
  redemptionRules: string | null;
  eligibleItems: { itemKind: string; itemId: string }[];
};

export const DEFAULT_POINTS_PROGRAMME: Omit<PointsProgrammeConfig, "id" | "eligibleItems"> = {
  isActive: false,
  kesPerPoint: null,
  pointsPerUnit: null,
  minPurchaseKES: 0,
  maxPointsPerTransaction: null,
  minRedeemPoints: 0,
  pointValueKES: null,
  expiryMonths: null,
  allowNegativeBalanceOnReversal: false,
  description: null,
  terms: null,
  redemptionRules: null,
};

/** Reads (and, for an owner looking at their own screen, creates) the programme row. */
export async function getOrCreateProgramme(businessId: string): Promise<PointsProgrammeConfig> {
  const existing = await prisma.loyaltyPointsProgramme.findUnique({ where: { businessId } }).catch(() => null);
  if (existing) return toProgrammeConfig(existing, await eligibleItemsFor(existing.id));
  // As with the wallet below: if another request created the programme a moment earlier, this call
  // must read that row back. Returning an empty id here would send every later write to a foreign
  // key that does not exist.
  const created = await prisma.loyaltyPointsProgramme
    .create({ data: { businessId } })
    .catch(() => prisma.loyaltyPointsProgramme.findUnique({ where: { businessId } }).catch(() => null));
  if (!created) return { id: "", ...DEFAULT_POINTS_PROGRAMME, eligibleItems: [] };
  return toProgrammeConfig(created, []);
}

/** Read-only variant: a public page must never create a row. */
export async function findProgramme(businessId: string): Promise<PointsProgrammeConfig | null> {
  const existing = await prisma.loyaltyPointsProgramme.findUnique({ where: { businessId } }).catch(() => null);
  if (!existing) return null;
  return toProgrammeConfig(existing, await eligibleItemsFor(existing.id));
}

async function eligibleItemsFor(programmeId: string) {
  const rows = await prisma.loyaltyPointsEligibleItem
    .findMany({ where: { programmeId } })
    .catch(() => [] as any[]);
  return rows.map((row: any) => ({ itemKind: String(row.itemKind), itemId: String(row.itemId) }));
}

function toProgrammeConfig(row: any, eligibleItems: { itemKind: string; itemId: string }[]): PointsProgrammeConfig {
  return {
    id: row.id,
    isActive: row.isActive === true,
    kesPerPoint: row.kesPerPoint === null || row.kesPerPoint === undefined ? null : Math.round(Number(row.kesPerPoint)),
    pointsPerUnit:
      row.pointsPerUnit === null || row.pointsPerUnit === undefined ? null : Math.round(Number(row.pointsPerUnit)),
    minPurchaseKES: Math.max(0, Math.round(Number(row.minPurchaseKES ?? 0) || 0)),
    maxPointsPerTransaction:
      row.maxPointsPerTransaction === null || row.maxPointsPerTransaction === undefined
        ? null
        : Math.max(1, Math.round(Number(row.maxPointsPerTransaction))),
    minRedeemPoints: Math.max(0, Math.round(Number(row.minRedeemPoints ?? 0) || 0)),
    pointValueKES: row.pointValueKES === null || row.pointValueKES === undefined ? null : Math.round(Number(row.pointValueKES)),
    expiryMonths: row.expiryMonths === null || row.expiryMonths === undefined ? null : Math.round(Number(row.expiryMonths)),
    allowNegativeBalanceOnReversal: row.allowNegativeBalanceOnReversal === true,
    description: row.description ?? null,
    terms: row.terms ?? null,
    redemptionRules: row.redemptionRules ?? null,
    eligibleItems,
  };
}

export type ValidatedProgrammeInput = Omit<PointsProgrammeConfig, "id" | "eligibleItems"> & {
  eligibleItems: { itemKind: string; itemId: string }[];
};

function optionalPositiveInt(value: unknown, min: number, max: number): number | null | "invalid" {
  if (value === null || value === undefined || value === "" ) return null;
  const parsed = Math.round(Number(value));
  if (!Number.isFinite(parsed)) return "invalid";
  if (parsed < min || parsed > max) return "invalid";
  return parsed;
}

/**
 * Validates the owner's configuration.
 *
 * Every rule below refuses a setting rather than substituting one: an unset earning rate, an
 * out-of-range expiry or a missing reward value is reported, never silently defaulted. Activation
 * is the one hard gate — a programme cannot earn or redeem points until a rate exists.
 */
export function validateProgrammeInput(raw: unknown): ValidationResult<ValidatedProgrammeInput> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;

  const kesPerPoint = optionalPositiveInt(body.kesPerPoint, MIN_KES_PER_POINT, MAX_KES_PER_POINT);
  if (kesPerPoint === "invalid") {
    return { ok: false, error: `Enter between ${MIN_KES_PER_POINT} and ${MAX_KES_PER_POINT} KES per point.` };
  }
  const pointsPerUnit = optionalPositiveInt(body.pointsPerUnit, MIN_POINTS_PER_UNIT, MAX_POINTS_PER_UNIT);
  if (pointsPerUnit === "invalid") {
    return { ok: false, error: `Enter between ${MIN_POINTS_PER_UNIT} and ${MAX_POINTS_PER_UNIT} points per unit.` };
  }
  const minPurchaseRaw = optionalPositiveInt(body.minPurchaseKES, 0, 100000000);
  if (minPurchaseRaw === "invalid") return { ok: false, error: "Enter a minimum spend of 0 or more." };
  const minPurchaseKES = minPurchaseRaw ?? 0;

  const maxPointsPerTransaction = optionalPositiveInt(body.maxPointsPerTransaction, 1, MAX_POINTS_PER_TRANSACTION);
  if (maxPointsPerTransaction === "invalid") {
    return { ok: false, error: `A cap must be between 1 and ${MAX_POINTS_PER_TRANSACTION} points, or left empty.` };
  }

  const minRedeemRaw = optionalPositiveInt(body.minRedeemPoints, MIN_REDEEM_POINTS, MAX_REDEEM_POINTS);
  if (minRedeemRaw === "invalid") return { ok: false, error: "Enter a redemption threshold of 0 or more." };
  const minRedeemPoints = minRedeemRaw ?? 0;
  const pointValueKES = optionalPositiveInt(body.pointValueKES, 0, 1000000);
  if (pointValueKES === "invalid") return { ok: false, error: "Enter what one point is worth in KES, or leave it empty." };
  const expiryMonths = optionalPositiveInt(body.expiryMonths, 1, MAX_EXPIRY_MONTHS);
  if (expiryMonths === "invalid") {
    return { ok: false, error: `Expiry must be between 1 and ${MAX_EXPIRY_MONTHS} months, or switched off.` };
  }

  const wantsActive = body.isActive === undefined ? false : Boolean(body.isActive);
  if (wantsActive && (kesPerPoint === null || pointsPerUnit === null)) {
    return {
      ok: false,
      error: "Set how many points a customer earns per KES before switching the programme on.",
    };
  }
  if (wantsActive && minRedeemPoints > 0 && minRedeemPoints < (pointsPerUnit ?? 0)) {
    return {
      ok: false,
      error: "A customer can never reach that redemption threshold if it is below a single award. Lower the threshold.",
    };
  }

  const eligibleItems = Array.isArray(body.eligibleItems)
    ? body.eligibleItems
        .map((entry: any) => ({
          itemKind: String(entry?.itemKind ?? "").toUpperCase() === "SERVICE" ? "SERVICE" : "PRODUCT",
          itemId: cleanText(entry?.itemId, 60),
        }))
        .filter((entry) => entry.itemId.length > 0)
        .slice(0, 200)
    : [];

  return {
    ok: true,
    value: {
      isActive: wantsActive,
      kesPerPoint,
      pointsPerUnit,
      minPurchaseKES,
      maxPointsPerTransaction,
      minRedeemPoints,
      pointValueKES,
      expiryMonths,
      allowNegativeBalanceOnReversal: body.allowNegativeBalanceOnReversal === true,
      description: cleanOptionalText(body.description, 600),
      terms: cleanOptionalText(body.terms, 2000),
      redemptionRules: cleanOptionalText(body.redemptionRules, 2000),
      eligibleItems,
    },
  };
}

export async function saveProgramme(params: {
  businessId: string;
  input: ValidatedProgrammeInput;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<PointsProgrammeConfig> {
  await getOrCreateProgramme(params.businessId);
  const updated = await prisma.loyaltyPointsProgramme.update({
    where: { businessId: params.businessId },
    data: {
      isActive: params.input.isActive,
      kesPerPoint: params.input.kesPerPoint,
      pointsPerUnit: params.input.pointsPerUnit,
      minPurchaseKES: params.input.minPurchaseKES,
      maxPointsPerTransaction: params.input.maxPointsPerTransaction,
      minRedeemPoints: params.input.minRedeemPoints,
      pointValueKES: params.input.pointValueKES,
      expiryMonths: params.input.expiryMonths,
      allowNegativeBalanceOnReversal: params.input.allowNegativeBalanceOnReversal,
      description: params.input.description,
      terms: params.input.terms,
      redemptionRules: params.input.redemptionRules,
    },
  });

  // Eligible items are replaced wholesale: the form posts the whole list, and a removed item must
  // stop earning from that moment.
  await prisma.loyaltyPointsEligibleItem.deleteMany({ where: { programmeId: updated.id } }).catch(() => undefined);
  for (const item of params.input.eligibleItems) {
    await prisma.loyaltyPointsEligibleItem
      .create({ data: { programmeId: updated.id, itemKind: item.itemKind, itemId: item.itemId } })
      .catch(() => undefined);
  }

  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.LOYALTY,
    subjectId: updated.id,
    kind: params.input.isActive ? "POINTS_PROGRAMME_ACTIVATED" : "POINTS_PROGRAMME_UPDATED",
    summary: params.input.isActive
      ? `Points programme switched on: ${params.input.pointsPerUnit} point(s) per KES ${params.input.kesPerPoint}`
      : "Points programme updated (earning off)",
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });

  return toProgrammeConfig(updated, params.input.eligibleItems);
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Accounts
// ───────────────────────────────────────────────────────────────────────────────────────────────

export type PointsAccountView = {
  id: string;
  cardId: string;
  customerName: string;
  cardCode: string;
  availablePoints: number;
  lifetimeEarned: number;
  lifetimeRedeemed: number;
  lifetimeExpired: number;
  pointsPending: number;
  status: string;
  lastActivityAt: string | null;
};

/** One wallet per customer card. Creating it enrols the customer in points; it never touches a stamp. */
export async function getOrCreateAccount(businessId: string, cardId: string): Promise<any | null> {
  const card = await prisma.loyaltyCard.findFirst({ where: { id: cardId, businessId } }).catch(() => null);
  if (!card) return null;
  const existing = await prisma.loyaltyPointsAccount.findUnique({ where: { cardId } }).catch(() => null);
  if (existing) return existing;
  const programme = await getOrCreateProgramme(businessId);
  try {
    return await prisma.loyaltyPointsAccount.create({
      data: {
        businessId,
        programmeId: programme.id,
        cardId,
        // Written explicitly rather than left to the schema default: every cached counter the
        // balance maths touches must exist from the first row, so a wallet can never be read as
        // "undefined points" and a compare-and-set can never be skipped.
        availablePoints: 0,
        lifetimeEarned: 0,
        lifetimeRedeemed: 0,
        lifetimeExpired: 0,
        pointsPending: 0,
        status: "ACTIVE",
      },
    });
  } catch (error) {
    // A customer's FIRST award can arrive twice at once — a double tap, a retried request, two
    // tills recording the same purchase. Only one `create` can win the unique index on `cardId`.
    // Reporting the loser as "not part of the programme" would silently drop a real award, so the
    // loser reads back the wallet the winner committed and carries on: the idempotency key on the
    // ledger is what then decides the award itself.
    const raced = await prisma.loyaltyPointsAccount.findUnique({ where: { cardId } }).catch(() => null);
    if (raced) return raced;
    return null;
  }
}

export async function findAccount(businessId: string, cardId: string): Promise<any | null> {
  return prisma.loyaltyPointsAccount.findFirst({ where: { businessId, cardId } }).catch(() => null);
}

export async function listAccounts(businessId: string, options: { search?: string; take?: number } = {}) {
  const take = Math.max(1, Math.min(200, Math.round(Number(options.take ?? 100) || 100)));
  const search = cleanSearch(options.search ?? "", 40).toLowerCase();
  const accounts = (await prisma.loyaltyPointsAccount
    .findMany({ where: { businessId }, take: 500 })
    .catch(() => [] as any[])) as any[];
  const cards = (await prisma.loyaltyCard
    .findMany({ where: { businessId }, take: 500 })
    .catch(() => [] as any[])) as any[];
  const ledger = (await prisma.loyaltyPointsLedger
    .findMany({ where: { businessId }, take: 2000 })
    .catch(() => [] as any[])) as any[];

  const views = accounts.map((account) => {
    const card = cards.find((entry) => entry.id === account.cardId);
    const history = ledger
      .filter((entry) => entry.accountId === account.id)
      .map((entry) => new Date(entry.createdAt).getTime())
      .sort((a, b) => b - a);
    return {
      id: account.id,
      cardId: account.cardId,
      customerName: card?.customerName ?? "Customer",
      cardCode: card?.code ?? "",
      availablePoints: account.availablePoints ?? 0,
      lifetimeEarned: account.lifetimeEarned ?? 0,
      lifetimeRedeemed: account.lifetimeRedeemed ?? 0,
      lifetimeExpired: account.lifetimeExpired ?? 0,
      pointsPending: account.pointsPending ?? 0,
      status: account.status ?? "ACTIVE",
      lastActivityAt: history.length ? new Date(history[0]).toISOString() : null,
    } satisfies PointsAccountView;
  });

  const filtered = search
    ? views.filter(
        (view) =>
          view.customerName.toLowerCase().includes(search) ||
          String(view.cardCode).toLowerCase().includes(search),
      )
    : views;
  return filtered
    .sort((a, b) => b.availablePoints - a.availablePoints || a.customerName.localeCompare(b.customerName))
    .slice(0, take);
}

export async function pointsStats(businessId: string) {
  const accounts = (await prisma.loyaltyPointsAccount
    .findMany({ where: { businessId }, take: 1000 })
    .catch(() => [] as any[])) as any[];
  const ledger = (await prisma.loyaltyPointsLedger
    .findMany({ where: { businessId }, take: 5000 })
    .catch(() => [] as any[])) as any[];
  const sum = (match: (row: any) => boolean) =>
    ledger.filter(match).reduce((total, row) => total + Math.abs(Number(row.points ?? 0)), 0);
  return {
    wallets: accounts.length,
    pointsIssued: sum((row) => row.type === "EARNED"),
    pointsRedeemed: sum((row) => row.type === "REDEEMED"),
    pointsExpired: sum((row) => row.type === "EXPIRED"),
    pointsReversed: sum((row) => row.type === "REVERSED"),
    adjustments: sum((row) => row.type === "MANUAL_ADJUSTMENT"),
    availablePoints: accounts.reduce((total, row) => total + Number(row.availablePoints ?? 0), 0),
  };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Earning
// ───────────────────────────────────────────────────────────────────────────────────────────────

export type PointsResult =
  | { ok: true; entry: any; account: any; duplicate?: boolean; status?: never; error?: never; shortfall?: number }
  | { ok: false; status: number; error: string; entry?: never; account?: never };

/**
 * Deterministic earning rule: `pointsPerUnit` points for every whole `kesPerPoint` KES of eligible
 * spend, capped by `maxPointsPerTransaction` when the owner set one.
 *
 * The same inputs always produce the same answer — there is no rounding drift, no pro-rata and no
 * random component — and the calculation is exported so it can be tested and shown to the owner.
 */
export function calculatePoints(
  eligibleAmountKES: number,
  programme: Pick<PointsProgrammeConfig, "kesPerPoint" | "pointsPerUnit" | "maxPointsPerTransaction">,
): number {
  if (programme.kesPerPoint === null || programme.pointsPerUnit === null) return 0;
  if (!Number.isFinite(eligibleAmountKES) || eligibleAmountKES <= 0) return 0;
  const units = Math.floor(eligibleAmountKES / programme.kesPerPoint);
  const raw = units * programme.pointsPerUnit;
  if (programme.maxPointsPerTransaction === null) return raw;
  return Math.max(0, Math.min(raw, programme.maxPointsPerTransaction));
}

/** Which part of a purchase counts, given the programme's eligible-items list. */
export function eligibleAmount(
  programme: Pick<PointsProgrammeConfig, "eligibleItems">,
  purchase: { amountKES: number; items?: { itemKind: string; itemId: string; amountKES?: number }[] },
): { eligibleKES: number; ineligible: boolean } {
  const items = Array.isArray(purchase.items) ? purchase.items : [];
  if (programme.eligibleItems.length === 0) return { eligibleKES: purchase.amountKES, ineligible: false };
  const allowed = new Set(programme.eligibleItems.map((item) => `${item.itemKind}:${item.itemId}`));
  const matching = items.filter((item) => allowed.has(`${String(item.itemKind).toUpperCase()}:${item.itemId}`));
  if (matching.length === 0) return { eligibleKES: 0, ineligible: true };
  const total = matching.reduce((sum, item) => sum + Math.max(0, Number(item.amountKES ?? 0)), 0);
  return { eligibleKES: total > 0 ? total : purchase.amountKES, ineligible: false };
}

function earnIdempotencyKey(transactionRef: string) {
  return `EARN:${transactionRef}`;
}

export function normaliseTransactionRef(value: unknown): string {
  return cleanText(value, 80).trim().toUpperCase();
}

/**
 * Awards points for one verified purchase.
 *
 * Duplicate protection is the unique index on (businessId, idempotencyKey): replaying the same
 * transaction reference — deliberately, or by two people verifying the same receipt at once —
 * returns the ORIGINAL entry with `duplicate: true` and writes nothing new.
 */
export async function awardPoints(params: {
  businessId: string;
  cardId: string;
  transactionRef: string;
  amountKES: number;
  items?: { itemKind: string; itemId: string; amountKES?: number }[];
  note?: string | null;
  source?: string;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<PointsResult> {
  const programme = await getOrCreateProgramme(params.businessId);
  if (!programme.isActive) {
    return { ok: false, status: 409, error: "Points earning is switched off. Turn the points programme on first." };
  }
  if (params.source === "PAYMENT_PROVIDER") {
    // Reserved for authoritative payment verification, which does not exist in this release.
    // Refusing it here is what stops a caller from asserting a payment that was never verified.
    return { ok: false, status: 400, error: "Automatic payment verification is not available. Record the purchase instead." };
  }

  const transactionRef = normaliseTransactionRef(params.transactionRef);
  if (transactionRef.length < 3) {
    return { ok: false, status: 400, error: "Enter a short reference for the purchase (receipt, order or date)." };
  }

  const account = await getOrCreateAccount(params.businessId, params.cardId);
  if (!account) return { ok: false, status: 404, error: "That customer is not part of your loyalty programme." };
  if (account.status !== "ACTIVE") {
    return { ok: false, status: 409, error: "This wallet is blocked. Unblock it before awarding points." };
  }

  const amountKES = Number(params.amountKES);
  if (!Number.isFinite(amountKES) || amountKES <= 0) {
    return { ok: false, status: 400, error: "Enter the purchase amount in KES." };
  }
  if (amountKES < programme.minPurchaseKES) {
    return {
      ok: false,
      status: 409,
      error: `This purchase is below your minimum of ${formatKes(programme.minPurchaseKES)}, so it earns no points.`,
    };
  }

  const { eligibleKES, ineligible } = eligibleAmount(programme, { amountKES, items: params.items });
  if (ineligible) {
    return { ok: false, status: 409, error: "None of the items on this purchase earn points." };
  }
  const points = calculatePoints(eligibleKES, programme);
  if (points <= 0) {
    return {
      ok: false,
      status: 409,
      error: `This purchase earns no points yet — customers earn ${programme.pointsPerUnit} point(s) for every KES ${programme.kesPerPoint}.`,
    };
  }

  const idempotencyKey = earnIdempotencyKey(transactionRef);
  const existing = await prisma.loyaltyPointsLedger
    .findFirst({ where: { businessId: params.businessId, idempotencyKey } })
    .catch(() => null);
  if (existing) return { ok: true, entry: existing, account, duplicate: true };

  const expiresAt = programme.expiryMonths ? addMonths(new Date(), programme.expiryMonths) : null;

  try {
    const entry = await prisma.$transaction(async (tx: any) => {
      const created = await tx.loyaltyPointsLedger.create({
        data: {
          businessId: params.businessId,
          accountId: account.id,
          type: "EARNED",
          direction: "CREDIT",
          points,
          balanceAfter: Number(account.availablePoints ?? 0) + points,
          reference: createReference("JATA-PTS"),
          idempotencyKey,
          source: "OWNER_VERIFIED",
          sourceReference: transactionRef,
          explanation:
            cleanOptionalText(params.note, 400) ??
            `${points} point(s) for a verified purchase of ${formatKes(Math.round(amountKES))} (${transactionRef})`,
          actorUserId: params.actorId ?? null,
          actorLabel: cleanOptionalText(params.actorLabel, 80),
          expiresAt,
          remainingPoints: points,
        },
      });
      await tx.loyaltyPointsAccount.update({
        where: { id: account.id },
        data: {
          availablePoints: { increment: points },
          lifetimeEarned: { increment: points },
        },
      });
      return created;
    });

    const updated = await prisma.loyaltyPointsAccount.findUnique({ where: { id: account.id } }).catch(() => account);
    await recordHubActivity(prisma, {
      businessId: params.businessId,
      subjectType: HUB_SUBJECTS.LOYALTY,
      subjectId: account.cardId,
      kind: "POINTS_EARNED",
      summary: `${points} point(s) awarded for ${transactionRef}`,
      note: cleanOptionalText(params.note, 400),
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel ?? null,
    });
    return { ok: true, entry, account: updated ?? account };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const original = await prisma.loyaltyPointsLedger
        .findFirst({ where: { businessId: params.businessId, idempotencyKey } })
        .catch(() => null);
      if (original) return { ok: true, entry: original, account, duplicate: true };
      return { ok: false, status: 409, error: "That purchase has already earned points." };
    }
    return { ok: false, status: 503, error: "We couldn't award those points. Please try again." };
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Reversal (refund or cancellation of a purchase that earned points)
// ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Reverses the points from one verified purchase.
 *
 * The original EARNED row is preserved; this writes a REVERSED row that points back at it. The
 * guard is the idempotency key `REVERSE:<entryId>`, so a refund webhook that fires twice, or an
 * owner who presses twice, reverses exactly once.
 *
 * Points already redeemed or expired cannot be clawed back unless the owner has explicitly allowed
 * a negative balance: the safe default reverses the unspent portion and reports the shortfall, so
 * no customer is pushed into a debt the business never agreed to collect.
 */
export async function reversePoints(params: {
  businessId: string;
  cardId: string;
  transactionRef: string;
  reason?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<PointsResult> {
  const programme = await getOrCreateProgramme(params.businessId);
  const transactionRef = normaliseTransactionRef(params.transactionRef);
  if (transactionRef.length < 3) {
    return { ok: false, status: 400, error: "Enter the reference of the purchase you are reversing." };
  }
  // Taking points back is the one action that can leave a customer worse off, so the reason is
  // required here too — the route is not the only door into this function.
  if (cleanText(params.reason, 400).length < MIN_ADJUSTMENT_REASON) {
    return { ok: false, status: 400, error: "Record why these points are being taken back." };
  }

  const original = await prisma.loyaltyPointsLedger
    .findFirst({ where: { businessId: params.businessId, type: "EARNED", sourceReference: transactionRef } })
    .catch(() => null);
  if (!original) {
    return { ok: false, status: 404, error: "No points were awarded for that purchase reference." };
  }

  const idempotencyKey = `REVERSE:${original.id}`;
  const already = await prisma.loyaltyPointsLedger
    .findFirst({ where: { businessId: params.businessId, idempotencyKey } })
    .catch(() => null);
  if (already) {
    return { ok: false, status: 409, error: "That purchase has already been reversed. It can only be reversed once." };
  }

  const account = await findAccount(params.businessId, params.cardId);
  if (!account) return { ok: false, status: 404, error: "That customer is not part of your loyalty programme." };

  const remaining = Number(original.remainingPoints ?? 0);
  const awarded = Math.abs(Number(original.points ?? 0));
  const allowNegative = programme.allowNegativeBalanceOnReversal === true;
  const points = allowNegative ? awarded : Math.min(awarded, remaining);
  const shortfall = awarded - points;

  try {
    const entry = await prisma.$transaction(async (tx: any) => {
      if (points > 0) {
        if (!allowNegative) {
          const guarded = await tx.loyaltyPointsAccount.updateMany({
            where: { id: account.id, businessId: params.businessId, availablePoints: { gte: points } },
            data: { availablePoints: { decrement: points }, lifetimeEarned: { decrement: points } },
          });
          if (!guarded || guarded.count !== 1) {
            throw Object.assign(new Error("insufficient"), { code: "INSUFFICIENT" });
          }
        } else {
          await tx.loyaltyPointsAccount.update({
            where: { id: account.id },
            data: { availablePoints: { decrement: points }, lifetimeEarned: { decrement: points } },
          });
        }
        await tx.loyaltyPointsLedger.update({
          where: { id: original.id },
          data: { remainingPoints: Math.max(0, remaining - points) },
        });
      }
      const created = await tx.loyaltyPointsLedger.create({
        data: {
          businessId: params.businessId,
          accountId: account.id,
          type: "REVERSED",
          direction: "DEBIT",
          points,
          balanceAfter: Number(account.availablePoints ?? 0) - points,
          reference: createReference("JATA-PTS"),
          idempotencyKey,
          source: "REVERSAL",
          sourceReference: transactionRef,
          reversalOfId: original.id,
          explanation:
            cleanOptionalText(params.reason, 400) ??
            `Reversed ${points} point(s) from ${transactionRef} (refunded or cancelled)`,
          actorUserId: params.actorId ?? null,
          actorLabel: cleanOptionalText(params.actorLabel, 80),
        },
      });
      return created;
    });

    const updated = await prisma.loyaltyPointsAccount.findUnique({ where: { id: account.id } }).catch(() => account);
    await recordHubActivity(prisma, {
      businessId: params.businessId,
      subjectType: HUB_SUBJECTS.LOYALTY,
      subjectId: account.cardId,
      kind: "POINTS_REVERSED",
      summary: `Reversed ${points} point(s) from ${transactionRef}`,
      note: cleanOptionalText(params.reason, 400),
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel ?? null,
    });
    return { ok: true, entry, account: updated ?? account, shortfall };
  } catch (error) {
    if (isUniqueViolation(error)) {
      return { ok: false, status: 409, error: "That purchase has already been reversed. It can only be reversed once." };
    }
    if ((error as any)?.code === "INSUFFICIENT") {
      return { ok: false, status: 409, error: "Those points have already been spent or expired, so there is nothing left to reverse." };
    }
    return { ok: false, status: 503, error: "We couldn't reverse those points. Please try again." };
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Manual adjustment
// ───────────────────────────────────────────────────────────────────────────────────────────────

/**
 * A correction, always recorded with a mandatory reason and an idempotency key, so an adjustment
 * can be replayed safely and can never be anonymous. A debit is refused when the wallet does not
 * hold the points: an adjustment may not invent a negative balance either.
 */
export async function adjustPoints(params: {
  businessId: string;
  cardId: string;
  points: number;
  reason: string;
  idempotencyKey?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<PointsResult> {
  const points = Math.round(Number(params.points));
  const reason = cleanText(params.reason, 400);
  if (!Number.isFinite(points) || points === 0) {
    return { ok: false, status: 400, error: "Enter how many points to add or remove." };
  }
  if (reason.length < MIN_ADJUSTMENT_REASON) {
    return { ok: false, status: 400, error: "Every adjustment needs a reason the customer could read." };
  }

  const account = await getOrCreateAccount(params.businessId, params.cardId);
  if (!account) return { ok: false, status: 404, error: "That customer is not part of your loyalty programme." };

  const magnitude = Math.abs(points);
  const direction = points > 0 ? "CREDIT" : "DEBIT";
  // Namespaced by wallet, for the same reason as a redemption key: the ledger's unique index is
  // (businessId, idempotencyKey), so one wallet's key must not be able to answer for another's.
  const idempotencyKey = `ADJUST:${account.id}:${cleanText(params.idempotencyKey, 120) || randomCode(12)}`;
  const existing = await prisma.loyaltyPointsLedger
    .findFirst({ where: { businessId: params.businessId, accountId: account.id, idempotencyKey } })
    .catch(() => null);
  if (existing) return { ok: true, entry: existing, account, duplicate: true };

  try {
    const entry = await prisma.$transaction(async (tx: any) => {
      if (direction === "CREDIT") {
        await tx.loyaltyPointsAccount.update({
          where: { id: account.id },
          data: { availablePoints: { increment: magnitude }, lifetimeEarned: { increment: magnitude } },
        });
      } else {
        const guarded = await tx.loyaltyPointsAccount.updateMany({
          where: { id: account.id, businessId: params.businessId, availablePoints: { gte: magnitude } },
          data: { availablePoints: { decrement: magnitude }, lifetimeRedeemed: { increment: magnitude } },
        });
        if (!guarded || guarded.count !== 1) {
          throw Object.assign(new Error("insufficient"), { code: "INSUFFICIENT" });
        }
      }
      return tx.loyaltyPointsLedger.create({
        data: {
          businessId: params.businessId,
          accountId: account.id,
          type: "MANUAL_ADJUSTMENT",
          direction,
          points: magnitude,
          balanceAfter:
            direction === "CREDIT"
              ? Number(account.availablePoints ?? 0) + magnitude
              : Number(account.availablePoints ?? 0) - magnitude,
          reference: createReference("JATA-PTS"),
          idempotencyKey,
          source: "OWNER_ADJUSTMENT",
          explanation: reason,
          actorUserId: params.actorId ?? null,
          actorLabel: cleanOptionalText(params.actorLabel, 80),
        },
      });
    });

    const updated = await prisma.loyaltyPointsAccount.findUnique({ where: { id: account.id } }).catch(() => account);
    await recordHubActivity(prisma, {
      businessId: params.businessId,
      subjectType: HUB_SUBJECTS.LOYALTY,
      subjectId: account.cardId,
      kind: "POINTS_ADJUSTED",
      summary: `${direction === "CREDIT" ? "Added" : "Removed"} ${magnitude} point(s): ${reason}`,
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel ?? null,
    });
    return { ok: true, entry, account: updated ?? account };
  } catch (error) {
    if (isUniqueViolation(error)) {
      const original = await prisma.loyaltyPointsLedger
        .findFirst({ where: { businessId: params.businessId, idempotencyKey } })
        .catch(() => null);
      if (original) return { ok: true, entry: original, account, duplicate: true };
    }
    if ((error as any)?.code === "INSUFFICIENT") {
      return { ok: false, status: 409, error: "That wallet does not hold enough points to remove that many." };
    }
    return { ok: false, status: 503, error: "We couldn't record that adjustment. Please try again." };
  }
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Rewards and redemption
// ───────────────────────────────────────────────────────────────────────────────────────────────

export type RewardInput = {
  title: string;
  description: string | null;
  kind: string;
  pointsCost: number;
  discountKES: number | null;
  itemKind: string | null;
  itemId: string | null;
  isActive: boolean;
  sortOrder: number;
};

export function validateRewardInput(raw: unknown): ValidationResult<RewardInput> {
  const body = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const title = cleanText(body.title, 80);
  if (title.length < 3) return { ok: false, error: "Name the reward." };
  const pointsCost = Math.round(Number(body.pointsCost));
  if (!Number.isFinite(pointsCost) || pointsCost < 1 || pointsCost > MAX_REWARD_COST) {
    return { ok: false, error: `A reward must cost between 1 and ${formatNumber(MAX_REWARD_COST)} points.` };
  }
  const kind = REWARD_KINDS.includes(String(body.kind) as any) ? String(body.kind) : "FIXED_POINTS";
  const discountRaw = body.discountKES === null || body.discountKES === undefined || body.discountKES === "" ? null : Math.round(Number(body.discountKES));
  if (discountRaw !== null && (!Number.isFinite(discountRaw) || discountRaw < 0 || discountRaw > 100000000)) {
    return { ok: false, error: "Enter the discount in KES, or leave it empty." };
  }
  const itemKind = kind === "PRODUCT" || kind === "SERVICE" ? (kind === "PRODUCT" ? "PRODUCT" : "SERVICE") : null;
  return {
    ok: true,
    value: {
      title,
      description: cleanOptionalText(body.description, 600),
      kind,
      pointsCost,
      discountKES: kind === "DISCOUNT" ? discountRaw : null,
      itemKind,
      itemId: itemKind ? cleanOptionalText(body.itemId, 60) : null,
      isActive: body.isActive === undefined ? true : Boolean(body.isActive),
      sortOrder: Math.max(0, Math.min(999, Math.round(Number(body.sortOrder ?? 0) || 0))),
    },
  };
}

export async function listRewards(businessId: string, options: { includeInactive?: boolean } = {}) {
  const rows = (await prisma.loyaltyReward
    .findMany({ where: { businessId }, take: 200 })
    .catch(() => [] as any[])) as any[];
  const filtered = options.includeInactive ? rows : rows.filter((row) => row.isActive !== false);
  return filtered
    .map((row) => ({
      id: row.id,
      title: row.title,
      description: row.description ?? null,
      kind: row.kind ?? "FIXED_POINTS",
      pointsCost: Number(row.pointsCost ?? 0),
      discountKES: row.discountKES === null || row.discountKES === undefined ? null : Number(row.discountKES),
      itemKind: row.itemKind ?? null,
      itemId: row.itemId ?? null,
      isActive: row.isActive !== false,
      sortOrder: Number(row.sortOrder ?? 0),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.pointsCost - b.pointsCost || a.title.localeCompare(b.title));
}

export async function saveReward(params: {
  businessId: string;
  rewardId?: string | null;
  input: RewardInput;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<any | null> {
  const programme = await getOrCreateProgramme(params.businessId);
  const data = {
    businessId: params.businessId,
    programmeId: programme.id,
    title: params.input.title,
    description: params.input.description,
    kind: params.input.kind,
    pointsCost: params.input.pointsCost,
    discountKES: params.input.discountKES,
    itemKind: params.input.itemKind,
    itemId: params.input.itemId,
    isActive: params.input.isActive,
    sortOrder: params.input.sortOrder,
  };
  // The id comes from the caller, so the edit is scoped to this business before anything is
  // written. Updating on the id alone would let one business pass another business's reward id and
  // rewrite it — the payload even carries `businessId`, so it would take ownership of it.
  const existing = params.rewardId
    ? await prisma.loyaltyReward
        .findFirst({ where: { id: params.rewardId, businessId: params.businessId } })
        .catch(() => null)
    : null;
  if (params.rewardId && !existing) return null;
  const row = existing
    ? await prisma.loyaltyReward.update({ where: { id: existing.id }, data })
    : await prisma.loyaltyReward.create({ data });
  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.LOYALTY,
    subjectId: row.id,
    kind: "POINTS_REWARD_SAVED",
    summary: `${params.rewardId ? "Updated" : "Added"} reward "${row.title}" (${row.pointsCost} points)`,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });
  return row;
}

export async function setRewardActive(params: {
  businessId: string;
  rewardId: string;
  isActive: boolean;
  actorId?: string | null;
  actorLabel?: string | null;
}) {
  const reward = await prisma.loyaltyReward.findFirst({ where: { id: params.rewardId, businessId: params.businessId } });
  if (!reward) return null;
  const updated = await prisma.loyaltyReward.update({ where: { id: reward.id }, data: { isActive: params.isActive } });
  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.LOYALTY,
    subjectId: reward.id,
    kind: "POINTS_REWARD_SAVED",
    summary: `${params.isActive ? "Published" : "Paused"} reward "${reward.title}"`,
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });
  return updated;
}

export type RedeemResult =
  | { ok: true; redemption: any; account: any; entry: any; duplicate?: boolean; status?: never; error?: never }
  | { ok: false; status: number; error: string; redemption?: never; account?: never };

/**
 * Redeems a reward.
 *
 * The double-spend guard is a compare-and-set inside one transaction: the account row is only
 * updated `WHERE availablePoints >= cost`, so two simultaneous redemptions serialise on that row
 * and the second one matches nothing and is refused — the points cannot be spent twice.
 *
 * The double-tap guard is the unique (businessId, idempotencyKey) index on the redemption: a
 * retried request returns the original redemption instead of creating a second one.
 */
export async function redeemPoints(params: {
  businessId: string;
  cardId: string;
  rewardId: string;
  idempotencyKey?: string | null;
  note?: string | null;
  channel?: "CUSTOMER" | "OWNER_ASSISTED";
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<RedeemResult> {
  const programme = await getOrCreateProgramme(params.businessId);
  if (!programme.isActive) {
    return { ok: false, status: 409, error: "This business's points programme is not active." };
  }

  const reward = await prisma.loyaltyReward
    .findFirst({ where: { id: params.rewardId, businessId: params.businessId } })
    .catch(() => null);
  if (!reward) return { ok: false, status: 404, error: "That reward is not available." };
  if (reward.isActive === false) return { ok: false, status: 409, error: "That reward is paused." };

  const account = await findAccount(params.businessId, params.cardId);
  if (!account) return { ok: false, status: 404, error: "That customer does not have a points wallet yet." };
  if (account.status !== "ACTIVE") return { ok: false, status: 409, error: "This wallet is blocked and cannot redeem." };

  // The replay check comes BEFORE the balance checks, because a replay is not a new attempt to
  // spend: the wallet has already paid for this redemption. A tap whose response was lost arrives
  // again with the same key, by which time the balance is legitimately lower — refusing it there
  // would tell a customer they cannot afford the reward they are holding, and would invite a
  // second hand-over of the same reward.
  //
  // The stored key is namespaced by wallet. The database enforces one key per BUSINESS, not per
  // wallet, so two customers who happened to use the same key would collide — and the loser of
  // that collision would be handed the other customer's redemption. The keys the wallet sends are
  // random, which makes that vanishingly unlikely; namespacing it makes it impossible.
  const clientKey = cleanText(params.idempotencyKey, 120) || randomCode(12);
  const idempotencyKey = `REDEEM:${account.id}:${clientKey}`;
  const existing = await prisma.loyaltyRewardRedemption
    .findFirst({ where: { businessId: params.businessId, accountId: account.id, idempotencyKey } })
    .catch(() => null);
  if (existing) return { ok: true, redemption: existing, account, entry: null, duplicate: true };

  const cost = Math.max(0, Math.round(Number(reward.pointsCost ?? 0)));
  const available = Number(account.availablePoints ?? 0);
  if (programme.minRedeemPoints > 0 && available < programme.minRedeemPoints) {
    return {
      ok: false,
      status: 409,
      error: `Redeeming starts at ${programme.minRedeemPoints} points. This wallet has ${available}.`,
    };
  }
  if (available < cost) {
    return {
      ok: false,
      status: 409,
      error: `This reward costs ${cost} points and the wallet holds ${available}.`,
    };
  }

  try {
    const result = await prisma.$transaction(async (tx: any) => {
      const guarded = await tx.loyaltyPointsAccount.updateMany({
        where: { id: account.id, businessId: params.businessId, availablePoints: { gte: cost } },
        data: { availablePoints: { decrement: cost }, lifetimeRedeemed: { increment: cost } },
      });
      if (!guarded || guarded.count !== 1) {
        throw Object.assign(new Error("insufficient"), { code: "INSUFFICIENT" });
      }
      const redemption = await tx.loyaltyRewardRedemption.create({
        data: {
          businessId: params.businessId,
          accountId: account.id,
          rewardId: reward.id,
          pointsSpent: cost,
          status: "PENDING",
          reference: createReference("JATA-RWD"),
          idempotencyKey,
          rewardTitleSnapshot: reward.title,
          rewardKindSnapshot: reward.kind ?? "FIXED_POINTS",
          channel: params.channel === "OWNER_ASSISTED" ? "OWNER_ASSISTED" : "CUSTOMER",
          customerNote: cleanOptionalText(params.note, 400),
        },
      });
      const entry = await tx.loyaltyPointsLedger.create({
        data: {
          businessId: params.businessId,
          accountId: account.id,
          type: "REDEEMED",
          direction: "DEBIT",
          points: cost,
          balanceAfter: available - cost,
          reference: createReference("JATA-PTS"),
          idempotencyKey: `LEDGER:${idempotencyKey}`,
          source: "CUSTOMER_REDEMPTION",
          sourceReference: redemption.reference,
          explanation: `Redeemed ${cost} point(s) for "${reward.title}"`,
          actorUserId: params.actorId ?? null,
          actorLabel: cleanOptionalText(params.actorLabel, 80),
        },
      });
      // Consume the oldest earning lots first (expiring points before points that never expire),
      // so expiry and reversals know exactly which points are still unspent.
      let remaining = cost;
      const lots = (await tx.loyaltyPointsLedger.findMany({
        where: { accountId: account.id, type: "EARNED", direction: "CREDIT", remainingPoints: { gt: 0 } },
      })) as any[];
      const ordered = [...lots].sort((a, b) => {
        const left = a.expiresAt ? new Date(a.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        const right = b.expiresAt ? new Date(b.expiresAt).getTime() : Number.MAX_SAFE_INTEGER;
        return left - right || new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      });
      for (const lot of ordered) {
        if (remaining <= 0) break;
        const held = Number(lot.remainingPoints ?? 0);
        if (held <= 0) continue;
        const take = Math.min(held, remaining);
        await tx.loyaltyPointsLedger.update({ where: { id: lot.id }, data: { remainingPoints: held - take } });
        remaining -= take;
      }
      return { redemption, entry };
    });

    const updated = await prisma.loyaltyPointsAccount.findUnique({ where: { id: account.id } }).catch(() => account);
    await recordHubActivity(prisma, {
      businessId: params.businessId,
      subjectType: HUB_SUBJECTS.LOYALTY,
      subjectId: account.cardId,
      kind: "POINTS_REDEEMED",
      summary: `Redeemed "${reward.title}" for ${cost} point(s)`,
      note: result.redemption.reference,
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel ?? null,
    });
    return { ok: true, redemption: result.redemption, entry: result.entry, account: updated ?? account };
  } catch (error) {
    if (isUniqueViolation(error)) {
      // Scoped to this wallet as well: a collision must never hand one customer another
      // customer's redemption, whatever the key turns out to be.
      const original = await prisma.loyaltyRewardRedemption
        .findFirst({ where: { businessId: params.businessId, accountId: account.id, idempotencyKey } })
        .catch(() => null);
      if (original) return { ok: true, redemption: original, account, entry: null, duplicate: true };
      return { ok: false, status: 409, error: "That redemption has already been recorded." };
    }
    if ((error as any)?.code === "INSUFFICIENT") {
      return { ok: false, status: 409, error: "Not enough points for that reward." };
    }
    return { ok: false, status: 503, error: "We couldn't complete that redemption. Please try again." };
  }
}

export async function updateRedemptionStatus(params: {
  businessId: string;
  redemptionId: string;
  status: string;
  reason?: string | null;
  actorId?: string | null;
  actorLabel?: string | null;
}) {
  const redemption = await prisma.loyaltyRewardRedemption
    .findFirst({ where: { id: params.redemptionId, businessId: params.businessId } })
    .catch(() => null);
  if (!redemption) return { ok: false as const, status: 404, error: "That redemption is not in your records." };
  if (!REDEMPTION_STATUSES.includes(String(params.status) as any)) {
    return { ok: false as const, status: 400, error: "Choose a valid redemption status." };
  }
  // Cancel first wins: a cancelled redemption has already returned its points, so pressing
  // "cancel" again is refused rather than silently treated as a no-op.
  if (redemption.status === "CANCELLED") {
    return { ok: false as const, status: 409, error: "That redemption was cancelled. Its points have already been returned." };
  }
  if (redemption.status === params.status) {
    return { ok: true as const, redemption };
  }

  const updated = await prisma.$transaction(async (tx: any) => {
    if (params.status === "CANCELLED") {
      // Cancelling returns the points through a compensating entry; the redemption row itself keeps
      // its history, and the second cancel is refused before it can return the points twice.
      await tx.loyaltyPointsAccount.update({
        where: { id: redemption.accountId },
        data: {
          availablePoints: { increment: redemption.pointsSpent },
          lifetimeRedeemed: { decrement: redemption.pointsSpent },
        },
      });
      const account = await tx.loyaltyPointsAccount.findUnique({ where: { id: redemption.accountId } });
      await tx.loyaltyPointsLedger.create({
        data: {
          businessId: params.businessId,
          accountId: redemption.accountId,
          type: "MANUAL_ADJUSTMENT",
          direction: "CREDIT",
          points: redemption.pointsSpent,
          balanceAfter: Number(account?.availablePoints ?? 0),
          reference: createReference("JATA-PTS"),
          idempotencyKey: `CANCEL:${redemption.id}`,
          source: "OWNER_ADJUSTMENT",
          sourceReference: redemption.reference,
          explanation:
            cleanOptionalText(params.reason, 400) ?? `Redemption ${redemption.reference} cancelled — points returned`,
          actorUserId: params.actorId ?? null,
          actorLabel: cleanOptionalText(params.actorLabel, 80),
        },
      });
    }
    return tx.loyaltyRewardRedemption.update({
      where: { id: redemption.id },
      data: {
        status: params.status,
        cancelledAt: params.status === "CANCELLED" ? new Date() : null,
        cancelReason: params.status === "CANCELLED" ? cleanOptionalText(params.reason, 400) : null,
        fulfilledByUserId: params.status === "FULFILLED" ? params.actorId ?? null : null,
        fulfilledByLabel: params.status === "FULFILLED" ? cleanOptionalText(params.actorLabel, 80) : null,
      },
    });
  });

  await recordHubActivity(prisma, {
    businessId: params.businessId,
    subjectType: HUB_SUBJECTS.LOYALTY,
    subjectId: redemption.accountId,
    kind: "POINTS_REDEMPTION_UPDATED",
    summary: `Redemption ${redemption.reference} marked ${String(params.status).toLowerCase()}`,
    note: cleanOptionalText(params.reason, 400),
    actorId: params.actorId ?? null,
    actorLabel: params.actorLabel ?? null,
  });
  return { ok: true as const, redemption: updated };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Expiry
// ───────────────────────────────────────────────────────────────────────────────────────────────

export type ExpiryResult = {
  scanned: number;
  expired: number;
  pointsExpired: number;
  skipped: string | null;
};

/**
 * Expires unused points that have reached their date.
 *
 * Idempotent per earning lot: the key `EXPIRE:<lotId>` can only ever be written once, so a
 * scheduler that runs twice — or resumes after an interruption — never expires the same points
 * twice. When the programme has no expiry period, this does nothing and says so.
 */
export async function runExpiry(params: {
  businessId: string;
  now?: Date;
  actorId?: string | null;
  actorLabel?: string | null;
}): Promise<ExpiryResult> {
  const programme = await getOrCreateProgramme(params.businessId);
  if (programme.expiryMonths === null) {
    return { scanned: 0, expired: 0, pointsExpired: 0, skipped: "Points never expire in this programme." };
  }
  const now = params.now ?? new Date();
  const lots = (await prisma.loyaltyPointsLedger
    .findMany({ where: { businessId: params.businessId, type: "EARNED", direction: "CREDIT", remainingPoints: { gt: 0 } }, take: 2000 })
    .catch(() => [] as any[])) as any[];
  const due = lots.filter((lot) => lot.expiresAt && new Date(lot.expiresAt).getTime() <= now.getTime());

  let expired = 0;
  let pointsExpired = 0;
  for (const lot of due) {
    const idempotencyKey = `EXPIRE:${lot.id}`;
    const already = await prisma.loyaltyPointsLedger
      .findFirst({ where: { businessId: params.businessId, idempotencyKey } })
      .catch(() => null);
    if (already) continue;

    const held = Number(lot.remainingPoints ?? 0);
    if (held <= 0) continue;
    const account = await prisma.loyaltyPointsAccount.findUnique({ where: { id: lot.accountId } }).catch(() => null);
    if (!account) continue;
    const take = Math.min(held, Math.max(0, Number(account.availablePoints ?? 0)));
    if (take <= 0) continue;

    try {
      await prisma.$transaction(async (tx: any) => {
        const guarded = await tx.loyaltyPointsAccount.updateMany({
          where: { id: account.id, businessId: params.businessId, availablePoints: { gte: take } },
          data: { availablePoints: { decrement: take }, lifetimeExpired: { increment: take } },
        });
        if (!guarded || guarded.count !== 1) {
          throw Object.assign(new Error("insufficient"), { code: "INSUFFICIENT" });
        }
        await tx.loyaltyPointsLedger.update({ where: { id: lot.id }, data: { remainingPoints: held - take } });
        await tx.loyaltyPointsLedger.create({
          data: {
            businessId: params.businessId,
            accountId: account.id,
            type: "EXPIRED",
            direction: "DEBIT",
            points: take,
            balanceAfter: Number(account.availablePoints ?? 0) - take,
            reference: createReference("JATA-PTS"),
            idempotencyKey,
            source: "SYSTEM_EXPIRY",
            sourceReference: lot.sourceReference ?? null,
            reversalOfId: lot.id,
            explanation: `${take} point(s) expired unused`,
            actorUserId: params.actorId ?? null,
            actorLabel: cleanOptionalText(params.actorLabel, 80),
          },
        });
      });
      expired += 1;
      pointsExpired += take;
    } catch {
      continue;
    }
  }

  if (expired > 0) {
    await recordHubActivity(prisma, {
      businessId: params.businessId,
      subjectType: HUB_SUBJECTS.LOYALTY,
      subjectId: params.businessId,
      kind: "POINTS_EXPIRED",
      summary: `Expired ${pointsExpired} unused point(s) across ${expired} award(s)`,
      actorId: params.actorId ?? null,
      actorLabel: params.actorLabel ?? null,
    });
  }
  return { scanned: due.length, expired, pointsExpired, skipped: null };
}

// ───────────────────────────────────────────────────────────────────────────────────────────────
// Reads: ledger, redemptions, reconciliation, wallets
// ───────────────────────────────────────────────────────────────────────────────────────────────

export async function listLedger(
  businessId: string,
  options: { accountId?: string; type?: string; take?: number } = {},
) {
  const take = Math.max(1, Math.min(200, Math.round(Number(options.take ?? 50) || 50)));
  const where: Record<string, unknown> = { businessId };
  if (options.accountId) where.accountId = options.accountId;
  if (options.type) where.type = options.type;
  const rows = (await prisma.loyaltyPointsLedger.findMany({ where, take: 2000 }).catch(() => [] as any[])) as any[];
  return rows
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, take)
    .map((row) => ({
      id: row.id,
      type: row.type,
      direction: row.direction,
      points: Number(row.points ?? 0),
      balanceAfter: Number(row.balanceAfter ?? 0),
      reference: row.reference,
      source: row.source,
      sourceReference: row.sourceReference ?? null,
      explanation: row.explanation ?? null,
      actorLabel: row.actorLabel ?? null,
      expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
      createdAt: new Date(row.createdAt).toISOString(),
    }));
}

export async function listRedemptions(
  businessId: string,
  options: { accountId?: string; status?: string; take?: number } = {},
) {
  const take = Math.max(1, Math.min(200, Math.round(Number(options.take ?? 50) || 50)));
  const where: Record<string, unknown> = { businessId };
  if (options.accountId) where.accountId = options.accountId;
  if (options.status) where.status = options.status;
  const rows = (await prisma.loyaltyRewardRedemption.findMany({ where, take: 2000 }).catch(() => [] as any[])) as any[];
  const accounts = (await prisma.loyaltyPointsAccount
    .findMany({ where: { businessId }, take: 1000 })
    .catch(() => [] as any[])) as any[];
  const cards = (await prisma.loyaltyCard
    .findMany({ where: { businessId }, take: 1000 })
    .catch(() => [] as any[])) as any[];
  return rows
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, take)
    .map((row) => {
      const account = accounts.find((entry) => entry.id === row.accountId);
      const card = cards.find((entry) => entry.id === account?.cardId);
      return {
        id: row.id,
        reference: row.reference,
        rewardTitle: row.rewardTitleSnapshot,
        rewardKind: row.rewardKindSnapshot,
        pointsSpent: Number(row.pointsSpent ?? 0),
        status: row.status,
        channel: row.channel ?? "CUSTOMER",
        customerName: card?.customerName ?? "Customer",
        customerNote: row.customerNote ?? null,
        cancelReason: row.cancelReason ?? null,
        createdAt: new Date(row.createdAt).toISOString(),
      };
    });
}

/**
 * Recomputes a wallet from its ledger. `available` must equal credits minus debits; the dashboard
 * shows the result so a drift can never sit unnoticed, and the test suite asserts it after every
 * kind of movement.
 */
export async function reconcileAccount(businessId: string, accountId: string) {
  const rows = (await prisma.loyaltyPointsLedger
    .findMany({ where: { businessId, accountId }, take: 5000 })
    .catch(() => [] as any[])) as any[];
  const credits = rows.filter((row) => row.direction === "CREDIT").reduce((total, row) => total + Number(row.points ?? 0), 0);
  const debits = rows.filter((row) => row.direction === "DEBIT").reduce((total, row) => total + Number(row.points ?? 0), 0);
  const account = await prisma.loyaltyPointsAccount.findUnique({ where: { id: accountId } }).catch(() => null);
  const available = Number(account?.availablePoints ?? 0);
  return {
    entries: rows.length,
    credits,
    debits,
    ledgerBalance: credits - debits,
    available,
    reconciled: credits - debits === available,
  };
}

/** The wallet a customer sees. Card-code only: no contact values, no owner notes, no ids. */
export async function walletForCardCode(code: string) {
  const card = await prisma.loyaltyCard.findUnique({ where: { code } }).catch(() => null);
  if (!card) return null;
  const business = await prisma.business.findUnique({ where: { id: card.businessId } }).catch(() => null);
  if (!business) return null;
  const programme = await findProgramme(card.businessId);
  if (!programme || !programme.isActive) {
    return { businessName: business.name, businessSlug: business.slug, active: false as const };
  }
  const account = await prisma.loyaltyPointsAccount.findUnique({ where: { cardId: card.id } }).catch(() => null);
  const rewards = await listRewards(card.businessId);

  const ledger = account
    ? ((await prisma.loyaltyPointsLedger
        .findMany({ where: { accountId: account.id }, take: 1000 })
        .catch(() => [] as any[])) as any[])
    : [];
  const redemptions = account
    ? ((await prisma.loyaltyRewardRedemption
        .findMany({ where: { accountId: account.id }, take: 1000 })
        .catch(() => [] as any[])) as any[])
    : [];

  const available = Number(account?.availablePoints ?? 0);
  const nextExpiry = ledger
    .filter((row) => row.type === "EARNED" && row.expiresAt && Number(row.remainingPoints ?? 0) > 0)
    .map((row) => new Date(row.expiresAt).getTime())
    .sort((a, b) => a - b)[0];

  return {
    active: true as const,
    businessName: business.name,
    businessSlug: business.slug,
    customerName: card.customerName,
    availablePoints: available,
    lifetimeEarned: Number(account?.lifetimeEarned ?? 0),
    lifetimeRedeemed: Number(account?.lifetimeRedeemed ?? 0),
    lifetimeExpired: Number(account?.lifetimeExpired ?? 0),
    pointsPending: Number(account?.pointsPending ?? 0),
    status: account?.status ?? "ACTIVE",
    earning: {
      kesPerPoint: programme.kesPerPoint,
      pointsPerUnit: programme.pointsPerUnit,
      minPurchaseKES: programme.minPurchaseKES,
      expiryMonths: programme.expiryMonths,
      description: programme.description,
      terms: programme.terms,
      redemptionRules: programme.redemptionRules,
      minRedeemPoints: programme.minRedeemPoints,
      pointValueKES: programme.pointValueKES,
    },
    nextExpiryAt: nextExpiry ? new Date(nextExpiry).toISOString() : null,
    rewards: rewards.map((reward) => ({
      id: reward.id,
      title: reward.title,
      description: reward.description,
      kind: reward.kind,
      pointsCost: reward.pointsCost,
      discountKES: reward.discountKES,
      affordable: available >= reward.pointsCost,
    })),
    transactions: ledger
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 20)
      .map((row) => ({
        type: row.type,
        direction: row.direction,
        points: Number(row.points ?? 0),
        explanation: row.explanation ?? null,
        reference: row.reference,
        source: row.source,
        expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
        createdAt: new Date(row.createdAt).toISOString(),
      })),
    redemptions: redemptions
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 10)
      .map((row) => ({
        reference: row.reference,
        rewardTitle: row.rewardTitleSnapshot,
        pointsSpent: Number(row.pointsSpent ?? 0),
        status: row.status,
        createdAt: new Date(row.createdAt).toISOString(),
      })),
  };
}

/** Wallet for the owner's own screen — same numbers, plus the identifiers the owner needs. */
export async function walletForCard(businessId: string, cardId: string) {
  const account = await findAccount(businessId, cardId);
  if (!account) return null;
  const card = await prisma.loyaltyCard.findFirst({ where: { id: cardId, businessId } }).catch(() => null);
  if (!card) return null;
  const wallet = await walletForCardCode(card.code);
  if (!wallet || !("active" in wallet) || wallet.active !== true) return { account, card, wallet: null };
  const reconciliation = await reconcileAccount(businessId, account.id);
  return { account, card, wallet, reconciliation };
}

export async function walletHistory(businessId: string, cardId: string, take = 30) {
  const account = await findAccount(businessId, cardId);
  if (!account) return [];
  return listHubActivity(prisma, businessId, { subjectType: HUB_SUBJECTS.LOYALTY, subjectId: cardId, take });
}

// ───────────────────────────────────────────────────────────────────────────────────────────────

function isUniqueViolation(error: unknown): boolean {
  const code = (error as any)?.code;
  return code === "P2002" || String((error as any)?.message ?? "").includes("Unique constraint");
}

function addMonths(from: Date, months: number): Date {
  const next = new Date(from.getTime());
  const day = next.getUTCDate();
  next.setUTCMonth(next.getUTCMonth() + months);
  // A 31 January award with a one-month term expires at the end of February, not in March.
  if (next.getUTCDate() < day) next.setUTCDate(0);
  return next;
}
