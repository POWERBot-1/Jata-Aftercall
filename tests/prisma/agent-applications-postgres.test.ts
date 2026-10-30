/** Isolated PostgreSQL only; no provider messages, phone verification or production payments. */
import { createHmac } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured, sharedPrisma } from "../helpers/prisma-client";
import { uid } from "../helpers/prisma-fixtures";

const mock = vi.hoisted(() => ({ session: null as null | { userId: string; role: string; email: string } }));
vi.mock("@/lib/db", async () => ({ default: (await import("../helpers/prisma-client")).sharedPrisma() }));
vi.mock("@/lib/auth", () => ({ getSession: async () => mock.session }));
import { GET, POST } from "@/app/api/agents/application/route";
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
