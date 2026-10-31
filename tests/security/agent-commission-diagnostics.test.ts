import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), limit: vi.fn(), transaction: vi.fn(), roles: vi.fn(), payment: vi.fn(), entries: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getSession: mocks.session }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitByIdentity: mocks.limit }));
vi.mock("@/lib/db", () => ({ default: { $transaction: mocks.transaction } }));
import { GET } from "@/app/api/admin/agents/commission-diagnostics/[paymentId]/route";

const env = { ...process.env };
const tx = { $queryRaw: mocks.roles, payment: { findUnique: mocks.payment }, agentCommissionLedgerEntry: { findMany: mocks.entries } };
const request = (paymentId = "payment-1") => GET(new Request("https://example.test"), { params: Promise.resolve({ paymentId }) });
const payment = { id: "payment-1", reference: "private-reference", status: "PAID", currency: "KES", amount: 10000 };
const accrual = { id: "entry-1", paymentId: "payment-1", agentApplicationId: "private-agent", currency: "KES", entryType: "ACCRUAL", amountMinor: BigInt(1000), originalEntryId: null, sourceEventId: "private-source" };

describe("admin-only local commission diagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AGENT_COMMISSION_DIAGNOSTICS_ENABLED = "true";
    mocks.session.mockResolvedValue({ userId: "admin-1", role: "ADMIN" });
    mocks.limit.mockReturnValue({ allowed: true });
    mocks.transaction.mockImplementation((fn) => fn(tx));
    mocks.roles.mockResolvedValue([{ role: "ADMIN" }]);
    mocks.payment.mockResolvedValue(payment);
    mocks.entries.mockResolvedValue([accrual]);
  });
  afterEach(() => { process.env = { ...env }; });
  it("rejects anonymous, non-admin, disabled and rate-limited requests before reading", async () => {
    mocks.session.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ userId: "user", role: "CUSTOMER" });
    expect((await request()).status).toBe(403);
    process.env.AGENT_COMMISSION_DIAGNOSTICS_ENABLED = "false";
    expect((await request()).status).toBe(503);
    process.env.AGENT_COMMISSION_DIAGNOSTICS_ENABLED = "true";
    mocks.limit.mockReturnValueOnce({ allowed: false });
    const limited = await request();
    expect(limited.status).toBe(429);
    expect(limited.headers.get("cache-control")).toContain("no-store");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it("rechecks database role, rejects invalid ids and keeps missing payments private", async () => {
    expect((await request("../bad")).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
    mocks.roles.mockResolvedValueOnce([{ role: "CUSTOMER" }]);
    expect((await request()).status).toBe(403);
    expect(mocks.payment).not.toHaveBeenCalled();
    mocks.payment.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(404);
    expect(mocks.entries).not.toHaveBeenCalled();
  });
  it("returns only scoped local issue counts and never reports provider or eligibility as verified", async () => {
    const res = await request();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    expect(await res.json()).toEqual({ scope: "LOCAL_SINGLE_PAYMENT_ONLY", providerVerification: "NOT_CHECKED", eligibility: "NOT_CHECKED", refundVerification: "NOT_CHECKED", entryCount: 1, issueCounts: { PROVIDER_VERIFICATION_UNAVAILABLE: 1 } });
    expect(mocks.transaction.mock.calls[0][1]).toEqual({ isolationLevel: "RepeatableRead" });
    expect(mocks.payment.mock.calls[0][0]).toEqual({ where: { id: "payment-1" }, select: { id: true, reference: true, status: true, currency: true, amount: true } });
    expect(mocks.entries.mock.calls[0][0]).toMatchObject({ where: { paymentId: "payment-1" }, take: 501 });
  });
  it("fails closed instead of returning partial totals or database details", async () => {
    mocks.entries.mockResolvedValueOnce(Array(501).fill(accrual));
    expect((await request()).status).toBe(409);
    mocks.transaction.mockRejectedValueOnce(new Error("secret-db-connection"));
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret-db-connection");
    mocks.payment.mockResolvedValueOnce({ ...payment, amount: Number.NaN });
    expect((await request()).status).toBe(503);
  });
  it("flags refunded payments and reversals as unverified, without returning private identifiers", async () => {
    mocks.payment.mockResolvedValueOnce({ ...payment, status: "REFUNDED" });
    mocks.entries.mockResolvedValueOnce([accrual, { ...accrual, id: "entry-2", entryType: "REVERSAL", amountMinor: BigInt(-1000), originalEntryId: "entry-1", sourceEventId: "refund" }]);
    const body = await (await request()).text();
    expect(body).toContain("PROVIDER_REFUND_VERIFICATION_REQUIRED");
    expect(body).toContain("REVERSAL_EVIDENCE_REVIEW");
    expect(body).not.toContain("private-");
  });
});
