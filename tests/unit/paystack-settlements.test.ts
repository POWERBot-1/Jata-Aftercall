import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  listPaystackSettlementTransactions,
  listPaystackSettlements,
} from "@/lib/payments/providers/paystack-settlements";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("Paystack read-only settlement adapter", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists a bounded page and returns only reduced settlement evidence", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      status: true,
      message: "Settlements retrieved",
      data: [{
        id: 3090024,
        status: "success",
        currency: "kes",
        total_processed: 100_000,
        total_fees: 1_500,
        effective_amount: 98_500,
        deductions: null,
        settlement_date: "2026-11-20T00:00:00.000Z",
        settled_by: "sensitive-provider-value",
        account_number: "1234567890",
      }],
      meta: { total: 1, page: 2, perPage: 25, pageCount: 1 },
    })) as unknown as typeof fetch;

    const result = await listPaystackSettlements(
      { page: 2, perPage: 25, status: "success", from: "2026-11-01", to: "2026-11-30" },
      { secretKey: "sk_test_unit", fetchImpl },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0];
    expect(String(url)).toContain("/settlement?page=2&perPage=25&status=success");
    expect(init?.method).toBe("GET");
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer sk_test_unit");
    expect(result).toEqual({
      records: [{
        provider: "PAYSTACK",
        providerSettlementId: "3090024",
        status: "success",
        currency: "KES",
        grossProcessedMinor: 100_000,
        providerFeeMinor: 1_500,
        effectiveNetMinor: 98_500,
        deductionsMinor: null,
        settlementDate: "2026-11-20T00:00:00.000Z",
      }],
      page: 2,
      perPage: 25,
      total: 1,
      pageCount: 1,
    });
    expect(JSON.stringify(result)).not.toContain("1234567890");
    expect(JSON.stringify(result)).not.toContain("sensitive-provider-value");
  });

  it("retrieves settlement transactions without exposing customer or authorization details", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      status: true,
      data: [{
        id: 2067030515,
        status: "success",
        reference: "jata-payment-ref",
        amount: 10_000,
        currency: "KES",
        fees: 390,
        paid_at: "2026-11-20T10:00:00.000Z",
        customer: { email: "private@example.com", phone: "+254700000000" },
        authorization: { authorization_code: "AUTH_SECRET" },
      }],
      meta: { total: 1, page: 1, perPage: 50, pageCount: 1 },
    })) as unknown as typeof fetch;

    const result = await listPaystackSettlementTransactions(
      "8610870",
      {},
      { secretKey: "sk_test_unit", fetchImpl },
    );

    expect(String(vi.mocked(fetchImpl).mock.calls[0][0])).toContain("/settlement/8610870/transactions");
    expect(result.records).toEqual([{
      provider: "PAYSTACK",
      providerTransactionId: "2067030515",
      reference: "jata-payment-ref",
      status: "success",
      amountMinor: 10_000,
      currency: "KES",
      providerFeeMinor: 390,
      paidAt: "2026-11-20T10:00:00.000Z",
    }]);
    expect(JSON.stringify(result)).not.toContain("private@example.com");
    expect(JSON.stringify(result)).not.toContain("AUTH_SECRET");
  });

  it("does not call the network when the Paystack connector is not configured", async () => {
    const fetchImpl = vi.fn();
    await expect(listPaystackSettlements({}, { fetchImpl: fetchImpl as unknown as typeof fetch }))
      .rejects.toThrow("PAYSTACK_NOT_CONFIGURED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects invalid settlement ids, pagination, status and date ranges before network access", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(listPaystackSettlementTransactions("../1", {}, { secretKey: "sk_test_unit", fetchImpl }))
      .rejects.toThrow("PAYSTACK_SETTLEMENT_INVALID_ID");
    await expect(listPaystackSettlements({ page: 0 }, { secretKey: "sk_test_unit", fetchImpl }))
      .rejects.toThrow("PAYSTACK_SETTLEMENT_INVALID_PAGINATION");
    await expect(listPaystackSettlements({ status: "unknown" as never }, { secretKey: "sk_test_unit", fetchImpl }))
      .rejects.toThrow("PAYSTACK_SETTLEMENT_INVALID_STATUS");
    await expect(listPaystackSettlements(
      { from: "2026-11-30", to: "2026-11-01" },
      { secretKey: "sk_test_unit", fetchImpl },
    )).rejects.toThrow("PAYSTACK_SETTLEMENT_INVALID_DATE_RANGE");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed on provider HTTP and malformed envelope responses", async () => {
    const failedFetch = vi.fn(async () => jsonResponse({}, 401)) as unknown as typeof fetch;
    await expect(listPaystackSettlements({}, { secretKey: "sk_test_unit", fetchImpl: failedFetch }))
      .rejects.toThrow("PAYSTACK_SETTLEMENT_REQUEST_FAILED");

    const malformedFetch = vi.fn(async () => jsonResponse({ status: true, data: {} })) as unknown as typeof fetch;
    await expect(listPaystackSettlements({}, { secretKey: "sk_test_unit", fetchImpl: malformedFetch }))
      .rejects.toThrow("PAYSTACK_SETTLEMENT_INVALID_RESPONSE");
  });

  it("does not invent absent monetary values or accept malformed amounts", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      status: true,
      data: [{
        id: "9001",
        status: "pending",
        currency: "KES",
        total_processed: "10000",
        total_fees: -1,
        effective_amount: 9_000.5,
        deductions: null,
        settlement_date: "not-a-date",
      }],
      meta: {},
    })) as unknown as typeof fetch;

    const result = await listPaystackSettlements({}, { secretKey: "sk_test_unit", fetchImpl });
    expect(result.records[0]).toMatchObject({
      providerSettlementId: "9001",
      status: "pending",
      currency: "KES",
      grossProcessedMinor: null,
      providerFeeMinor: null,
      effectiveNetMinor: null,
      deductionsMinor: null,
      settlementDate: null,
    });
  });
});
