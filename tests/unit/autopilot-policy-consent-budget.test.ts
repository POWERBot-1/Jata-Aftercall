import { describe, expect, it } from "vitest";
import {
  evaluateAutopilotActionPolicy,
  isGlobalAutopilotKillSwitchActive,
} from "@/lib/autopilot/policy";
import {
  isOptOutMessage,
  isWithinQuietHours,
  normalizeAutopilotPhone,
} from "@/lib/autopilot/consent";
import { QUOTA_BY_AUTOPILOT_TIER, evaluateAutopilotBudget } from "@/lib/autopilot/usage";

const SAMPLE_OFFER_PAYLOAD = {
  actionType: "CREATE_OR_UPDATE_OFFER" as const,
  title: "Weekend Spotlight",
  description: "Featured menu platter",
  discountPercent: 0,
};

describe("JATA Autopilot deterministic policy, RBAC, kill switch & modes", () => {
  it("halts immediately when global kill switch or tenant pause is active", () => {
    expect(isGlobalAutopilotKillSwitchActive({ JATA_AUTOPILOT_GLOBAL_KILL_SWITCH: "true" } as any)).toBe(true);
    expect(isGlobalAutopilotKillSwitchActive({ JATA_AUTOPILOT_GLOBAL_KILL_SWITCH: "0" } as any)).toBe(false);

    const killed = evaluateAutopilotActionPolicy({
      phase: "EXECUTE",
      actorRole: "OWNER",
      entitled: true,
      autonomyMode: "ADVANCED",
      operationalStatus: "LIVE",
      industryPackKey: "restaurant_cafe_bakery",
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "LOW_RISK_DRAFT",
      payload: SAMPLE_OFFER_PAYLOAD,
      env: { JATA_AUTOPILOT_GLOBAL_KILL_SWITCH: "1" } as any,
    });
    expect(killed.allowed).toBe(false);
    if (killed.allowed === false) expect(killed.code).toBe("GLOBAL_KILL_SWITCH_ACTIVE");

    const paused = evaluateAutopilotActionPolicy({
      phase: "PROPOSE",
      actorRole: "OWNER",
      entitled: true,
      autonomyMode: "ASSISTED",
      operationalStatus: "PAUSED",
      industryPackKey: "restaurant_cafe_bakery",
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "LOW_RISK_DRAFT",
      payload: SAMPLE_OFFER_PAYLOAD,
      env: {} as any,
    });
    expect(paused.allowed).toBe(false);
    if (paused.allowed === false) expect(paused.code).toBe("TENANT_AUTOPILOT_PAUSED");
  });

  it("enforces strict RBAC so VIEWER or STAFF cannot configure offers or FAQs via Autopilot", () => {
    const viewerAttempt = evaluateAutopilotActionPolicy({
      phase: "PROPOSE",
      actorRole: "VIEWER",
      entitled: true,
      autonomyMode: "ASSISTED",
      operationalStatus: "LIVE",
      industryPackKey: "generic_custom",
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "LOW_RISK_DRAFT",
      payload: SAMPLE_OFFER_PAYLOAD,
      env: {} as any,
    });
    expect(viewerAttempt.allowed).toBe(false);
    if (viewerAttempt.allowed === false) expect(viewerAttempt.code).toBe("RBAC_FORBIDDEN");

    const staffOfferAttempt = evaluateAutopilotActionPolicy({
      phase: "PROPOSE",
      actorRole: "STAFF",
      entitled: true,
      autonomyMode: "ASSISTED",
      operationalStatus: "LIVE",
      industryPackKey: "generic_custom",
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "LOW_RISK_DRAFT",
      payload: SAMPLE_OFFER_PAYLOAD,
      env: {} as any,
    });
    expect(staffOfferAttempt.allowed).toBe(false);

    const managerAttempt = evaluateAutopilotActionPolicy({
      phase: "EXECUTE",
      actorRole: "MANAGER",
      entitled: true,
      autonomyMode: "ASSISTED",
      operationalStatus: "LIVE",
      industryPackKey: "generic_custom",
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "LOW_RISK_DRAFT",
      payload: SAMPLE_OFFER_PAYLOAD,
      env: {} as any,
    });
    expect(managerAttempt.allowed).toBe(true);
  });

  it("requires active entitlement for live EXECUTE while allowing safe draft PROPOSE in preview mode", () => {
    const draftInPreview = evaluateAutopilotActionPolicy({
      phase: "PROPOSE",
      actorRole: "OWNER",
      entitled: false,
      autonomyMode: "ASSISTED",
      operationalStatus: "LIVE",
      industryPackKey: "generic_custom",
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "LOW_RISK_DRAFT",
      payload: SAMPLE_OFFER_PAYLOAD,
      env: {} as any,
    });
    expect(draftInPreview.allowed).toBe(true);

    const execInPreview = evaluateAutopilotActionPolicy({
      phase: "EXECUTE",
      actorRole: "OWNER",
      entitled: false,
      autonomyMode: "ASSISTED",
      operationalStatus: "LIVE",
      industryPackKey: "generic_custom",
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "LOW_RISK_DRAFT",
      payload: SAMPLE_OFFER_PAYLOAD,
      env: {} as any,
    });
    expect(execInPreview.allowed).toBe(false);
    if (execInPreview.allowed === false) expect(execInPreview.code).toBe("ENTITLEMENT_REQUIRED");
  });

  it("requires explicit transcript confirmation on voice commands and enforces mode & discount caps", () => {
    const unconfirmedVoice = evaluateAutopilotActionPolicy({
      phase: "PROPOSE",
      actorRole: "OWNER",
      entitled: true,
      autonomyMode: "ASSISTED",
      operationalStatus: "LIVE",
      industryPackKey: "generic_custom",
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "LOW_RISK_DRAFT",
      payload: SAMPLE_OFFER_PAYLOAD,
      modality: "VOICE_TRANSCRIPT",
      voiceTranscriptConfirmed: false,
      env: {} as any,
    });
    expect(unconfirmedVoice.allowed).toBe(false);
    if (unconfirmedVoice.allowed === false) {
      expect(unconfirmedVoice.code).toBe("VOICE_CONFIRMATION_REQUIRED");
    }

    // Assisted mode never auto-executes
    const assistedAuto = evaluateAutopilotActionPolicy({
      phase: "AUTO_EXECUTE",
      actorRole: "OWNER",
      entitled: true,
      autonomyMode: "ASSISTED",
      operationalStatus: "LIVE",
      industryPackKey: "generic_custom",
      actionType: "RESOLVE_UNANSWERED_FAQ",
      riskCategory: "LOW_RISK_DRAFT",
      payload: {
        actionType: "RESOLVE_UNANSWERED_FAQ",
        question: "What time do you open?",
        answer: "8:00 AM daily.",
      },
      env: {} as any,
    });
    expect(assistedAuto.allowed).toBe(false);

    // Advanced mode blocks auto-discounts exceeding maxAutoDiscountPct
    const overDiscountAuto = evaluateAutopilotActionPolicy({
      phase: "AUTO_EXECUTE",
      actorRole: "OWNER",
      entitled: true,
      autonomyMode: "ADVANCED",
      operationalStatus: "LIVE",
      industryPackKey: "generic_custom",
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "MEDIUM_RISK_REVERSIBLE",
      payload: { ...SAMPLE_OFFER_PAYLOAD, discountPercent: 15 },
      maxAutoDiscountPct: 5,
      env: {} as any,
    });
    expect(overDiscountAuto.allowed).toBe(false);
    if (overDiscountAuto.allowed === false) {
      expect(overDiscountAuto.code).toBe("AUTO_DISCOUNT_CAP_EXCEEDED");
    }

    // High-risk actions are permanently locked in all modes
    const locked = evaluateAutopilotActionPolicy({
      phase: "EXECUTE",
      actorRole: "OWNER",
      entitled: true,
      autonomyMode: "ADVANCED",
      operationalStatus: "LIVE",
      industryPackKey: "generic_custom",
      actionType: "CREATE_OR_UPDATE_OFFER",
      riskCategory: "HIGH_RISK_LOCKED",
      payload: SAMPLE_OFFER_PAYLOAD,
      env: {} as any,
    });
    expect(locked.allowed).toBe(false);
    if (locked.allowed === false) expect(locked.code).toBe("HIGH_RISK_ACTION_LOCKED");
  });
});

describe("JATA Autopilot consent, STOP/ACHA opt-out, EAT quiet hours & spend caps", () => {
  it("normalizes Kenyan phone numbers and detects English + Kiswahili opt-out keywords", () => {
    expect(normalizeAutopilotPhone("0722 123 456")).toBe("+254722123456");
    expect(normalizeAutopilotPhone("254711000999")).toBe("+254711000999");

    expect(isOptOutMessage("STOP")).toBe(true);
    expect(isOptOutMessage("  unsubscribe! ")).toBe(true);
    expect(isOptOutMessage("ACHA")).toBe(true);
    expect(isOptOutMessage("TOA")).toBe(true);
    expect(isOptOutMessage("Please stop by my office with the parcel")).toBe(false);
  });

  it("enforces Africa/Nairobi (UTC+3) overnight quiet hours accurately", () => {
    // 19:30 UTC = 22:30 EAT (inside 20:00-07:00 quiet hours)
    expect(
      isWithinQuietHours({
        now: new Date("2026-10-25T19:30:00Z"),
        quietHoursStart: "20:00",
        quietHoursEnd: "07:00",
        timezone: "Africa/Nairobi",
      }),
    ).toBe(true);

    // 09:00 UTC = 12:00 noon EAT (outside quiet hours)
    expect(
      isWithinQuietHours({
        now: new Date("2026-10-25T09:00:00Z"),
        quietHoursStart: "20:00",
        quietHoursEnd: "07:00",
        timezone: "Africa/Nairobi",
      }),
    ).toBe(false);
  });

  it("halts AI spend before provider invocation when daily spend cap is exceeded", async () => {
    expect(QUOTA_BY_AUTOPILOT_TIER.PREVIEW.OUTBOUND_MSG).toBe(0);
    expect(QUOTA_BY_AUTOPILOT_TIER.STANDARD.LLM_REASONING).toBe(300);

    const overDailyCap = await evaluateAutopilotBudget({
      businessId: "biz_budget_test",
      tierKey: "STANDARD",
      capability: "VISION_EXTRACT",
      dailySpendCapMinorKES: 100, // KES 1.00 cap < KES 2.50 vision call
      estimatedCallCostMinorKES: 250,
    });
    expect(overDailyCap.allowed).toBe(false);
    if (overDailyCap.allowed === false) {
      expect(overDailyCap.code).toBe("DAILY_SPEND_CAP_REACHED");
    }
  });
});
