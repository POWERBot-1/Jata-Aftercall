/** Disposable PostgreSQL and an in-process synthetic provider only; no real recipient or network. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";
import { MockMessagingProvider, getMessagingProvider, resetProviderRegistry, signCallback } from "@/lib/messaging/providers";
import { enqueueApplicationSubmitted } from "@/lib/agents/admin-notification-event";
import { processAdminNotificationBatch } from "@/lib/agents/admin-notification-worker";
import { applyAdminNotificationCallbacks } from "@/lib/agents/admin-notification-callback";
import { claimAdminNotification } from "@/lib/agents/admin-notification-claims";
import { replayAdminNotification } from "@/lib/agents/admin-notification-replay";
const context = vi.hoisted(() => ({ prisma: null as any }));
vi.mock("@/lib/auth", () => ({ getSession: async () => ({ userId: "admin", role: "ADMIN" }) }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: () => ({ allowed: true }) }));
vi.mock("@/lib/db", () => ({ default: new Proxy({}, { get: (_target, property) => { const value = context.prisma[property]; return typeof value === "function" ? value.bind(context.prisma) : value; } }) }));

const schema = `notification_worker_${randomUUID().replace(/-/g, "")}`;
let pool: Pool;
let prisma: any;
const old = { ...process.env };
const callbackSecret = "synthetic-callback-secret-not-for-production";
describe.skipIf(!realPrismaConfigured)("notification worker lifecycle on disposable PostgreSQL", () => {
  beforeAll(async () => {
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) throw new Error("Disposable loopback JATA database required");
    pool = new Pool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query('CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "role" TEXT NOT NULL)');
    await pool.query('CREATE TABLE "AgentAdminNotificationEvent" ("applicationId" TEXT PRIMARY KEY, "eventType" TEXT NOT NULL)');
    for (const name of ["20261112000000_agent_notification_outbox_plan", "20261113000000_agent_notification_claim_state", "20261114000000_agent_notification_operator_review", "20261121000000_agent_notification_attempt_history", "20261122000000_agent_notification_recovery_audit", "20261123000000_agent_notification_replay"]) await pool.query(readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"));
    const require = createRequire(import.meta.url); const harness = process.env.PRISMA_WASM_HARNESS_DIR;
    if (harness) {
      const { PrismaClient } = require(path.join(harness, "generated", "wasm.js")); const { PrismaPg } = require(path.join(harness, "node_modules", "@prisma/adapter-pg")); const { Pool: AdapterPool } = require(path.join(harness, "node_modules", "pg"));
      prisma = new PrismaClient({ adapter: new PrismaPg(new AdapterPool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` })) });
    } else { const { PrismaClient } = require("@prisma/client"); url.searchParams.set("schema", schema); prisma = new PrismaClient({ datasourceUrl: url.toString() }); }
    context.prisma = prisma;
    await pool.query(`INSERT INTO "User" ("id", "role") VALUES ('admin', 'ADMIN'), ('customer', 'CUSTOMER')`);
    process.env.AGENT_ADMIN_NOTIFICATION_QUEUE_ENABLED = "true";
    process.env.AGENT_ADMIN_NOTIFICATION_OUTBOX_PLAN_ENABLED = "true";
    process.env.AGENT_ADMIN_NOTIFICATION_CLAIMS_ENABLED = "true";
    process.env.AGENT_ADMIN_NOTIFICATION_WORKER_ENABLED = "true";
    process.env.AGENT_ADMIN_NOTIFICATION_CALLBACKS_ENABLED = "true";
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001,0700000002";
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY = "synthetic-recipient-key-01234567890123456789";
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY_VERSION = "test-v1";
    process.env.MESSAGING_WEBHOOK_SECRET = callbackSecret;
  });
  afterAll(async () => { process.env = { ...old }; if (prisma) await prisma.$disconnect(); if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); } });
  it("enqueues once and processes competing workers with authenticated, correlated callbacks", async () => {
    await Promise.all(Array.from({ length: 4 }, () => prisma.$transaction((tx: typeof prisma) => enqueueApplicationSubmitted(tx, "synthetic-app"))));
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentAdminNotificationDelivery"')).rows[0].n).toBe(2);
    const provider = new MockMessagingProvider();
    const results = await Promise.all(Array.from({ length: 5 }, () => processAdminNotificationBatch(prisma, provider)));
    expect(results.reduce((sum, row) => sum + row.processed, 0)).toBe(2);
    expect(provider.sent).toHaveLength(2);
    const attempts = (await pool.query('SELECT "outcome", "messageId" FROM "AgentAdminNotificationAttempt" ORDER BY "messageId"')).rows;
    expect(attempts).toHaveLength(2); expect(attempts.every((row) => row.outcome === "ACCEPTED")).toBe(true);
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentAdminNotificationClaimState" WHERE "state" = \'ACCEPTED\'')).rows[0].n).toBe(2);
    const raw = JSON.stringify({ events: [{ id: "synthetic-event-1", messageId: attempts[0].messageId, status: "DELIVERED" }] });
    await expect(applyAdminNotificationCallbacks(prisma, provider, raw, { "x-signature": "bad" })).rejects.toThrow("UNAUTHORIZED");
    const headers = { "x-signature": signCallback(raw, callbackSecret) };
    const replay = await Promise.all(Array.from({ length: 4 }, () => applyAdminNotificationCallbacks(prisma, provider, raw, headers)));
    expect(replay.reduce((sum, item) => sum + item.acceptedEvents, 0)).toBe(1);
    expect((await pool.query('SELECT "status" FROM "AgentAdminNotificationCallback"')).rows).toEqual([{ status: "DELIVERED" }]);
    const conflict = JSON.stringify({ events: [{ id: "synthetic-event-1", messageId: attempts[0].messageId, status: "FAILED" }] });
    await expect(applyAdminNotificationCallbacks(prisma, provider, conflict, { "x-signature": signCallback(conflict, callbackSecret) })).rejects.toThrow("CONFLICT");
    const unknown = JSON.stringify({ events: [{ id: "unknown", messageId: "no-such-message", status: "DELIVERED" }] });
    await expect(applyAdminNotificationCallbacks(prisma, provider, unknown, { "x-signature": signCallback(unknown, callbackSecret) })).rejects.toThrow("UNMATCHED");
    const batch = JSON.stringify({ events: [
      { id: "would-be-rolled-back", messageId: attempts[0].messageId, status: "DELIVERED" },
      { id: "missing-message", messageId: "no-such-message", status: "FAILED" },
    ] });
    await expect(applyAdminNotificationCallbacks(prisma, provider, batch, { "x-signature": signCallback(batch, callbackSecret) })).rejects.toThrow("UNMATCHED");
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentAdminNotificationCallback"')).rows[0].n).toBe(1);
    expect(await processAdminNotificationBatch(prisma, provider)).toMatchObject({ processed: 0, deliveryVerified: false });
  });
  it("retries only a confirmed safe rejection, preserving the idempotency key", async () => {
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001";
    await prisma.$transaction((tx: typeof prisma) => enqueueApplicationSubmitted(tx, "safe-retry-app"));
    const provider = new MockMessagingProvider();
    const keys: string[] = [];
    provider.send = async (request) => { keys.push(request.idempotencyKey); return keys.length === 1
      ? { outcome: "FAILED", retryable: true, safeToFallback: true }
      : { outcome: "ACCEPTED", providerMessageId: "synthetic-retry-accepted" }; };
    expect((await processAdminNotificationBatch(prisma, provider, 1)).processed).toBe(1);
    expect((await pool.query('SELECT "state" FROM "AgentAdminNotificationClaimState" WHERE "applicationId" = $1', ["safe-retry-app"])).rows[0].state).toBe("RETRY");
    await pool.query('UPDATE "AgentAdminNotificationClaimState" SET "nextAttemptAt" = clock_timestamp() - interval \'1 second\' WHERE "applicationId" = $1', ["safe-retry-app"]);
    expect((await processAdminNotificationBatch(prisma, provider, 1)).processed).toBe(1);
    expect(keys).toHaveLength(2); expect(keys[0]).toBe(keys[1]);
    expect((await pool.query('SELECT "attempt", "outcome" FROM "AgentAdminNotificationAttempt" WHERE "applicationId" = $1 ORDER BY "attempt"', ["safe-retry-app"])).rows).toEqual([{ attempt: 1, outcome: "SAFE_TRANSIENT_REJECTION" }, { attempt: 2, outcome: "ACCEPTED" }]);
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001,0700000002";
  });
  it("recovers expired claims conservatively after a simulated worker crash", async () => {
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001";
    await prisma.$transaction((tx: typeof prisma) => enqueueApplicationSubmitted(tx, "crashed-app"));
    const claim = await claimAdminNotification(prisma); expect(claim?.applicationId).toBe("crashed-app");
    await pool.query('UPDATE "AgentAdminNotificationClaimState" SET "leaseUntil" = clock_timestamp() - interval \'1 second\' WHERE "applicationId" = $1', ["crashed-app"]);
    const provider = new MockMessagingProvider();
    expect(await processAdminNotificationBatch(prisma, provider)).toMatchObject({ processed: 0, expired: 1 });
    expect(provider.sent).toHaveLength(0);
    expect((await pool.query('SELECT "attempt", "reason" FROM "AgentAdminNotificationRecovery" WHERE "applicationId"=$1', ["crashed-app"])).rows).toEqual([{ attempt: 1, reason: "LEASE_EXPIRED_UNKNOWN" }]);
    expect((await pool.query('SELECT "state" FROM "AgentAdminNotificationClaimState" WHERE "applicationId" = $1', ["crashed-app"])).rows[0].state).toBe("UNKNOWN");
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001,0700000002";
  });
  it("executes authenticated worker and signed callback HTTP handlers against PostgreSQL", async () => {
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001";
    process.env.AGENT_ADMIN_NOTIFICATION_WORKER_SECRET = "synthetic-worker-secret-01234567890123456789";
    process.env.AGENT_ADMIN_NOTIFICATION_PROVIDER = "mock";
    resetProviderRegistry();
    await prisma.$transaction((tx: typeof prisma) => enqueueApplicationSubmitted(tx, "http-app"));
    const { POST: worker } = await import("@/app/api/cron/agent-notification-worker/route");
    const { POST: callback } = await import("@/app/api/webhooks/agent-admin-notifications/route");
    const response = await worker(new Request("https://fixture.test/api/cron/agent-notification-worker", { method: "POST", headers: { authorization: `Bearer ${process.env.AGENT_ADMIN_NOTIFICATION_WORKER_SECRET}` } }));
    expect(response.status).toBe(200); expect((await response.json()).processed).toBe(1);
    expect((getMessagingProvider("mock") as MockMessagingProvider).sent).toHaveLength(1);
    const attempt = (await pool.query('SELECT "messageId" FROM "AgentAdminNotificationAttempt" WHERE "applicationId"=$1', ["http-app"])).rows[0];
    const body = JSON.stringify({ events: [{ id: "synthetic-http-event", messageId: attempt.messageId, status: "DELIVERED" }] });
    const send = () => callback(new Request("https://fixture.test/api/webhooks/agent-admin-notifications", { method: "POST", body, headers: { "x-signature": signCallback(body, callbackSecret) } }));
    expect((await send()).status).toBe(200); expect((await send()).status).toBe(200);
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentAdminNotificationCallback" WHERE "messageId"=$1', [attempt.messageId])).rows[0].n).toBe(1);
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001,0700000002";
  });
  it("replays a safely dead-lettered item through the admin HTTP endpoint and worker", async () => {
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001";
    process.env.AGENT_ADMIN_NOTIFICATION_OPERATIONS_ENABLED = "true";
    process.env.AGENT_ADMIN_NOTIFICATION_REPLAY_ENABLED = "true";
    await prisma.$transaction((tx: typeof prisma) => enqueueApplicationSubmitted(tx, "replay-app"));
    const provider = new MockMessagingProvider();
    const keys: string[] = [];
    provider.send = async (request) => { keys.push(request.idempotencyKey); return keys.length === 1
      ? { outcome: "FAILED", safeToFallback: true, retryable: false }
      : { outcome: "ACCEPTED", providerMessageId: "replay-test-message" }; };
    expect((await processAdminNotificationBatch(prisma, provider)).processed).toBe(1);
    const item = (await pool.query('SELECT "state", "recipientKey" FROM "AgentAdminNotificationClaimState" WHERE "applicationId"=$1', ["replay-app"])).rows[0];
    expect(item.state).toBe("DEAD");
    const input = { applicationId: "replay-app", recipientKey: item.recipientKey, actorId: "customer", requestId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" };
    expect(await replayAdminNotification(prisma, input)).toBe("forbidden");
    const uncertain = (await pool.query('SELECT "recipientKey" FROM "AgentAdminNotificationClaimState" WHERE "applicationId"=$1', ["crashed-app"])).rows[0];
    expect(await replayAdminNotification(prisma, { ...input, actorId: "admin", applicationId: "crashed-app", recipientKey: uncertain.recipientKey })).toBe("conflict");
    const { POST } = await import("@/app/api/admin/agents/notification-replay/route");
    const body = { applicationId: "replay-app", recipientKey: item.recipientKey, requestId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    const request = () => new Request("https://fixture.test/api/admin/agents/notification-replay", { method: "POST", headers: { host: "fixture.test", origin: "https://fixture.test", "content-type": "application/json" }, body: JSON.stringify(body) });
    const responses = await Promise.all([POST(request()), POST(request())]);
    expect(responses.map((r) => r.status)).toEqual([200, 200]);
    expect((await Promise.all(responses.map((r) => r.json()))).filter((r) => r.alreadyAuthorized)).toHaveLength(1);
    expect((await pool.query('SELECT "actorId", "previousAttempt" FROM "AgentAdminNotificationReplay" WHERE "applicationId"=$1', ["replay-app"])).rows).toEqual([{ actorId: "admin", previousAttempt: 1 }]);
    expect((await processAdminNotificationBatch(prisma, provider)).processed).toBe(1);
    expect(keys[0]).toBe(keys[1]);
    expect((await pool.query('SELECT "state", "attempts" FROM "AgentAdminNotificationClaimState" WHERE "applicationId"=$1', ["replay-app"])).rows[0]).toEqual({ state: "ACCEPTED", attempts: 2 });
    expect((await pool.query('SELECT "outcome" FROM "AgentAdminNotificationAttempt" WHERE "applicationId"=$1 ORDER BY "attempt"', ["replay-app"])).rows.map((r) => r.outcome)).toEqual(["SAFE_PERMANENT_REJECTION", "ACCEPTED"]);
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001,0700000002";
  });
  it("does not replay a dead letter after the lifetime attempt cap", async () => {
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001";
    await prisma.$transaction((tx: typeof prisma) => enqueueApplicationSubmitted(tx, "exhausted-app"));
    const provider = new MockMessagingProvider();
    provider.send = async () => ({ outcome: "FAILED", safeToFallback: true, retryable: true });
    for (let i = 0; i < 5; i++) {
      expect((await processAdminNotificationBatch(prisma, provider, 1)).processed).toBe(1);
      if (i < 4) await pool.query('UPDATE "AgentAdminNotificationClaimState" SET "nextAttemptAt"=clock_timestamp() - interval \'1 second\' WHERE "applicationId"=$1', ["exhausted-app"]);
    }
    const row = (await pool.query('SELECT "state", "recipientKey" FROM "AgentAdminNotificationClaimState" WHERE "applicationId"=$1', ["exhausted-app"])).rows[0];
    expect(row.state).toBe("DEAD");
    expect(await replayAdminNotification(prisma, { applicationId: "exhausted-app", recipientKey: row.recipientKey, actorId: "admin", requestId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" })).toBe("conflict");
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentAdminNotificationAttempt" WHERE "applicationId"=$1', ["exhausted-app"])).rows[0].n).toBe(5);
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENTS = "0700000001,0700000002";
  });
  it("never automatically retries a timeout or a changed recipient configuration", async () => {
    await prisma.$transaction((tx: typeof prisma) => enqueueApplicationSubmitted(tx, "uncertain-app"));
    const provider = new MockMessagingProvider({ outcome: "UNKNOWN" });
    expect((await processAdminNotificationBatch(prisma, provider, 1)).processed).toBe(1);
    const unknown = (await pool.query('SELECT count(*)::int AS n FROM "AgentAdminNotificationClaimState" WHERE "applicationId" = $1 AND "state" = $2', ["uncertain-app", "UNKNOWN"])).rows[0].n;
    expect(unknown).toBe(1);
    process.env.AGENT_ADMIN_NOTIFICATION_RECIPIENT_KEY_VERSION = "different-version";
    expect((await processAdminNotificationBatch(prisma, provider)).processed).toBe(1);
    expect(provider.sent).toHaveLength(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM "AgentAdminNotificationClaimState" WHERE "applicationId" = $1 AND "state" = $2', ["uncertain-app", "UNKNOWN"])).rows[0].n).toBe(2);
    expect((await processAdminNotificationBatch(prisma, provider)).processed).toBe(0);
  });
});
