/**
 * BROWSER-ONLY replacement for `lib/team-access.ts`.
 *
 * `lib/ai-entitlement.ts`, `lib/experience/entitlement.ts`, `lib/pos/entitlement.ts` and
 * `lib/autopilot/entitlement.ts` are shared with client components. Their webpack CLIENT build
 * replaces the server entitlement module with this file (see next.config.js), so the authorised
 * allowlist, the audit queries and Node's `crypto` module can NEVER be emitted into a frontend
 * bundle. Every browser-side answer is therefore fail-closed; real decisions happen on the server.
 *
 * This file contains no phone numbers, no secrets and no database access.
 */

export const TEAM_FREE_ACCESS_LABEL = "JATA Team — Free Access";
export const TEAM_FREE_ACCESS_KEY = "JATA_TEAM_FREE_ACCESS";
export const AUTHORIZED_TEAM_PHONES: readonly string[] = Object.freeze([]);
// Audit action names are internal server vocabulary. The browser build gets empty strings: no
// client component needs them, and any accidental use fails closed instead of echoing a grant.
export const TEAM_AUDIT_ACTIONS = Object.freeze({
  VERIFICATION_STARTED: "",
  VERIFICATION_FAILED: "",
  PHONE_VERIFIED: "",
  ACCESS_GRANTED: "",
  ACCESS_REVOKED: "",
});

export type TeamAccessEvent = { action: string; createdAt: Date | string | number; metadata?: Record<string, unknown> | null };
export type TeamAccessDecision = { entitled: boolean; label: string | null; reason: string };
export type TeamAccessAuditEntry = { action: string; userId: string; actorId: string | null; at: string };
export type VerificationStartResult = { ok: false; error: string; status: number } | { ok: true; challengeId: string; code: string; expiresAt: string; maskedPhone: string };
export type VerificationSubmitResult = { ok: boolean; status: number; error?: string; entitled?: boolean };

const denied: TeamAccessDecision = { entitled: false, label: null, reason: "CLIENT" };

export function normalizeTeamPhone(): string | null { return null; }
export function isAuthorizedTeamPhone(): boolean { return false; }
export function teamPhoneFingerprint(): string { return ""; }
export function deriveTeamFreeAccess(): TeamAccessDecision { return denied; }
export async function getTeamAccessStatus(): Promise<TeamAccessDecision> { return denied; }
export async function hasTeamFreeAccessForBusiness(): Promise<boolean> { return false; }
export async function getRecentTeamAccessEvents(): Promise<TeamAccessAuditEntry[]> { return []; }
export async function startTeamPhoneVerification(): Promise<VerificationStartResult> { return { ok: false, status: 403, error: "Server-only operation." }; }
export async function verifyTeamPhoneCode(): Promise<VerificationSubmitResult> { return { ok: false, status: 403, error: "Server-only operation." }; }
export async function revokeTeamAccess(): Promise<{ ok: boolean; status: number; error?: string }> { return { ok: false, status: 403, error: "Server-only operation." }; }
