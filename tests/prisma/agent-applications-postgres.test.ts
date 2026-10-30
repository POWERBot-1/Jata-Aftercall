/** Isolated PostgreSQL only; synthetic adapter, no live messages or production payments. */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { uid } from "../helpers/prisma-fixtures";

const mock = vi.hoisted(() => ({ session: null as null | { userId: string; role: string; email: string } }));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", () => ({ getSession: async () => mock.session, hashPassword: async () => "synthetic-hash" }));
import { GET, POST } from "@/app/api/agents/application/route";
import { applyMetaStatus } from "@/lib/messaging/meta-whatsapp-webhook";
import { MockMessagingProvider } from "@/lib/messaging/providers";
import { issuePhoneChallenge, confirmPhoneChallenge } from "@/lib/agents/phone-verification";
import { allowAgentApplication } from "@/lib/agent-application-throttle";
import { POST as registerAgent } from "@/app/api/agents/register/route";
import { POST as rotateReferral } from "@/app/api/agents/referrals/route";
import { POST as decide } from "@/app/api/admin/agents/applications/[id]/decision/route";
import { POST as reject } from "@/app/api/admin/agents/applications/[id]/reject/route";

const p = realPrismaConfigured ? sharedPrisma() : null;
const users: string[] = [];
const throttleKeys: string[] = [];
const originalSecret = process.env.AUTH_SECRET;
const body = { fullName: "Synthetic Applicant", phone: "0712345678", privacyAccepted: true };
const request = (url: string, data: unknown) => new Request(`https://agent.test${url}`, {
  method: "POST", headers: { host: "agent.test", origin: "https://agent.test", "content-type": "application/json" }, body: JSON.stringify(data),
});

describe.skipIf(!realPrismaConfigured)("real PostgreSQL: agent application and audit", () => {
  beforeAll(() => {
    if (!process.env.AUTH_SECRET && !process.env.NEXTAUTH_SECRET) process.env.AUTH_SECRET = "agent-integration-test-only";
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    // Opt-in is insufficient: refuse remote databases and names other than disposable JATA CI DBs.
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) {
      throw new Error("Agent integration tests require a loopback disposable JATA test database.");
    }
  });
  afterAll(async () => {
    if (!p) return;
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET!;
    const userKeys = users.map((id) => createHmac("sha256", secret).update(`agent-application-account:v1:${id}`).digest("hex"));
    if (throttleKeys.length || userKeys.length) await p.agentRegistrationThrottle.deleteMany({ where: { key: { in: [...throttleKeys, ...userKeys] } } });
    if (originalSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = originalSecret;
    await p.auditEvent.deleteMany({ where: { actorId: { in: users } } });
    await p.agentReferralAttribution.deleteMany({ where: { OR: [{ referrer: { userId: { in: users } } }, { referred: { userId: { in: users } } }] } });
    await p.agentReferralLink.deleteMany({ where: { referrer: { userId: { in: users } } } });
    await p.agentWhatsAppWebhookEvent.deleteMany({ where: { challenge: { application: { userId: { in: users } } } } });
    await p.agentPhoneChallenge.deleteMany({ where: { application: { userId: { in: users } } } });
    await p.agentApplication.deleteMany({ where: { userId: { in: users } } });
    await p.user.deleteMany({ where: { id: { in: users } } });
    await p.$disconnect();
  });

  it("enforces an atomic shared account limit and resets an expired window", async () => {
    const identity = `throttle-${uid()}`;
    const key = createHmac("sha256", process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET!).update(`agent-application-account:v1:${identity}`).digest("hex");
    throttleKeys.push(key);
    const results = await Promise.all(Array.from({ length: 12 }, () => allowAgentApplication(identity)));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect((await p.agentRegistrationThrottle.findUniqueOrThrow({ where: { key } })).count).toBe(5);
    await p.agentRegistrationThrottle.update({ where: { key }, data: { expiresAt: new Date(0) } });
    expect(await allowAgentApplication(identity)).toBe(true);
    expect((await p.agentRegistrationThrottle.findUniqueOrThrow({ where: { key } })).count).toBe(1);
  });

  it("verifies a synthetic OTP once, without activation or duplicate verified phones", async () => {
    const provider = new MockMessagingProvider();
    const config = { provider, secret: "synthetic-only-secret-at-least-32-chars", sender: "fixture" };
    throttleKeys.push(createHmac("sha256", config.secret).update("agent-phone-limit:v1:phone:+254712345678").digest("hex"));
    const first = await p.user.create({ data: { email: `verify-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    const second = await p.user.create({ data: { email: `duplicate-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    users.push(first.id, second.id);
    const a = await p.agentApplication.create({ data: { userId: first.id, fullName: "Synthetic User", phoneE164: "+254712345678", privacyAcknowledgedAt: new Date() } });
    await p.agentApplication.create({ data: { userId: second.id, fullName: "Other Synthetic", phoneE164: "+254712345678", privacyAcknowledgedAt: new Date() } });
    expect(await issuePhoneChallenge(first.id, config)).toBe("sent");
    const code = provider.sent[0].body.match(/\b\d{6}\b/)![0];
    const challenge = await p.agentPhoneChallenge.findUniqueOrThrow({ where: { applicationId: a.id } });
    expect(challenge.codeDigest).not.toContain(code);
    expect(await confirmPhoneChallenge(first.id, code === "000000" ? "000001" : "000000", config.secret)).toBe("invalid");
    const results = await Promise.all([confirmPhoneChallenge(first.id, code, config.secret), confirmPhoneChallenge(first.id, code, config.secret)]);
    expect(results.sort()).toEqual(["already", "verified"]);
    const updated = await p.agentApplication.findUniqueOrThrow({ where: { id: a.id } });
    expect(updated.status).toBe("PENDING");
    expect(updated.verifiedPhoneE164).toBe("+254712345678");
    expect(await p.auditEvent.count({ where: { action: "AGENT_PHONE_VERIFIED", targetId: a.id } })).toBe(1);
    expect(await issuePhoneChallenge(second.id, config)).toBe("sent");
    const secondCode = provider.sent[1].body.match(/\b\d{6}\b/)![0];
    await expect(confirmPhoneChallenge(second.id, secondCode, config.secret)).rejects.toThrow();
    expect((await p.agentApplication.findUniqueOrThrow({ where: { userId: second.id } })).phoneVerifiedAt).toBeNull();
  });

  it("uses a synthetic WhatsApp authentication template once under concurrent requests", async () => {
    const secret = "whatsapp-synthetic-only-secret-at-least-32";
    const phone = "+254700000002";
    throttleKeys.push(createHmac("sha256", secret).update(`agent-phone-limit:v1:phone:${phone}`).digest("hex"));
    const user = await p.user.create({ data: { email: `wa-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    users.push(user.id);
    const app = await p.agentApplication.create({ data: { userId: user.id, fullName: "Synthetic WhatsApp", phoneE164: phone, privacyAcknowledgedAt: new Date() } });
    const provider = new MockMessagingProvider();
    provider.channel = "WHATSAPP";
    const config = { provider, secret, sender: "fixture", template: { name: "fixture_auth", language: "en" } };
    await Promise.all([issuePhoneChallenge(user.id, config), issuePhoneChallenge(user.id, config)]);
    expect(provider.sent).toHaveLength(1);
    expect(provider.sent[0].body).toBe("");
    expect(provider.sent[0].authenticationTemplate?.name).toBe("fixture_auth");
    const code = provider.sent[0].authenticationTemplate!.code;
    const stored = await p.agentPhoneChallenge.findUniqueOrThrow({ where: { applicationId: app.id } });
    expect(stored.deliveryChannel).toBe("WHATSAPP");
    expect(stored.deliveryState).toBe("ACCEPTED");
    expect(stored.providerMessageId).toBeTruthy();
    expect(stored.codeDigest).not.toContain(code);
    expect(await confirmPhoneChallenge(user.id, code, secret)).toBe("verified");
    expect((await p.agentApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("PENDING");
  });

  it("requires separate reviewed, verified activation and serializes decisions with audit", async () => {
    const admin = await p.user.create({ data: { email: `reviewer-${uid()}@test.invalid`, passwordHash: "test-only", role: "ADMIN" } });
    const applicant = await p.user.create({ data: { email: `reviewee-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    users.push(admin.id, applicant.id);
    const app = await p.agentApplication.create({ data: { userId: applicant.id, fullName: "Review Fixture", phoneE164: "+254700000099", privacyAcknowledgedAt: new Date() } });
    const params = Promise.resolve({ id: app.id });
    const approve = () => request(`/api/admin/agents/applications/${app.id}/decision`, { action: "approve", reason: "MANUAL_ELIGIBILITY_REVIEW" });
    const suspend = () => request(`/api/admin/agents/applications/${app.id}/decision`, { action: "suspend", reason: "COMPLIANCE_REVIEW" });
    const old = process.env.AGENT_ACTIVATION_ENABLED;
    try {
      mock.session = { userId: admin.id, role: "ADMIN", email: admin.email };
      delete process.env.AGENT_ACTIVATION_ENABLED;
      expect((await decide(approve(), { params })).status).toBe(503);
      process.env.AGENT_ACTIVATION_ENABLED = "true";
      expect((await decide(approve(), { params })).status).toBe(409);
      await p.agentApplication.update({ where: { id: app.id }, data: { verifiedPhoneE164: app.phoneE164, phoneVerifiedAt: new Date() } });
      mock.session = { userId: applicant.id, role: "ADMIN", email: applicant.email };
      expect((await decide(approve(), { params })).status).toBe(403); // database role, not session
      mock.session = { userId: admin.id, role: "ADMIN", email: admin.email };
      const decisions = await Promise.all([decide(approve(), { params }), decide(approve(), { params })]);
      expect(decisions.map((r) => r.status)).toEqual([200, 200]);
      expect(await p.auditEvent.count({ where: { actorId: admin.id, action: "AGENT_APPLICATION_APPROVED", targetId: app.id } })).toBe(1);
      expect((await p.user.findUniqueOrThrow({ where: { id: applicant.id } })).role).toBe("CUSTOMER");
      expect((await reject(request(`/api/admin/agents/applications/${app.id}/reject`, { reason: "APPLICANT_REQUEST" }), { params })).status).toBe(409);
      delete process.env.AGENT_ACTIVATION_ENABLED;
      expect((await decide(suspend(), { params })).status).toBe(200);
      expect((await decide(suspend(), { params })).status).toBe(200);
      expect(await p.auditEvent.count({ where: { actorId: admin.id, action: "AGENT_APPLICATION_SUSPENDED", targetId: app.id } })).toBe(1);
      process.env.AGENT_ACTIVATION_ENABLED = "true";
      expect((await decide(approve(), { params })).status).toBe(409);
      const selfApp = await p.agentApplication.create({ data: { userId: admin.id, fullName: "Admin Fixture", phoneE164: "+254700000098", verifiedPhoneE164: "+254700000098", phoneVerifiedAt: new Date(), privacyAcknowledgedAt: new Date() } });
      expect((await decide(request(`/api/admin/agents/applications/${selfApp.id}/decision`, { action: "approve", reason: "MANUAL_ELIGIBILITY_REVIEW" }), { params: Promise.resolve({ id: selfApp.id }) })).status).toBe(403);
    } finally { if (old === undefined) delete process.env.AGENT_ACTIVATION_ENABLED; else process.env.AGENT_ACTIVATION_ENABLED = old; mock.session = null; }
  });

  it("rotates active-agent links and records only explicitly consented registration evidence", async () => {
    const envNames = ["AGENT_REGISTRATION_REFERRALS_ENABLED", "AGENT_REFERRAL_LINK_LIFETIME_SECONDS", "AGENT_SELF_SERVICE_REGISTRATION_ENABLED"] as const;
    const before = Object.fromEntries(envNames.map((key) => [key, process.env[key]]));
    const secret = process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET!;
    throttleKeys.push(createHmac("sha256", secret).update("agent-registration:v1:untrusted-proxy").digest("hex"));
    const agent = await p.user.create({ data: { email: `referrer-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } }); users.push(agent.id);
    const app = await p.agentApplication.create({ data: { userId: agent.id, fullName: "Synthetic Referrer", phoneE164: "+254700000096", verifiedPhoneE164: "+254700000096", phoneVerifiedAt: new Date(), privacyAcknowledgedAt: new Date(), agentStatus: "ACTIVE" } });
    try {
      process.env.AGENT_REGISTRATION_REFERRALS_ENABLED = "true"; process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS = "3600"; process.env.AGENT_SELF_SERVICE_REGISTRATION_ENABLED = "true";
      mock.session = { userId: agent.id, role: "CUSTOMER", email: agent.email };
      const first = await rotateReferral(request("/api/agents/referrals", {})); expect(first.status).toBe(200);
      const oldCode = new URL((await first.json()).path, "https://agent.test").searchParams.get("ref");
      const second = await rotateReferral(request("/api/agents/referrals", {})); expect(second.status).toBe(200);
      const code = new URL((await second.json()).path, "https://agent.test").searchParams.get("ref");
      expect(code).not.toBe(oldCode);
      const links = await p.agentReferralLink.findMany({ where: { referrerApplicationId: app.id } });
      expect(links).toHaveLength(2); expect(links.filter((l: { revokedAt: Date | null }) => !l.revokedAt)).toHaveLength(1);
      expect(links.every((l: { tokenHash: string }) => l.tokenHash !== code && l.tokenHash !== oldCode)).toBe(true);
      mock.session = null;
      for (const [index, token, consent] of [[0, code, true], [1, oldCode, true], [2, code, false], [3, code, true], [4, code, true]] as const) {
        if (index === 4) await p.agentReferralLink.updateMany({ where: { referrerApplicationId: app.id, revokedAt: null }, data: { expiresAt: new Date(0) } });
        const email = `referred-${uid()}@test.invalid`;
        const response = await registerAgent(request("/api/agents/register", { fullName: "Synthetic Applicant", email, phone: index === 3 ? "0700000096" : `07000000${80 + index}`, password: "synthetic-pass-123", privacyAccepted: true, termsAccepted: true, referralCode: token, referralConsent: consent }));
        expect(response.status).toBe(200);
        const user = await p.user.findUniqueOrThrow({ where: { email } }); users.push(user.id);
        const referred = await p.agentApplication.findUniqueOrThrow({ where: { userId: user.id } });
        const evidence = await p.agentReferralAttribution.findUnique({ where: { referredApplicationId: referred.id } });
        if (index === 0) expect(evidence?.referrerApplicationId).toBe(app.id); else expect(evidence).toBeNull();
      }
      expect(await p.agentReferralAttribution.count({ where: { referrerApplicationId: app.id } })).toBe(1);
      const existing = await p.agentReferralAttribution.findFirstOrThrow({ where: { referrerApplicationId: app.id } });
      await expect(p.agentReferralAttribution.create({ data: { referrerApplicationId: app.id, referredApplicationId: existing.referredApplicationId, linkId: existing.linkId, consentedAt: new Date() } })).rejects.toMatchObject({ code: "P2002" });
      mock.session = { userId: agent.id, role: "CUSTOMER", email: agent.email };
      const concurrent = await Promise.all([rotateReferral(request("/api/agents/referrals", {})), rotateReferral(request("/api/agents/referrals", {}))]);
      expect(concurrent.map((response) => response.status)).toEqual([200, 200]);
      expect(await p.agentReferralLink.count({ where: { referrerApplicationId: app.id, revokedAt: null } })).toBe(1);
      expect(await p.auditEvent.count({ where: { action: "AGENT_REGISTRATION_ATTRIBUTION_RECORDED", actorId: { in: users } } })).toBe(1);
      await p.agentApplication.update({ where: { id: app.id }, data: { agentStatus: "SUSPENDED" } });
      mock.session = { userId: agent.id, role: "CUSTOMER", email: agent.email };
      expect((await rotateReferral(request("/api/agents/referrals", {}))).status).toBe(403);
    } finally { for (const key of envNames) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } mock.session = null; }
  });

  it("serializes competing approval and rejection without contradictory audits", async () => {
    const admin = await p.user.create({ data: { email: `race-admin-${uid()}@test.invalid`, passwordHash: "test-only", role: "ADMIN" } });
    const applicant = await p.user.create({ data: { email: `race-applicant-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    users.push(admin.id, applicant.id);
    const app = await p.agentApplication.create({ data: { userId: applicant.id, fullName: "Race Fixture", phoneE164: "+254700000097", verifiedPhoneE164: "+254700000097", phoneVerifiedAt: new Date(), privacyAcknowledgedAt: new Date() } });
    const previous = process.env.AGENT_ACTIVATION_ENABLED;
    try {
      process.env.AGENT_ACTIVATION_ENABLED = "true";
      mock.session = { userId: admin.id, role: "ADMIN", email: admin.email };
      const params = { params: Promise.resolve({ id: app.id }) };
      const [approval, rejection] = await Promise.all([
        decide(request(`/api/admin/agents/applications/${app.id}/decision`, { action: "approve", reason: "MANUAL_ELIGIBILITY_REVIEW" }), params),
        reject(request(`/api/admin/agents/applications/${app.id}/reject`, { reason: "APPLICANT_REQUEST" }), params),
      ]);
      expect([approval.status, rejection.status].sort()).toEqual([200, 409]);
      const current = await p.agentApplication.findUniqueOrThrow({ where: { id: app.id } });
      expect([["PENDING", "ACTIVE"], ["REJECTED", "INACTIVE"]]).toContainEqual([current.status, current.agentStatus]);
      expect(await p.auditEvent.count({ where: { targetId: app.id, action: { in: ["AGENT_APPLICATION_APPROVED", "AGENT_APPLICATION_REJECTED"] } } })).toBe(1);
    } finally { if (previous === undefined) delete process.env.AGENT_ACTIVATION_ENABLED; else process.env.AGENT_ACTIVATION_ENABLED = previous; mock.session = null; }
  });

  it("correlates webhook status once without activating the applicant", async () => {
    const user = await p.user.create({ data: { email: `hook-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } }); users.push(user.id);
    const app = await p.agentApplication.create({ data: { userId: user.id, fullName: "Synthetic Hook", phoneE164: "+254700000004", privacyAcknowledgedAt: new Date() } });
    const messageId = `wamid.synthetic${uid()}`;
    await p.agentPhoneChallenge.create({ data: { applicationId: app.id, phoneE164: app.phoneE164, nonce: uid(), codeDigest: "fixture", expiresAt: new Date(Date.now() + 60000), sentAt: new Date(), deliveryChannel: "WHATSAPP", deliveryState: "ACCEPTED", providerMessageId: messageId } });
    const event = { id: messageId, status: "delivered" as const, timestamp: "1700000000" };
    expect((await Promise.all([applyMetaStatus(event, "12345678"), applyMetaStatus(event, "12345678")])).sort()).toEqual(["applied", "duplicate"]);
    expect(await applyMetaStatus({ ...event, status: "read", timestamp: "1700000001" }, "12345678")).toBe("applied");
    expect(await applyMetaStatus({ ...event, status: "sent", timestamp: "1699999999" }, "12345678")).toBe("applied");
    const challenge = await p.agentPhoneChallenge.findUniqueOrThrow({ where: { applicationId: app.id } });
    expect(challenge.providerStatus).toBe("read");
    expect(await p.agentWhatsAppWebhookEvent.count({ where: { challengeId: challenge.id } })).toBe(3);
    expect((await p.agentApplication.findUniqueOrThrow({ where: { id: app.id } })).phoneVerifiedAt).toBeNull();
    expect(await applyMetaStatus({ ...event, id: "wamid.unknown" }, "12345678")).toBe("unmatched");
  });

  it("falls back to SMS only after explicit safe rejection, never after an unknown response", async () => {
    const secret = "fallback-fixture-secret-at-least-32-chars";
    for (const [i, safe] of [true, false].entries()) {
      const phone = `+25470000001${i}`;
      throttleKeys.push(createHmac("sha256", secret).update(`agent-phone-limit:v1:phone:${phone}`).digest("hex"));
      const user = await p.user.create({ data: { email: `fallback-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } }); users.push(user.id);
      const app = await p.agentApplication.create({ data: { userId: user.id, fullName: "Synthetic Fallback", phoneE164: phone, privacyAcknowledgedAt: new Date() } });
      const wa = new MockMessagingProvider(); wa.channel = "WHATSAPP";
      vi.spyOn(wa, "send").mockResolvedValue(safe ? { outcome: "FAILED", safeToFallback: true } : { outcome: "UNKNOWN" });
      const sms = new MockMessagingProvider();
      const result = await issuePhoneChallenge(user.id, { provider: wa, secret, sender: "fixture", template: { name: "auth", language: "en" }, fallback: { sender: "fixture", provider: sms } });
      expect(result).toBe(safe ? "sent" : "unavailable");
      expect(sms.sent).toHaveLength(safe ? 1 : 0);
      expect((await p.agentPhoneChallenge.findUniqueOrThrow({ where: { applicationId: app.id } })).deliveryChannel).toBe(safe ? "SMS" : "WHATSAPP");
    }
  });

  it("records an uncertain provider failure and refuses an immediate retry", async () => {
    const secret = "uncertain-fixture-secret-more-than-32-chars";
    const phone = "+254700000003";
    throttleKeys.push(createHmac("sha256", secret).update(`agent-phone-limit:v1:phone:${phone}`).digest("hex"));
    const user = await p.user.create({ data: { email: `unknown-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    users.push(user.id);
    const app = await p.agentApplication.create({ data: { userId: user.id, fullName: "Synthetic Unknown", phoneE164: phone, privacyAcknowledgedAt: new Date() } });
    const provider = new MockMessagingProvider();
    const send = vi.spyOn(provider, "send").mockRejectedValue(new Error("simulated timeout"));
    const config = { provider, secret, sender: "fixture" };
    expect(await issuePhoneChallenge(user.id, config)).toBe("unavailable");
    expect(await issuePhoneChallenge(user.id, config)).toBe("unavailable");
    expect(send).toHaveBeenCalledTimes(1);
    const record = await p.agentPhoneChallenge.findUniqueOrThrow({ where: { applicationId: app.id } });
    expect(record.deliveryState).toBe("UNKNOWN");
    expect(record.sentAt).toBeNull();
    expect(record.providerMessageId).toBeNull();
  });

  it("rejects expired, unsent and brute-forced synthetic challenges", async () => {
    const secret = "another-test-only-secret-at-least-32-chars";
    const phone = "+254700000001";
    throttleKeys.push(createHmac("sha256", secret).update(`agent-phone-limit:v1:phone:${phone}`).digest("hex"));
    const user = await p.user.create({ data: { email: `locked-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    users.push(user.id);
    const app = await p.agentApplication.create({ data: { userId: user.id, fullName: "Synthetic Locked", phoneE164: phone, privacyAcknowledgedAt: new Date() } });
    const failed = new MockMessagingProvider({ outcome: "FAILED" });
    expect(await issuePhoneChallenge(user.id, { provider: failed, secret, sender: "fixture" })).toBe("unavailable");
    const unsentCode = failed.sent[0].body.match(/\b\d{6}\b/)![0];
    expect(await confirmPhoneChallenge(user.id, unsentCode, secret)).toBe("invalid");
    // No duplicate send is attempted after rejection until the previous challenge expires.
    const mock = new MockMessagingProvider();
    expect(await issuePhoneChallenge(user.id, { provider: mock, secret, sender: "fixture" })).toBe("unavailable");
    expect(mock.sent).toHaveLength(0);
    await p.agentPhoneChallenge.update({ where: { applicationId: app.id }, data: { expiresAt: new Date(0) } });
    expect(await issuePhoneChallenge(user.id, { provider: mock, secret, sender: "fixture" })).toBe("sent");
    const code = mock.sent[0].body.match(/\b\d{6}\b/)![0];
    await p.agentPhoneChallenge.update({ where: { applicationId: app.id }, data: { expiresAt: new Date(0) } });
    expect(await confirmPhoneChallenge(user.id, code, secret)).toBe("invalid");
    // Advance the isolated throttle window too; no production time or policy is changed.
    await p.agentRegistrationThrottle.update({ where: { key: throttleKeys[throttleKeys.length - 1] }, data: { expiresAt: new Date(0) } });
    expect(await issuePhoneChallenge(user.id, { provider: mock, secret, sender: "fixture" })).toBe("sent");
    const newCode = mock.sent[1].body.match(/\b\d{6}\b/)![0];
    const wrong = newCode === "000000" ? "000001" : "000000";
    for (let i = 0; i < 5; i++) expect(await confirmPhoneChallenge(user.id, wrong, secret)).toBe("invalid");
    expect(await confirmPhoneChallenge(user.id, newCode, secret)).toBe("invalid");
    expect((await p.agentPhoneChallenge.findUniqueOrThrow({ where: { applicationId: app.id } })).attempts).toBe(5);
    expect((await p.agentApplication.findUniqueOrThrow({ where: { id: app.id } })).phoneVerifiedAt).toBeNull();
  });

  it("deduplicates concurrent submissions and commits only one registration audit", async () => {
    const user = await p.user.create({ data: { email: `agent-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    users.push(user.id);
    mock.session = { userId: user.id, email: user.email, role: "CUSTOMER" };
    const [a, b] = await Promise.all([POST(request("/api/agents/application", body)), POST(request("/api/agents/application", body))]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const entries = await p.agentApplication.findMany({ where: { userId: user.id } });
    expect(entries).toHaveLength(1);
    expect(entries[0].status).toBe("PENDING");
    expect(entries[0].phoneE164).toBe("+254712345678");
    expect(await p.auditEvent.count({ where: { action: "AGENT_APPLICATION_SUBMITTED", targetId: entries[0].id } })).toBe(1);
  });

  it("does not expose another account and records rejection exactly once", async () => {
    const applicant = await p.user.create({ data: { email: `applicant-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    users.push(applicant.id);
    const app = await p.agentApplication.create({ data: { userId: applicant.id, fullName: "Synthetic Applicant", phoneE164: "+254712345678", privacyAcknowledgedAt: new Date() } });
    const other = await p.user.create({ data: { email: `other-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    const admin = await p.user.create({ data: { email: `admin-${uid()}@test.invalid`, passwordHash: "test-only", role: "ADMIN" } });
    users.push(other.id, admin.id);
    mock.session = { userId: other.id, email: other.email, role: "CUSTOMER" };
    expect(await (await GET()).json()).toMatchObject({ applied: false, status: null });
    const params = { params: Promise.resolve({ id: app.id }) };
    expect((await reject(request(`/api/admin/agents/applications/${app.id}/reject`, { reason: "APPLICANT_REQUEST" }), params)).status).toBe(403);
    mock.session = { userId: admin.id, email: admin.email, role: "ADMIN" };
    expect((await reject(request(`/api/admin/agents/applications/${app.id}/reject`, { reason: "APPLICANT_REQUEST" }), params)).status).toBe(200);
    expect((await reject(request(`/api/admin/agents/applications/${app.id}/reject`, { reason: "APPLICANT_REQUEST" }), params)).status).toBe(200);
    expect((await p.agentApplication.findUniqueOrThrow({ where: { id: app.id } })).status).toBe("REJECTED");
    expect(await p.auditEvent.count({ where: { action: "AGENT_APPLICATION_REJECTED", targetId: app.id } })).toBe(1);
    mock.session = { userId: app.userId, email: "applicant@test.invalid", role: "CUSTOMER" };
    expect(await (await GET()).json()).toMatchObject({ applied: true, status: "REJECTED" });
  });
});
