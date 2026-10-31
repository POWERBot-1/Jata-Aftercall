/** Synthetic, randomly named schema; all fixtures are dropped together after the test. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PRISMA_TEST_DATABASE_URL, realPrismaConfigured } from "../helpers/prisma-client";

const mocks = vi.hoisted(() => ({ session: vi.fn(), provider: vi.fn(), client: null as any }));
vi.mock("@/lib/agents/paystack-sandbox-diagnostics", () => ({ readSandboxTransaction: mocks.provider }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/db", () => ({ default: { $transaction: (...args: unknown[]) => mocks.client.$transaction(...args), $queryRaw: (...args: unknown[]) => mocks.client.$queryRaw(...args) } }));
import { GET } from "@/app/api/admin/agents/commission-diagnostics/[paymentId]/route";
import { POST as sandboxDiagnostic } from "@/app/api/admin/agents/commission-diagnostics/[paymentId]/sandbox/route";
import { GET as ownSummary } from "@/app/api/agents/commissions/summary/route";

const schema = `diagnostic_test_${randomUUID().replace(/-/g, "")}`;
const oldSetting = process.env.AGENT_COMMISSION_DIAGNOSTICS_ENABLED;
const oldSandboxSetting = process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED;
const oldSandboxSecret = process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET;
const oldSummarySetting = process.env.AGENT_COMMISSION_SUMMARY_ENABLED;
let pool: Pool;
const require = createRequire(import.meta.url);
const request = (id: string) => GET(new Request("https://example.test"), { params: Promise.resolve({ paymentId: id }) });

describe.skipIf(!realPrismaConfigured)("commission diagnostics with isolated PostgreSQL and Prisma", () => {
  beforeAll(async () => {
    const url = new URL(PRISMA_TEST_DATABASE_URL);
    if (!["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname) || !/^\/jata_(ci|recon|e2e|verify|agent_test|rehearsal_full)$/.test(url.pathname)) throw new Error("Disposable loopback JATA database required");
    pool = new Pool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await pool.query(`CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED', 'EXPIRED', 'CANCELLED');
      CREATE TABLE "User" ("id" TEXT PRIMARY KEY, "role" TEXT NOT NULL);
      CREATE TABLE "Payment" ("id" TEXT PRIMARY KEY, "reference" TEXT NOT NULL, "status" "PaymentStatus" NOT NULL, "currency" TEXT NOT NULL, "amount" INTEGER NOT NULL);
      CREATE TABLE "AgentApplication" ("id" TEXT PRIMARY KEY, "userId" TEXT UNIQUE NOT NULL, "status" TEXT NOT NULL, "agentStatus" TEXT NOT NULL);`);
    await pool.query(readFileSync("prisma/migrations/20261111000000_agent_commission_ledger/migration.sql", "utf8"));
    await pool.query(`INSERT INTO "User" VALUES ('admin-1', 'ADMIN'), ('former-admin', 'CUSTOMER');
      INSERT INTO "Payment" VALUES ('payment-1', 'private-reference', 'REFUNDED', 'KES', 10000), ('payment-2', 'other-reference', 'PAID', 'KES', 20000), ('payment-3', 'third-reference', 'PAID', 'KES', 30000);
      INSERT INTO "AgentApplication" VALUES ('agent-1', 'user-1', 'PENDING', 'ACTIVE'), ('agent-2', 'user-2', 'PENDING', 'ACTIVE'), ('agent-3', 'user-3', 'PENDING', 'SUSPENDED');
      INSERT INTO "AgentCommissionLedgerEntry" ("id", "paymentId", "agentApplicationId", "entryType", "currency", "amountMinor", "sourceEventId", "policyVersion", "policySnapshot") VALUES
      ('entry-1', 'payment-1', 'agent-1', 'ACCRUAL', 'KES', 1000, 'fixture-event', 'fixture-v1', '{"fixture":true}'),
      ('entry-2', 'payment-2', 'agent-2', 'ACCRUAL', 'KES', 700, 'fixture-event-2', 'fixture-v1', '{"fixture":true}'),
      ('entry-3', 'payment-3', 'agent-1', 'ACCRUAL', 'KES', 9007199254740993, 'fixture-event-3', 'fixture-v1', '{"fixture":true}');
      INSERT INTO "AgentCommissionLedgerEntry" ("id", "paymentId", "agentApplicationId", "entryType", "currency", "amountMinor", "sourceEventId", "originalEntryId", "policyVersion", "policySnapshot")
      VALUES ('entry-4', 'payment-3', 'agent-1', 'REVERSAL', 'KES', -2000, 'fixture-event-4', 'entry-3', 'fixture-v1', '{"fixture":true}');`);
    const harness = process.env.PRISMA_WASM_HARNESS_DIR;
    if (harness) {
      const { PrismaClient } = require(path.join(harness, "generated", "wasm.js"));
      const { PrismaPg } = require(path.join(harness, "node_modules", "@prisma/adapter-pg"));
      const { Pool: HarnessPool } = require(path.join(harness, "node_modules", "pg"));
      mocks.client = new PrismaClient({ adapter: new PrismaPg(new HarnessPool({ connectionString: PRISMA_TEST_DATABASE_URL, options: `-c search_path=${schema}` }), { schema }) });
    } else {
      const { PrismaClient } = require("@prisma/client");
      url.searchParams.set("schema", schema);
      mocks.client = new PrismaClient({ datasourceUrl: url.toString() });
    }
    process.env.AGENT_COMMISSION_DIAGNOSTICS_ENABLED = "true";
    process.env.AGENT_COMMISSION_SUMMARY_ENABLED = "true";
    process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED = "true";
    process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET = "sk_test_fixture";
    mocks.provider.mockResolvedValue({ transactionId: "123", reference: "private-reference", status: "success", currency: "KES", amountMinor: BigInt(10000) });
    mocks.session.mockResolvedValue({ userId: "admin-1", role: "ADMIN" });
  });
  afterAll(async () => {
    if (oldSetting === undefined) delete process.env.AGENT_COMMISSION_DIAGNOSTICS_ENABLED; else process.env.AGENT_COMMISSION_DIAGNOSTICS_ENABLED = oldSetting;
    if (oldSandboxSetting === undefined) delete process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED; else process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED = oldSandboxSetting;
    if (oldSandboxSecret === undefined) delete process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET; else process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET = oldSandboxSecret;
    if (oldSummarySetting === undefined) delete process.env.AGENT_COMMISSION_SUMMARY_ENABLED; else process.env.AGENT_COMMISSION_SUMMARY_ENABLED = oldSummarySetting;
    if (mocks.client) await mocks.client.$disconnect();
    if (pool) { await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`); await pool.end(); }
  });
  it("reads one payment and ledger in a real repeatable-read transaction, without provider proof", async () => {
    const response = await request("payment-1");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ scope: "LOCAL_SINGLE_PAYMENT_ONLY", providerVerification: "NOT_CHECKED", refundVerification: "NOT_CHECKED", eligibility: "NOT_CHECKED", entryCount: 1 });
    expect(body.issueCounts).toMatchObject({ PROVIDER_REFUND_VERIFICATION_REQUIRED: 1, PROVIDER_VERIFICATION_UNAVAILABLE: 1, REFUND_REVERSAL_REVIEW: 1 });
    expect(JSON.stringify(body)).not.toContain("private-reference");
    const other = await request("payment-2");
    expect((await other.json()).entryCount).toBe(1);
  });
  it("compares a synthetic provider fixture with a real local ledger without calling Paystack", async () => {
    const request = new Request("https://example.test", { method: "POST", headers: { origin: "https://example.test", host: "example.test" } });
    const response = await sandboxDiagnostic(request, { params: Promise.resolve({ paymentId: "payment-1" }) });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ scope: "SANDBOX_SINGLE_PAYMENT_ONLY", providerVerification: "SANDBOX_RESPONSE_RECEIVED", refundVerification: "NOT_CHECKED", eligibility: "NOT_CHECKED", entryCount: 1 });
    expect(body.issueCounts).toMatchObject({ PROVIDER_REFUND_VERIFICATION_REQUIRED: 1, REFUND_REVERSAL_REVIEW: 1 });
    expect(mocks.provider).toHaveBeenCalledWith("private-reference");
  });
  it("scopes exact ledger totals to the caller and blocks suspended agents", async () => {
    mocks.session.mockResolvedValueOnce({ userId: "user-1", role: "CUSTOMER" });
    const own = await ownSummary();
    expect(own.status).toBe(200);
    expect(await own.json()).toMatchObject({ scope: "OWN_LEDGER_STORAGE_ONLY", entryCount: "3", accrualMinor: "9007199254741993", reversalMinor: "-2000", netMinor: "9007199254739993", entitlement: "NOT_DETERMINED", payout: "NOT_AVAILABLE" });
    mocks.session.mockResolvedValueOnce({ userId: "user-2", role: "CUSTOMER" });
    const other = await ownSummary();
    expect(await other.json()).toMatchObject({ entryCount: "1", accrualMinor: "700", reversalMinor: "0", netMinor: "700" });
    mocks.session.mockResolvedValueOnce({ userId: "user-3", role: "CUSTOMER" });
    expect((await ownSummary()).status).toBe(403);
    await pool.query(`UPDATE "AgentApplication" SET "agentStatus" = 'SUSPENDED' WHERE "id" = 'agent-1'`);
    mocks.session.mockResolvedValueOnce({ userId: "user-1", role: "CUSTOMER" });
    expect((await ownSummary()).status).toBe(403);
  });
  it("denies a stale administrator session using the actual database role", async () => {
    mocks.session.mockResolvedValueOnce({ userId: "former-admin", role: "ADMIN" });
    expect((await request("payment-1")).status).toBe(403);
  });
});
