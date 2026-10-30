/** A bounded projection of recorded credit movements, not a complete financial statement. */
type CreditMovement = { partyType: string; partyId: string; direction: string; amountKES: number };
type CreditPeriodAccount = { partyType: "CUSTOMER" | "SUPPLIER"; partyId: string; openingKES: number; debitsKES: number; creditsKES: number; closingKES: number };

export class CreditPeriodError extends Error {}

/**
 * All entries before the period plus all entries inside it must be supplied. Credits are
 * subtracted for both receivables and payables. No missing opening balance is assumed beyond
 * the recorded ledger; this is a projection, not proof that the ledger is complete.
 */
export function projectCreditPeriod(openingEntries: CreditMovement[], movements: CreditMovement[]): CreditPeriodAccount[] {
  const accounts = new Map<string, CreditPeriodAccount>();
  function add(row: CreditMovement, opening: boolean) {
    if ((row.partyType !== "CUSTOMER" && row.partyType !== "SUPPLIER") || !row.partyId ||
        (row.direction !== "DEBIT" && row.direction !== "CREDIT") ||
        !Number.isSafeInteger(row.amountKES) || row.amountKES < 0) throw new CreditPeriodError("Invalid credit ledger entry");
    const key = JSON.stringify([row.partyType, row.partyId]);
    const account = accounts.get(key) ?? { partyType: row.partyType, partyId: row.partyId, openingKES: 0, debitsKES: 0, creditsKES: 0, closingKES: 0 };
    if (opening) account.openingKES += row.direction === "DEBIT" ? row.amountKES : -row.amountKES;
    else if (row.direction === "DEBIT") account.debitsKES += row.amountKES;
    else account.creditsKES += row.amountKES;
    if (![account.openingKES, account.debitsKES, account.creditsKES].every(Number.isSafeInteger)) throw new CreditPeriodError("Credit ledger total exceeds safe integer range");
    accounts.set(key, account);
  }
  for (const row of openingEntries) add(row, true);
  for (const row of movements) add(row, false);
  const result = [...accounts.values()];
  for (const account of result) {
    account.closingKES = account.openingKES + account.debitsKES - account.creditsKES;
    if (!Number.isSafeInteger(account.closingKES)) throw new CreditPeriodError("Credit balance exceeds safe integer range");
  }
  return result.sort((a, b) => a.partyType.localeCompare(b.partyType) || a.partyId.localeCompare(b.partyId));
}
