import { ReportLimitError } from "./report-limit";

/**
 * Ageing policy: unapplied credits reduce the oldest debits first (FIFO). We do not persist
 * allocations, so this is an accounting convention, not evidence of which invoice was paid.
 * Refuse when the complete ledger cannot be reconciled with the party's stored balance.
 */
export class CreditAgeError extends Error {
  constructor() { super("Credit ageing is unavailable because the account history is ambiguous or does not reconcile. Contact support."); }
}

export function unpaidDebitLots(entries: { direction: string; amountKES: number; createdAt: Date | string; saleId?: string | null }[], balanceKES: number): { createdAt: Date; amountKES: number }[] {
  if (!Number.isSafeInteger(balanceKES) || balanceKES < 0) throw new CreditAgeError();
  let debits = 0, credits = 0;
  for (const row of entries) {
    if (!Number.isSafeInteger(row.amountKES) || row.amountKES < 0) throw new CreditAgeError();
    if (row.direction === "DEBIT") debits += row.amountKES;
    else if (row.direction === "CREDIT") credits += row.amountKES;
    else throw new CreditAgeError();
    if (!Number.isSafeInteger(debits) || !Number.isSafeInteger(credits)) throw new CreditAgeError();
  }
  if (debits - credits !== balanceKES) throw new CreditAgeError();
  if (balanceKES === 0) return [];
  // Sale-linked reversals need invoice-specific allocations, which this ledger does not have.
  // Applying them FIFO could age the wrong invoice, so refuse instead of guessing.
  if (entries.some((row) => row.direction === "CREDIT" && row.saleId)) throw new CreditAgeError();
  let remaining = balanceKES;
  const lots: { createdAt: Date; amountKES: number }[] = [];
  const newestFirst = entries.filter((row) => row.direction === "DEBIT").slice().sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  for (const debit of newestFirst) {
    if (debit.amountKES === 0) continue;
    const date = new Date(debit.createdAt);
    if (!Number.isFinite(date.getTime())) throw new CreditAgeError();
    const outstanding = Math.min(remaining, debit.amountKES);
    lots.push({ createdAt: date, amountKES: outstanding });
    remaining -= outstanding;
    if (remaining === 0) return lots.reverse();
  }
  throw new CreditAgeError();
}

export function oldestUnpaidDebit(entries: Parameters<typeof unpaidDebitLots>[0], balanceKES: number): Date | null {
  return unpaidDebitLots(entries, balanceKES)[0]?.createdAt ?? null;
}

/** Complete party ledger, bounded with an explicit refusal rather than silent paging. */
export async function loadOldestUnpaidDebit(client: any, businessId: string, partyType: "CUSTOMER" | "SUPPLIER", partyId: string, balanceKES: number): Promise<Date | null> {
  const rows = await client.posCreditEntry.findMany({ where: { businessId, partyType, partyId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { direction: true, amountKES: true, createdAt: true, saleId: true }, take: 5001 });
  if (rows.length > 5000) throw new ReportLimitError();
  return oldestUnpaidDebit(rows, balanceKES);
}
