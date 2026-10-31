"use client";
import { useEffect, useState } from "react";

type Summary = { entryCount: string; accrualMinor: string; reversalMinor: string; netMinor: string };
type State = { status: "loading" } | { status: "error" } | { status: "ready"; summary: Summary };
const unsigned = (value: unknown): value is string => typeof value === "string" && /^(0|[1-9]\d{0,99})$/.test(value);
const nonPositive = (value: unknown): value is string => typeof value === "string" && /^(0|-[1-9]\d{0,99})$/.test(value);

/** Parse the constrained API response; no value here represents verified or payable earnings. */
export function parseStorageSummary(value: unknown): Summary | null {
  if (!value || typeof value !== "object") return null;
  const data = value as Record<string, unknown>;
  if (data.scope !== "OWN_LEDGER_STORAGE_ONLY" || data.currency !== "KES" || data.verification !== "NOT_CHECKED" || data.entitlement !== "NOT_DETERMINED" || data.payout !== "NOT_AVAILABLE" ||
      !unsigned(data.entryCount) || !unsigned(data.accrualMinor) || !nonPositive(data.reversalMinor) || !unsigned(data.netMinor)) return null;
  if (BigInt(data.accrualMinor) + BigInt(data.reversalMinor) !== BigInt(data.netMinor) ||
      (data.entryCount === "0" && (data.accrualMinor !== "0" || data.reversalMinor !== "0" || data.netMinor !== "0"))) return null;
  return { entryCount: data.entryCount, accrualMinor: data.accrualMinor, reversalMinor: data.reversalMinor, netMinor: data.netMinor };
}

/** Exact KES formatting, including values outside JavaScript's safe integer range. */
export function formatStorageMinor(value: string): string {
  const negative = value.startsWith("-");
  const digits = (negative ? value.slice(1) : value).padStart(3, "0");
  const whole = digits.slice(0, -2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}KES ${whole}.${digits.slice(-2)}`;
}

export default function CommissionStorageSummary() {
  const [state, setState] = useState<State>({ status: "loading" });
  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch("/api/agents/commissions/summary", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Unavailable");
        const summary = parseStorageSummary(await response.json());
        if (!summary) throw new Error("Invalid response");
        if (!controller.signal.aborted) setState({ status: "ready", summary });
      } catch {
        if (!controller.signal.aborted) setState({ status: "error" });
      }
    }
    void load();
    return () => controller.abort();
  }, []);
  return <section aria-label="Unverified commission ledger records">
    <h3>Unverified commission ledger records</h3>
    <p>These are stored records only. Payments and eligibility have not been verified. These figures are not earnings or a payable balance; payouts are unavailable.</p>
    {state.status === "loading" ? <p role="status">Loading ledger records…</p> : state.status === "error" ? <p role="alert">Ledger records are temporarily unavailable. Refresh to try again.</p> : state.summary.entryCount === "0" ? <p>No ledger records are stored for your account.</p> : <div style={{ overflowWrap: "anywhere" }}>
      <p><strong>Stored entries:</strong> {state.summary.entryCount}</p>
      <p><strong>Accrual entries:</strong> {formatStorageMinor(state.summary.accrualMinor)}</p>
      <p><strong>Reversal entries:</strong> {formatStorageMinor(state.summary.reversalMinor)}</p>
      <p><strong>Net stored amount:</strong> {formatStorageMinor(state.summary.netMinor)}</p>
    </div>}
  </section>;
}
