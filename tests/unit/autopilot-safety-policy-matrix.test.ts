/**
 * Autopilot safety matrix over the REAL pure policy functions (no database, no mocks).
 * Covers: kill switch, tenant pause, RBAC, entitlement, autonomy modes, batch and discount
 * caps (including invalid configuration), and Africa/Nairobi quiet hours (boundaries, UTC
 * conversion, timezone independence, DST-free zone, weekend and date boundaries).
 */
import { afterEach, describe, expect, it } from "vitest";
import {
  evaluateAutopilotActionPolicy,
  isGlobalAutopilotKillSwitchActive,
  defaultRiskCategoryForAction,
  type PolicyEvaluationInput,
} from "@/lib/autopilot/policy";
import { isWithinQuietHours } from "@/lib/autopilot/consent";
import { validateAutopilotActionPayload } from "@/lib/autopilot/actions";

const KILL_ON = { JATA_AUTOPILOT_GLOBAL_KILL_SWITCH: "1" } as Partial<NodeJS.ProcessEnv>;
const offerPayload = { actionType: "CREATE_OR_UPDATE_OFFER", title: "Weekend lunch", description: "Fictional", discountPercent: 10, validUntilIso: "2099-01-01T00:00:00.000Z" } as const;
const followupPayload = (n: number) => ({ actionType: "QUEUE_CONSENTED_FOLLOWUP", channel: "WHATSAPP", scope: "TRANSACTIONAL", batchRecipientCount: n, body: "FIXTURE" }) as const;

function base(over: Partial<PolicyEvaluationInput> = {}): PolicyEvaluationInput {
  return {
    phase: "EXECUTE",
    actorRole: "OWNER",
    entitled: true,
    autonomyMode: "SUPERVISED",
    operationalStatus: "LIVE",
    industryPackKey: "generic_custom",
    actionType: "RESOLVE_UNANSWERED_FAQ",
    riskCategory: "LOW_RISK_DRAFT",
    payload: { actionType: "RESOLVE_UNANSWERED_FAQ", question: "Q?", answer: "A" } as never,
    maxAutoDiscountPct: 0,
    maxBatchRecipients: 50,
    env: {},
    ...over,
  };
}

afterEach(() => {
  delete process.env.TZ;
});

describe("global kill switch (env flag parsing)", () => {
  it.each(["1", "true", "yes", "on", " TRUE "])("treats %j as active", (v) => {
    expect(isGlobalAutopilotKillSwitchActive({ JATA_AUTOPILOT_GLOBAL_KILL_SWITCH: v })).toBe(true);
  });
  it.each(["0", "false", "no", "off", "", "2"])("treats %j as inactive", (v) => {
    expect(isGlobalAutopilotKillSwitchActive({ JATA_AUTOPILOT_GLOBAL_KILL_SWITCH: v })).toBe(false);
  });
  it("is inactive when the variable is absent", () => {
    expect(isGlobalAutopilotKillSwitchActive({})).toBe(false);
  });
});

describe("kill switch blocks every applicable phase, regardless of role or entitlement", () => {
  it.each([
    ["PROPOSE", "PROPOSE"],
    ["EXECUTE", "EXECUTE"],
    ["AUTO_EXECUTE", "AUTO_EXECUTE"],
  ] as const)("blocks %s with GLOBAL_KILL_SWITCH_ACTIVE", (_label, phase) => {
    const d = evaluateAutopilotActionPolicy(base({ phase, env: KILL_ON, actorRole: "OWNER", entitled: true }));
    expect(d).toMatchObject({ allowed: false, code: "GLOBAL_KILL_SWITCH_ACTIVE" });
  });
  it("is checked before tenant pause and RBAC (first gate)", () => {
    const d = evaluateAutopilotActionPolicy(base({ env: KILL_ON, operationalStatus: "PAUSED", actorRole: "VIEWER" }));
    expect(d).toMatchObject({ code: "GLOBAL_KILL_SWITCH_ACTIVE" });
  });
  it("allows the same action when the switch is off", () => {
    const d = evaluateAutopilotActionPolicy(base({ env: {} }));
    expect(d.allowed).toBe(true);
  });
});

describe("merchant withdrawal (tenant PAUSED) and entitlement", () => {
  it("blocks PROPOSE and EXECUTE while the tenant is paused", () => {
    expect(evaluateAutopilotActionPolicy(base({ phase: "PROPOSE", operationalStatus: "PAUSED" }))).toMatchObject({ code: "TENANT_AUTOPILOT_PAUSED" });
    expect(evaluateAutopilotActionPolicy(base({ phase: "EXECUTE", operationalStatus: "PAUSED" }))).toMatchObject({ code: "TENANT_AUTOPILOT_PAUSED" });
  });
  it("allows the action again once the tenant is LIVE", () => {
    expect(evaluateAutopilotActionPolicy(base({ operationalStatus: "LIVE" })).allowed).toBe(true);
  });
  it("requires an active entitlement for live EXECUTE but still allows a PROPOSE draft in preview", () => {
    expect(evaluateAutopilotActionPolicy(base({ phase: "EXECUTE", entitled: false }))).toMatchObject({ code: "ENTITLEMENT_REQUIRED" });
    expect(evaluateAutopilotActionPolicy(base({ phase: "PROPOSE", entitled: false })).allowed).toBe(true);
  });
  it("never lets an automatic run bypass ASSISTED mode", () => {
    expect(evaluateAutopilotActionPolicy(base({ phase: "AUTO_EXECUTE", autonomyMode: "ASSISTED" }))).toMatchObject({ code: "MODE_REQUIRES_HUMAN_APPROVAL" });
  });
  it("marks SUPERVISED pricing or outbound actions as requiring explicit owner approval", () => {
    const d = evaluateAutopilotActionPolicy(base({ phase: "PROPOSE", autonomyMode: "SUPERVISED", actionType: "CREATE_OR_UPDATE_OFFER", riskCategory: "MEDIUM_RISK_REVERSIBLE", payload: offerPayload as never }));
    expect(d).toMatchObject({ allowed: true, requiresExplicitApproval: true });
  });
  it("classifies discount offers as medium-risk and draft FAQ work as low-risk", () => {
    expect(defaultRiskCategoryForAction("CREATE_OR_UPDATE_OFFER", offerPayload as never)).toBe("MEDIUM_RISK_REVERSIBLE");
    expect(defaultRiskCategoryForAction("RESOLVE_UNANSWERED_FAQ", {} as never)).toBe("LOW_RISK_DRAFT");
  });
});

describe("RBAC", () => {
  it.each(["VIEWER", "STAFF"] as const)("denies %s the configure-level action", (role) => {
    expect(evaluateAutopilotActionPolicy(base({ actorRole: role, actionType: "RESOLVE_UNANSWERED_FAQ" }))).toMatchObject({ code: "RBAC_FORBIDDEN" });
  });
});

describe("spend and action caps (values from the real config defaults)", () => {
  // Source of each limit: prisma/schema.prisma AutopilotConfiguration defaults, and
  // lib/autopilot/policy.ts fallbacks used when a value is absent.
  it("uses the schema defaults: batch 50, auto-discount 0%, daily spend 25,000 minor KES", async () => {
    const schema = (await import("node:fs")).readFileSync("prisma/schema.prisma", "utf8");
    const block = schema.slice(schema.indexOf("model AutopilotConfiguration"));
    expect(block).toMatch(/maxBatchRecipients\s+Int\s+@default\(50\)/);
    expect(block).toMatch(/maxAutoDiscountPct\s+Int\s+@default\(0\)/);
    expect(block).toMatch(/dailySpendCapMinorKES\s+Int\s+@default\(25000\)/);
  });

  it("batch: exactly at the cap is allowed; one above is blocked (boundary)", () => {
    const at = evaluateAutopilotActionPolicy(base({ phase: "PROPOSE", actionType: "QUEUE_CONSENTED_FOLLOWUP", payload: followupPayload(3) as never, maxBatchRecipients: 3, riskCategory: "MEDIUM_RISK_REVERSIBLE" }));
    expect(at.allowed).toBe(true);
    const over = evaluateAutopilotActionPolicy(base({ phase: "PROPOSE", actionType: "QUEUE_CONSENTED_FOLLOWUP", payload: followupPayload(4) as never, maxBatchRecipients: 3, riskCategory: "MEDIUM_RISK_REVERSIBLE" }));
    expect(over).toMatchObject({ allowed: false, code: "BATCH_RECIPIENT_CAP_EXCEEDED" });
  });

  it("auto-discount: a discount at the cap runs in ADVANCED mode; above the cap is blocked", () => {
    const ok = evaluateAutopilotActionPolicy(base({ phase: "AUTO_EXECUTE", autonomyMode: "ADVANCED", actionType: "CREATE_OR_UPDATE_OFFER", riskCategory: "MEDIUM_RISK_REVERSIBLE", payload: offerPayload as never, maxAutoDiscountPct: 10 }));
    expect(ok.allowed).toBe(true);
    const over = evaluateAutopilotActionPolicy(base({ phase: "AUTO_EXECUTE", autonomyMode: "ADVANCED", actionType: "CREATE_OR_UPDATE_OFFER", riskCategory: "MEDIUM_RISK_REVERSIBLE", payload: offerPayload as never, maxAutoDiscountPct: 9 }));
    expect(over).toMatchObject({ allowed: false, code: "AUTO_DISCOUNT_CAP_EXCEEDED" });
  });

  it.each([
    ["zero", 0],
    ["negative", -1],
    ["fractional", 2.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ])("invalid batch cap (%s) fails closed", (_label, cap) => {
    const d = evaluateAutopilotActionPolicy(base({ phase: "PROPOSE", actionType: "QUEUE_CONSENTED_FOLLOWUP", payload: followupPayload(1) as never, maxBatchRecipients: cap as number, riskCategory: "MEDIUM_RISK_REVERSIBLE" }));
    expect(d).toMatchObject({ allowed: false, code: "BATCH_RECIPIENT_CAP_EXCEEDED" });
  });

  it("an absent batch cap falls back to the code default of 50 (not unlimited)", () => {
    const { maxBatchRecipients: _m, ...rest } = base({ phase: "PROPOSE", actionType: "QUEUE_CONSENTED_FOLLOWUP", payload: followupPayload(51) as never, riskCategory: "MEDIUM_RISK_REVERSIBLE" });
    const d = evaluateAutopilotActionPolicy(rest as PolicyEvaluationInput);
    expect(d).toMatchObject({ allowed: false, code: "BATCH_RECIPIENT_CAP_EXCEEDED" });
  });

  it("payload validation rejects a batch count above the tenant cap and a smuggled recipientCount field", () => {
    expect(validateAutopilotActionPayload("QUEUE_CONSENTED_FOLLOWUP", followupPayload(4), { maxBatchRecipients: 3 })).toMatchObject({ ok: false, code: "BATCH_RECIPIENT_CAP_EXCEEDED" });
    expect(validateAutopilotActionPayload("QUEUE_CONSENTED_FOLLOWUP", { ...followupPayload(1), recipientCount: 1 }, { maxBatchRecipients: 3 })).toMatchObject({ ok: false });
  });
});

describe("Africa/Nairobi quiet hours (20:00–07:00, server-side timezone)", () => {
  // 2026-11-02 Nairobi is UTC+3 with no DST. 20:00 EAT = 17:00Z.
  const at = (iso: string) => new Date(iso);
  const quiet = (now: Date) => isWithinQuietHours({ now, quietHoursStart: "20:00", quietHoursEnd: "07:00", timezone: "Africa/Nairobi" });

  it("is open before the window (19:59) and closed at 12:00", () => {
    expect(quiet(at("2026-11-02T16:59:00Z"))).toBe(false); // 19:59 EAT
    expect(quiet(at("2026-11-02T09:00:00Z"))).toBe(false); // 12:00 EAT
  });
  it("starts at 20:00 inclusive (start boundary)", () => {
    expect(quiet(at("2026-11-02T16:59:59Z"))).toBe(false);
    expect(quiet(at("2026-11-02T17:00:00Z"))).toBe(true); // 20:00 EAT
  });
  it("is active through the overnight window", () => {
    expect(quiet(at("2026-11-02T21:30:00Z"))).toBe(true); // 00:30 EAT next day
  });
  it("ends at 07:00 exclusive (end boundary)", () => {
    expect(quiet(at("2026-11-03T03:59:59Z"))).toBe(true); // 06:59 EAT
    expect(quiet(at("2026-11-03T04:00:00Z"))).toBe(false); // 07:00 EAT
  });
  it("converts UTC correctly across the date boundary", () => {
    expect(quiet(at("2026-11-02T23:59:00Z"))).toBe(true); // 02:59 EAT on 03 Nov
  });
  it("applies the same window on weekends (no weekend exception in policy)", () => {
    expect(quiet(at("2026-11-07T18:00:00Z"))).toBe(true); // Sat 21:00 EAT
    expect(quiet(at("2026-11-08T08:00:00Z"))).toBe(false); // Sun 11:00 EAT
  });
  it("is independent of the process timezone (TZ) and the browser clock", () => {
    const instant = at("2026-11-02T17:00:00Z");
    process.env.TZ = "America/Los_Angeles";
    expect(quiet(instant)).toBe(true);
    process.env.TZ = "Pacific/Kiritimati";
    expect(quiet(instant)).toBe(true);
  });
  it("is stable across northern-hemisphere DST changes (Nairobi has none)", () => {
    expect(quiet(at("2026-03-08T16:59:59Z"))).toBe(false); // 19:59 EAT
    expect(quiet(at("2026-03-08T17:00:00Z"))).toBe(true); // 20:00 EAT
    expect(quiet(at("2026-07-01T17:00:00Z"))).toBe(true);
  });
  it("uses the tenant's configured window and zone when provided", () => {
    // 07:00Z is 10:00 in Nairobi (inside 09:00–11:00) but 07:00 in UTC (outside it).
    expect(isWithinQuietHours({ now: at("2026-11-02T07:00:00Z"), quietHoursStart: "09:00", quietHoursEnd: "11:00", timezone: "Africa/Nairobi" })).toBe(true);
    expect(isWithinQuietHours({ now: at("2026-11-02T07:00:00Z"), quietHoursStart: "09:00", quietHoursEnd: "11:00", timezone: "UTC" })).toBe(false);
  });
  it("falls back to 20:00–07:00 Nairobi when the stored window is malformed", () => {
    expect(isWithinQuietHours({ now: at("2026-11-02T17:00:00Z"), quietHoursStart: "25:99", quietHoursEnd: "bogus", timezone: "Africa/Nairobi" })).toBe(true);
  });
});
