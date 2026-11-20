/**
 * Pure commission policy evaluator. This module does not read payments, approve policies, write
 * ledgers, send messages, or initiate payouts. Its input must eventually be assembled exclusively
 * from authoritative server-side records; a browser-supplied snapshot is never payment evidence.
 *
 * No policy or rate is shipped with the product. No production integration currently invokes
 * this evaluator. Tests use explicit hypothetical rules, not approved financial terms.
 */
import { isProviderTransactionId } from "@/lib/paymentVerification";

export type CommissionPolicyGovernance = {
  attribution: { precedence: string; windowDays: number; renewalTreatment: string; correctionTreatment: string; consentRequired: boolean };
  amountTreatment: { taxTreatment: string; discountTreatment: string; feeTreatment: string };
  recurrence: { newSale: string; renewal: string; upgrade: string };
  reversals: { fullRefund: string; partialRefund: string; chargeback: string; disputeResolution: string; maxDays: number };
  caps: { perPaymentMinor: number | null; perAgentPeriodMinor: number | null; period: string };
  payout: { schedule: string; method: string; minimumMinor: number; holdDays: number };
  hierarchy: { enabled: boolean; compensation: string; maxLevels: number };
  privacy: { retentionDays: number; legalHold: string };
};

export type CommissionPolicySnapshot = {
  id: string;
  version: string;
  approval: "DRAFT" | "APPROVED" | "REVOKED";
  effectiveFrom: Date;
  effectiveUntil: Date | null; // exclusive
  currency: "KES";
  eligiblePlanIds: readonly string[];
  eligibleEvents: readonly ("NEW_SALE" | "RENEWAL" | "UPGRADE")[];
  basis: "GROSS" | "NET";
  rule: { kind: "FIXED"; minorUnits: number } | { kind: "PERCENTAGE"; basisPoints: number; rounding: "HALF_UP" | "DOWN" };
  /** Every non-calculation term must be explicit before a policy can be evaluated. */
  governance: CommissionPolicyGovernance;
};

export type CommissionPaymentSnapshot = {
  id: string;
  reference: string;
  status: string;
  purpose: string;
  paystackId: string | null;
  /** Must be derived from authenticated provider mode, never browser input. */
  isTestMode: boolean;
  /** Must be derived from authoritative subscription/payment history. */
  isFirstSettledPaymentForSubscription: boolean;
  currency: string;
  amountMinor: number;
  businessId: string | null;
  customerId: string;
  planId: string | null;
  verifiedAt: Date;
  event: "NEW_SALE" | "RENEWAL" | "UPGRADE";
};

export type CommissionAttributionSnapshot = {
  agentId: string;
  agentUserId: string;
  agentStatus: string;
  businessId: string;
  customerId: string;
  /** Timestamp of the first valid recorded referral interaction. */
  validFrom: Date;
  validUntil: Date | null; // exclusive
  /** Must be derived from the persisted attribution history. */
  isFirstTouch: boolean;
};

export type CommissionEvaluation =
  | { eligible: false; reason: string }
  | { eligible: true; paymentId: string; paymentReference: string; policyId: string; policyVersion: string; agentId: string; businessId: string; customerId: string; planId: string; currency: "KES"; paymentMinor: number; eligibleMinor: number; commissionMinor: number; calculation: CommissionPolicySnapshot["rule"] };

function validDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}
function validMinor(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
function nonempty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 255;
}
function completeGovernance(value: unknown): value is CommissionPolicyGovernance {
  if (!value || typeof value !== "object") return false;
  const governance = value as Partial<CommissionPolicyGovernance>;
  const strings = [
    governance.attribution?.precedence,
    governance.attribution?.renewalTreatment,
    governance.attribution?.correctionTreatment,
    governance.amountTreatment?.taxTreatment,
    governance.amountTreatment?.discountTreatment,
    governance.amountTreatment?.feeTreatment,
    governance.recurrence?.newSale,
    governance.recurrence?.renewal,
    governance.recurrence?.upgrade,
    governance.reversals?.fullRefund,
    governance.reversals?.partialRefund,
    governance.reversals?.chargeback,
    governance.reversals?.disputeResolution,
    governance.caps?.period,
    governance.payout?.schedule,
    governance.payout?.method,
    governance.hierarchy?.compensation,
    governance.privacy?.legalHold,
  ];
  const integers = [
    governance.attribution?.windowDays,
    governance.reversals?.maxDays,
    governance.payout?.minimumMinor,
    governance.payout?.holdDays,
    governance.hierarchy?.maxLevels,
    governance.privacy?.retentionDays,
  ];
  const validCap = (amount: number | null | undefined) => amount === null || validMinor(amount);
  return strings.every(nonempty) &&
    integers.every(validMinor) &&
    typeof governance.attribution?.consentRequired === "boolean" &&
    typeof governance.hierarchy?.enabled === "boolean" &&
    validCap(governance.caps?.perPaymentMinor) &&
    validCap(governance.caps?.perAgentPeriodMinor);
}

/**
 * `eligibleMinor` is the owner-defined net base after recurring discounts and excluding separately
 * itemized tax and provider fees. This pure evaluator cannot prove the provenance of that amount;
 * callers must derive it from authoritative server-side payment and refund records. No numeric rate
 * schedule is approved and this evaluator is not a production accrual writer.
 */
export function evaluateCommission(input: {
  policy: CommissionPolicySnapshot | null;
  payment: CommissionPaymentSnapshot;
  attribution: CommissionAttributionSnapshot | null;
  eligibleMinor: number;
}): CommissionEvaluation {
  const { policy, payment, attribution, eligibleMinor } = input;
  if (!policy || policy.approval !== "APPROVED") return { eligible: false, reason: "POLICY_NOT_APPROVED" };
  if (!completeGovernance(policy.governance)) return { eligible: false, reason: "POLICY_INCOMPLETE" };
  // Enforce the owner's adopted initial policy boundary even if a future caller supplies a
  // syntactically complete but broader policy snapshot. This is a calculation guard, not an
  // accrual writer or approval of any numeric rate.
  const governance = policy.governance;
  if (
    policy.basis !== "NET" ||
    !Array.isArray(policy.eligibleEvents) ||
    policy.eligibleEvents.length !== 1 ||
    policy.eligibleEvents[0] !== "NEW_SALE" ||
    governance.attribution.precedence !== "FIRST_TOUCH" ||
    governance.attribution.windowDays !== 30 ||
    governance.recurrence.newSale !== "FIRST_SETTLED_NON_TEST_PAYMENT" ||
    governance.recurrence.renewal !== "NOT_COMMISSIONABLE" ||
    governance.recurrence.upgrade !== "NOT_COMMISSIONABLE" ||
    governance.amountTreatment.taxTreatment !== "EXCLUDE_SEPARATELY_ITEMIZED_TAX" ||
    governance.amountTreatment.discountTreatment !== "AFTER_RECURRING_DISCOUNTS" ||
    governance.amountTreatment.feeTreatment !== "EXCLUDE_PROVIDER_FEES" ||
    governance.hierarchy.enabled !== false
  ) return { eligible: false, reason: "POLICY_OUTSIDE_OWNER_BOUNDARY" };
  if (!nonempty(policy.id) || !nonempty(policy.version) || !validDate(policy.effectiveFrom) ||
      (policy.effectiveUntil !== null && (!validDate(policy.effectiveUntil) || policy.effectiveUntil <= policy.effectiveFrom)) ||
      !Array.isArray(policy.eligiblePlanIds) || !Array.isArray(policy.eligibleEvents) || policy.currency !== "KES") {
    return { eligible: false, reason: "POLICY_INVALID" };
  }
  if (!nonempty(payment.id) || !nonempty(payment.reference) || !nonempty(payment.customerId) ||
      !nonempty(payment.businessId) || !nonempty(payment.planId) || !validDate(payment.verifiedAt) ||
      !validMinor(payment.amountMinor) || payment.amountMinor === 0 || !validMinor(eligibleMinor) ||
      typeof payment.isTestMode !== "boolean" || typeof payment.isFirstSettledPaymentForSubscription !== "boolean") {
    return { eligible: false, reason: "PAYMENT_INVALID" };
  }
  if (payment.status !== "PAID" || payment.purpose !== "SUBSCRIPTION" || payment.isTestMode ||
      !payment.isFirstSettledPaymentForSubscription || !isProviderTransactionId(payment.paystackId)) {
    return { eligible: false, reason: "PAYMENT_NOT_VERIFIED" };
  }
  // The owner-boundary guard above narrows the policy basis to NET before this point.
  if (payment.currency !== policy.currency || eligibleMinor > payment.amountMinor) {
    return { eligible: false, reason: "BASIS_INVALID" };
  }
  if (payment.verifiedAt < policy.effectiveFrom || (policy.effectiveUntil && payment.verifiedAt >= policy.effectiveUntil)) {
    return { eligible: false, reason: "POLICY_NOT_EFFECTIVE" };
  }
  if (!policy.eligiblePlanIds.includes(payment.planId) || !policy.eligibleEvents.includes(payment.event)) {
    return { eligible: false, reason: "PAYMENT_NOT_ELIGIBLE" };
  }
  if (!attribution || !nonempty(attribution.agentId) || !nonempty(attribution.agentUserId) ||
      !validDate(attribution.validFrom) || typeof attribution.isFirstTouch !== "boolean" ||
      (attribution.validUntil !== null &&
        (!validDate(attribution.validUntil) || attribution.validUntil <= attribution.validFrom))) {
    return { eligible: false, reason: "ATTRIBUTION_INVALID" };
  }
  if (!attribution.isFirstTouch || attribution.agentStatus !== "ACTIVE" || attribution.agentUserId === payment.customerId ||
      attribution.businessId !== payment.businessId || attribution.customerId !== payment.customerId ||
      payment.verifiedAt < attribution.validFrom || (attribution.validUntil && payment.verifiedAt >= attribution.validUntil)) {
    return { eligible: false, reason: "ATTRIBUTION_NOT_ELIGIBLE" };
  }
  if (payment.verifiedAt.getTime() - attribution.validFrom.getTime() > 30 * 24 * 60 * 60 * 1000) {
    return { eligible: false, reason: "ATTRIBUTION_OUTSIDE_WINDOW" };
  }
  if (eligibleMinor === 0) return { eligible: false, reason: "ZERO_ELIGIBLE_AMOUNT" };
  const rule = policy.rule;
  let commission: bigint;
  if (rule?.kind === "FIXED" && validMinor(rule.minorUnits)) {
    commission = BigInt(rule.minorUnits);
  } else if (rule?.kind === "PERCENTAGE" && validMinor(rule.basisPoints) && (rule.rounding === "DOWN" || rule.rounding === "HALF_UP")) {
    const numerator = BigInt(eligibleMinor) * BigInt(rule.basisPoints);
    commission = (numerator + (rule.rounding === "HALF_UP" ? BigInt(5000) : BigInt(0))) / BigInt(10000);
  } else return { eligible: false, reason: "POLICY_INVALID" };
  if (commission === BigInt(0)) return { eligible: false, reason: "ZERO_COMMISSION" };
  if (commission > BigInt(Number.MAX_SAFE_INTEGER)) return { eligible: false, reason: "AMOUNT_OVERFLOW" };
  return {
    eligible: true, paymentId: payment.id, paymentReference: payment.reference, policyId: policy.id,
    policyVersion: policy.version, agentId: attribution.agentId, businessId: payment.businessId,
    customerId: payment.customerId, planId: payment.planId, currency: "KES", paymentMinor: payment.amountMinor,
    eligibleMinor, commissionMinor: Number(commission), calculation: { ...rule },
  };
}
