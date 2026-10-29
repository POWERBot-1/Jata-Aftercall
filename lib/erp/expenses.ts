/**
 * Recording an expense is a *posting*: it writes an `ErpExpense` row and a balanced journal in one
 * transaction, so the ledger and the expense can never disagree.
 *
 * This lives in the domain rather than in the server action because the action used to hold the
 * transaction inline, and nothing could exercise it without a browser and a session. That is how
 * `postJournal(tx, …)` came to be called with a transaction client and throw
 * `db.$transaction is not a function` — every expense failed, and no test noticed. The same code is
 * now reachable from a PostgreSQL test.
 *
 * Idempotency: the form carries a `requestKey`. Replaying it returns the expense that was already
 * recorded instead of posting a second journal and failing on the unique index.
 */
import { buildExpenseJournal, postJournal } from "./accounting";

export type RecordExpenseInput = {
  businessId: string;
  category: string;
  accountCode: string;
  paidFromCode: string;
  description: string;
  /** Gross amount in cents, VAT included. */
  amountCents: number;
  taxCents: number;
  method?: string;
  occurredAt: Date | string;
  /** Stable per submission; the same key must never post twice. */
  requestKey: string;
  actorId?: string | null;
  actorName?: string | null;
};

export type RecordedExpense = {
  expense: any;
  journal: { id: string; journalNumber: string; totalDebitCents: number; totalCreditCents: number } | null;
  replayed: boolean;
};

export async function recordExpense(client: any, input: RecordExpenseInput): Promise<RecordedExpense> {
  if (!client) throw new Error("recordExpense needs a database client.");
  const businessId = input.businessId;
  const description = String(input.description ?? "").trim();
  if (description.length < 3) throw Object.assign(new Error("Describe what the money was spent on."), { status: 400 });
  const amountCents = Math.round(Number(input.amountCents) || 0);
  const taxCents = Math.round(Number(input.taxCents) || 0);
  if (amountCents <= 0) throw Object.assign(new Error("Enter the amount spent."), { status: 400 });
  if (taxCents < 0 || taxCents > amountCents) throw Object.assign(new Error("VAT cannot be more than the total."), { status: 400 });
  if (!input.requestKey) throw Object.assign(new Error("A submission key is required."), { status: 400 });

  const idempotencyKey = `expense:${input.requestKey}`;
  const existing = await client.erpExpense.findUnique({
    where: { businessId_idempotencyKey: { businessId, idempotencyKey } },
  });
  if (existing) return { expense: existing, journal: null, replayed: true };

  const occurredAt = input.occurredAt instanceof Date ? input.occurredAt : new Date(input.occurredAt);
  if (Number.isNaN(occurredAt.getTime())) throw Object.assign(new Error("That date is not valid."), { status: 400 });

  const netCents = amountCents - taxCents;
  return client.$transaction(async (tx: any) => {
    const journal = await postJournal(tx, {
      businessId,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      entryDate: occurredAt,
      description: `Expense: ${description}`,
      sourceType: "EXPENSE",
      lines: buildExpenseJournal({ netCents, taxCents, description, expenseCode: input.accountCode, paidFromCode: input.paidFromCode }),
      idempotencyKey: `expense-journal:${input.requestKey}`,
    });
    const expense = await tx.erpExpense.create({
      data: {
        businessId,
        category: input.category,
        accountCode: input.accountCode,
        description,
        amountCents,
        taxCents,
        method: input.method ?? "cash",
        paidFromCode: input.paidFromCode,
        occurredAt,
        status: "POSTED",
        journalId: journal.id,
        idempotencyKey,
        createdById: input.actorId ?? null,
      },
    });
    return { expense, journal, replayed: false };
  });
}
