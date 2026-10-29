/**
 * Double-entry accounting (§2.1, §2.7)
 *
 * Every financial event becomes a journal of at least two lines whose debits and credits are
 * equal. A posted journal is immutable: corrections are reversing journals with a reason, never
 * an edit or a delete. Closed periods reject new postings, and a document number comes from an
 * atomic per-tenant sequence rather than a row count.
 *
 * These functions accept a Prisma-compatible client so the same code runs inside a larger
 * transaction (invoice issuance, payment allocation) and in the in-memory test client.
 */

import prisma from "../db";
import { logErpAudit } from "./audit";
import { nextDocumentNumber } from "./sequences";

export class AccountingError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "ACCOUNTING_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "AccountingError";
  }
}

export type AccountType = "ASSET" | "LIABILITY" | "EQUITY" | "INCOME" | "EXPENSE";
export type AccountSide = "DEBIT" | "CREDIT";

export type AccountDefinition = {
  code: string;
  name: string;
  type: AccountType;
  systemKey: string;
  parentCode?: string;
};

/**
 * A compact Kenyan SME chart of accounts. Industry packs can add accounts; they must not remove
 * these system accounts, because invoice, payment, tax and stock postings depend on them.
 */
export const CHART_OF_ACCOUNTS: AccountDefinition[] = [
  { code: "1000", name: "Cash on hand", type: "ASSET", systemKey: "cash" },
  { code: "1010", name: "Bank account", type: "ASSET", systemKey: "bank" },
  { code: "1100", name: "Accounts receivable", type: "ASSET", systemKey: "accounts_receivable" },
  { code: "1150", name: "VAT input (recoverable)", type: "ASSET", systemKey: "vat_input" },
  { code: "1200", name: "Inventory", type: "ASSET", systemKey: "inventory" },
  { code: "1500", name: "Equipment and fixed assets", type: "ASSET", systemKey: "fixed_assets" },
  { code: "2000", name: "Accounts payable", type: "LIABILITY", systemKey: "accounts_payable" },
  { code: "2100", name: "VAT output (payable)", type: "LIABILITY", systemKey: "vat_output" },
  { code: "2200", name: "Customer deposits", type: "LIABILITY", systemKey: "customer_deposits" },
  { code: "3000", name: "Owner's equity", type: "EQUITY", systemKey: "owner_equity" },
  { code: "3100", name: "Retained earnings", type: "EQUITY", systemKey: "retained_earnings" },
  { code: "4000", name: "Sales revenue", type: "INCOME", systemKey: "sales_revenue" },
  { code: "4100", name: "Service revenue", type: "INCOME", systemKey: "service_revenue" },
  { code: "4900", name: "Discounts allowed", type: "EXPENSE", systemKey: "discounts_allowed" },
  { code: "5000", name: "Cost of goods sold", type: "EXPENSE", systemKey: "cost_of_sales" },
  { code: "5100", name: "Rent", type: "EXPENSE", systemKey: "expense_rent" },
  { code: "5200", name: "Salaries and wages", type: "EXPENSE", systemKey: "expense_salaries" },
  { code: "5300", name: "Utilities", type: "EXPENSE", systemKey: "expense_utilities" },
  { code: "5400", name: "Transport and delivery", type: "EXPENSE", systemKey: "expense_transport" },
  { code: "5500", name: "Marketing", type: "EXPENSE", systemKey: "expense_marketing" },
  { code: "5600", name: "Bank and payment charges", type: "EXPENSE", systemKey: "expense_bank_charges" },
  { code: "5700", name: "Other expenses", type: "EXPENSE", systemKey: "expense_other" },
  { code: "5800", name: "Depreciation", type: "EXPENSE", systemKey: "expense_depreciation" },
  { code: "5900", name: "Inventory adjustments", type: "EXPENSE", systemKey: "expense_inventory_adjustment" },
];

export function accountNormalSide(type: AccountType): AccountSide {
  return type === "ASSET" || type === "EXPENSE" ? "DEBIT" : "CREDIT";
}

export function accountBySystemKey(key: string): AccountDefinition {
  const found = CHART_OF_ACCOUNTS.find((account) => account.systemKey === key);
  if (!found) throw new AccountingError(`Unknown system account "${key}".`, 500, "CHART_ERROR");
  return found;
}

export type JournalLineInput = {
  accountCode: string;
  debitCents?: number;
  creditCents?: number;
  description?: string | null;
  branchId?: string | null;
};

export type ValidatedLine = {
  accountCode: string;
  accountId: string;
  accountType: AccountType;
  debitCents: number;
  creditCents: number;
  description: string | null;
  branchId: string | null;
};

export type JournalValidation = {
  ok: boolean;
  errors: string[];
  lines: ValidatedLine[];
  totalDebitCents: number;
  totalCreditCents: number;
};

/**
 * Pure validation, used before anything is written. A journal that does not balance is rejected
 * with a sentence a shopkeeper can act on, not a stack trace.
 */
export function validateJournal(
  lines: JournalLineInput[],
  accounts: Array<{ id: string; code: string; type: string; isActive?: boolean }>,
): JournalValidation {
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  const errors: string[] = [];
  const validated: ValidatedLine[] = [];

  if (!Array.isArray(lines) || lines.length < 2) {
    errors.push("A journal needs at least two lines — one debit and one credit.");
  }

  lines.forEach((line, index) => {
    const account = byCode.get(String(line.accountCode ?? "").trim());
    const debit = Math.round(Number(line.debitCents ?? 0));
    const credit = Math.round(Number(line.creditCents ?? 0));
    const label = `Line ${index + 1}`;

    if (!account) {
      errors.push(`${label}: account ${line.accountCode ?? "(missing)"} is not in your chart of accounts.`);
      return;
    }
    if (account.isActive === false) {
      errors.push(`${label}: account ${account.code} is inactive.`);
    }
    if (!Number.isFinite(debit) || !Number.isFinite(credit) || debit < 0 || credit < 0) {
      errors.push(`${label}: amounts cannot be negative.`);
      return;
    }
    if (debit > 0 && credit > 0) {
      errors.push(`${label}: use either a debit or a credit, not both.`);
      return;
    }
    if (debit === 0 && credit === 0) {
      errors.push(`${label}: enter a debit or a credit.`);
      return;
    }
    validated.push({
      accountCode: account.code,
      accountId: account.id,
      accountType: account.type as AccountType,
      debitCents: debit,
      creditCents: credit,
      description: line.description ?? null,
      branchId: line.branchId ?? null,
    });
  });

  const totalDebitCents = validated.reduce((total, line) => total + line.debitCents, 0);
  const totalCreditCents = validated.reduce((total, line) => total + line.creditCents, 0);

  if (totalDebitCents !== totalCreditCents) {
    const difference = (totalDebitCents - totalCreditCents) / 100;
    errors.push(`Debits and credits must match. They differ by KES ${Math.abs(difference).toLocaleString("en-KE", { minimumFractionDigits: 2 })}.`);
  }
  if (totalDebitCents === 0 && totalCreditCents === 0 && validated.length > 0) {
    errors.push("A journal cannot be for zero.");
  }

  return { ok: errors.length === 0, errors, lines: validated, totalDebitCents, totalCreditCents };
}

export async function ensureChartOfAccounts(client: any, businessId: string): Promise<number> {
  const existing = await client.erpAccount.findMany({ where: { businessId }, select: { code: true } });
  const have = new Set(existing.map((row: any) => row.code));
  let created = 0;
  for (const account of CHART_OF_ACCOUNTS) {
    if (have.has(account.code)) continue;
    await client.erpAccount.create({
      data: {
        businessId,
        code: account.code,
        name: account.name,
        type: account.type,
        systemKey: account.systemKey,
        parentCode: account.parentCode ?? null,
        isActive: true,
      },
    });
    created += 1;
  }
  return created;
}

export async function loadAccounts(client: any, businessId: string, codes?: string[]) {
  const where: any = { businessId };
  if (codes && codes.length) where.code = { in: codes };
  return client.erpAccount.findMany({ where });
}

export function periodKey(date: Date | string): { fiscalYear: number; month: number } {
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) throw new AccountingError("That date is not valid.", 400, "BAD_DATE");
  return { fiscalYear: value.getUTCFullYear(), month: value.getUTCMonth() + 1 };
}

export async function ensurePeriod(client: any, businessId: string, date: Date | string) {
  const { fiscalYear, month } = periodKey(date);
  return client.erpPeriod.upsert({
    where: { businessId_fiscalYear_month: { businessId, fiscalYear, month } },
    create: { businessId, fiscalYear, month, status: "OPEN" },
    update: {},
  });
}

export async function assertPeriodOpen(client: any, businessId: string, date: Date | string) {
  const { fiscalYear, month } = periodKey(date);
  const period = await client.erpPeriod.findUnique({ where: { businessId_fiscalYear_month: { businessId, fiscalYear, month } } });
  if (period && String(period.status).toUpperCase() === "CLOSED") {
    throw new AccountingError(
      `The books for ${month}/${fiscalYear} are closed. Post to an open period or ask an owner to reopen it.`,
      409,
      "PERIOD_CLOSED",
    );
  }
  return period;
}

export type PostJournalInput = {
  businessId: string;
  actorId?: string | null;
  actorName?: string | null;
  entryDate: Date | string;
  description: string;
  sourceType?: string;
  sourceId?: string | null;
  branchId?: string | null;
  currencyCode?: string;
  lines: JournalLineInput[];
  idempotencyKey?: string | null;
  reversalOfId?: string | null;
  reversalReason?: string | null;
};

export type PostedJournal = {
  id: string;
  journalNumber: string;
  entryDate: Date;
  description: string;
  status: string;
  totalDebitCents: number;
  totalCreditCents: number;
};

/**
 * Post inside an existing transaction. Callers that own a bigger transaction (issuing an invoice,
 * recording a payment) use this so the document and its ledger entry commit together or not at
 * all.
 */
export async function postJournalTx(tx: any, input: PostJournalInput): Promise<PostedJournal> {
  const businessId = input.businessId;
  if (!input.description || input.description.trim().length < 2) {
    throw new AccountingError("Describe what this journal is for.", 400, "DESCRIPTION_REQUIRED");
  }

  const entryDate = input.entryDate instanceof Date ? input.entryDate : new Date(input.entryDate);
  if (Number.isNaN(entryDate.getTime())) throw new AccountingError("That date is not valid.", 400, "BAD_DATE");

  // Idempotency: a repeated request returns the first journal rather than posting twice.
  if (input.idempotencyKey) {
    const existing = await tx.erpIdempotencyRecord.findUnique({
      where: { businessId_scope_key: { businessId, scope: "journal", key: input.idempotencyKey } },
    }).catch(() => null);
    if (existing?.responseJson) {
      const parsed = JSON.parse(existing.responseJson);
      return parsed as PostedJournal;
    }
  }

  await assertPeriodOpen(tx, businessId, entryDate);
  await ensurePeriod(tx, businessId, entryDate);

  const codes = [...new Set(input.lines.map((line) => String(line.accountCode)))];
  const accounts = await loadAccounts(tx, businessId, codes);
  const validation = validateJournal(input.lines, accounts);
  if (!validation.ok) {
    throw new AccountingError(validation.errors[0], 400, "JOURNAL_INVALID");
  }

  const journalNumber = await nextDocumentNumber(tx, businessId, "journal", input.reversalOfId ? "RJV" : "JV");
  const journal = await tx.erpJournal.create({
    data: {
      businessId,
      branchId: input.branchId ?? null,
      journalNumber,
      entryDate,
      description: input.description.trim(),
      sourceType: input.sourceType ?? "MANUAL",
      sourceId: input.sourceId ?? null,
      status: "POSTED",
      currencyCode: input.currencyCode ?? "KES",
      postedAt: new Date(),
      postedById: input.actorId ?? null,
      reversalOfId: input.reversalOfId ?? null,
      reversalReason: input.reversalReason ?? null,
      createdById: input.actorId ?? null,
    },
  });

  for (const line of validation.lines) {
    await tx.erpJournalLine.create({
      data: {
        businessId,
        journalId: journal.id,
        accountCode: line.accountCode,
        accountId: line.accountId,
        branchId: line.branchId ?? input.branchId ?? null,
        description: line.description,
        debitCents: line.debitCents,
        creditCents: line.creditCents,
      },
    });
  }

  const posted: PostedJournal = {
    id: journal.id,
    journalNumber,
    entryDate,
    description: journal.description,
    status: "POSTED",
    totalDebitCents: validation.totalDebitCents,
    totalCreditCents: validation.totalCreditCents,
  };

  if (input.idempotencyKey) {
    await tx.erpIdempotencyRecord.create({
      data: {
        businessId,
        scope: "journal",
        key: input.idempotencyKey,
        responseJson: JSON.stringify(posted),
      },
    });
  }

  return posted;
}

/**
 * Post and audit a journal.
 *
 * The client may be the root Prisma client *or* a transaction a caller already owns. Two callers
 * pass their own `tx` — supplier bills and expenses — because the journal and the document must
 * commit together. A transaction client has no `$transaction` of its own, so opening one there
 * throws `db.$transaction is not a function`; that is why this joins the caller's transaction
 * instead of nesting a new one. With a root client it still opens one.
 */
export async function postJournal(client: any, input: PostJournalInput): Promise<PostedJournal> {
  const db = client ?? prisma;
  const posted = typeof db.$transaction === "function"
    ? await db.$transaction(async (tx: any) => postJournalTx(tx, input))
    : await postJournalTx(db, input);
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: input.reversalOfId ? "JOURNAL_REVERSED" : "JOURNAL_POSTED",
    targetType: "JOURNAL",
    targetId: posted.id,
    after: { journalNumber: posted.journalNumber, totalDebitCents: posted.totalDebitCents, sourceType: input.sourceType, sourceId: input.sourceId },
    client: db,
  });
  return posted;
}

/**
 * Reverse a posted journal. The original stays in the ledger (audit intact), a new journal with
 * the sides swapped is posted in an open period, and the original is marked with the reversal id.
 * Reversing twice is refused.
 */
export async function reverseJournal(
  client: any,
  input: {
    businessId: string;
    journalId: string;
    actorId?: string | null;
    actorName?: string | null;
    reason: string;
    entryDate?: Date | string;
  },
): Promise<PostedJournal> {
  const db = client ?? prisma;
  if (!input.reason || input.reason.trim().length < 5) {
    throw new AccountingError("Say why this journal is being reversed — the reason is kept on the record.", 400, "REASON_REQUIRED");
  }

  return db.$transaction(async (tx: any) => {
    const journal = await tx.erpJournal.findUnique({ where: { id: input.journalId } });
    if (!journal || journal.businessId !== input.businessId) {
      throw new AccountingError("That journal was not found.", 404, "NOT_FOUND");
    }
    if (journal.status !== "POSTED") throw new AccountingError("Only a posted journal can be reversed.", 409, "NOT_POSTED");
    if (journal.reversedById) throw new AccountingError("That journal has already been reversed.", 409, "ALREADY_REVERSED");

    const lines = await tx.erpJournalLine.findMany({ where: { journalId: journal.id, businessId: input.businessId } });
    const mirrored = lines.map((line: any) => ({
      accountCode: line.accountCode,
      debitCents: line.creditCents,
      creditCents: line.debitCents,
      description: `Reversal: ${line.description ?? journal.description}`,
      branchId: line.branchId,
    }));

    const reversal = await postJournalTx(tx, {
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      entryDate: input.entryDate ?? new Date(),
      description: `Reversal of ${journal.journalNumber} — ${input.reason.trim()}`,
      sourceType: "REVERSAL",
      sourceId: journal.id,
      branchId: journal.branchId,
      currencyCode: journal.currencyCode,
      lines: mirrored,
      reversalOfId: journal.id,
      reversalReason: input.reason.trim(),
    });

    await tx.erpJournal.update({ where: { id: journal.id }, data: { reversedById: reversal.id } });
    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      action: "JOURNAL_REVERSED",
      targetType: "JOURNAL",
      targetId: journal.id,
      reason: input.reason.trim(),
      before: { journalNumber: journal.journalNumber, status: journal.status },
      after: { reversalJournalId: reversal.id, reversalNumber: reversal.journalNumber },
      client: tx,
    });
    return reversal;
  });
}

export type AccountBalance = {
  accountCode: string;
  accountName: string;
  accountType: AccountType;
  debitCents: number;
  creditCents: number;
  /** Positive means a debit balance (assets/expenses); negative means a credit balance. */
  balanceCents: number;
};

async function postedJournals(client: any, businessId: string, range: { from?: Date | string | null; to?: Date | string | null; branchId?: string | null }) {
  const where: any = { businessId, status: "POSTED" };
  const dateFilter: any = {};
  if (range.from) dateFilter.gte = new Date(range.from);
  if (range.to) dateFilter.lte = new Date(range.to);
  if (Object.keys(dateFilter).length) where.entryDate = dateFilter;
  if (range.branchId) where.branchId = range.branchId;
  return client.erpJournal.findMany({ where });
}

async function balancesFor(
  client: any,
  businessId: string,
  range: { from?: Date | string | null; to?: Date | string | null; branchId?: string | null },
): Promise<Map<string, { debitCents: number; creditCents: number }>> {
  const journals = await postedJournals(client, businessId, range);
  if (!journals.length) return new Map();
  const ids = journals.map((journal: any) => journal.id);
  const lines = await client.erpJournalLine.findMany({ where: { businessId, journalId: { in: ids } } });
  const totals = new Map<string, { debitCents: number; creditCents: number }>();
  for (const line of lines) {
    const current = totals.get(line.accountCode) ?? { debitCents: 0, creditCents: 0 };
    current.debitCents += Number(line.debitCents ?? 0);
    current.creditCents += Number(line.creditCents ?? 0);
    totals.set(line.accountCode, current);
  }
  return totals;
}

/**
 * Trial balance. Debits equal credits by construction, and the report proves it rather than
 * asserting it: `balanced` is computed from the rows returned.
 */
export async function trialBalance(
  client: any,
  businessId: string,
  options: { from?: Date | string | null; to?: Date | string | null; branchId?: string | null } = {},
) {
  const [accounts, totals] = await Promise.all([
    client.erpAccount.findMany({ where: { businessId } }),
    balancesFor(client ?? prisma, businessId, options),
  ]);
  const rows: AccountBalance[] = accounts
    .map((account: any) => {
      const total = totals.get(account.code) ?? { debitCents: 0, creditCents: 0 };
      return {
        accountCode: account.code,
        accountName: account.name,
        accountType: account.type as AccountType,
        debitCents: total.debitCents,
        creditCents: total.creditCents,
        balanceCents: total.debitCents - total.creditCents,
      };
    })
    .filter((row: AccountBalance) => row.debitCents !== 0 || row.creditCents !== 0)
    .sort((a: AccountBalance, b: AccountBalance) => a.accountCode.localeCompare(b.accountCode));

  const totalDebitCents = rows.reduce((total, row) => total + row.debitCents, 0);
  const totalCreditCents = rows.reduce((total, row) => total + row.creditCents, 0);
  return {
    rows,
    totalDebitCents,
    totalCreditCents,
    balanced: totalDebitCents === totalCreditCents,
    from: options.from ?? null,
    to: options.to ?? null,
  };
}

export type ProfitAndLoss = {
  income: AccountBalance[];
  expenses: AccountBalance[];
  totalIncomeCents: number;
  totalExpenseCents: number;
  netProfitCents: number;
  from: Date | string | null;
  to: Date | string | null;
};

export async function profitAndLoss(
  client: any,
  businessId: string,
  options: { from?: Date | string | null; to?: Date | string | null; branchId?: string | null } = {},
): Promise<ProfitAndLoss> {
  const [accounts, totals] = await Promise.all([
    client.erpAccount.findMany({ where: { businessId } }),
    balancesFor(client ?? prisma, businessId, options),
  ]);
  const byAccount: AccountBalance[] = accounts.map((account: any) => {
    const total = totals.get(account.code) ?? { debitCents: 0, creditCents: 0 };
    return {
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type as AccountType,
      debitCents: total.debitCents,
      creditCents: total.creditCents,
      balanceCents: total.debitCents - total.creditCents,
    };
  });
  const income = byAccount
    .filter((row) => row.accountType === "INCOME")
    .map((row) => ({ ...row, balanceCents: row.creditCents - row.debitCents }))
    .filter((row) => row.balanceCents !== 0);
  const expenses = byAccount
    .filter((row) => row.accountType === "EXPENSE")
    .map((row) => ({ ...row, balanceCents: row.debitCents - row.creditCents }))
    .filter((row) => row.balanceCents !== 0);
  const totalIncomeCents = income.reduce((total, row) => total + row.balanceCents, 0);
  const totalExpenseCents = expenses.reduce((total, row) => total + row.balanceCents, 0);
  return {
    income,
    expenses,
    totalIncomeCents,
    totalExpenseCents,
    netProfitCents: totalIncomeCents - totalExpenseCents,
    from: options.from ?? null,
    to: options.to ?? null,
  };
}

export type BalanceSheet = {
  assets: AccountBalance[];
  liabilities: AccountBalance[];
  equity: AccountBalance[];
  totalAssetsCents: number;
  totalLiabilitiesCents: number;
  totalEquityCents: number;
  netIncomeCents: number;
  balanced: boolean;
  asOf: Date | string | null;
};

/**
 * Balance sheet as at a date. Equity includes the cumulative profit from the ledger (there is no
 * manual "plug"), so assets equal liabilities + equity + profit exactly when the ledger is sound.
 */
export async function balanceSheet(
  client: any,
  businessId: string,
  options: { to?: Date | string | null; branchId?: string | null } = {},
): Promise<BalanceSheet> {
  const [accounts, totals] = await Promise.all([
    client.erpAccount.findMany({ where: { businessId } }),
    balancesFor(client ?? prisma, businessId, { to: options.to, branchId: options.branchId }),
  ]);
  const rows: AccountBalance[] = accounts.map((account: any) => {
    const total = totals.get(account.code) ?? { debitCents: 0, creditCents: 0 };
    return {
      accountCode: account.code,
      accountName: account.name,
      accountType: account.type as AccountType,
      debitCents: total.debitCents,
      creditCents: total.creditCents,
      balanceCents: total.debitCents - total.creditCents,
    };
  });
  const assets = rows.filter((row) => row.accountType === "ASSET" && row.balanceCents !== 0);
  const liabilities = rows
    .filter((row) => row.accountType === "LIABILITY")
    .map((row) => ({ ...row, balanceCents: row.creditCents - row.debitCents }))
    .filter((row) => row.balanceCents !== 0);
  const equity = rows
    .filter((row) => row.accountType === "EQUITY")
    .map((row) => ({ ...row, balanceCents: row.creditCents - row.debitCents }))
    .filter((row) => row.balanceCents !== 0);
  const income = rows
    .filter((row) => row.accountType === "INCOME")
    .reduce((total, row) => total + (row.creditCents - row.debitCents), 0);
  const expenses = rows
    .filter((row) => row.accountType === "EXPENSE")
    .reduce((total, row) => total + (row.debitCents - row.creditCents), 0);
  const netIncomeCents = income - expenses;
  const totalAssetsCents = assets.reduce((total, row) => total + row.balanceCents, 0);
  const totalLiabilitiesCents = liabilities.reduce((total, row) => total + row.balanceCents, 0);
  const totalEquityCents = equity.reduce((total, row) => total + row.balanceCents, 0);
  return {
    assets,
    liabilities,
    equity,
    totalAssetsCents,
    totalLiabilitiesCents,
    totalEquityCents,
    netIncomeCents,
    balanced: totalAssetsCents === totalLiabilitiesCents + totalEquityCents + netIncomeCents,
    asOf: options.to ?? null,
  };
}

export async function closePeriod(
  client: any,
  input: { businessId: string; fiscalYear: number; month: number; actorId?: string | null; actorName?: string | null },
) {
  const db = client ?? prisma;
  const month = Math.round(input.month);
  const fiscalYear = Math.round(input.fiscalYear);
  if (month < 1 || month > 12) throw new AccountingError("That month is not valid.", 400, "BAD_MONTH");
  const period = await ensurePeriod(db, input.businessId, new Date(Date.UTC(fiscalYear, month - 1, 15)));
  if (period.status === "CLOSED") throw new AccountingError("That period is already closed.", 409, "ALREADY_CLOSED");
  const updated = await db.erpPeriod.update({
    where: { businessId_fiscalYear_month: { businessId: input.businessId, fiscalYear, month } },
    data: { status: "CLOSED", closedAt: new Date(), closedById: input.actorId ?? null },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "PERIOD_CLOSED",
    targetType: "PERIOD",
    targetId: `${fiscalYear}-${String(month).padStart(2, "0")}`,
    client: db,
  });
  return updated;
}

export async function reopenPeriod(
  client: any,
  input: { businessId: string; fiscalYear: number; month: number; actorId?: string | null; actorName?: string | null; reason: string },
) {
  const db = client ?? prisma;
  if (!input.reason || input.reason.trim().length < 10) {
    throw new AccountingError("Reopening closed books needs a written reason.", 400, "REASON_REQUIRED");
  }
  const fiscalYear = Math.round(input.fiscalYear);
  const month = Math.round(input.month);
  const updated = await db.erpPeriod.update({
    where: { businessId_fiscalYear_month: { businessId: input.businessId, fiscalYear, month } },
    data: { status: "OPEN", closedAt: null, closedById: null },
  });
  await logErpAudit({
    businessId: input.businessId,
    actorId: input.actorId,
    actorName: input.actorName,
    action: "PERIOD_REOPENED",
    targetType: "PERIOD",
    targetId: `${fiscalYear}-${String(month).padStart(2, "0")}`,
    reason: input.reason.trim(),
    client: db,
  });
  return updated;
}

// ── Journal builders for business events ────────────────────────────────────────────────────

export function buildInvoiceJournal(input: {
  receivablesCode?: string;
  revenueCode?: string;
  vatOutputCode?: string;
  netCents: number;
  taxCents: number;
  totalCents: number;
  description: string;
  branchId?: string | null;
}): JournalLineInput[] {
  const lines: JournalLineInput[] = [
    { accountCode: input.receivablesCode ?? "1100", debitCents: input.totalCents, description: input.description, branchId: input.branchId },
  ];
  if (input.netCents !== 0) lines.push({ accountCode: input.revenueCode ?? "4000", creditCents: input.netCents, description: input.description, branchId: input.branchId });
  if (input.taxCents !== 0) lines.push({ accountCode: input.vatOutputCode ?? "2100", creditCents: input.taxCents, description: "VAT output", branchId: input.branchId });
  return lines;
}

export function buildPaymentJournal(input: {
  cashCode?: string;
  receivablesCode?: string;
  amountCents: number;
  description: string;
  branchId?: string | null;
}): JournalLineInput[] {
  return [
    { accountCode: input.cashCode ?? "1000", debitCents: input.amountCents, description: input.description, branchId: input.branchId },
    { accountCode: input.receivablesCode ?? "1100", creditCents: input.amountCents, description: input.description, branchId: input.branchId },
  ];
}

export function buildExpenseJournal(input: {
  expenseCode?: string;
  paidFromCode?: string;
  netCents: number;
  taxCents: number;
  description: string;
  branchId?: string | null;
}): JournalLineInput[] {
  const lines: JournalLineInput[] = [
    { accountCode: input.expenseCode ?? "5700", debitCents: input.netCents, description: input.description, branchId: input.branchId },
  ];
  if (input.taxCents > 0) lines.push({ accountCode: "1150", debitCents: input.taxCents, description: "VAT input", branchId: input.branchId });
  lines.push({ accountCode: input.paidFromCode ?? "1000", creditCents: input.netCents + input.taxCents, description: input.description, branchId: input.branchId });
  return lines;
}

export function buildSupplierBillJournal(input: {
  expenseCode?: string;
  payableCode?: string;
  netCents: number;
  taxCents: number;
  description: string;
  branchId?: string | null;
}): JournalLineInput[] {
  const lines: JournalLineInput[] = [
    { accountCode: input.expenseCode ?? "5000", debitCents: input.netCents, description: input.description, branchId: input.branchId },
  ];
  if (input.taxCents > 0) lines.push({ accountCode: "1150", debitCents: input.taxCents, description: "VAT input", branchId: input.branchId });
  lines.push({ accountCode: input.payableCode ?? "2000", creditCents: input.netCents + input.taxCents, description: input.description, branchId: input.branchId });
  return lines;
}

export function buildCreditNoteJournal(input: {
  receivablesCode?: string;
  revenueCode?: string;
  vatOutputCode?: string;
  netCents: number;
  taxCents: number;
  description: string;
  branchId?: string | null;
}): JournalLineInput[] {
  const lines: JournalLineInput[] = [
    { accountCode: input.revenueCode ?? "4000", debitCents: input.netCents, description: input.description, branchId: input.branchId },
  ];
  if (input.taxCents !== 0) lines.push({ accountCode: input.vatOutputCode ?? "2100", debitCents: input.taxCents, description: "VAT reverse charge", branchId: input.branchId });
  lines.push({ accountCode: input.receivablesCode ?? "1100", creditCents: input.netCents + input.taxCents, description: input.description, branchId: input.branchId });
  return lines;
}
