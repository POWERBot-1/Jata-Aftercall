import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), transaction: vi.fn(), roles: vi.fn(), payment: vi.fn(), entries: vi.fn(), provider: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: mocks.limit }));
vi.mock("@/lib/db", () => ({ default: { $transaction: mocks.transaction } }));
vi.mock("@/lib/agents/paystack-sandbox-diagnostics", () => ({ readSandboxTransaction: mocks.provider }));
import { POST } from "@/app/api/admin/agents/commission-diagnostics/[paymentId]/sandbox/route";
const env = { ...process.env };
const tx = { $queryRaw: mocks.roles, payment: { findUnique: mocks.payment }, agentCommissionLedgerEntry: { findMany: mocks.entries } };
const call = (origin = "https://example.test") => POST(new Request("https://example.test", { method: "POST", headers: { origin, host: "example.test" } }), { params: Promise.resolve({ paymentId: "p1" }) });
const payment = { id: "p1", reference: "ref-1", status: "PAID", currency: "KES", amount: 10000 };

describe("sandbox-only administrator comparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_COMMISSION_DIAGNOSTICS_ENABLED = "true";
    process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED = "true";
    process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET = "sk_test_fixture";
    mocks.session.mockResolvedValue({ userId: "admin", role: "ADMIN" });
    mocks.limit.mockReturnValue({ allowed: true });
    mocks.roles.mockResolvedValue([{ role: "ADMIN" }]);
    mocks.payment.mockResolvedValue(payment);
    mocks.entries.mockResolvedValue([]);
    mocks.transaction.mockImplementation((callback) => callback(tx));
    mocks.provider.mockResolvedValue({ reference: "ref-1", transactionId: "123", status: "success", currency: "KES", amountMinor: BigInt(10000) });
  });
  afterEach(() => { process.env = { ...env }; });
  it("denies cross-origin, unauthenticated, non-admin, disabled, live-key and limited requests without provider access", async () => {
    expect((await call("https://evil.test")).status).toBe(403);
    mocks.session.mockResolvedValueOnce(null); expect((await call()).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ userId: "u", role: "CUSTOMER" }); expect((await call()).status).toBe(403);
    process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED = "false"; expect((await call()).status).toBe(503);
    process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED = "true"; process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET = "sk_live_fixture"; expect((await call()).status).toBe(503);
    process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET = "sk_test_fixture"; mocks.limit.mockReturnValueOnce({ allowed: false }); expect((await call()).status).toBe(429);
    expect(mocks.provider).not.toHaveBeenCalled(); expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("compares sandbox response with a fresh local snapshot without disclosing references or implying eligibility", async () => {
    const response = await call(); expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ scope: "SANDBOX_SINGLE_PAYMENT_ONLY", providerVerification: "SANDBOX_RESPONSE_RECEIVED", eligibility: "NOT_CHECKED", refundVerification: "NOT_CHECKED", entryCount: 0, issueCounts: {} });
    expect(mocks.provider).toHaveBeenCalledWith("ref-1"); expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.transaction.mock.calls.map((x) => x[1])).toEqual([{ isolationLevel: "RepeatableRead" }, { isolationLevel: "RepeatableRead" }]);
  });
  it("flags provider differences instead of authorizing payment or commission", async () => {
    mocks.provider.mockResolvedValueOnce({ reference: "other", transactionId: "123", status: "failed", currency: "USD", amountMinor: BigInt(50) });
    const response = await call(); const body = await response.json();
    expect(body.issueCounts).toMatchObject({ PROVIDER_REFERENCE_MISMATCH: 1, PROVIDER_AMOUNT_MISMATCH: 1, PROVIDER_CURRENCY_MISMATCH: 1, PAYMENT_STATUS_MISMATCH: 1 });
    expect(JSON.stringify(body)).not.toContain("other");
  });
  it("rechecks revoked roles, rejects changed references and does not use partial entries", async () => {
    mocks.roles.mockResolvedValueOnce([{ role: "ADMIN" }]).mockResolvedValueOnce([{ role: "CUSTOMER" }]);
    expect((await call()).status).toBe(403);
    mocks.payment.mockResolvedValueOnce(payment).mockResolvedValueOnce({ ...payment, reference: "changed" });
    expect((await call()).status).toBe(409);
    mocks.entries.mockResolvedValueOnce(Array(501).fill({})); expect((await call()).status).toBe(409);
    mocks.provider.mockRejectedValueOnce(new Error("secret-provider-details"));
    const failed = await call(); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain("secret-provider-details");
  });
});
