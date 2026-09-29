import crypto from "crypto";

/** Client-generated onboarding draft keys are random UUIDs. Anything else is ignored. */
const DRAFT_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidDraftKey(value: unknown): value is string {
  return typeof value === "string" && DRAFT_KEY_PATTERN.test(value);
}

/**
 * Deterministic, server-derived business id for an onboarding draft.
 * The id is scoped to the signed-in owner (the user id is part of the hash), so a
 * retried or duplicated "create business" request for the same draft maps to the same
 * primary key and the database's primary-key constraint makes a duplicate impossible,
 * even for concurrent requests. A client cannot target another owner's business,
 * because it never controls the user id half of the input.
 */
export function deriveDraftBusinessId(userId: string, draftKey: string): string {
  const digest = crypto.createHash("sha256").update(`jata-onboarding-draft:${userId}:${draftKey.toLowerCase()}`).digest("hex");
  return `d${digest.slice(0, 24)}`;
}
