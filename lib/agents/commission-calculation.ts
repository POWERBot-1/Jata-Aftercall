/**
 * Pure commission policy evaluator. This module does not read payments, approve policies, write
 * ledgers, send messages, or initiate payouts. Its input must eventually be assembled exclusively
 * from authoritative server-side records; a browser-supplied snapshot is never payment evidence.
 *
 * No policy or rate is shipped with the product. No production integration currently invokes
 * this evaluator. Tests use explicit hypothetical rules, not approved financial terms.
 */
import { isProviderTransactionId } from "@/lib/paymentVerification";

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
};

export type CommissionPaymentSnapshot = {
  id: string;
  reference: string;
  status: string;
  purpose: string;
  paystackId: string | null;
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
  validFrom: Date;
  validUntil: Date | null; // exclusive; renewal retention must be explicitly approved
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

/**
 * `eligibleMinor` is the approved gross/net base already derived from verified evidence. NET
 * treatment of taxes, fees, discounts and refunds has not been defined by the owner. Until it is,
 * callers must not invent a value or call this function for production commission creation.
 */
export function evaluateCommission(input: {
  policy: CommissionPolicySnapshot | null;
  payment: CommissionPaymentSnapshot;
  attribution: CommissionAttributionSnapshot | null;
  eligibleMinor: number;
}): CommissionEvaluation {
  const { policy, payment, attribution, eligibleMinor } = input;
  if (!policy || policy.approval !== "APPROVED") return { eligible: false, reason: "POLICY_NOT_APPROVED" };
  if (!nonempty(policy.id) || !nonempty(policy.version) || !validDate(policy.effectiveFrom) ||
      (policy.effectiveUntil !== null && (!validDate(policy.effectiveUntil) || policy.effectiveUntil <= policy.effectiveFrom)) ||
      !Array.isArray(policy.eligiblePlanIds) || !Array.isArray(policy.eligibleEvents) || policy.currency !== "KES") {
    return { eligible: false, reason: "POLICY_INVALID" };
  }
  if (!nonempty(payment.id) || !nonempty(payment.reference) || !nonempty(payment.customerId) ||
      !nonempty(payment.businessId) || !nonempty(payment.planId) || !validDate(payment.verifiedAt) ||
      !validMinor(payment.amountMinor) || payment.amountMinor === 0 || !validMinor(eligibleMinor)) {
    return { eligible: false, reason: "PAYMENT_INVALID" };
  }
  if (payment.status !== "PAID" || payment.purpose !== "SUBSCRIPTION" || !isProviderTransactionId(payment.paystackId)) {
    return { eligible: false, reason: "PAYMENT_NOT_VERIFIED" };
  }
  if (payment.currency !== policy.currency || eligibleMinor > payment.amountMinor ||
      (policy.basis === "GROSS" && eligibleMinor !== payment.amountMinor) ||
      (policy.basis !== "GROSS" && policy.basis !== "NET")) return { eligible: false, reason: "BASIS_INVALID" };
  if (payment.verifiedAt < policy.effectiveFrom || (policy.effectiveUntil && payment.verifiedAt >= policy.effectiveUntil)) {
    return { eligible: false, reason: "POLICY_NOT_EFFECTIVE" };
  }
  if (!policy.eligiblePlanIds.includes(payment.planId) || !policy.eligibleEvents.includes(payment.event)) {
    return { eligible: false, reason: "PAYMENT_NOT_ELIGIBLE" };
  }
  if (!attribution || !nonempty(attribution.agentId) || !nonempty(attribution.agentUserId) ||
      !validDate(attribution.validFrom) || (attribution.validUntil !== null &&
        (!validDate(attribution.validUntil) || attribution.validUntil <= attribution.validFrom))) {
    return { eligible: false, reason: "ATTRIBUTION_INVALID" };
  }
  if (attribution.agentStatus !== "ACTIVE" || attribution.agentUserId === payment.customerId ||
      attribution.businessId !== payment.businessId || attribution.customerId !== payment.customerId ||
      payment.verifiedAt < attribution.validFrom || (attribution.validUntil && payment.verifiedAt >= attribution.validUntil)) {
    return { eligible: false, reason: "ATTRIBUTION_NOT_ELIGIBLE" };
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
