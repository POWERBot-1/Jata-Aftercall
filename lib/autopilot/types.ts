/**
 * JATA Autopilot — Canonical Domain Types
 *
 * Separates deterministic facts, permissions, entitlements, and budgets from
 * generative LLM reasoning. Every KPI carries an explicit provenance basis tag
 * so no metric is ever guessed or presented as verified without database proof.
 */

export const AUTOPILOT_PLAN_KEYS = [
  "JATA_AUTOPILOT",
  "JATA_AUTOPILOT_PRO",
  "JATA_AUTOPILOT_ENTERPRISE",
] as const;

export type AutopilotPlanKey = (typeof AUTOPILOT_PLAN_KEYS)[number];

export type AutopilotTier = "STANDARD" | "PRO" | "ENTERPRISE";

export type AutopilotSubscriptionStatus =
  | "NONE"
  | "PENDING"
  | "ACTIVE"
  | "EXPIRING"
  | "PAST_DUE"
  | "EXPIRED"
  | "SUSPENDED"
  | "CANCELLED";

export type AutopilotEntitlementStatus =
  | "NONE"
  | "ACTIVE"
  | "GRACE"
  | "SUSPENDED"
  | "EXPIRED"
  | "CANCELLED";

export type AutopilotMode = "ASSISTED" | "SUPERVISED" | "ADVANCED";

export type AutopilotOperationalStatus = "LIVE" | "PAUSED";

export type MetricProvenanceBasis =
  | "RECORDED"
  | "CALCULATED"
  | "ESTIMATE"
  | "MISSING_DATA";

export type AutopilotActionType =
  | "CREATE_OR_UPDATE_OFFER"
  | "RESOLVE_UNANSWERED_FAQ"
  | "QUEUE_CONSENTED_FOLLOWUP";

export type AutopilotRiskCategory =
  | "READ_ONLY"
  | "LOW_RISK_DRAFT"
  | "MEDIUM_RISK_REVERSIBLE"
  | "HIGH_RISK_LOCKED";

export type AutopilotProposalStatus =
  | "PROPOSED"
  | "APPROVED"
  | "EXECUTING"
  | "EXECUTED"
  | "REJECTED"
  | "EXPIRED"
  | "FAILED"
  | "ROLLED_BACK";

export type AutopilotUsageCapability =
  | "LLM_REASONING"
  | "VISION_EXTRACT"
  | "VOICE_STT"
  | "VOICE_TTS"
  | "OUTBOUND_MSG"
  | "WORKFLOW_STEP";

/**
 * Exact compatibility & readiness taxonomy required by the engineering brief (§8.3).
 * Autopilot never claims universal channel integration or live readiness without proof.
 */
export type ChannelCompatibilityStatus =
  | "SUPPORTED AND VERIFIED"
  | "IMPLEMENTED BUT NOT LIVE-VERIFIED"
  | "REQUIRES CREDENTIALS OR OWNER AUTHORIZATION"
  | "REQUIRES PROVIDER APPROVAL"
  | "LIMITED BY PLATFORM API"
  | "NOT SUPPORTED"
  | "NOT TESTED";

export interface GroundedMetric {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  basis: MetricProvenanceBasis;
  explanation: string;
}

export interface DiagnosisFinding {
  id: string;
  severity: "OPPORTUNITY" | "BOTTLENECK" | "RISK" | "MISSING_SIGNAL";
  title: string;
  summary: string;
  basis: MetricProvenanceBasis;
  evidence: string[];
  recommendedActionType?: AutopilotActionType;
}

export interface OfferActionPayload {
  actionType: "CREATE_OR_UPDATE_OFFER";
  title: string;
  description: string;
  badgeText?: string;
  ctaLabel?: string;
  discountPercent?: number;
  validUntilIso?: string | null;
}

export interface ResolveFaqActionPayload {
  actionType: "RESOLVE_UNANSWERED_FAQ";
  unansweredQuestionId?: string | null;
  question: string;
  answer: string;
  category?: string;
}

export interface ConsentedFollowupActionPayload {
  actionType: "QUEUE_CONSENTED_FOLLOWUP";
  recipientName?: string;
  recipientPhone?: string;
  recipientEmail?: string;
  channel: "WHATSAPP" | "SMS" | "EMAIL";
  scope: "TRANSACTIONAL" | "MARKETING";
  subject?: string;
  body: string;
  discountPercent?: number;
  batchRecipientCount?: number;
}

export type AutopilotActionPayload =
  | OfferActionPayload
  | ResolveFaqActionPayload
  | ConsentedFollowupActionPayload;

export interface GroundedDiagnosisReport {
  businessId: string;
  businessName: string;
  category: string;
  industryPackKey: string;
  industryPackName: string;
  generatedAt: string;
  healthSummary: string;
  metrics: GroundedMetric[];
  findings: DiagnosisFinding[];
  dataGaps: string[];
  suggestedProposals: Array<{
    actionType: AutopilotActionType;
    riskCategory: AutopilotRiskCategory;
    title: string;
    rationale: string;
    expectedImpact: string;
    payload: AutopilotActionPayload;
    idempotencyKey: string;
  }>;
}
