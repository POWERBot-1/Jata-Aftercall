/**
 * Autopilot FIXTURE safety tests. The decision module runs the REAL policy functions over
 * FICTIONAL state. These tests prove the fixture's decisions match the server's policy, and
 * that the fixture cannot reach a database, provider, message channel or payment.
 *
 * Limits (stated, not hidden): database-backed controls (daily spend reservation, customer
 * profile lookup, row-level tenant filters, concurrency) are NOT exercised here. See
 * tests/prisma (CI PostgreSQL) and tests/unit/autopilot-execution-rollback-isolation.test.ts.
 */
import { describe, expect, it, vi, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import {
  buildFixtureOverview,
  createFixtureState,
  FIXTURE_BUSINESS_A,
  FIXTURE_BUSINESS_B,
  AUTOPILOT_FIXTURE_NOTICE,
  type FixtureState,
} from "@/lib/autopilot/fixtures/autopilotFixtureModel";
import { decideFixtureRequest, type FixtureRequest } from "@/lib/autopilot/fixtures/autopilotFixtureDecide";

const A = FIXTURE_BUSINESS_A;
const B = FIXTURE_BUSINESS_B;
// Fixed instants. Nairobi is UTC+3 with no DST.
const MON_10_EAT = new Date("2026-11-02T07:00:00Z"); // 10:00 Mon, open hours
const MON_21_EAT = new Date("2026-11-02T18:00:00Z"); // 21:00 Mon, quiet hours

function ask(state: FixtureState, request: FixtureRequest, now: Date = MON_10_EAT) {
  return decideFixtureRequest({ state, request }, now);
}
const approve = (businessId: string, proposalId: string) =>
  ({ kind: "PROPOSAL_OP", businessId, proposalId, operation: "APPROVE_AND_EXECUTE" }) as const;
const reject = (businessId: string, proposalId: string) =>
  ({ kind: "PROPOSAL_OP", businessId, proposalId, operation: "REJECT" }) as const;
const pause = (businessId: string, operationalStatus: "LIVE" | "PAUSED") =>
  ({ kind: "CONFIG_PATCH", businessId, patch: { operationalStatus } }) as const;
function statusOf(state: FixtureState, businessId: string, proposalId: string) {
  return state.businesses[businessId].proposals.find((p) => p.id === proposalId)?.status;
}
function auditActions(state: FixtureState, businessId: string) {
  return state.businesses[businessId].audit.map((a) => a.action);
}

afterEach(() => vi.unstubAllEnvs());

describe("merchant consent: granted, withdrawn, and attempts without consent", () => {
  it("consent granted (entitled, LIVE): an approved offer executes", () => {
    const s = createFixtureState("approval-pending");
    const r = ask(s, approve(A, `${A}-p-offer`));
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, proposal: { status: "EXECUTED" } });
    expect(statusOf(r.state, A, `${A}-p-offer`)).toBe("EXECUTED");
  });

  it("consent not granted (no active entitlement): live execution is refused with ENTITLEMENT_REQUIRED and nothing changes", () => {
    const s = createFixtureState("consent-not-granted");
    const r = ask(s, approve(A, `${A}-p-faq`));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "ENTITLEMENT_REQUIRED" });
    expect(statusOf(r.state, A, `${A}-p-faq`)).toBe("PROPOSED");
  });

  it("consent withdrawn (tenant PAUSED): execution and new proposals are blocked, and the audit trail records the pause", () => {
    let s = createFixtureState("ready");
    s = ask(s, pause(A, "PAUSED")).state;
    expect(auditActions(s, A)).toContain("autopilot.config.paused");
    const exec = ask(s, approve(A, `${A}-p-faq`));
    expect(exec.status).toBe(409);
    expect(exec.body).toMatchObject({ code: "TENANT_AUTOPILOT_PAUSED" });
    expect(statusOf(exec.state, A, `${A}-p-faq`)).toBe("PROPOSED");
    const propose = ask(s, {
      kind: "PROPOSE",
      businessId: A,
      candidate: { actionType: "RESOLVE_UNANSWERED_FAQ", title: "FIXTURE new", rationale: "r", expectedImpact: null, payload: { actionType: "RESOLVE_UNANSWERED_FAQ", question: "Q?", answer: "A" }, idempotencyKey: "new-key-1" },
    });
    expect(propose.body).toMatchObject({ code: "TENANT_AUTOPILOT_PAUSED" });
  });

  it("resuming (LIVE) re-enables execution; withdrawal is reversible through the same audited control", () => {
    let s = createFixtureState("ready");
    s = ask(s, pause(A, "PAUSED")).state;
    s = ask(s, pause(A, "LIVE")).state;
    expect(ask(s, approve(A, `${A}-p-faq`)).body).toMatchObject({ ok: true });
  });

  it("attempted action without consent: a follow-up with no opted-in customer is refused with CONSENT_NOT_GRANTED", () => {
    const s = createFixtureState("approval-pending");
    const withoutOptIn = {
      ...s,
      businesses: { ...s.businesses, [A]: { ...s.businesses[A], consents: s.businesses[A].consents.map((c) => ({ ...c, status: "OPTED_OUT" as const })) } },
    };
    const r = ask(withoutOptIn, approve(A, `${A}-p-follow`));
    expect(r.body).toMatchObject({ code: "CONSENT_NOT_GRANTED" });
    expect(statusOf(r.state, A, `${A}-p-follow`)).toBe("PROPOSED");
  });

  it("a recorded opt-in lets a follow-up proceed only as a fictional outbox entry (nothing sent)", () => {
    const s = createFixtureState("approval-pending");
    const r = ask(s, approve(A, `${A}-p-follow`));
    expect(r.status).toBe(200);
    expect(String(r.body.fixtureNote)).toMatch(/Nothing was sent/);
  });

  it("consent visibility: recording a consent row is audited and appears only in the owning tenant", () => {
    const s = createFixtureState("ready");
    const r = ask(s, { kind: "CONSENT_RECORD", businessId: A, channel: "WHATSAPP", scope: "TRANSACTIONAL", status: "OPTED_IN", label: "FIXTURE Customer 9" });
    expect(r.status).toBe(200);
    expect(auditActions(r.state, A)).toContain("autopilot.consent.updated");
    expect(buildFixtureOverview(r.state, A).auditEvents.map((e) => e.action)).toContain("autopilot.consent.updated");
    expect(buildFixtureOverview(r.state, B).auditEvents.map((e) => e.action)).not.toContain("autopilot.consent.updated");
  });
});

describe("human approval controls", () => {
  it("approval required: a SUPERVISED pricing proposal waits in PROPOSED until a person approves", () => {
    const s = createFixtureState("approval-pending");
    expect(statusOf(s, A, `${A}-p-offer`)).toBe("PROPOSED");
    expect(ask(s, approve(A, `${A}-p-offer`)).status).toBe(200);
  });

  it("rejection is final: a rejected proposal cannot be approved, re-rejected, or executed", () => {
    let s = createFixtureState("approval-pending");
    s = ask(s, reject(A, `${A}-p-offer`)).state;
    expect(statusOf(s, A, `${A}-p-offer`)).toBe("REJECTED");
    const again = ask(s, approve(A, `${A}-p-offer`));
    expect(again.status).toBe(409);
    expect(again.body).toMatchObject({ code: "INVALID_PROPOSAL_STATE" });
    expect(ask(s, reject(A, `${A}-p-offer`)).status).toBe(409);
    expect(statusOf(again.state, A, `${A}-p-offer`)).toBe("REJECTED");
  });

  it("expired approval: an expired proposal is marked EXPIRED and must be regenerated", () => {
    const s = createFixtureState("approval-pending");
    const r = ask(s, approve(A, `${A}-p-old`));
    expect(r.body).toMatchObject({ code: "PROPOSAL_EXPIRED" });
    expect(statusOf(r.state, A, `${A}-p-old`)).toBe("EXPIRED");
    expect(ask(r.state, approve(A, `${A}-p-old`)).body).toMatchObject({ code: "INVALID_PROPOSAL_STATE" });
  });

  it("duplicate approval attempts: a second approve replays the result and does not execute twice", () => {
    let s = createFixtureState("approval-pending");
    s = ask(s, approve(A, `${A}-p-offer`)).state;
    const replay = ask(s, approve(A, `${A}-p-offer`));
    expect(replay.status).toBe(200);
    expect(replay.body).toMatchObject({ idempotentReplay: true });
    const executions = auditActions(replay.state, A).filter((x) => x === "autopilot.proposal.executed");
    expect(executions).toHaveLength(1);
  });

  it("unauthorized approval attempts: STAFF and VIEWER cannot approve or reject", () => {
    for (const role of ["STAFF", "VIEWER"] as const) {
      const s = { ...createFixtureState("approval-pending"), actorRole: role };
      expect(ask(s, approve(A, `${A}-p-offer`))).toMatchObject({ status: 403, body: { code: "RBAC_FORBIDDEN" } });
      expect(ask(s, reject(A, `${A}-p-offer`))).toMatchObject({ status: 403, body: { code: "RBAC_FORBIDDEN" } });
      expect(statusOf(s, A, `${A}-p-offer`)).toBe("PROPOSED");
    }
  });

  it("invalid approval: an unknown proposal id is rejected with 404", () => {
    const s = createFixtureState("approval-pending");
    expect(ask(s, approve(A, "does-not-exist"))).toMatchObject({ status: 404, body: { code: "NOT_FOUND" } });
  });

  it("cancellation: a reject before execution cancels; rollback is available only for executed actions", () => {
    const s = createFixtureState("approval-pending");
    expect(ask(s, { kind: "PROPOSAL_OP", businessId: A, proposalId: `${A}-p-offer`, operation: "ROLLBACK" }).status).toBe(409);
    const executed = ask(createFixtureState("ready"), { kind: "PROPOSAL_OP", businessId: A, proposalId: `${A}-p-offer`, operation: "ROLLBACK" });
    expect(executed.body).toMatchObject({ ok: true, proposal: { status: "ROLLED_BACK" } });
  });
});

describe("kill switch", () => {
  it("active: every execution and proposal is blocked, and the state does not change", () => {
    const s = createFixtureState("kill-switch");
    expect(s.globalKillSwitch).toBe(true);
    const r = ask(s, approve(A, `${A}-p-faq`));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "GLOBAL_KILL_SWITCH_ACTIVE" });
    expect(statusOf(r.state, A, `${A}-p-faq`)).toBe("PROPOSED");
  });

  it("repeated and retried requests stay blocked; refresh-equivalent state does not bypass it", () => {
    let s = createFixtureState("kill-switch");
    for (let i = 0; i < 5; i++) {
      const r = ask(s, approve(A, `${A}-p-faq`));
      expect(r.body).toMatchObject({ code: "GLOBAL_KILL_SWITCH_ACTIVE" });
      s = r.state;
    }
    expect(statusOf(s, A, `${A}-p-faq`)).toBe("PROPOSED");
  });

  it("resuming the tenant does not bypass a platform kill switch", () => {
    let s = createFixtureState("kill-switch");
    s = ask(s, pause(A, "PAUSED")).state;
    s = ask(s, pause(A, "LIVE")).state;
    expect(ask(s, approve(A, `${A}-p-faq`)).body).toMatchObject({ code: "GLOBAL_KILL_SWITCH_ACTIVE" });
  });

  it("cannot be disabled from the client: the route ignores any client-sent state and the server session stays active", async () => {
    const { createFixtureSession } = await import("@/lib/autopilot/fixtures/autopilotFixtureSessions");
    const { POST } = await import("@/app/dev/autopilot-fixture/decide/route");
    const { id } = createFixtureSession({ scenario: "kill-switch", role: "OWNER", tenant: "a" });
    const send = (payload: Record<string, unknown>) =>
      POST(new Request("http://localhost/dev/autopilot-fixture/decide", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }));
    // Client attempts to smuggle a state that has the switch off.
    const tampered = await send({ action: "REQUEST", sessionId: id, state: { globalKillSwitch: false, activeBusinessId: A, businesses: {}, actorRole: "OWNER" }, request: approve(A, `${A}-p-faq`) });
    expect(tampered.status).toBe(409);
    expect(await tampered.json()).toMatchObject({ code: "GLOBAL_KILL_SWITCH_ACTIVE" });
    // Unknown or malformed session ids are refused.
    const unknown = await send({ action: "REQUEST", sessionId: "00000000-0000-4000-8000-000000000000", request: approve(A, `${A}-p-faq`) });
    expect(unknown.status).toBe(404);
    const malformed = await send({ action: "REQUEST", sessionId: "not-a-uuid", request: approve(A, `${A}-p-faq`) });
    expect(malformed.status).toBe(404);
    const noAction = await send({ sessionId: id });
    expect(noAction.status).toBe(400);
  });

  it("unauthorized attempts to change tenant controls are refused for STAFF", () => {
    const s = { ...createFixtureState("ready"), actorRole: "STAFF" as const };
    const r = ask(s, pause(A, "PAUSED"));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "RBAC_FORBIDDEN" });
  });

  it("inactive: the same approval proceeds (the switch is the only difference)", () => {
    const s = createFixtureState("ready");
    expect(ask(s, approve(A, `${A}-p-faq`)).body).toMatchObject({ ok: true });
  });

  it("reactivation is not exposed in the fixture: the switch is env-only and no request can change it", () => {
    const s = createFixtureState("kill-switch");
    const r = ask(s, { kind: "CONFIG_PATCH", businessId: A, patch: { operationalStatus: "LIVE" } });
    expect(r.state.globalKillSwitch).toBe(true);
  });
});

describe("quiet hours (server decides, Africa/Nairobi)", () => {
  it("a follow-up is blocked during 20:00–07:00 and succeeds at 10:00, using the server clock", () => {
    const s = createFixtureState("approval-pending");
    const blocked = ask(s, approve(A, `${A}-p-follow`), MON_21_EAT);
    expect(blocked.status).toBe(409);
    expect(blocked.body).toMatchObject({ code: "QUIET_HOURS_ACTIVE" });
    expect(statusOf(blocked.state, A, `${A}-p-follow`)).toBe("PROPOSED");
    const later = ask(blocked.state, approve(A, `${A}-p-follow`), MON_10_EAT);
    expect(later.body).toMatchObject({ ok: true });
  });

  it("a client-supplied time is ignored: the decision uses only the server clock", () => {
    const s = createFixtureState("approval-pending");
    const r = decideFixtureRequest({ state: s, request: { ...approve(A, `${A}-p-follow`), now: "2026-11-02T07:00:00Z", clientTime: "10:00" } as never }, MON_21_EAT);
    expect(r.body).toMatchObject({ code: "QUIET_HOURS_ACTIVE" });
  });
});

describe("caps (tenant-specific, from fictional config)", () => {
  it("a follow-up above the batch cap is blocked at approval; the cap is per tenant", () => {
    const s = createFixtureState("cap-reached");
    const r = ask(s, approve(A, `${A}-p-follow`));
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "BATCH_RECIPIENT_CAP_EXCEEDED" });
    // Tenant B keeps its own cap (50 by default), so its equal-size follow-up is not affected.
    expect(s.businesses[B].maxBatchRecipients).toBe(50);
  });

  it("a tenant's cap change does not affect another tenant", () => {
    let s = createFixtureState("approval-pending");
    s = { ...s, businesses: { ...s.businesses, [B]: { ...s.businesses[B], maxBatchRecipients: 1 } } };
    expect(ask(s, approve(A, `${A}-p-follow`)).body).toMatchObject({ ok: true });
  });

  it("a payload claiming a batch size above the cap is rejected at proposal time", () => {
    const s = createFixtureState("cap-reached");
    const r = ask(s, { kind: "PROPOSE", businessId: A, candidate: { actionType: "QUEUE_CONSENTED_FOLLOWUP", title: "FIXTURE big", rationale: "r", expectedImpact: null, payload: { actionType: "QUEUE_CONSENTED_FOLLOWUP", channel: "WHATSAPP", scope: "TRANSACTIONAL", batchRecipientCount: 999, body: "FIXTURE" }, idempotencyKey: "big-1" } });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ code: "BATCH_RECIPIENT_CAP_EXCEEDED" });
  });

  it("invalid client-supplied fields are rejected rather than coerced", () => {
    const s = createFixtureState("ready");
    const r = ask(s, { kind: "PROPOSE", businessId: A, candidate: { actionType: "QUEUE_CONSENTED_FOLLOWUP", title: "x", rationale: "r", expectedImpact: null, payload: { actionType: "QUEUE_CONSENTED_FOLLOWUP", channel: "WHATSAPP", scope: "TRANSACTIONAL", recipientCount: 1, body: "x" }, idempotencyKey: "bad-1" } });
    expect(r.body).toMatchObject({ code: "MISMATCHED_RECIPIENT_COUNT_FIELD" });
  });
});

describe("tenant isolation (fixture decisions)", () => {
  it("a tenant-A actor cannot act on tenant B at all (403, no state change)", () => {
    const s = createFixtureState("approval-pending", { tenant: "a" });
    const r = ask(s, approve(B, `${B}-p-offer`));
    expect(r.status).toBe(403);
    expect(r.body).toMatchObject({ code: "TENANT_FORBIDDEN" });
    expect(statusOf(r.state, B, `${B}-p-offer`)).toBe("PROPOSED");
  });

  it("a tenant-A actor cannot modify tenant B's limits or pause state", () => {
    const s = createFixtureState("ready");
    const r = ask(s, pause(B, "PAUSED"));
    expect(r.status).toBe(403);
    expect(r.state.businesses[B].operationalStatus).toBe("LIVE");
  });

  it("a cross-tenant approval ID is rejected under the tenant-A scope (404), and B's record is unchanged", () => {
    const s = createFixtureState("approval-pending", { tenant: "a" });
    const r = ask(s, approve(A, `${B}-p-offer`));
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ code: "NOT_FOUND" });
    expect(statusOf(r.state, B, `${B}-p-offer`)).toBe("PROPOSED");
  });

  it("tenant A's overview shows no tenant B consents, proposals, audit or name", () => {
    const s = createFixtureState("approval-pending", { tenant: "a" });
    const overview = JSON.stringify(buildFixtureOverview(s, A));
    expect(overview).not.toContain(B);
    expect(overview).not.toContain("Lakeside Salon");
  });

  it("missing or empty tenant context fails closed", () => {
    const s = createFixtureState("ready");
    expect(decideFixtureRequest({ state: s, request: { kind: "PROPOSAL_OP", businessId: "", proposalId: `${A}-p-faq`, operation: "APPROVE_AND_EXECUTE" } }, MON_10_EAT).status).toBe(403);
    expect(decideFixtureRequest({ state: s, request: { kind: "PROPOSAL_OP", proposalId: `${A}-p-faq`, operation: "APPROVE_AND_EXECUTE" } as never }, MON_10_EAT).status).toBe(400);
    expect(decideFixtureRequest({ state: null, request: approve(A, `${A}-p-faq`) }, MON_10_EAT).status).toBe(400);
  });
});

describe("fixture isolation and honesty", () => {
  it("the decision route returns 404 in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const { POST } = await import("@/app/dev/autopilot-fixture/decide/route");
    const res = await POST(new Request("http://localhost/dev/autopilot-fixture/decide", { method: "POST", body: "{}" }));
    expect(res.status).toBe(404);
  });

  it("the fixture page calls notFound() in production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const mod = await import("@/app/dev/autopilot-fixture/page");
    await expect(mod.default({ searchParams: Promise.resolve({}) })).rejects.toThrow();
  });

  it("fixture modules do not import the database, the provider, or any real messaging or payment code", () => {
    const files = [
      "lib/autopilot/fixtures/autopilotFixtureModel.ts",
      "components/autopilot/fixture/AutopilotFixtureClient.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/from\s+["']@\/lib\/db["']/);
      expect(src).not.toMatch(/from\s+["']@\/lib\/paystack["']/);
      expect(src).not.toMatch(/from\s+["']@\/lib\/notification["']/);
      expect(src).not.toMatch(/from\s+["']@\/lib\/autopilot\/policy["']/);
    }
    const decide = readFileSync("lib/autopilot/fixtures/autopilotFixtureDecide.ts", "utf8");
    expect(decide).not.toMatch(/prisma\./);
    expect(decide).not.toMatch(/fetch\(/);
  });

  it("the notice states that nothing was sent, spent or changed", () => {
    expect(AUTOPILOT_FIXTURE_NOTICE).toMatch(/FICTIONAL FIXTURE/);
    expect(AUTOPILOT_FIXTURE_NOTICE).toMatch(/No message was sent/);
    expect(AUTOPILOT_FIXTURE_NOTICE).toMatch(/no money was spent/);
  });
});
