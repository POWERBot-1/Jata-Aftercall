/**
 * Read-only Paystack settlement feed adapter.
 *
 * This module calls only Paystack GET settlement endpoints. It returns a deliberately reduced
 * evidence shape and never writes payment, payout, bank or accounting records.
 */
import { readPaystackConfig } from "../config";

const PAYSTACK_BASE = "https://api.paystack.co";
const MAX_PAGE = 10_000;
const DEFAULT_PER_PAGE = 50;
const MAX_PER_PAGE = 100;

type PaystackEnvelope = {
  status?: unknown;
  data?: unknown;
  meta?: unknown;
};

export type PaystackSettlementStatus = "success" | "processing" | "pending" | "failed";

export type PaystackSettlementRecord = {
  provider: "PAYSTACK";
  providerSettlementId: string;
  status: PaystackSettlementStatus | "UNKNOWN";
  currency: string | null;
  grossProcessedMinor: number | null;
  providerFeeMinor: number | null;
  effectiveNetMinor: number | null;
  deductionsMinor: number | null;
  settlementDate: string | null;
};

export type PaystackSettlementTransaction = {
  provider: "PAYSTACK";
  providerTransactionId: string | null;
  reference: string | null;
  status: string | null;
  amountMinor: number | null;
  currency: string | null;
  providerFeeMinor: number | null;
  paidAt: string | null;
};

export type PaystackSettlementPage<T> = {
  records: T[];
  page: number;
  perPage: number;
  total: number | null;
  pageCount: number | null;
};

export type PaystackSettlementQuery = {
  page?: number;
  perPage?: number;
  status?: PaystackSettlementStatus;
  from?: string;
  to?: string;
};

export type PaystackSettlementFetchOptions = {
  fetchImpl?: typeof fetch;
  /** Explicit config injection keeps tests deterministic; production defaults to server config. */
  secretKey?: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeMinor(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function safeId(value: unknown): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[0-9]{1,20}$/.test(value)) return value;
  return null;
}

function safeCurrency(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z]{3}$/.test(value) ? value.toUpperCase() : null;
}

function safeDate(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 64) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function boundedInteger(value: number | undefined, fallback: number, max: number): number {
  const candidate = value ?? fallback;
  if (!Number.isSafeInteger(candidate) || candidate < 1 || candidate > max) {
    throw new Error("PAYSTACK_SETTLEMENT_INVALID_PAGINATION");
  }
  return candidate;
}

function validateDateFilter(value: string | undefined): string | null {
  if (value === undefined) return null;
  if (value.length > 64 || !Number.isFinite(new Date(value).getTime())) {
    throw new Error("PAYSTACK_SETTLEMENT_INVALID_DATE_FILTER");
  }
  return value;
}

function normalizeSettlement(value: unknown): PaystackSettlementRecord | null {
  if (!isRecord(value)) return null;
  const providerSettlementId = safeId(value.id);
  if (!providerSettlementId) return null;
  const status = typeof value.status === "string" &&
    ["success", "processing", "pending", "failed"].includes(value.status)
    ? value.status as PaystackSettlementStatus
    : "UNKNOWN";
  return {
    provider: "PAYSTACK",
    providerSettlementId,
    status,
    currency: safeCurrency(value.currency),
    grossProcessedMinor: safeMinor(value.total_processed),
    providerFeeMinor: safeMinor(value.total_fees),
    effectiveNetMinor: safeMinor(value.effective_amount),
    // Paystack's public example returns deductions=null. Null remains unknown, not zero or tax.
    deductionsMinor: safeMinor(value.deductions),
    settlementDate: safeDate(value.settlement_date),
  };
}

function normalizeSettlementTransaction(value: unknown): PaystackSettlementTransaction | null {
  if (!isRecord(value)) return null;
  const providerTransactionId = safeId(value.id);
  const reference = typeof value.reference === "string" && value.reference.trim().length > 0 &&
    value.reference.trim().length <= 128 ? value.reference.trim() : null;
  if (!providerTransactionId && !reference) return null;
  return {
    provider: "PAYSTACK",
    providerTransactionId,
    reference,
    status: typeof value.status === "string" && value.status.length <= 40 ? value.status : null,
    amountMinor: safeMinor(value.amount),
    currency: safeCurrency(value.currency),
    providerFeeMinor: safeMinor(value.fees),
    paidAt: safeDate(value.paid_at ?? value.paidAt),
  };
}

function pageMeta(value: unknown, page: number, perPage: number) {
  const meta = isRecord(value) ? value : {};
  return {
    page,
    perPage,
    total: typeof meta.total === "number" && Number.isSafeInteger(meta.total) && meta.total >= 0 ? meta.total : null,
    pageCount: typeof meta.pageCount === "number" && Number.isSafeInteger(meta.pageCount) && meta.pageCount >= 0 ? meta.pageCount : null,
  };
}

async function getPaystackPage<T>(
  path: string,
  query: URLSearchParams,
  normalize: (value: unknown) => T | null,
  options: PaystackSettlementFetchOptions,
): Promise<PaystackSettlementPage<T>> {
  const config = readPaystackConfig();
  const secretKey = options.secretKey ?? (config.ready ? config.secretKey : "");
  if (!secretKey) throw new Error("PAYSTACK_NOT_CONFIGURED");

  const page = Number(query.get("page") ?? 1);
  const perPage = Number(query.get("perPage") ?? DEFAULT_PER_PAGE);
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(`${PAYSTACK_BASE}${path}?${query.toString()}`, {
    method: "GET",
    headers: { Authorization: `Bearer ${secretKey}`, Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  if (!response.ok) throw new Error("PAYSTACK_SETTLEMENT_REQUEST_FAILED");

  const envelope = await response.json().catch(() => null) as PaystackEnvelope | null;
  if (!envelope || envelope.status !== true || !Array.isArray(envelope.data)) {
    throw new Error("PAYSTACK_SETTLEMENT_INVALID_RESPONSE");
  }
  const records = envelope.data.map(normalize).filter((record): record is T => record !== null);
  return { records, ...pageMeta(envelope.meta, page, perPage) };
}

/** List one bounded page of Paystack settlement summaries (read-only GET). */
export async function listPaystackSettlements(
  filters: PaystackSettlementQuery = {},
  options: PaystackSettlementFetchOptions = {},
): Promise<PaystackSettlementPage<PaystackSettlementRecord>> {
  const page = boundedInteger(filters.page, 1, MAX_PAGE);
  const perPage = boundedInteger(filters.perPage, DEFAULT_PER_PAGE, MAX_PER_PAGE);
  const query = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  if (filters.status && !["success", "processing", "pending", "failed"].includes(filters.status)) {
    throw new Error("PAYSTACK_SETTLEMENT_INVALID_STATUS");
  }
  if (filters.status) query.set("status", filters.status);
  const from = validateDateFilter(filters.from);
  const to = validateDateFilter(filters.to);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    throw new Error("PAYSTACK_SETTLEMENT_INVALID_DATE_RANGE");
  }
  return getPaystackPage("/settlement", query, normalizeSettlement, options);
}

/** List one bounded page of transactions included in a single provider settlement. */
export async function listPaystackSettlementTransactions(
  settlementId: string,
  filters: Pick<PaystackSettlementQuery, "page" | "perPage" | "from" | "to"> = {},
  options: PaystackSettlementFetchOptions = {},
): Promise<PaystackSettlementPage<PaystackSettlementTransaction>> {
  if (!/^[0-9]{1,20}$/.test(settlementId)) throw new Error("PAYSTACK_SETTLEMENT_INVALID_ID");
  const page = boundedInteger(filters.page, 1, MAX_PAGE);
  const perPage = boundedInteger(filters.perPage, DEFAULT_PER_PAGE, MAX_PER_PAGE);
  const query = new URLSearchParams({ page: String(page), perPage: String(perPage) });
  const from = validateDateFilter(filters.from);
  const to = validateDateFilter(filters.to);
  if (from) query.set("from", from);
  if (to) query.set("to", to);
  if (from && to && new Date(from).getTime() > new Date(to).getTime()) {
    throw new Error("PAYSTACK_SETTLEMENT_INVALID_DATE_RANGE");
  }
  return getPaystackPage(
    `/settlement/${encodeURIComponent(settlementId)}/transactions`,
    query,
    normalizeSettlementTransaction,
    options,
  );
}
