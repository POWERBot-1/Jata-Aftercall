/**
 * FICTIONAL Autopilot fixture model (development and test only).
 *
 * Client-safe: no server imports. It builds the overview payload that the REAL
 * AutopilotCommandCenter renders. Every business, customer, consent record,
 * proposal and audit row here is invented. Nothing is read from or written to a
 * database, and no external service is contacted.
 *
 * Authoritative decisions (kill switch, pause, role, expiry, payload caps,
 * quiet hours) are made by `autopilotFixtureDecide.ts`, which calls the real
 * policy functions. This file only describes state.
 */

import type { AutopilotOverviewPayload } from "@/components/autopilot/AutopilotCommandCenter";

export const AUTOPILOT_FIXTURE_NOTICE =
  "FICTIONAL FIXTURE — simulated Autopilot data. No message was sent, no money was spent, no offer, FAQ, customer or subscription was changed, and no automation ran.";

export type FixtureScenarioId =
  | "ready"
  | "consent-not-granted"
  | "paused"
  | "kill-switch"
  | "approval-pending"
  | "cap-reached"
  | "empty";

export const FIXTURE_SCENARIO_IDS: readonly FixtureScenarioId[] = [
  "ready",
  "consent-not-granted",
  "paused",
  "kill-switch",
  "approval-pending",
  "cap-reached",
  "empty",
];

export const FIXTURE_ROLES = ["OWNER", "MANAGER", "STAFF", "VIEWER"] as const;
export type FixtureRole = (typeof FIXTURE_ROLES)[number];

export interface FixtureProposal {
  id: string;
  businessId: string;
  actionType: "CREATE_OR_UPDATE_OFFER" | "RESOLVE_UNANSWERED_FAQ" | "QUEUE_CONSENTED_FOLLOWUP";
  riskCategory: string;
  status: "PROPOSED" | "APPROVED" | "EXECUTED" | "REJECTED" | "EXPIRED" | "FAILED" | "ROLLED_BACK";
  title: string;
  rationale: string;
  expectedImpact: string | null;
  payload: Record<string, unknown>;
  rollbackSupported: boolean;
  idempotencyKey: string;
  expiresAt: string | null;
  executedAt: string | null;
  rolledBackAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface FixtureConsent {
  id: string;
  label: string;
  channel: "WHATSAPP" | "SMS" | "EMAIL";
  scope: "TRANSACTIONAL" | "MARKETING";
  status: "OPTED_IN" | "OPTED_OUT" | "UNSUBSCRIBED_KEYWORD";
}

export interface FixtureBusiness {
  id: string;
  name: string;
  /** Merchant activation: an active Autopilot entitlement (fictional). */
  entitled: boolean;
  autonomyMode: "ASSISTED" | "SUPERVISED" | "ADVANCED";
  /** LIVE = merchant has not withdrawn; PAUSED = merchant withdrew automation. */
  operationalStatus: "LIVE" | "PAUSED";
  industryPackKey: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  timezone: string;
  dailySpendCapMinorKES: number;
  dailySpendMinorKES: number;
  maxBatchRecipients: number;
  maxAutoDiscountPct: number;
  consents: FixtureConsent[];
  proposals: FixtureProposal[];
  audit: Array<{ id: string; actorKind: string; action: string; createdAt: string }>;
}

export interface FixtureState {
  scenario: FixtureScenarioId;
  /** Simulates the platform-wide kill switch (env JATA_AUTOPILOT_GLOBAL_KILL_SWITCH). */
  globalKillSwitch: boolean;
  actorRole: FixtureRole;
  activeBusinessId: string;
  businesses: Record<string, FixtureBusiness>;
}

export const FIXTURE_BUSINESS_A = "fx-tenant-a";
export const FIXTURE_BUSINESS_B = "fx-tenant-b";

const CREATED = "2026-11-01T08:00:00.000Z";
const FUTURE = "2099-01-01T00:00:00.000Z";
const PAST = "2020-01-01T00:00:00.000Z";

function offerProposal(
  id: string,
  businessId: string,
  status: FixtureProposal["status"],
  opts: Partial<FixtureProposal> = {},
): FixtureProposal {
  return {
    id,
    businessId,
    actionType: "CREATE_OR_UPDATE_OFFER",
    riskCategory: "MEDIUM_RISK_REVERSIBLE",
    status,
    title: "FIXTURE: Weekend lunch offer (10% off)",
    rationale: "Fictional rationale: weekend lunch orders fell in the fictional sample.",
    expectedImpact: "Fictional estimate only; not a forecast.",
    payload: {
      actionType: "CREATE_OR_UPDATE_OFFER",
      title: "Weekend lunch",
      description: "Fictional offer copy",
      discountPercent: 10,
      validUntilIso: FUTURE,
    },
    rollbackSupported: true,
    idempotencyKey: `${id}-key`,
    expiresAt: FUTURE,
    executedAt: null,
    rolledBackAt: null,
    lastError: null,
    createdAt: CREATED,
    ...opts,
  };
}

function faqProposal(id: string, businessId: string, status: FixtureProposal["status"]): FixtureProposal {
  return {
    id,
    businessId,
    actionType: "RESOLVE_UNANSWERED_FAQ",
    riskCategory: "LOW_RISK_DRAFT",
    status,
    title: "FIXTURE: Answer 'Do you deliver to Kilimani?'",
    rationale: "Fictional unanswered question from the fictional inbox.",
    expectedImpact: null,
    payload: {
      actionType: "RESOLVE_UNANSWERED_FAQ",
      question: "Do you deliver to Kilimani?",
      answer: "FIXTURE: Yes, delivery is available in Kilimani (fictional answer).",
    },
    rollbackSupported: true,
    idempotencyKey: `${id}-key`,
    expiresAt: FUTURE,
    executedAt: null,
    rolledBackAt: null,
    lastError: null,
    createdAt: CREATED,
  };
}

function followupProposal(id: string, businessId: string, batch: number): FixtureProposal {
  return {
    id,
    businessId,
    actionType: "QUEUE_CONSENTED_FOLLOWUP",
    riskCategory: "MEDIUM_RISK_REVERSIBLE",
    status: "PROPOSED",
    title: `FIXTURE: Consented follow-up to ${batch} customers`,
    rationale: "Fictional follow-up for fictional opted-in customers.",
    expectedImpact: "Fictional estimate only.",
    payload: {
      actionType: "QUEUE_CONSENTED_FOLLOWUP",
      channel: "WHATSAPP",
      scope: "TRANSACTIONAL",
      batchRecipientCount: batch,
      body: "FIXTURE: Thanks for your order (fictional message; never sent).",
    },
    rollbackSupported: true,
    idempotencyKey: `${id}-key`,
    expiresAt: FUTURE,
    executedAt: null,
    rolledBackAt: null,
    lastError: null,
    createdAt: CREATED,
  };
}

function baseBusiness(id: string, name: string): FixtureBusiness {
  return {
    id,
    name,
    entitled: true,
    autonomyMode: "SUPERVISED",
    operationalStatus: "LIVE",
    industryPackKey: "generic_custom",
    quietHoursStart: "20:00",
    quietHoursEnd: "07:00",
    timezone: "Africa/Nairobi",
    dailySpendCapMinorKES: 25000,
    dailySpendMinorKES: 4200,
    maxBatchRecipients: 50,
    maxAutoDiscountPct: 0,
    consents: [
      { id: `${id}-c1`, label: "FIXTURE Customer 1 (WhatsApp)", channel: "WHATSAPP", scope: "TRANSACTIONAL", status: "OPTED_IN" },
      { id: `${id}-c2`, label: "FIXTURE Customer 2 (WhatsApp)", channel: "WHATSAPP", scope: "TRANSACTIONAL", status: "UNSUBSCRIBED_KEYWORD" },
    ],
    proposals: [],
    audit: [
      { id: `${id}-a1`, actorKind: "SYSTEM", action: "autopilot.fixture.seeded", createdAt: CREATED },
    ],
  };
}

function seedBusinessForScenario(id: string, name: string, scenario: FixtureScenarioId): FixtureBusiness {
  const b = baseBusiness(id, name);
  switch (scenario) {
    case "ready":
      b.proposals = [
        offerProposal(`${id}-p-offer`, id, "EXECUTED", { executedAt: CREATED, title: "FIXTURE: Weekend lunch offer (executed earlier)" }),
        faqProposal(`${id}-p-faq`, id, "PROPOSED"),
      ];
      break;
    case "approval-pending":
      b.proposals = [
        offerProposal(`${id}-p-offer`, id, "PROPOSED"),
        faqProposal(`${id}-p-faq`, id, "PROPOSED"),
        followupProposal(`${id}-p-follow`, id, 4),
        offerProposal(`${id}-p-old`, id, "PROPOSED", { expiresAt: PAST, title: "FIXTURE: Expired offer proposal" }),
      ];
      break;
    case "consent-not-granted":
      b.entitled = false;
      b.autonomyMode = "ASSISTED";
      b.consents = [];
      b.proposals = [followupProposal(`${id}-p-follow`, id, 2), faqProposal(`${id}-p-faq`, id, "PROPOSED")];
      break;
    case "paused":
      b.operationalStatus = "PAUSED";
      b.proposals = [offerProposal(`${id}-p-offer`, id, "PROPOSED"), faqProposal(`${id}-p-faq`, id, "PROPOSED")];
      break;
    case "kill-switch":
      b.proposals = [faqProposal(`${id}-p-faq`, id, "PROPOSED")];
      break;
    case "cap-reached":
      b.dailySpendMinorKES = 25000;
      b.maxBatchRecipients = 3;
      b.proposals = [followupProposal(`${id}-p-follow`, id, 5), faqProposal(`${id}-p-faq`, id, "PROPOSED")];
      break;
    case "empty":
      b.proposals = [];
      b.audit = [];
      b.consents = [];
      break;
  }
  return b;
}

export function createFixtureState(
  scenario: FixtureScenarioId = "ready",
  opts: { role?: FixtureRole; tenant?: "a" | "b"; globalKillSwitch?: boolean } = {},
): FixtureState {
  const killSwitchScenario = scenario === "kill-switch";
  return {
    scenario,
    globalKillSwitch: opts.globalKillSwitch ?? killSwitchScenario,
    actorRole: opts.role ?? "OWNER",
    activeBusinessId: opts.tenant === "b" ? FIXTURE_BUSINESS_B : FIXTURE_BUSINESS_A,
    businesses: {
      [FIXTURE_BUSINESS_A]: seedBusinessForScenario(FIXTURE_BUSINESS_A, "FIXTURE Mama Pima Kitchen (tenant A)", scenario),
      // Tenant B is always seeded with a different, independent state.
      [FIXTURE_BUSINESS_B]: seedBusinessForScenario(FIXTURE_BUSINESS_B, "FIXTURE Lakeside Salon (tenant B)", "approval-pending"),
    },
  };
}

function entitlementBanner(b: FixtureBusiness): AutopilotOverviewPayload["entitlement"]["banner"] {
  if (b.entitled) {
    return {
      tone: "success",
      headline: "FIXTURE: Autopilot entitlement active (fictional)",
      detail: "Fictional entitlement. No subscription exists or was changed.",
      ctaLabel: null,
    };
  }
  return {
    tone: "warning",
    headline: "FIXTURE: Preview mode — no active Autopilot entitlement",
    detail: "Preview mode supports diagnosis and drafts only. Live execution is blocked until an entitlement is active (fictional).",
    ctaLabel: null,
  };
}

/** Builds the overview payload the real Command Center renders. Pure and client-safe. */
export function buildFixtureOverview(state: FixtureState, businessId = state.activeBusinessId): AutopilotOverviewPayload {
  const b = state.businesses[businessId] ?? state.businesses[FIXTURE_BUSINESS_A];
  return {
    actorRole: state.actorRole,
    globalKillSwitchActive: state.globalKillSwitch,
    entitlement: {
      entitled: b.entitled,
      previewMode: !b.entitled,
      tier: b.entitled ? "STANDARD" : "PREVIEW",
      planKey: "JATA_AUTOPILOT",
      subscriptionStatus: b.entitled ? "ACTIVE" : "NONE",
      entitlementStatus: b.entitled ? "ACTIVE" : "NONE",
      expiresAt: b.entitled ? FUTURE : null,
      daysRemaining: b.entitled ? 30 : null,
      banner: entitlementBanner(b),
    },
    plans: [
      {
        id: null,
        key: "JATA_AUTOPILOT",
        tier: "STANDARD",
        name: "FIXTURE Autopilot (no payment is simulated)",
        priceKES: 2499,
        durationDays: 30,
        description: "Fictional plan card. Activation is not available in this fixture.",
      },
    ],
    config: {
      businessId: b.id,
      autonomyMode: b.autonomyMode,
      operationalStatus: b.operationalStatus,
      industryPackKey: b.industryPackKey,
      quietHoursStart: b.quietHoursStart,
      quietHoursEnd: b.quietHoursEnd,
      timezone: b.timezone,
      dailySpendCapMinorKES: b.dailySpendCapMinorKES,
      maxBatchRecipients: b.maxBatchRecipients,
      maxAutoDiscountPct: b.maxAutoDiscountPct,
      voiceEnabled: false,
      version: 1,
    },
    industryPacks: [{ key: "generic_custom", name: "Generic custom (fixture)", hasRegulatedGuardrail: false }],
    diagnosis: {
      businessId: b.id,
      businessName: b.name,
      category: "FIXTURE",
      industryPackKey: "generic_custom",
      industryPackName: "Generic custom (fixture)",
      generatedAt: CREATED,
      healthSummary: "FIXTURE: fictional diagnosis. Not generated from live business data.",
      metrics: [
        {
          key: "fixture_orders",
          label: "Fictional orders this week",
          value: 12,
          unit: "orders",
          basis: "ESTIMATE",
          explanation: "Fictional sample value; not recorded business data.",
        },
      ],
      findings: [],
      dataGaps: ["FIXTURE: no live tenant data is loaded in this fixture."],
      suggestedProposals: [
        {
          actionType: "RESOLVE_UNANSWERED_FAQ",
          riskCategory: "LOW_RISK_DRAFT",
          title: "FIXTURE: Answer 'Do you deliver to Kilimani?'",
          rationale: "Fictional unanswered question.",
          expectedImpact: "Fictional.",
          payload: {
            actionType: "RESOLVE_UNANSWERED_FAQ",
            question: "Do you deliver to Kilimani?",
            answer: "FIXTURE: Yes, delivery is available in Kilimani (fictional answer).",
          },
          idempotencyKey: `${b.id}-suggest-faq`,
        },
      ],
    },
    proposals: b.proposals.map((p) => ({
      id: p.id,
      actionType: p.actionType,
      riskCategory: p.riskCategory,
      status: p.status,
      title: p.title,
      rationale: p.rationale,
      expectedImpact: p.expectedImpact,
      rollbackSupported: p.rollbackSupported,
      executedAt: p.executedAt,
      rolledBackAt: p.rolledBackAt,
      lastError: p.lastError,
      createdAt: p.createdAt,
    })),
    usage: {
      periodKey: "2026-11",
      dayKey: "2026-11-02",
      tierKey: b.entitled ? "STANDARD" : "PREVIEW",
      dailySpendMinorKES: b.dailySpendMinorKES,
      dailySpendCapMinorKES: b.dailySpendCapMinorKES,
      monthlySpendMinorKES: b.dailySpendMinorKES * 4,
      monthlySpendCapMinorKES: 500000,
      capabilityUsedThisMonth: {},
      capabilityLimits: {},
    },
    channels: [
      {
        channelKey: "WHATSAPP",
        label: "WhatsApp (fixture)",
        status: "REQUIRES PROVIDER APPROVAL",
        inboundCapable: false,
        outboundCapable: false,
        detail: "Fictional channel row. No provider is connected in this fixture.",
      },
    ],
    auditEvents: b.audit.map((a) => ({
      id: a.id,
      actorKind: a.actorKind,
      action: a.action,
      createdAt: a.createdAt,
      metadata: { fixture: true },
    })),
  };
}
