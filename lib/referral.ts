/**
 * Stage 2 — self-service referral attribution.
 *
 * Flow: an existing owner shares `/r/<code>` → an unauthenticated recipient opens it
 * (server-side attribution row + httpOnly token cookie) → the recipient registers → the
 * referral row is converted **inside the registration transaction**, i.e. atomically with the
 * creation of the recipient's first business.
 *
 * Rules that must hold (pinned by tests):
 *  - Attribution is resolved and persisted server-side. Client analytics events are never the
 *    authoritative record and cannot create a referral on their own.
 *  - First-touch wins: an existing unconverted attribution is never overwritten by a later link.
 *  - Only an eligible referrer (existing, published, not suspended) can be attributed.
 *  - Referral state is never an input to publication or payment decisions.
 *  - Only opaque ids and public business data move through this module; no email, phone or
 *    token is ever rendered or returned to a browser.
 */

import crypto from "crypto";
import prisma from "./db";
import { getBaseUrl } from "./url";

export const REFERRAL_COOKIE_NAME = "jata_referral";
export const REFERRAL_ATTRIBUTION_DAYS = 30;
export const REFERRAL_CODE_LENGTH = 12;
export const REFERRAL_TOKEN_BYTES = 32;
const MAX_COOKIE_VALUE_LENGTH = 512;

// Crockford-style alphabet: no I, L, O, U (avoids accidental words and look-alike glyphs).
const CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const CODE_PATTERN = new RegExp(`^[0-9A-HJKMNP-TV-Z]{${REFERRAL_CODE_LENGTH}}$`);

export type ReferralRejectReason =
  | "no_attribution"
  | "code_malformed"
  | "attribution_invalid"
  | "attribution_expired"
  | "attribution_claimed"
  | "referrer_not_found"
  | "referrer_owner_missing"
  | "referrer_unpublished"
  | "referrer_suspended"
  | "referrer_mismatch"
  | "self_referral";

export type ReferralStatusValue = "PENDING" | "CONVERTED" | "REJECTED" | "EXPIRED";

export type ReferralRow = {
  id: string;
  code: string;
  referrerUserId: string;
  referrerBusinessId: string | null;
  referredUserId: string | null;
  referredBusinessId: string | null;
  status: ReferralStatusValue;
  tokenHash: string;
  rejectReason: string | null;
  expiresAt: Date;
  convertedAt: Date | null;
};

export type ReferrerSnapshot = {
  businessId: string;
  businessName: string;
  ownerId: string;
  ownerEmail: string | null;
  ownerPhone: string | null;
  isPublished: boolean;
  status: string;
};

// Note: a single object type (not a boolean-discriminated union) on purpose — this project
// compiles with `strict: false`, where TypeScript does not narrow boolean literal discriminants.
export type EligibilityResult = { eligible: boolean; reason: "ok" | ReferralRejectReason };

/**
 * Narrows an eligibility result to a concrete reject reason. Kept as a function so callers never
 * have to carry the union into a contextually-typed return value.
 */
export function rejectReason(result: EligibilityResult, fallback: ReferralRejectReason = "referrer_not_found"): ReferralRejectReason {
  return result.eligible ? fallback : (result.reason as ReferralRejectReason);
}

export type ReferralResolution =
  | { decision: "skip"; reason: ReferralRejectReason }
  | { decision: "reject"; reason: ReferralRejectReason; attributionId: string | null }
  | { decision: "convert"; attributionId: string; referrer: ReferrerSnapshot };

/* ── pure helpers ─────────────────────────────────────────────────────────── */

export function generateReferralCode(): string {
  const bytes = crypto.randomBytes(REFERRAL_CODE_LENGTH);
  let code = "";
  for (let i = 0; i < REFERRAL_CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** Accepts only the exact public code format. Anything else (tampered, padded, empty) is null. */
export function normalizeReferralCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim().toUpperCase();
  if (!CODE_PATTERN.test(candidate)) return null;
  return candidate;
}

export function isValidReferralCode(raw: unknown): boolean {
  return normalizeReferralCode(raw) !== null;
}

export function normalizeReferralToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const token = raw.trim();
  if (!token || token.length > MAX_COOKIE_VALUE_LENGTH) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(token)) return null;
  return token;
}

export function issueReferralToken(): string {
  return crypto.randomBytes(REFERRAL_TOKEN_BYTES).toString("base64url");
}

export function hashReferralToken(token: string): string {
  return crypto.createHash("sha256").update(`jata-referral-token:${token}`).digest("hex");
}

export function referralPath(code: string): string {
  return `/r/${code}`;
}

export function referralLink(code: string, baseUrl: string = getBaseUrl()): string {
  return `${baseUrl.replace(/\/$/, "")}${referralPath(code)}`;
}

export function attributionExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + REFERRAL_ATTRIBUTION_DAYS * 24 * 60 * 60 * 1000);
}

export function referralCookieOptions(maxAgeSeconds: number = REFERRAL_ATTRIBUTION_DAYS * 24 * 60 * 60) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

/** Reads the attribution token from a raw cookie header (works for Request objects in tests). */
export function readReferralCookie(req: Request): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() !== REFERRAL_COOKIE_NAME) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * Referrer eligibility. Evaluated server-side on every touch and again at claim time, so a
 * referrer that is unpublished or suspended afterwards can never be credited.
 */
export function isReferrerEligible(input: { referrer: ReferrerSnapshot | null; viewerId?: string | null }): EligibilityResult {
  const { referrer, viewerId } = input;
  if (!referrer) return { eligible: false, reason: "referrer_not_found" };
  if (!referrer.ownerId) return { eligible: false, reason: "referrer_owner_missing" };
  if (referrer.status === "SUSPENDED") return { eligible: false, reason: "referrer_suspended" };
  if (referrer.isPublished !== true) return { eligible: false, reason: "referrer_unpublished" };
  if (viewerId && viewerId === referrer.ownerId) return { eligible: false, reason: "self_referral" };
  return { eligible: true, reason: "ok" };
}

/** Only public business data may be shown to a recipient — never ids, emails, phones or tokens. */
export function publicReferralInvite(referrer: ReferrerSnapshot | null): { businessName: string } | null {
  if (!referrer) return null;
  const businessName = String(referrer.businessName || "").trim();
  return businessName ? { businessName } : null;
}

export function isAttributionClaimable(row: ReferralRow | null, now: Date = new Date()): EligibilityResult {
  if (!row) return { eligible: false, reason: "attribution_invalid" };
  if (row.status !== "PENDING") return { eligible: false, reason: "attribution_claimed" };
  if (row.expiresAt.getTime() <= now.getTime()) return { eligible: false, reason: "attribution_expired" };
  return { eligible: true, reason: "ok" };
}

function phoneDigits(phone: string | null | undefined): string {
  return String(phone || "").replace(/\D/g, "");
}

/**
 * Self-referral guard. The recipient is a brand-new user, so we cannot compare user ids with the
 * referrer; we compare the registering contact details with the referrer owner's.
 */
export function isSelfReferral(
  referrer: { ownerEmail?: string | null; ownerPhone?: string | null } | null,
  candidate: { email?: string | null; phone?: string | null },
): boolean {
  if (!referrer) return false;
  const referrerEmail = String(referrer.ownerEmail || "").trim().toLowerCase();
  const candidateEmail = String(candidate.email || "").trim().toLowerCase();
  if (referrerEmail && candidateEmail && referrerEmail === candidateEmail) return true;

  // Compare the national significant part (last 9 digits) so 0722123456, +254722123456 and
  // 254-722-123-456 all match. Very short values are ignored to avoid false positives.
  const referrerPhone = phoneDigits(referrer.ownerPhone);
  const candidatePhone = phoneDigits(candidate.phone);
  if (referrerPhone.length >= 9 && candidatePhone.length >= 9 && referrerPhone.slice(-9) === candidatePhone.slice(-9)) {
    return true;
  }
  return false;
}

function prismaErrorCode(error: unknown): string | undefined {
  return error && typeof error === "object" && "code" in error ? String((error as { code?: unknown }).code) : undefined;
}

/* ── database helpers ─────────────────────────────────────────────────────── */

export function toReferrerSnapshot(row: {
  id: string;
  name: string;
  ownerId: string;
  isPublished: boolean;
  status: string;
  owner?: { id?: string; email?: string | null; phone?: string | null } | null;
} | null): ReferrerSnapshot | null {
  if (!row) return null;
  return {
    businessId: row.id,
    businessName: row.name,
    ownerId: row.ownerId,
    ownerEmail: row.owner?.email ?? null,
    ownerPhone: row.owner?.phone ?? null,
    isPublished: row.isPublished === true,
    status: row.status,
  };
}

/** Resolve the referrer business (and its owner) for a public referral code. */
export async function resolveReferrerByCode(code: unknown): Promise<ReferrerSnapshot | null> {
  const normalized = normalizeReferralCode(code);
  if (!normalized) return null;
  try {
    const business = await prisma.business.findUnique({
      where: { referralCode: normalized },
      select: { id: true, name: true, ownerId: true, isPublished: true, status: true, owner: { select: { id: true, email: true, phone: true } } },
    });
    return toReferrerSnapshot(business);
  } catch {
    console.error("referral lookup failed");
    return null;
  }
}

/**
 * Mints a referral code for a business the first time it is eligible to share one.
 * Existing rows are not backfilled: the first eligible render/claim mints the code, so the
 * migration stays additive and no production data mutation is required.
 */
export async function ensureReferralCode(businessId: string): Promise<string | null> {
  if (!businessId) return null;
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, referralCode: true, isPublished: true, status: true, ownerId: true },
    });
    if (!business) return null;
    if (business.referralCode) return business.referralCode;
    if (!isReferrerEligible({ referrer: { businessId, businessName: "", ownerId: business.ownerId, ownerEmail: null, ownerPhone: null, isPublished: business.isPublished === true, status: business.status } }).eligible) {
      return null;
    }
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = generateReferralCode();
      try {
        const updated = await prisma.business.update({
          where: { id: businessId },
          data: { referralCode: code },
          select: { referralCode: true },
        });
        return updated.referralCode ?? null;
      } catch (error) {
        if (prismaErrorCode(error) === "P2002") continue;
        return null;
      }
    }
    return null;
  } catch {
    console.error("referral code minting failed");
    return null;
  }
}

export async function createReferralAttribution(input: {
  code: string;
  referrerUserId: string;
  referrerBusinessId: string | null;
  now?: Date;
}): Promise<{ row: ReferralRow; token: string } | null> {
  const now = input.now ?? new Date();
  const token = issueReferralToken();
  try {
    const row = await prisma.referral.create({
      data: {
        code: input.code,
        referrerUserId: input.referrerUserId,
        referrerBusinessId: input.referrerBusinessId,
        status: "PENDING",
        tokenHash: hashReferralToken(token),
        expiresAt: attributionExpiry(now),
      },
    });
    return { row: row as ReferralRow, token };
  } catch {
    console.error("referral attribution write failed");
    return null;
  }
}

/** Loads an unconverted, unexpired attribution for the presented cookie token. */
export async function findAttributionByToken(token: unknown, now: Date = new Date()): Promise<ReferralRow | null> {
  const normalized = normalizeReferralToken(token);
  if (!normalized) return null;
  try {
    const row = await prisma.referral.findUnique({ where: { tokenHash: hashReferralToken(normalized) } });
    if (!row) return null;
    if (!isAttributionClaimable(row as ReferralRow, now).eligible) return null;
    return row as ReferralRow;
  } catch {
    console.error("referral attribution lookup failed");
    return null;
  }
}

/**
 * Resolves the referral that a registration should be attributed to.
 * The cookie token (first touch) wins; a submitted public code is only used when no valid
 * attribution exists, and is resolved server-side before anything is recorded.
 */
export async function resolveReferralForRegistration(
  input: { code?: unknown; token?: unknown },
  now: Date = new Date(),
): Promise<ReferralResolution> {
  const token = normalizeReferralToken(input.token);
  if (token) {
    const row = await findAttributionByToken(token, now);
    if (row) {
      const referrer = row.referrerBusinessId ? await resolveReferrerByBusiness(row.referrerBusinessId) : null;
      const eligibility = isReferrerEligible({ referrer });
      if (!eligibility.eligible) return { decision: "reject", reason: rejectReason(eligibility), attributionId: row.id };
      if (!referrer) return { decision: "reject", reason: "referrer_not_found", attributionId: row.id };
      if (referrer.ownerId !== row.referrerUserId) {
        return { decision: "reject", reason: "referrer_mismatch", attributionId: row.id };
      }
      return { decision: "convert", attributionId: row.id, referrer };
    }
    const rawCode = normalizeReferralCode(input.code);
    if (!rawCode) return { decision: "skip", reason: normalizeReferralToken(token) ? "attribution_invalid" : "code_malformed" };
  }

  const code = normalizeReferralCode(input.code);
  if (!code) return { decision: "skip", reason: "no_attribution" };

  const referrer = await resolveReferrerByCode(code);
  const eligibility = isReferrerEligible({ referrer });
  if (!eligibility.eligible) {
    return { decision: "reject", reason: rejectReason(eligibility), attributionId: null };
  }
  if (!referrer) {
    return { decision: "reject", reason: "referrer_not_found", attributionId: null };
  }
  const created = await createReferralAttribution({
    code,
    referrerUserId: referrer.ownerId,
    referrerBusinessId: referrer.businessId,
    now,
  });
  if (!created) return { decision: "skip", reason: "no_attribution" };
  return { decision: "convert", attributionId: created.row.id, referrer };
}

export async function resolveReferrerByBusiness(businessId: string): Promise<ReferrerSnapshot | null> {
  if (!businessId) return null;
  try {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, name: true, ownerId: true, isPublished: true, status: true, owner: { select: { id: true, email: true, phone: true } } },
    });
    return toReferrerSnapshot(business);
  } catch {
    console.error("referrer business lookup failed");
    return null;
  }
}

export type ClaimTx = {
  referral?: {
    updateMany: (args: { where: Record<string, unknown>; data: Record<string, unknown> }) => Promise<{ count: number }>;
  };
};

export type ClaimResult = { recorded: boolean; reason?: ReferralRejectReason };

/**
 * Converts an attribution inside the caller's transaction so that referral recording and the
 * recipient's first business creation commit — or roll back — together.
 */
export async function claimReferralInTransaction(
  tx: ClaimTx,
  input: { attributionId: string; referredUserId: string; referredBusinessId: string; now?: Date },
): Promise<ClaimResult> {
  if (!tx?.referral?.updateMany) return { recorded: false, reason: "attribution_invalid" };
  const now = input.now ?? new Date();
  const result = await tx.referral.updateMany({
    where: { id: input.attributionId, status: "PENDING" },
    data: {
      status: "CONVERTED",
      referredUserId: input.referredUserId,
      referredBusinessId: input.referredBusinessId,
      convertedAt: now,
    },
  });
  // count === 0 means another claim won the race — first-touch wins, no duplicate attribution.
  return result.count === 1 ? { recorded: true } : { recorded: false, reason: "attribution_claimed" };
}

/** Records why a touch could not be credited. Same transaction, never blocks the registration. */
export async function rejectReferralInTransaction(
  tx: ClaimTx,
  input: { attributionId: string; reason: ReferralRejectReason },
): Promise<void> {
  if (!tx?.referral?.updateMany || !input.attributionId) return;
  await tx.referral.updateMany({
    where: { id: input.attributionId, status: "PENDING" },
    data: { status: "REJECTED", rejectReason: input.reason },
  });
}
