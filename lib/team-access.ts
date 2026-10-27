/**
 * JATA_TEAM_FREE_ACCESS — server-side entitlement (owner directive 2026-10-27 Phase 5).
 *
 * Design (uses the EXISTING subscription/entitlement architecture; no second billing engine):
 *  • The allowlist lives in this server module only. It is never returned by an API, never put
 *    in a cookie/JWT claim and never imported by a client component (pinned by a test).
 *  • A user's editable `User.phone` is NEVER sufficient. The account must hold an append-only
 *    `AuditEvent` chain proving (1) a trusted server-side phone verification and (2) a grant.
 *    The proof is bound to a KEYED FINGERPRINT of the normalised phone at verification time, so
 *    editing a profile number cannot transfer or create the entitlement.
 *  • Verification uses a one-time code generated server-side, stored ONLY as a salted hash in
 *    the audit log, rate-limited and attempt-limited. An ADMIN starts it and delivers the code
 *    to the team member out-of-band (phone/WhatsApp); the team member submits it while signed
 *    in. No SMS provider credential is required, and no public endpoint can mint a grant.
 *  • Grants/revocations are append-only audit events. Revocation wins and never deletes history,
 *    payments, subscriptions or invoices. No fake payment row is ever created.
 *  • Every database failure is FAIL-CLOSED: no team access.
 *
 * This module is server-only. Client components consume the single boolean through their own
 * server-rendered props / `/api/account/team-access`.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import prisma from "./db";
import { writeAuditEvent } from "./audit";
import { normalizeKePhone } from "./phone";
import { requestCache } from "./request-cache";

export const TEAM_FREE_ACCESS_LABEL = "JATA Team — Free Access";
export const TEAM_FREE_ACCESS_KEY = "JATA_TEAM_FREE_ACCESS";

/** Server-side allowlist. Only normalised E.164-like digits are compared. */
export const AUTHORIZED_TEAM_PHONES: readonly string[] = Object.freeze([
  "254724317010", // 0724317010
  "254721359955", // 0721359955
  "254727935449", // 0727935449
]);

const AUDIT_TARGET = "USER";
/**
 * Kept local (and mirrored verbatim in `AUDIT_ACTIONS`) so a test that mocks only `logAudit`
 * cannot accidentally change the meaning of an action string. Fixed server-side names.
 */
export const TEAM_AUDIT_ACTIONS = Object.freeze({
  VERIFICATION_STARTED: "JATA_TEAM_PHONE_VERIFICATION_STARTED",
  VERIFICATION_FAILED: "JATA_TEAM_PHONE_VERIFICATION_FAILED",
  PHONE_VERIFIED: "JATA_TEAM_PHONE_VERIFIED",
  ACCESS_GRANTED: "JATA_TEAM_FREE_ACCESS_GRANTED",
  ACCESS_REVOKED: "JATA_TEAM_FREE_ACCESS_REVOKED",
} as const);
const ALL_TEAM_ACTIONS: readonly string[] = Object.values(TEAM_AUDIT_ACTIONS);

const VERIFICATION_TTL_MS = 10 * 60 * 1000;
const MAX_VERIFICATION_ATTEMPTS = 5;

export type TeamAccessEvent = {
  action: string;
  createdAt: Date | string | number;
  metadata?: Record<string, unknown> | null;
};

export type TeamAccessDecision = {
  entitled: boolean;
  label: string | null;
  reason: "NOT_ALLOWLISTED" | "NO_PHONE" | "NO_GRANT" | "REVOKED" | "PHONE_CHANGED" | "UNVERIFIED" | "ACTIVE";
};

export function normalizeTeamPhone(input: string | null | undefined): string | null {
  return normalizeKePhone(input);
}

export function isAuthorizedTeamPhone(input: string | null | undefined): boolean {
  const normalized = normalizeTeamPhone(input);
  return Boolean(normalized && AUTHORIZED_TEAM_PHONES.includes(normalized));
}

/** A keyed fingerprint: a stolen audit row alone cannot be replayed against another deployment. */
export function teamPhoneFingerprint(normalizedPhone: string, secret: string): string {
  return createHmac("sha256", secret).update(`jata-team-phone:${normalizedPhone}`).digest("hex");
}

function timeOf(event: TeamAccessEvent): number {
  const raw = event.createdAt;
  const value = raw instanceof Date ? raw.getTime() : typeof raw === "number" ? raw : Date.parse(String(raw));
  return Number.isFinite(value) ? value : 0;
}

/**
 * PURE decision function. `events` are the account's own audit events, already loaded by the
 * server. Sorted newest-first here, so a caller cannot accidentally pass a helpful ordering.
 * A grant is honoured only when a matching trusted verification exists at or before the grant,
 * the current phone fingerprint still matches, and no later revocation exists.
 */
export function deriveTeamFreeAccess(input: {
  phone: string | null | undefined;
  fingerprint: string;
  events: readonly TeamAccessEvent[];
}): TeamAccessDecision {
  const normalized = normalizeTeamPhone(input.phone);
  if (!normalized || !isAuthorizedTeamPhone(normalized)) {
    return { entitled: false, label: null, reason: "NOT_ALLOWLISTED" };
  }
  if (!input.fingerprint) return { entitled: false, label: null, reason: "UNVERIFIED" };

  const revokePriority = (event: TeamAccessEvent) => event.action === TEAM_AUDIT_ACTIONS.ACCESS_REVOKED ? 1 : 0;
  // Audit rows share millisecond precision; a revocation MUST win a tie with a grant.
  const events = [...input.events].sort((a, b) => timeOf(b) - timeOf(a) || revokePriority(b) - revokePriority(a));
  const terminal = events.find(
    (event) => event.action === TEAM_AUDIT_ACTIONS.ACCESS_GRANTED || event.action === TEAM_AUDIT_ACTIONS.ACCESS_REVOKED,
  );
  if (!terminal) return { entitled: false, label: null, reason: "NO_GRANT" };
  if (terminal.action === TEAM_AUDIT_ACTIONS.ACCESS_REVOKED) {
    return { entitled: false, label: null, reason: "REVOKED" };
  }

  const grantFingerprint = terminal.metadata?.phoneFingerprint;
  if (typeof grantFingerprint !== "string" || grantFingerprint !== input.fingerprint) {
    return { entitled: false, label: null, reason: "PHONE_CHANGED" };
  }

  const grantTime = timeOf(terminal);
  const verification = events.find((event) =>
    event.action === TEAM_AUDIT_ACTIONS.PHONE_VERIFIED &&
    timeOf(event) <= grantTime &&
    event.metadata?.phoneFingerprint === input.fingerprint &&
    typeof event.metadata?.challengeId === "string",
  );
  if (!verification) return { entitled: false, label: null, reason: "UNVERIFIED" };

  return { entitled: true, label: TEAM_FREE_ACCESS_LABEL, reason: "ACTIVE" };
}

function auditSecret(): string {
  return String(process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || "");
}

function currentFingerprint(phone: string | null | undefined): string {
  const normalized = normalizeTeamPhone(phone);
  const secret = auditSecret();
  if (!normalized || !secret) return "";
  return teamPhoneFingerprint(normalized, secret);
}

function parseMetadata(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function readTeamEvents(userId: string): Promise<TeamAccessEvent[]> {
  const rows = await prisma.auditEvent.findMany({
    where: { targetType: AUDIT_TARGET, targetId: userId, action: { in: [...ALL_TEAM_ACTIONS] } },
    orderBy: { createdAt: "desc" },
    take: 100,
    select: { action: true, createdAt: true, metadata: true },
  });
  return (rows || []).map((row) => ({ action: row.action, createdAt: row.createdAt, metadata: parseMetadata(row.metadata) }));
}

/** Server-side read for one authenticated account. Never trusts a request-supplied identifier. */
export async function getTeamAccessStatus(userId: string): Promise<TeamAccessDecision> {
  if (!userId) return { entitled: false, label: null, reason: "NO_PHONE" };
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!user) return { entitled: false, label: null, reason: "NO_PHONE" };
    const fingerprint = currentFingerprint(user.phone);
    if (!fingerprint || !isAuthorizedTeamPhone(user.phone)) {
      return { entitled: false, label: null, reason: "NOT_ALLOWLISTED" };
    }
    const events = await readTeamEvents(userId);
    return deriveTeamFreeAccess({ phone: user.phone, fingerprint, events });
  } catch {
    return { entitled: false, label: null, reason: "UNVERIFIED" };
  }
}

/**
 * Business-level helper used by all product entitlement getters. Team access follows the BUSINESS
 * OWNER, never a browser parameter, never a business member and never an arbitrary phone field.
 * Tenant isolation is unchanged: callers still resolve the business id from an authenticated
 * session/membership before calling this.
 */
export const hasTeamFreeAccessForBusiness = requestCache(async (businessId: string): Promise<boolean> => {
  if (!businessId) return false;
  try {
    const business = await prisma.business.findUnique({ where: { id: businessId }, select: { ownerId: true } });
    if (!business?.ownerId) return false;
    return (await getTeamAccessStatus(business.ownerId)).entitled;
  } catch {
    return false;
  }
});

function codeHash(userId: string, challengeId: string, code: string): string {
  return createHash("sha256")
    .update(`${auditSecret()}:${userId}:${challengeId}:${code}`)
    .digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  if (!/^[a-f0-9]{64}$/.test(a) || !/^[a-f0-9]{64}$/.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export type VerificationStartResult =
  | { ok: false; error: string; status: number }
  | { ok: true; challengeId: string; code: string; expiresAt: string; maskedPhone: string };

/** ADMIN-only caller (authorisation is enforced again in the route). Generates a short-lived OTP. */
export async function startTeamPhoneVerification(adminId: string, userId: string): Promise<VerificationStartResult> {
  if (!adminId || !userId) return { ok: false, status: 400, error: "An account is required." };
  let user: { phone: string | null } | null;
  try {
    user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
  } catch {
    return { ok: false, status: 503, error: "We could not read that account. Try again later." };
  }
  if (!user) return { ok: false, status: 404, error: "We couldn't find that account." };
  if (!isAuthorizedTeamPhone(user.phone)) {
    return { ok: false, status: 403, error: "That account's verified phone is not on the team allowlist." };
  }
  const fingerprint = currentFingerprint(user.phone);
  if (!fingerprint) return { ok: false, status: 503, error: "Server verification is not configured." };

  const challengeId = randomBytes(16).toString("hex");
  const code = String(100000 + (parseInt(randomBytes(4).toString("hex"), 16) % 900000));
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
  const written = await writeAuditEvent({
    actorId: adminId,
    action: TEAM_AUDIT_ACTIONS.VERIFICATION_STARTED,
    targetType: AUDIT_TARGET,
    targetId: userId,
    metadata: {
      challengeId,
      codeHash: codeHash(userId, challengeId, code),
      phoneFingerprint: fingerprint,
      expiresAt,
      attemptLimit: MAX_VERIFICATION_ATTEMPTS,
      delivery: "ADMIN_OUT_OF_BAND",
    },
  });
  if (!written) return { ok: false, status: 503, error: "Could not record the verification. Try again later." };
  const normalized = normalizeTeamPhone(user.phone) || "";
  return {
    ok: true,
    challengeId,
    code,
    expiresAt,
    maskedPhone: `+${normalized.slice(0, 3)}•••••${normalized.slice(-3)}`,
  };
}

export type VerificationSubmitResult = { ok: boolean; status: number; error?: string; entitled?: boolean };

/** Called only by the signed-in account itself. Never accepts a phone, userId or entitlement flag. */
export async function verifyTeamPhoneCode(userId: string, submittedCode: unknown): Promise<VerificationSubmitResult> {
  if (!userId) return { ok: false, status: 401, error: "Please sign in." };
  if (typeof submittedCode !== "string" || !/^\d{6}$/.test(submittedCode.trim())) {
    return { ok: false, status: 400, error: "Enter the six-digit verification code." };
  }
  let user: { phone: string | null } | null;
  let events: TeamAccessEvent[];
  try {
    user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    events = await readTeamEvents(userId);
  } catch {
    return { ok: false, status: 503, error: "We could not verify that code. Try again later." };
  }
  if (!user || !isAuthorizedTeamPhone(user.phone)) {
    return { ok: false, status: 403, error: "This account is not eligible for team access." };
  }
  const fingerprint = currentFingerprint(user.phone);
  const expiryOf = (event: TeamAccessEvent) => {
    const raw = event.metadata?.expiresAt;
    const parsed = typeof raw === "string" ? Date.parse(raw) : 0;
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const challenges = [...events]
    .filter((event) => event.action === TEAM_AUDIT_ACTIONS.VERIFICATION_STARTED && event.metadata?.phoneFingerprint === fingerprint)
    // expiresAt is monotonic with issuance, so it breaks millisecond ties deterministically.
    .sort((a, b) => timeOf(b) - timeOf(a) || expiryOf(b) - expiryOf(a));
  const challenge = challenges[0];
  const challengeId = challenge?.metadata?.challengeId;
  const expectedHash = challenge?.metadata?.codeHash;
  const expiresAt = typeof challenge?.metadata?.expiresAt === "string" ? Date.parse(challenge.metadata.expiresAt) : 0;
  if (!challenge || typeof challengeId !== "string" || typeof expectedHash !== "string" || !Number.isFinite(expiresAt)) {
    return { ok: false, status: 400, error: "No active verification was found. Ask an administrator to start one." };
  }
  if (Date.now() > expiresAt) {
    return { ok: false, status: 400, error: "That verification code expired. Ask an administrator to start a new one." };
  }
  const failedAttempts = events.filter(
    (event) => event.action === TEAM_AUDIT_ACTIONS.VERIFICATION_FAILED && event.metadata?.challengeId === challengeId,
  ).length;
  if (failedAttempts >= MAX_VERIFICATION_ATTEMPTS) {
    return { ok: false, status: 429, error: "Too many incorrect codes. Ask an administrator to start a new verification." };
  }
  if (!safeEqualHex(codeHash(userId, challengeId, submittedCode.trim()), expectedHash)) {
    await writeAuditEvent({
      actorId: userId,
      action: TEAM_AUDIT_ACTIONS.VERIFICATION_FAILED,
      targetType: AUDIT_TARGET,
      targetId: userId,
      metadata: { challengeId, attempt: failedAttempts + 1 },
    });
    return { ok: false, status: 400, error: "That code is not correct." };
  }

  const verified = await writeAuditEvent({
    actorId: userId,
    action: TEAM_AUDIT_ACTIONS.PHONE_VERIFIED,
    targetType: AUDIT_TARGET,
    targetId: userId,
    metadata: { challengeId, phoneFingerprint: fingerprint, method: "ADMIN_DELIVERED_OTP", verifiedAt: new Date().toISOString() },
  });
  const granted = verified && await writeAuditEvent({
    actorId: userId,
    action: TEAM_AUDIT_ACTIONS.ACCESS_GRANTED,
    targetType: AUDIT_TARGET,
    targetId: userId,
    metadata: { challengeId, phoneFingerprint: fingerprint, entitlement: TEAM_FREE_ACCESS_KEY, label: TEAM_FREE_ACCESS_LABEL },
  });
  if (!verified || !granted) {
    return { ok: false, status: 503, error: "Verification could not be recorded. No access was granted." };
  }
  return { ok: true, status: 200, entitled: true };
}

export type TeamAccessAuditEntry = { action: string; userId: string; actorId: string | null; at: string };

/** Append-only grant/revocation history for the admin console. No phone number is returned. */
export async function getRecentTeamAccessEvents(limit = 20): Promise<TeamAccessAuditEntry[]> {
  try {
    const rows = await prisma.auditEvent.findMany({
      where: { targetType: AUDIT_TARGET, action: { in: [TEAM_AUDIT_ACTIONS.ACCESS_GRANTED, TEAM_AUDIT_ACTIONS.ACCESS_REVOKED] } },
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.min(100, limit)),
      select: { action: true, targetId: true, actorId: true, createdAt: true },
    });
    return (rows || []).map((row) => ({
      action: row.action,
      userId: String(row.targetId || ""),
      actorId: row.actorId ?? null,
      at: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    }));
  } catch {
    return [];
  }
}

/** ADMIN-only caller. Append-only revocation; billing history is untouched. */
export async function revokeTeamAccess(adminId: string, userId: string): Promise<{ ok: boolean; status: number; error?: string }> {
  if (!adminId || !userId) return { ok: false, status: 400, error: "An account is required." };
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return { ok: false, status: 404, error: "We couldn't find that account." };
  } catch {
    return { ok: false, status: 503, error: "We could not read that account." };
  }
  const written = await writeAuditEvent({
    actorId: adminId,
    action: TEAM_AUDIT_ACTIONS.ACCESS_REVOKED,
    targetType: AUDIT_TARGET,
    targetId: userId,
    metadata: { entitlement: TEAM_FREE_ACCESS_KEY, reason: "ADMIN_REVOCATION" },
  });
  return written
    ? { ok: true, status: 200 }
    : { ok: false, status: 503, error: "Revocation could not be recorded. No access changed." };
}
