/**
 * Payment destination identification and validation (§9, §10, §11, §13, §52, §56).
 *
 * The merchant enters one thing — where their customers pay — and JATA works out the rest:
 * which provider it belongs to, which destination kind it is, whether the format is even
 * possible, and what capabilities are *actually* available for it.
 *
 * The honesty rules this module enforces:
 *   • a number that merely has the right length is FORMAT_VERIFIED, never "connected" (§52)
 *   • JATA never invents an ownership lookup the provider does not expose (§13)
 *   • capabilities come from the provider adapter's real configuration, never from a wish (§88)
 */

import {
  DESTINATION_PROVIDER,
  DESTINATION_TITLES,
  type DestinationKind,
  type DestinationRecord,
  type ProviderKey,
} from "./types";
import { maskDestination, maskPhone } from "./money";

export type DestinationInput = {
  kind?: unknown;
  /** The number/text the merchant typed: till, paybill, account, pochi number. */
  providerDestinationId?: unknown;
  /** PayBill business/account reference. */
  providerAccountRef?: unknown;
  bankName?: unknown;
  accountName?: unknown;
  currency?: unknown;
};

export type DestinationDraft = {
  kind: DestinationKind;
  provider: ProviderKey;
  providerDestinationId: string;
  providerAccountRef: string;
  bankName: string | null;
  accountName: string | null;
  currency: string;
};

export type IdentificationResult =
  | { ok: true; draft: DestinationDraft }
  | { ok: false; code: string; message: string; field?: string };

function clean(value: unknown, max = 80): string {
  return typeof value === "string" ? value.replace(/[<>]/g, "").trim().slice(0, max) : "";
}

function digits(value: unknown, max = 32): string {
  return clean(value, max).replace(/[^0-9]/g, "");
}

/**
 * Turns what the merchant entered into a destination JATA can reason about. Format rules are
 * deliberately conservative: an obviously wrong number is refused here with plain language
 * rather than being passed to a provider to fail later (§38).
 */
export function identifyDestination(input: DestinationInput): IdentificationResult {
  const kindRaw = clean(input.kind, 32).toUpperCase();
  const kind = (["MPESA_TILL", "MPESA_PAYBILL", "MPESA_POCHI", "BANK_ACCOUNT", "PAYSTACK"] as string[]).includes(kindRaw)
    ? (kindRaw as DestinationKind)
    : null;
  if (!kind) {
    return { ok: false, code: "KIND_REQUIRED", message: "Choose where your customers pay.", field: "kind" };
  }

  const provider = DESTINATION_PROVIDER[kind];
  const currency = clean(input.currency, 3).toUpperCase() || "KES";
  const number = clean(input.providerDestinationId, 64);
  const accountRef = clean(input.providerAccountRef, 64);
  const bankName = clean(input.bankName, 80) || null;
  const accountName = clean(input.accountName, 120) || null;

  if (kind === "MPESA_TILL") {
    const till = digits(number, 12);
    if (!/^\d{5,7}$/.test(till)) {
      return { ok: false, code: "TILL_INVALID", message: "Enter your M-PESA till number — 5 to 7 digits.", field: "providerDestinationId" };
    }
    return { ok: true, draft: { kind, provider, providerDestinationId: till, providerAccountRef: "", bankName: null, accountName: null, currency } };
  }

  if (kind === "MPESA_PAYBILL") {
    const paybill = digits(number, 12);
    if (!/^\d{5,7}$/.test(paybill)) {
      return { ok: false, code: "PAYBILL_INVALID", message: "Enter your M-PESA PayBill number — 5 to 7 digits.", field: "providerDestinationId" };
    }
    if (!accountRef) {
      return { ok: false, code: "ACCOUNT_REF_REQUIRED", message: "Add the reference your customers should use for this PayBill.", field: "providerAccountRef" };
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9\-./_]{0,31}$/.test(accountRef)) {
      return { ok: false, code: "ACCOUNT_REF_INVALID", message: "Use letters and numbers only for the reference — for example JATA-1048.", field: "providerAccountRef" };
    }
    return { ok: true, draft: { kind, provider, providerDestinationId: paybill, providerAccountRef: accountRef, bankName: null, accountName: null, currency } };
  }

  if (kind === "MPESA_POCHI") {
    const pochiDigits = digits(number, 15);
    if (!/^(?:254|0)(?:7|1)\d{8}$/.test(pochiDigits) && !/^(?:7|1)\d{8}$/.test(pochiDigits)) {
      return { ok: false, code: "POCHI_INVALID", message: "Enter the Pochi la Biashara phone number, for example 0712345678.", field: "providerDestinationId" };
    }
    const normalized = /^(?:254)\d{9}$/.test(pochiDigits)
      ? pochiDigits
      : /^0\d{9}$/.test(pochiDigits)
        ? `254${pochiDigits.slice(1)}`
        : `254${pochiDigits}`;
    return { ok: true, draft: { kind, provider, providerDestinationId: normalized, providerAccountRef: "", bankName: null, accountName: null, currency } };
  }

  if (kind === "BANK_ACCOUNT") {
    const account = digits(number, 24);
    if (!bankName) return { ok: false, code: "BANK_REQUIRED", message: "Which bank is this account with?", field: "bankName" };
    if (!accountName) return { ok: false, code: "ACCOUNT_NAME_REQUIRED", message: "Add the account name as it appears on the bank account.", field: "accountName" };
    if (!/^\d{5,20}$/.test(account)) {
      return { ok: false, code: "ACCOUNT_INVALID", message: "Enter the bank account number — 5 to 20 digits.", field: "providerDestinationId" };
    }
    return { ok: true, draft: { kind, provider, providerDestinationId: account, providerAccountRef: "", bankName, accountName, currency } };
  }

  // PAYSTACK
  if (number.length < 3) {
    return { ok: false, code: "PAYSTACK_REF_INVALID", message: "Give this Paystack destination a name you will recognise — for example your business name.", field: "providerDestinationId" };
  }
  return { ok: true, draft: { kind, provider, providerDestinationId: number, providerAccountRef: accountRef, bankName: null, accountName: null, currency } };
}

/** §7 `validateDestination` — the same rules, exposed under the name the architecture uses. */
export function validateDestination(input: DestinationInput): IdentificationResult {
  return identifyDestination(input);
}

/** "M-PESA Till •••4567" — the only way a destination is ever rendered (§59). */
export function destinationLabel(destination: Pick<DestinationRecord, "kind" | "providerDestinationId" | "bankName">): string {
  if (destination.kind === "BANK_ACCOUNT") {
    return `${destination.bankName ?? "Bank"} account ${maskDestination(destination.providerDestinationId)}`;
  }
  if (destination.kind === "MPESA_POCHI") {
    return `Pochi la Biashara ${maskPhone(destination.providerDestinationId) ?? maskDestination(destination.providerDestinationId)}`;
  }
  return `${DESTINATION_TITLES[destination.kind]} ${maskDestination(destination.providerDestinationId)}`;
}

export function destinationHeadline(destination: Pick<DestinationRecord, "kind" | "providerDestinationId" | "bankName" | "providerAccountRef">): string {
  const label = destinationLabel(destination);
  if (destination.kind === "MPESA_PAYBILL" && destination.providerAccountRef) {
    return `${label} · ref ${destination.providerAccountRef}`;
  }
  return label;
}

/**
 * Which destination a payment is routed to (§21). JATA decides — the POS only ever sends an
 * amount and (optionally) a business. If the merchant asked for a specific destination, that
 * destination must belong to this tenant and be active; otherwise the primary destination wins.
 */
export type RoutingChoice =
  | { ok: true; destination: DestinationRecord }
  | { ok: false; code: string; message: string };

export function routeDestination(
  destinations: DestinationRecord[],
  requestedId?: string | null,
): RoutingChoice {
  const active = (destinations ?? []).filter((destination) => destination.isActive);
  if (requestedId) {
    const requested = active.find((destination) => destination.id === requestedId);
    if (!requested) {
      return { ok: false, code: "DESTINATION_NOT_FOUND", message: "That payment destination is not available for this business." };
    }
    return { ok: true, destination: requested };
  }
  const primary = active.find((destination) => destination.isPrimary) ?? active[0];
  if (!primary) {
    return {
      ok: false,
      code: "NO_DESTINATION",
      message: "Add where your customers pay before you can request a payment.",
    };
  }
  return { ok: true, destination: primary };
}

/**
 * The capabilities a destination *really* has, given the provider adapter's connector state.
 * A destination whose provider connector is not active keeps only the honest, manual
 * capability — never "real-time confirmation" (§52, §88, §129).
 */
export function effectiveCapabilities(params: {
  providerCapabilities: readonly string[];
  connectorReady: boolean;
  verificationLevel: "NONE" | "FORMAT" | "PROVIDER" | "LIVE";
}): string[] {
  const { providerCapabilities, connectorReady, verificationLevel } = params;
  if (!connectorReady) {
    // The provider may be perfectly capable; JATA's central connector is not, in this deployment.
    return providerCapabilities.includes("PAYMENT_INSTRUCTIONS") ? ["PAYMENT_INSTRUCTIONS"] : [];
  }
  const capped = providerCapabilities.filter((capability) =>
    // Real-time claims require an actual provider-side verification, not a format check.
    ["REAL_TIME_CONFIRMATION", "WEBHOOKS", "STATUS_QUERY", "REFUNDS", "REVERSALS"].includes(capability)
      ? verificationLevel === "PROVIDER" || verificationLevel === "LIVE"
      : true,
  );
  return [...capped];
}
