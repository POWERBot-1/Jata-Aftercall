/**
 * Explicit bounds for referral report revisions (ADMIN-023 §028).
 *
 * MAX_MEMBERS_PER_REVISION is the largest membership a single revision may hold. It is also
 * enforced in SQL by the baseline trigger (see migration 20261127000000_agent_referral_report_bounded_pages),
 * so the two values must change together. A revision above this cap is refused, never truncated.
 *
 * READ_PAGE_SIZE bounds the rows any single revision-read request materialises. Pages are keyset
 * pages over eventId; a page is returned with a nextCursor only when more members remain.
 *
 * RECONCILE_WRITE_CHUNK bounds the rows sent in one INSERT statement while a reconciled revision is
 * written inside its transaction. The write fence still applies to every chunk.
 *
 * READ_STATEMENT_TIMEOUT and RECONCILE_STATEMENT_TIMEOUT bound database time per request.
 */
export const MAX_MEMBERS_PER_REVISION = 50_000;
export const READ_PAGE_SIZE = 500;
export const RECONCILE_WRITE_CHUNK = 1_000;
export const READ_STATEMENT_TIMEOUT = "5s";
export const RECONCILE_STATEMENT_TIMEOUT = "10s";
/**
 * Whole-transaction budget for a reconciliation. Prisma interactive transactions default to 5,000 ms, which
 * expired during the write at 50,000 members (measured 2 Nov 2026, Prisma "Transaction already closed").
 * The statement timeout above bounds one statement only. Measured on the sandbox at 50,000 members: the full
 * reconciliation write took 5.8 s; 15 s leaves about 2.6x headroom. A timeout rolls the whole revision back.
 * Evidence: docs/agents/evidence/migration-20261127/scale-50k-timing.json.
 */
export const RECONCILE_TRANSACTION_TIMEOUT_MS = 15_000;
export const RECONCILE_TRANSACTION_MAX_WAIT_MS = 5_000;

if (!Number.isInteger(MAX_MEMBERS_PER_REVISION) || MAX_MEMBERS_PER_REVISION < READ_PAGE_SIZE) {
  throw new Error("Invalid referral report bounds");
}

/** Cursor is an opaque retained event id: 1-128 url-safe characters. */
export const EVENT_CURSOR_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
