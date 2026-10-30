/** Isolated PostgreSQL only; synthetic adapter, no live messages or production payments. */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { uid } from "../helpers/prisma-fixtures";

const mock = vi.hoisted(() => ({ session: null as null | { userId: string; role: string; email: string } }));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", () => ({ getSession: async () => mock.session }));
import { GET, POST } from "@/app/api/agents/application/route";
import { MockMessagingProvider } from "@/lib/messaging/providers";
import { issuePhoneChallenge, confirmPhoneChallenge } from "@/lib/agents/phone-verification";
import { allowAgentApplication } from "@/lib/agent-application-throttle";
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
    const mock = new MockMessagingProvider();
    expect(await issuePhoneChallenge(user.id, { provider: mock, secret, sender: "fixture" })).toBe("sent");
    const code = mock.sent[0].body.match(/\b\d{6}\b/)![0];
    await p.agentPhoneChallenge.update({ where: { applicationId: app.id }, data: { expiresAt: new Date(0) } });
    expect(await confirmPhoneChallenge(user.id, code, secret)).toBe("invalid");
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
