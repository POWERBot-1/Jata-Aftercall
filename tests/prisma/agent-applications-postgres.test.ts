/** Isolated PostgreSQL only; synthetic adapter, no live messages or production payments. */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { uid } from "../helpers/prisma-fixtures";

const mock = vi.hoisted(() => ({ session: null as null | { userId: string; role: string; email: string } }));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", () => ({ getSession: async () => mock.session, hashPassword: async () => "synthetic-hash" }));
import { GET, POST } from "@/app/api/agents/application/route";
import { GET as notificationOperations, POST as acknowledgeNotification } from "@/app/api/admin/agents/notification-operations/route";
import { enqueueApplicationSubmitted } from "@/lib/agents/admin-notification-event";
import { applyMetaStatus } from "@/lib/messaging/meta-whatsapp-webhook";
import { MockMessagingProvider } from "@/lib/messaging/providers";
import { issuePhoneChallenge, confirmPhoneChallenge } from "@/lib/agents/phone-verification";
import { allowAgentApplication } from "@/lib/agent-application-throttle";
import { POST as registerAgent } from "@/app/api/agents/register/route";
import { GET as referralSummary } from "@/app/api/agents/referrals/summary/route";
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
    await p.agentAdminNotificationReview.deleteMany({ where: { claim: { delivery: { plan: { event: { application: { userId: { in: users } } } } } } } });
    await p.agentAdminNotificationClaimState.deleteMany({ where: { delivery: { plan: { event: { application: { userId: { in: users } } } } } } });
    await p.agentAdminNotificationDelivery.deleteMany({ where: { plan: { event: { application: { userId: { in: users } } } } } });
    await p.agentAdminNotificationPlan.deleteMany({ where: { event: { application: { userId: { in: users } } } } });
    await p.agentAdminNotificationEvent.deleteMany({ where: { application: { userId: { in: users } } } });
    await p.agentApplication.deleteMany({ where: { userId: { in: users } } });
    await p.user.deleteMany({ where: { id: { in: users } } });
    await p.$disconnect();
  });

  it("plans recipients atomically, idempotently and without storing destinations", async () => {
    const names = ["AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED", "AGENT_ADMIN_NOTIFICATION_OUTBOX_PLAN_ENABLED", "AGENT_ADMIN_NOTIFICATION_RECIPIENTS", "AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY", "AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY_VERSION"] as const;
    const saved = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    try {
      process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED = "true";
      process.env.AGENT_ADMIN_NOTIFICATION_OUTBOX_PLAN_ENABLED = "true";
      process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001,0700000002";
      process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY = "synthetic-key-only-012345678901234567890123456789";
      process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY_VERSION = "fixture-v1";
      const user = await p.user.create({ data: { email: `plan-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
      users.push(user.id);
      const application = await p.agentApplication.create({ data: { userId: user.id, fullName: "Synthetic User", phoneE164: "+254700000003", privacyAcknowledgedAt: new Date() } });
      await expect(p.$transaction(async (tx) => { await enqueueApplicationSubmitted(tx, application.id); throw new Error("synthetic rollback"); })).rejects.toThrow("synthetic rollback");
      expect(await p.agentAdminNotificationEvent.count({ where: { applicationId: application.id } })).toBe(0);
      expect(await p.agentAdminNotificationPlan.count({ where: { applicationId: application.id } })).toBe(0);
      expect(await p.agentAdminNotificationDelivery.count({ where: { applicationId: application.id } })).toBe(0);
      await Promise.all(Array.from({ length: 4 }, () => p.$transaction((tx) => enqueueApplicationSubmitted(tx, application.id))));
      const plan = await p.agentAdminNotificationPlan.findUniqueOrThrow({ where: { applicationId: application.id }, include: { deliveries: true } });
      expect(plan.recipientKeyVersion).toBe("fixture-v1");
      expect(plan.deliveries).toHaveLength(2);
      expect(new Set(plan.deliveries.map((item) => item.recipientKey)).size).toBe(2);
      expect(plan.deliveries.every((item) => /^[a-f0-9]{64}$/.test(item.recipientKey) && item.state === "QUEUED")).toBe(true);
      expect(JSON.stringify(plan)).not.toContain("0700000001");
      process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000003";
      process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY_VERSION = "fixture-v2";
      await p.$transaction((tx) => enqueueApplicationSubmitted(tx, application.id));
      expect(await p.agentAdminNotificationDelivery.count({ where: { applicationId: application.id } })).toBe(2);
      expect((await p.agentAdminNotificationPlan.findUniqueOrThrow({ where: { applicationId: application.id } })).recipientKeyVersion).toBe("fixture-v1");
    } finally {
      for (const name of names) { if (saved[name] === undefined) delete process.env[name]; else process.env[name] = saved[name]; }
    }
  });

  it("audits one concurrent operator acknowledgement without retrying an unknown send", async () => {
    const original = process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED;
    try {
      process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED = "true";
      const admin = await p.user.create({ data: { email: `operator-${uid()}@test.invalid`, passwordHash: "test-only", role: "ADMIN" } });
      const applicant = await p.user.create({ data: { email: `operator-applicant-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
      users.push(admin.id, applicant.id);
      const app = await p.agentApplication.create({ data: { userId: applicant.id, fullName: "Synthetic User", phoneE164: "+254700000003", privacyAcknowledgedAt: new Date() } });
      const recipientKey = "a".repeat(64);
      await p.agentAdminNotificationEvent.create({ data: { applicationId: app.id, eventType: "APPLICATION_SUBMITTED" } });
      await p.agentAdminNotificationPlan.create({ data: { applicationId: app.id, recipientKeyVersion: "fixture" } });
      await p.agentAdminNotificationDelivery.create({ data: { applicationId: app.id, recipientKey } });
      await p.agentAdminNotificationClaimState.create({ data: { applicationId: app.id, recipientKey, state: "UNKNOWN", attempts: 1 } });
      mock.session = { userId: admin.id, role: "ADMIN", email: admin.email };
      const listed = await notificationOperations();
      expect(listed.status).toBe(200);
      expect((await listed.json()).items.some((x: { applicationId: string }) => x.applicationId === app.id)).toBe(true);
      const data = { applicationId: app.id, recipientKey, action: "ACKNOWLEDGE_NO_RETRY" };
      const results = await Promise.all([acknowledgeNotification(request("/api/admin/agents/notification-operations", data)), acknowledgeNotification(request("/api/admin/agents/notification-operations", data))]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect((await Promise.all(results.map((r) => r.json()))).map((r) => r.alreadyReviewed).sort()).toEqual([false, true]);
      expect(await p.agentAdminNotificationReview.count({ where: { applicationId: app.id } })).toBe(1);
      expect(await p.auditEvent.count({ where: { action: "AGENT_NOTIFICATION_ACKNOWLEDGED_NO_RETRY", targetId: app.id } })).toBe(1);
      expect((await p.agentAdminNotificationClaimState.findUniqueOrThrow({ where: { applicationId_recipientKey: { applicationId: app.id, recipientKey } } })).state).toBe("UNKNOWN");
      expect((await (await notificationOperations()).json()).items.some((x: { applicationId: string }) => x.applicationId === app.id)).toBe(false);
      mock.session = { userId: applicant.id, role: "ADMIN", email: applicant.email };
      expect((await notificationOperations()).status).toBe(403);
      expect((await acknowledgeNotification(request("/api/admin/agents/notification-operations", data))).status).toBe(403);
    } finally { if (original === undefined) delete process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED; else process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED = original; }
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

  it("gates and audits reinstatement once, rechecks eligibility and revokes old links", async () => {
    const admin = await p.user.create({ data: { email: `reinstate-admin-${uid()}@test.invalid`, passwordHash: "test-only", role: "ADMIN" } });
    const applicant = await p.user.create({ data: { email: `reinstate-applicant-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } }); users.push(admin.id, applicant.id);
    const app = await p.agentApplication.create({ data: { userId: applicant.id, fullName: "Reinstatement Fixture", phoneE164: "+254700000061", privacyAcknowledgedAt: new Date(), agentStatus: "SUSPENDED" } });
    const link = await p.agentReferralLink.create({ data: { referrerApplicationId: app.id, tokenHash: `test-${uid()}`, expiresAt: new Date(Date.now() + 3600000) } });
    const params = Promise.resolve({ id: app.id });
    const reinstate = () => request(`/api/admin/agents/applications/${app.id}/decision`, { action: "reinstate", reason: "MANUAL_REINSTATEMENT_REVIEW" });
    const old = process.env.AGENT_REINSTATEMENT_ENABLED;
    try {
      mock.session = { userId: admin.id, role: "ADMIN", email: admin.email };
      delete process.env.AGENT_REINSTATEMENT_ENABLED;
      expect((await decide(reinstate(), { params })).status).toBe(503);
      process.env.AGENT_REINSTATEMENT_ENABLED = "true";
      expect((await decide(reinstate(), { params })).status).toBe(409);
      expect((await p.agentReferralLink.findUniqueOrThrow({ where: { id: link.id } })).revokedAt).toBeNull();
      await p.agentApplication.update({ where: { id: app.id }, data: { phoneVerifiedAt: new Date(), verifiedPhoneE164: app.phoneE164 } });
      mock.session = { userId: applicant.id, role: "ADMIN", email: applicant.email };
      expect((await decide(reinstate(), { params })).status).toBe(403);
      const self = await p.agentApplication.create({ data: { userId: admin.id, fullName: "Self Review", phoneE164: "+254700000062", verifiedPhoneE164: "+254700000062", phoneVerifiedAt: new Date(), privacyAcknowledgedAt: new Date(), agentStatus: "SUSPENDED" } });
      mock.session = { userId: admin.id, role: "ADMIN", email: admin.email };
      expect((await decide(reinstate(), { params: Promise.resolve({ id: self.id }) })).status).toBe(403);
      await p.agentApplication.update({ where: { id: app.id }, data: { agentStatus: "INACTIVE" } });
      expect((await decide(reinstate(), { params })).status).toBe(409);
      await p.agentApplication.update({ where: { id: app.id }, data: { agentStatus: "SUSPENDED", status: "REJECTED" } });
      expect((await decide(reinstate(), { params })).status).toBe(409);
      await p.agentApplication.update({ where: { id: app.id }, data: { status: "PENDING" } });
      expect((await p.agentReferralLink.findUniqueOrThrow({ where: { id: link.id } })).revokedAt).toBeNull();
      const results = await Promise.all([decide(reinstate(), { params }), decide(reinstate(), { params })]);
      expect(results.map((result) => result.status)).toEqual([200, 200]);
      expect((await p.agentApplication.findUniqueOrThrow({ where: { id: app.id } })).agentStatus).toBe("ACTIVE");
      expect((await p.agentReferralLink.findUniqueOrThrow({ where: { id: link.id } })).revokedAt).not.toBeNull();
      const audits = await p.auditEvent.findMany({ where: { actorId: admin.id, action: "AGENT_APPLICATION_REINSTATED", targetId: app.id } });
      expect(audits).toHaveLength(1);
      expect(JSON.parse(audits[0].metadata!)).toEqual({ reason: "MANUAL_REINSTATEMENT_REVIEW", previousStatus: "SUSPENDED", newStatus: "ACTIVE" });
      expect((await p.user.findUniqueOrThrow({ where: { id: applicant.id } })).role).toBe("CUSTOMER");
    } finally { if (old === undefined) delete process.env.AGENT_REINSTATEMENT_ENABLED; else process.env.AGENT_REINSTATEMENT_ENABLED = old; mock.session = null; }
  });

  it("records a single transactional notification event only for enabled new applications", async () => {
    const old = process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED;
    const applicant = await p.user.create({ data: { email: `event-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    const noQueue = await p.user.create({ data: { email: `off-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    const rollback = await p.user.create({ data: { email: `rollback-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } }); users.push(applicant.id, noQueue.id, rollback.id);
    try {
      process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED = "true";
      mock.session = { userId: applicant.id, email: applicant.email, role: "CUSTOMER" };
      const responses = await Promise.all([POST(request("/api/agents/application", body)), POST(request("/api/agents/application", body))]);
      expect(responses.map((r) => r.status)).toEqual([200, 200]);
      const application = await p.agentApplication.findUniqueOrThrow({ where: { userId: applicant.id } });
      const events = await p.agentAdminNotificationEvent.findMany({ where: { applicationId: application.id } });
      expect(events).toHaveLength(1); expect(Object.keys(events[0]).sort()).toEqual(["applicationId", "createdAt", "eventType"]);
      expect(events[0].eventType).toBe("APPLICATION_SUBMITTED");
      expect(await p.auditEvent.count({ where: { actorId: applicant.id, action: "AGENT_APPLICATION_SUBMITTED" } })).toBe(1);
      await expect(p.$transaction(async (tx: typeof p) => {
        const app = await tx.agentApplication.create({ data: { userId: rollback.id, fullName: "Rollback Fixture", phoneE164: "+254700000060", privacyAcknowledgedAt: new Date() } });
        await enqueueApplicationSubmitted(tx, app.id);
        throw new Error("synthetic rollback");
      })).rejects.toThrow("synthetic rollback");
      expect(await p.agentApplication.findUnique({ where: { userId: rollback.id } })).toBeNull();
      expect(await p.agentAdminNotificationEvent.count({ where: { application: { userId: rollback.id } } })).toBe(0);
      delete process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED;
      mock.session = { userId: noQueue.id, email: noQueue.email, role: "CUSTOMER" };
      expect((await POST(request("/api/agents/application", body))).status).toBe(200);
      const offApp = await p.agentApplication.findUniqueOrThrow({ where: { userId: noQueue.id } });
      expect(await p.agentAdminNotificationEvent.findUnique({ where: { applicationId: offApp.id } })).toBeNull();
    } finally { if (old === undefined) delete process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED; else process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED = old; mock.session = null; }
  });

  it("rotates active-agent links and records only explicitly consented registration evidence", async () => {
    const envNames = ["AGENT_REGISTRATION_REFERRALS_ENABLED", "AGENT_REFERRAL_LINK_LIFETIME_SECONDS", "AGENT_SELF_SERVICE_REGISTRATION_ENABLED", "AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED"] as const;
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
        if (index === 0) process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED = "true"; else delete process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED;
        const email = `referred-${uid()}@test.invalid`;
        const response = await registerAgent(request("/api/agents/register", { fullName: "Synthetic Applicant", email, phone: index === 3 ? "0700000096" : `07000000${80 + index}`, password: "synthetic-pass-123", privacyAccepted: true, termsAccepted: true, referralCode: token, referralConsent: consent }));
        expect(response.status).toBe(200);
        const user = await p.user.findUniqueOrThrow({ where: { email } }); users.push(user.id);
        const referred = await p.agentApplication.findUniqueOrThrow({ where: { userId: user.id } });
        const evidence = await p.agentReferralAttribution.findUnique({ where: { referredApplicationId: referred.id } });
        const event = await p.agentAdminNotificationEvent.findUnique({ where: { applicationId: referred.id } });
        if (index === 0) expect(event?.eventType).toBe("APPLICATION_SUBMITTED"); else expect(event).toBeNull();
        if (index === 0) expect(evidence?.referrerApplicationId).toBe(app.id); else expect(evidence).toBeNull();
      }
      expect(await p.agentReferralAttribution.count({ where: { referrerApplicationId: app.id } })).toBe(1);
      mock.session = { userId: agent.id, role: "CUSTOMER", email: agent.email };
      const ownSummary = await referralSummary(); expect(ownSummary.status).toBe(200); expect(await ownSummary.json()).toEqual({ registrationCount: 1, existingApplicationCount: 0 });
      const other = await p.user.create({ data: { email: `other-referrer-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } }); users.push(other.id);
      await p.agentApplication.create({ data: { userId: other.id, fullName: "Other Agent", phoneE164: "+254700000095", privacyAcknowledgedAt: new Date(), agentStatus: "ACTIVE" } });
      mock.session = { userId: other.id, role: "CUSTOMER", email: other.email };
      const invokeSummary = referralSummary as (request: Request) => Promise<Response>;
      const otherSummary = await invokeSummary(new Request(`https://agent.test/api/agents/referrals/summary?agentId=${app.id}`)); expect(otherSummary.status).toBe(200); expect(await otherSummary.json()).toEqual({ registrationCount: 0, existingApplicationCount: 0 });
      mock.session = null; expect((await referralSummary()).status).toBe(401);

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
      expect((await referralSummary()).status).toBe(403);
    } finally { for (const key of envNames) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } mock.session = null; }
  });

  it("attributes a consented existing-account application once without allowing reassignment", async () => {
    const envNames = ["AGENT_REGISTRATION_REFERRALS_ENABLED", "AGENT_REFERRAL_LINK_LIFETIME_SECONDS"] as const;
    const before = Object.fromEntries(envNames.map((key) => [key, process.env[key]]));
    const owner = await p.user.create({ data: { email: `owner-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    const referred = await p.user.create({ data: { email: `existing-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } });
    users.push(owner.id, referred.id);
    const app = await p.agentApplication.create({ data: { userId: owner.id, fullName: "Owner Fixture", phoneE164: "+254700000091", privacyAcknowledgedAt: new Date(), agentStatus: "ACTIVE" } });
    try {
      process.env.AGENT_REGISTRATION_REFERRALS_ENABLED = "true"; process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS = "3600";
      mock.session = { userId: owner.id, role: "CUSTOMER", email: owner.email };
      const linkResponse = await rotateReferral(request("/api/agents/referrals", {}));
      expect(linkResponse.status).toBe(200);
      const links = await linkResponse.json();
      const code = new URL(links.applicationPath, "https://agent.test").searchParams.get("ref");
      expect(code).toEqual(new URL(links.path, "https://agent.test").searchParams.get("ref"));
      const submission = { fullName: "Existing Fixture", phone: "0700000092", privacyAccepted: true, referralCode: code, referralConsent: true };
      mock.session = { userId: referred.id, role: "CUSTOMER", email: referred.email };
      const decisions = await Promise.all([POST(request("/api/agents/application", submission)), POST(request("/api/agents/application", submission))]);
      expect(decisions.map((response) => response.status)).toEqual([200, 200]);
      const referredApp = await p.agentApplication.findUniqueOrThrow({ where: { userId: referred.id } });
      const attribution = await p.agentReferralAttribution.findUniqueOrThrow({ where: { referredApplicationId: referredApp.id } });
      expect(attribution.referrerApplicationId).toBe(app.id); expect(attribution.source).toBe("EXISTING_ACCOUNT");
      expect(await p.auditEvent.count({ where: { targetId: referredApp.id, action: "AGENT_EXISTING_ACCOUNT_ATTRIBUTION_RECORDED" } })).toBe(1);
      expect((await POST(request("/api/agents/application", { ...submission, referralCode: "A".repeat(43) }))).status).toBe(200);
      expect((await p.agentReferralAttribution.findUniqueOrThrow({ where: { referredApplicationId: referredApp.id } })).linkId).toBe(attribution.linkId);
      mock.session = { userId: owner.id, role: "CUSTOMER", email: owner.email };
      expect(await (await referralSummary()).json()).toEqual({ registrationCount: 0, existingApplicationCount: 1 });
      const withoutConsent = await p.user.create({ data: { email: `no-consent-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } }); users.push(withoutConsent.id);
      mock.session = { userId: withoutConsent.id, role: "CUSTOMER", email: withoutConsent.email };
      expect((await POST(request("/api/agents/application", { ...submission, referralConsent: false, phone: "0700000093" }))).status).toBe(200);
      const noConsentApp = await p.agentApplication.findUniqueOrThrow({ where: { userId: withoutConsent.id } });
      expect(await p.agentReferralAttribution.findUnique({ where: { referredApplicationId: noConsentApp.id } })).toBeNull();
    } finally { for (const key of envNames) { if (before[key] === undefined) delete process.env[key]; else process.env[key] = before[key]; } mock.session = null; }
  });

  it("rejects ineligible existing-account referral evidence without blocking applications", async () => {
    const names = ["AGENT_REGISTRATION_REFERRALS_ENABLED", "AGENT_REFERRAL_LINK_LIFETIME_SECONDS"] as const;
    const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
    const owner = await p.user.create({ data: { email: `identity-${uid()}@test.invalid`, passwordHash: "test-only", role: "CUSTOMER" } }); users.push(owner.id);
    const ownerApp = await p.agentApplication.create({ data: { userId: owner.id, fullName: "Owner Fixture", phoneE164: "+254700000071", privacyAcknowledgedAt: new Date(), agentStatus: "ACTIVE" } });
    try {
      process.env.AGENT_REGISTRATION_REFERRALS_ENABLED = "true"; process.env.AGENT_REFERRAL_LINK_LIFETIME_SECONDS = "3600";
      mock.session = { userId: owner.id, role: "CUSTOMER", email: owner.email };
      const issue = async () => {
        const response = await rotateReferral(request("/api/agents/referrals", {}));
        expect(response.status).toBe(200);
        return new URL((await response.json()).applicationPath, "https://agent.test").searchParams.get("ref")!;
      };
      const revoked = await issue(); const current = await issue();
      const cases = ["malformed", "unknown", "revoked", "expired", "suspended", "same-phone", "same-email", "disabled", "valid"] as const;
      for (const [index, name] of cases.entries()) {
        if (name === "expired") await p.agentReferralLink.updateMany({ where: { referrerApplicationId: ownerApp.id, revokedAt: null }, data: { expiresAt: new Date(0) } });
        if (name === "suspended") { await p.agentReferralLink.updateMany({ where: { referrerApplicationId: ownerApp.id, revokedAt: null }, data: { expiresAt: new Date(Date.now() + 3600000) } }); await p.agentApplication.update({ where: { id: ownerApp.id }, data: { agentStatus: "SUSPENDED" } }); }
        if (name === "same-phone") await p.agentApplication.update({ where: { id: ownerApp.id }, data: { agentStatus: "ACTIVE" } });
        if (name === "disabled") process.env.AGENT_REGISTRATION_REFERRALS_ENABLED = "false";
        if (name === "valid") process.env.AGENT_REGISTRATION_REFERRALS_ENABLED = "true";
        const email = name === "same-email" ? owner.email.toUpperCase() : `case-${uid()}@test.invalid`;
        const user = await p.user.create({ data: { email, passwordHash: "test-only", role: "CUSTOMER" } }); users.push(user.id);
        // The session and request claim the opposite identity; the database account must be authoritative.
        mock.session = { userId: user.id, role: "CUSTOMER", email: name === "same-email" ? `different-${uid()}@test.invalid` : owner.email };
        const code = name === "malformed" ? "bad" : name === "unknown" ? "A".repeat(43) : name === "revoked" ? revoked : current;
        const response = await POST(request("/api/agents/application", { fullName: "Case Fixture", phone: name === "same-phone" ? "0700000071" : `0700000${100 + index}`, privacyAccepted: true, referralCode: code, referralConsent: true, email: owner.email, userId: owner.id }));
        expect(response.status, name).toBe(200);
        const app = await p.agentApplication.findUniqueOrThrow({ where: { userId: user.id } });
        const evidence = await p.agentReferralAttribution.findUnique({ where: { referredApplicationId: app.id } });
        if (name === "valid") { expect(evidence?.source).toBe("EXISTING_ACCOUNT"); expect(evidence?.referrerApplicationId).toBe(ownerApp.id); }
        else expect(evidence, name).toBeNull();
        expect(await p.auditEvent.count({ where: { targetId: app.id, action: "AGENT_EXISTING_ACCOUNT_ATTRIBUTION_RECORDED" } }), name).toBe(name === "valid" ? 1 : 0);
      }
      mock.session = { userId: owner.id, role: "CUSTOMER", email: owner.email };
      expect((await POST(request("/api/agents/application", { fullName: "Owner Fixture", phone: "0700000071", privacyAccepted: true, referralCode: current, referralConsent: true }))).status).toBe(200);
      expect(await p.agentReferralAttribution.findUnique({ where: { referredApplicationId: ownerApp.id } })).toBeNull();
    } finally { for (const name of names) { if (before[name] === undefined) delete process.env[name]; else process.env[name] = before[name]; } mock.session = null; }
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
