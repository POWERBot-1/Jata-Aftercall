/**
 * Opaque keyset cursor for an agent's own referral report snapshots.
 *
 * The cursor is a position in the ordering (endExclusive desc, periodKey desc). It is never a tenant
 * or application selector: the route always scopes the query to the authenticated active agent first.
 * Decoding is strict and canonical, so a tampered, oversized or non-canonical value is rejected
 * before any database access.
 */
export type ReportCursor = { endExclusive: Date; periodKey: string };

const MAX_CURSOR_LENGTH = 256;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
// Mirrors AgentReferralReportSnapshot_period_check exactly: daily:YYYY-MM-DD or monthly:YYYY-MM.
const PERIOD_KEY = /^(daily:\d{4}-\d{2}-\d{2}|monthly:\d{4}-\d{2})$/;

export function encodeReportCursor(cursor: ReportCursor): string {
  return Buffer.from(
    JSON.stringify({ e: cursor.endExclusive.toISOString(), k: cursor.periodKey }),
    "utf8",
  ).toString("base64url");
}

export type DecodedReportCursor = { ok: true; cursor: ReportCursor | null } | { ok: false };

/** A missing cursor means the first page. A present but invalid cursor is refused, never ignored. */
export function decodeReportCursor(raw: string | null): DecodedReportCursor {
  if (raw === null) return { ok: true, cursor: null };
  if (raw.length === 0 || raw.length > MAX_CURSOR_LENGTH || !BASE64URL.test(raw)) return { ok: false };
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
  } catch {
    return { ok: false };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false };
  const keys = Object.keys(parsed).sort();
  if (keys.length !== 2 || keys[0] !== "e" || keys[1] !== "k") return { ok: false };
  const { e, k } = parsed as { e: unknown; k: unknown };
  if (typeof e !== "string" || typeof k !== "string" || !PERIOD_KEY.test(k)) return { ok: false };
  const endExclusive = new Date(e);
  // Canonical round trip: rejects alternative date spellings of the same instant.
  if (!Number.isFinite(endExclusive.getTime()) || endExclusive.toISOString() !== e) return { ok: false };
  const cursor = { endExclusive, periodKey: k };
  // Canonical round trip for the whole value: rejects extra whitespace or re-encoded variants.
  if (encodeReportCursor(cursor) !== raw) return { ok: false };
  return { ok: true, cursor };
}
