/**
 * Credit engine (§30, §11, §12)
 *
 * Customer credit and supplier credit are separate ledgers that never meet: money owed *by*
 * customers is receivable, money owed *to* suppliers is payable. Both use the same
 * arithmetic, but a balance is always tied to one party type, and mixing them is a bug this
 * module makes impossible by construction.
 */

import type { CreditPartyType, PosConfiguration } from "./types";

export type CreditEntry = {
  id: string;
  partyType: CreditPartyType;
  partyId: string;
  direction: "DEBIT" | "CREDIT";
  amountKES: number;
  occurredAt: Date | string;
  dueAt?: Date | string | null;
  reference?: string | null;
  note?: string | null;
};

export type CreditParty = {
  id: string;
  name: string;
  partyType: CreditPartyType;
  balanceKES: number;
  limitKES: number;
  termsDays: number;
  phone?: string | null;
  notes?: string | null;
};

export const RECEIVABLE: CreditPartyType = "CUSTOMER";
export const PAYABLE: CreditPartyType = "SUPPLIER";

/** A single place that turns ledger entries into a balance — never a client-supplied number. */
export function balanceFromEntries(entries: CreditEntry[], partyType: CreditPartyType): number {
  return entries
    .filter((entry) => entry.partyType === partyType)
    .reduce((total, entry) => {
      const amount = Math.max(0, Number(entry.amountKES) || 0);
      return entry.direction === "DEBIT" ? total + amount : total - amount;
    }, 0);
}

export function outstandingKES(party: Pick<CreditParty, "balanceKES">): number {
  return Math.max(0, Math.round(Number(party.balanceKES) || 0));
}

/** Flat result shape (see money.ts): readable under `strictNullChecks: false`. */
export type CreditDecision = {
  allowed: boolean;
  reason: string;
  newBalanceKES: number;
  code?: string;
  remainingKES?: number;
  requiresApproval?: boolean;
};

/**
 * May this sale go on credit? The decision is made from the configuration and the recorded
 * balance — a browser cannot assert that a customer is within their limit (§30, §56).
 */
export function decideCredit(params: {
  config: PosConfiguration;
  party: Pick<CreditParty, "balanceKES" | "limitKES" | "partyType"> | null;
  amountKES: number;
  roleKey?: string;
  now?: Date;
  oldestEntryAt?: Date | string | null;
}): CreditDecision {
  const now = params.now ?? new Date();
  const config = params.config;
  if (!config.credit.enabled) {
    return { allowed: false, code: "CREDIT_DISABLED", reason: "Credit is not switched on for this business.", newBalanceKES: 0 };
  }
  const amount = Math.max(0, Math.round(Number(params.amountKES) || 0));
  if (amount <= 0) {
    return { allowed: false, code: "NO_AMOUNT", reason: "Enter the amount going on credit.", newBalanceKES: 0 };
  }
  if (!params.party) {
    return { allowed: false, code: "NO_CUSTOMER", reason: `Choose the ${customerWord(config)} this sale is for.`, newBalanceKES: 0 };
  }
  if (params.party.partyType !== RECEIVABLE) {
    // Supplier balances can never absorb a customer sale (§30).
    return { allowed: false, code: "WRONG_PARTY", reason: "That record is a supplier account, not a customer account.", newBalanceKES: 0 };
  }
  const balance = outstandingKES(params.party);
  const limit = Math.max(0, Math.round(Number(params.party.limitKES) || config.credit.limitKES || 0));
  const newBalanceKES = balance + amount;
  if (limit > 0 && newBalanceKES > limit) {
    return {
      allowed: false,
      code: "OVER_LIMIT",
      reason: `That would take the balance to KES ${newBalanceKES.toLocaleString("en-KE")}, above the KES ${limit.toLocaleString("en-KE")} limit.`,
      newBalanceKES,
    };
  }
  const overdueKES = overdueAmount({ balanceKES: balance, termsDays: config.credit.termsDays }, params.oldestEntryAt, now);
  if (overdueKES > 0 && config.credit.highlightOverdue) {
    return {
      allowed: false,
      code: "OVERDUE",
      reason: `This account is ${daysOverdue(params.oldestEntryAt, config.credit.termsDays, now)} days past terms. Collect a payment first.`,
      newBalanceKES,
    };
  }
  const requiresApproval = !config.credit.staffCanApprove && params.roleKey !== undefined && !["OWNER", "ADMIN", "MANAGER"].includes(params.roleKey);
  return {
    allowed: true,
    newBalanceKES,
    remainingKES: limit > 0 ? Math.max(0, limit - newBalanceKES) : Number.POSITIVE_INFINITY,
    requiresApproval,
    reason: requiresApproval ? "A manager needs to approve this credit sale." : "Within the agreed limit.",
  };
}

function customerWord(config: PosConfiguration): string {
  const custom = config.terminology?.customer;
  if (custom) return custom.toLowerCase();
  return "customer";
}

export function daysOverdue(oldestEntryAt: Date | string | null | undefined, termsDays: number, now: Date = new Date()): number {
  if (!oldestEntryAt) return 0;
  const date = new Date(oldestEntryAt);
  if (Number.isNaN(date.getTime())) return 0;
  const due = new Date(date.getTime() + Math.max(0, Number(termsDays) || 0) * 86_400_000);
  const diff = now.getTime() - due.getTime();
  return diff > 0 ? Math.floor(diff / 86_400_000) : 0;
}

export function overdueAmount(
  party: { balanceKES: number; termsDays?: number },
  oldestEntryAt: Date | string | null | undefined,
  now: Date = new Date(),
): number {
  const balance = outstandingKES(party);
  if (balance <= 0) return 0;
  return daysOverdue(oldestEntryAt, party.termsDays ?? 0, now) > 0 ? balance : 0;
}

export type AgeingBucket = "CURRENT" | "1-30" | "31-60" | "61-90" | "90+";

export const AGEING_BUCKETS: AgeingBucket[] = ["CURRENT", "1-30", "31-60", "61-90", "90+"];

export function ageingBucket(daysOverdueValue: number): AgeingBucket {
  const days = Math.max(0, Math.floor(Number(daysOverdueValue) || 0));
  if (days === 0) return "CURRENT";
  if (days <= 30) return "1-30";
  if (days <= 60) return "31-60";
  if (days <= 90) return "61-90";
  return "90+";
}

export type StatementLine = {
  id: string;
  date: string;
  description: string;
  debitKES: number;
  creditKES: number;
  balanceKES: number;
};

/** A statement is built from the ledger, oldest first, with a running balance (§30). */
/**
 * Maps stored ledger rows onto the engine's entry shape. One mapper, so a statement on a screen,
 * in an API response and in a test are all built from the same rows in the same order.
 */
export function toCreditEntries(rows: unknown, partyType: CreditPartyType): CreditEntry[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter((row): row is Record<string, any> => Boolean(row) && typeof row === "object")
    .map((row) => ({
      id: String(row.id ?? ""),
      partyType,
      partyId: String(row.partyId ?? ""),
      direction: String(row.direction ?? "").toUpperCase() === "CREDIT" ? "CREDIT" as const : "DEBIT" as const,
      amountKES: Math.max(0, Math.round(Number(row.amountKES ?? 0) || 0)),
      occurredAt: (row.createdAt ?? row.occurredAt ?? new Date()) as Date | string,
      dueAt: (row.dueAt ?? null) as Date | string | null,
      reference: (row.reference ?? null) as string | null,
      note: (row.note ?? null) as string | null,
    }));
}

export function buildStatement(entries: CreditEntry[], partyType: CreditPartyType): { lines: StatementLine[]; closingBalanceKES: number } {
  const sorted = entries
    .filter((entry) => entry.partyType === partyType)
    .slice()
    .sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  let running = 0;
  const lines = sorted.map((entry) => {
    const amount = Math.max(0, Math.round(Number(entry.amountKES) || 0));
    const debitKES = entry.direction === "DEBIT" ? amount : 0;
    const creditKES = entry.direction === "CREDIT" ? amount : 0;
    running += debitKES - creditKES;
    return {
      id: entry.id,
      date: new Date(entry.occurredAt).toISOString().slice(0, 10),
      description: entry.note || (entry.direction === "DEBIT" ? "Sale on credit" : "Payment received"),
      debitKES,
      creditKES,
      balanceKES: running,
    };
  });
  return { lines, closingBalanceKES: running };
}

export type RepaymentValidation = { ok: boolean; amountKES: number; newBalanceKES: number; message?: string };

/**
 * A repayment reduces a balance and can never exceed it. Overpayment is refused rather than
 * silently turned into a credit note (§54: corrections are explicit records). The result is a
 * flat shape so callers can read `message` under `strictNullChecks: false` (see money.ts).
 */
export function validateRepayment(balanceKES: number, amountKES: number): RepaymentValidation {
  const balance = outstandingKES({ balanceKES });
  const amount = Math.max(0, Math.round(Number(amountKES) || 0));
  if (amount <= 0) return { ok: false, amountKES: 0, newBalanceKES: balance, message: "Enter the amount being paid." };
  if (balance <= 0) return { ok: false, amountKES: 0, newBalanceKES: balance, message: "This account has nothing owing." };
  if (amount > balance) {
    return {
      ok: false,
      amountKES: 0,
      newBalanceKES: balance,
      message: `The balance is KES ${balance.toLocaleString("en-KE")}; the payment cannot be more than that.`,
    };
  }
  return { ok: true, amountKES: amount, newBalanceKES: balance - amount };
}

/** Supplier side: the same arithmetic, a different ledger and different words (§30). */
export function supplierSummary(config: PosConfiguration, parties: Pick<CreditParty, "balanceKES" | "name">[]): {
  totalOwedKES: number; count: number; oldest: { name: string; balanceKES: number } | null;
} {
  if (!config.suppliers.enabled || !config.suppliers.credit) return { totalOwedKES: 0, count: 0, oldest: null };
  const owing = parties.filter((party) => outstandingKES(party) > 0);
  const total = owing.reduce((sum, party) => sum + outstandingKES(party), 0);
  const oldest = owing.length ? owing.reduce((worst, party) => (party.balanceKES > worst.balanceKES ? party : worst), owing[0]) : null;
  return { totalOwedKES: total, count: owing.length, oldest: oldest ? { name: oldest.name, balanceKES: outstandingKES(oldest) } : null };
}

export function creditExposure(parties: Pick<CreditParty, "balanceKES" | "limitKES">[]): {
  totalKES: number; overLimit: number; atRiskKES: number;
} {
  const total = parties.reduce((sum, party) => sum + outstandingKES(party), 0);
  const overLimit = parties.filter((party) => party.limitKES > 0 && outstandingKES(party) > party.limitKES).length;
  const atRisk = parties.reduce((sum, party) => {
    const balance = outstandingKES(party);
    const limit = Math.max(0, Number(party.limitKES) || 0);
    return limit > 0 && balance > limit ? sum + (balance - limit) : sum;
  }, 0);
  return { totalKES: total, overLimit, atRiskKES: atRisk };
}
