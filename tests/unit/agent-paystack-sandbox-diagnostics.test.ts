import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { readSandboxTransaction } from "@/lib/agents/paystack-sandbox-diagnostics";
const env = { ...process.env };
const payload = { status: true, data: { id: 123, reference: "reference-1", status: "success", currency: "KES", amount: 10000 } };
const fetchMock = vi.fn();
describe("test-only Paystack read boundary", () => {
  beforeEach(() => { vi.stubGlobal("fetch", fetchMock); fetchMock.mockReset(); process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED = "true"; process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET = "sk_test_fixture"; fetchMock.mockResolvedValue({ ok: true, json: async () => payload }); });
  afterEach(() => { vi.unstubAllGlobals(); process.env = { ...env }; });
  it("uses only a dedicated test key and fixed endpoint without redirects", async () => {
    expect(await readSandboxTransaction("reference-1")).toEqual({ transactionId: "123", reference: "reference-1", status: "success", currency: "KES", amountMinor: BigInt(10000) });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.paystack.co/transaction/verify/reference-1");
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: "error", cache: "no-store", headers: { Authorization: "Bearer sk_test_fixture" } });
  });
  it("refuses disabled, live-key and unsafe reference inputs before network access", async () => {
    process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED = "false"; await expect(readSandboxTransaction("reference-1")).rejects.toThrow();
    process.env.AGENT_COMMISSION_SANDBOX_DIAGNOSTICS_ENABLED = "true"; process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET = "sk_live_fixture"; await expect(readSandboxTransaction("reference-1")).rejects.toThrow();
    process.env.AGENT_COMMISSION_PAYSTACK_TEST_SECRET = "sk_test_fixture"; await expect(readSandboxTransaction("../secret")).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects malformed or unsafe provider payloads", async () => {
    for (const data of [{ ...payload.data, id: "mock_fake" }, { ...payload.data, id: Number.MAX_SAFE_INTEGER + 1 }, { ...payload.data, amount: 0.1 }, { ...payload.data, currency: "kes" }, { ...payload.data, reference: "../bad" }]) {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ status: true, data }) });
      await expect(readSandboxTransaction("reference-1")).rejects.toThrow();
    }
    fetchMock.mockResolvedValueOnce({ ok: false, json: async () => payload }); await expect(readSandboxTransaction("reference-1")).rejects.toThrow();
  });
});
