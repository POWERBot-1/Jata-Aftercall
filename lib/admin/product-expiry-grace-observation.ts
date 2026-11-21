export type LifecycleProduct =
  | "BUSINESS_PAGE"
  | "WEBSITE_STUDIO"
  | "AI_FRONT_DESK"
  | "BUSINESS_POS"
  | "AUTOPILOT"
  | "MJENGO_OS"
  | "ERP_PRO";

export type LifecycleExpiryEvidence = {
  product: LifecycleProduct;
  businessId: string;
  subscriptionId: string;
  status: string;
  expiresAt: Date | string | null;
  graceUntil: Date | string | null;
};

export type ExpiryObservationState =
  | "CURRENT"
  | "GRACE"
  | "EXPIRED"
  | "GRACE_POLICY_UNKNOWN"
  | "INVALID_GRACE_WINDOW"
  | "INACTIVE"
  | "NO_EXPIRY";

export type ExpiryObservation = LifecycleExpiryEvidence & {
  state: ExpiryObservationState;
  observedAt: string;
  effectiveExpiryAt: string | null;
  reason: string;
};

const BILLABLE_STATES = new Set(["ACTIVE", "EXPIRING", "PAST_DUE"]);

function validDate(value: Date | string | null): Date | null {
  if (value === null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Read-only lifecycle observation. It deliberately does not infer a grace duration:
 * products have different historical grace contracts, and a missing graceUntil is
 * evidence of an unknown policy, not permission to invent a deadline.
 */
export function observeSubscriptionExpiry(
  evidence: LifecycleExpiryEvidence,
  now: Date = new Date(),
): ExpiryObservation {
  const expiresAt = validDate(evidence.expiresAt);
  const graceUntil = validDate(evidence.graceUntil);
  const base = {
    ...evidence,
    observedAt: now.toISOString(),
    effectiveExpiryAt: graceUntil?.toISOString() ?? expiresAt?.toISOString() ?? null,
  };

  if (!BILLABLE_STATES.has(evidence.status.toUpperCase())) {
    return { ...base, state: "INACTIVE", reason: "Subscription status is not in an active billing lifecycle." };
  }
  if (evidence.expiresAt !== null && !expiresAt) {
    return { ...base, state: "INVALID_GRACE_WINDOW", reason: "Stored expiry timestamp is invalid; no lifecycle action is safe." };
  }
  if (!expiresAt) {
    return { ...base, state: "NO_EXPIRY", reason: "No expiry timestamp is recorded; retain access decision at the product gate." };
  }
  if (graceUntil && graceUntil.getTime() < expiresAt.getTime()) {
    return { ...base, state: "INVALID_GRACE_WINDOW", reason: "Grace deadline precedes the subscription expiry; policy requires review." };
  }
  if (now.getTime() < expiresAt.getTime()) {
    return { ...base, state: "CURRENT", reason: "Subscription period has not reached its recorded expiry." };
  }
  if (!graceUntil) {
    return { ...base, state: "GRACE_POLICY_UNKNOWN", reason: "Subscription expiry has passed but no explicit grace deadline is recorded." };
  }
  if (now.getTime() < graceUntil.getTime()) {
    return { ...base, state: "GRACE", reason: "Subscription is inside its explicitly recorded grace window." };
  }
  return { ...base, state: "EXPIRED", reason: "The explicitly recorded grace deadline has elapsed." };
}

export function summarizeSubscriptionExpiry(
  rows: LifecycleExpiryEvidence[],
  now: Date = new Date(),
) {
  const observations = rows.map((row) => observeSubscriptionExpiry(row, now));
  const counts = observations.reduce<Record<ExpiryObservationState, number>>((result, item) => {
    result[item.state] += 1;
    return result;
  }, {
    CURRENT: 0,
    GRACE: 0,
    EXPIRED: 0,
    GRACE_POLICY_UNKNOWN: 0,
    INVALID_GRACE_WINDOW: 0,
    INACTIVE: 0,
    NO_EXPIRY: 0,
  });
  return { observedAt: now.toISOString(), total: observations.length, counts, observations };
}
