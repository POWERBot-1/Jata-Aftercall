/**
 * Ledger lifecycle against the real accounting engine (no database).
 *
 * `postJournalTx` and `reverseJournal` are run with a transaction double that records the ORDER of
 * writes. That order is the invariant this file exists to protect: the journal row is created
 * DRAFT, its lines are written while it is still DRAFT, and only then is it sealed POSTED — which
 * is exactly what lets a database trigger refuse any later line write on a POSTED journal.
 *
 * What this file cannot prove (and does not claim): that PostgreSQL actually raises on a
 * POSTED-line mutation, or that a failed seal rolls back. Those need the migrated database suite,
 * which is BLOCKED here and reported as such in the implementation report.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ default: {}, prisma: {} }));

import { postJournal, reverseJournal, validateJournal } from "../../lib/erp/accounting";

type Call = { op: string; args: any };

function accountingTx() {
  const calls: Call[] = [];
  const journals = new Map<string, any>();
  let sequence = 0;
  let seqValue = 0;
  const lines: any[] = [];
  const tx: any = {
    erpIdempotencyRecord: {
      findUnique: async () => null,
      create: async (args: any) => {
        calls.push({ op: "idempotency.create", args });
        return args.data;
      },
    },
    erpPeriod: {
      findUnique: async () => null,
      upsert: async (args: any) => ({ id: "period", status: "OPEN", ...args.create }),
    },
    erpAccount: {
      findMany: async () => [
        { id: "acc_cash", businessId: "bizA", code: "1100", name: "Cash", type: "ASSET", systemKey: "CASH", isActive: true },
        { id: "acc_sales", businessId: "bizA", code: "4100", name: "Sales", type: "INCOME", systemKey: "SALES", isActive: true },
      ],
    },
    erpSequence: {
      upsert: async () => {
        seqValue += 1;
        return { value: seqValue };
      },
    },
    erpJournal: {
      create: async (args: any) => {
        calls.push({ op: "journal.create", args });
        const row = { id: `j${++sequence}`, reversedById: null, ...args.data };
        journals.set(row.id, row);
        return row;
      },
      update: async (args: any) => {
        calls.push({ op: "journal.update", args });
        const row = { ...journals.get(args.where.id), ...args.data };
        journals.set(args.where.id, row);
        return row;
      },
      findUnique: async (args: any) => journals.get(args.where.id) ?? null,
    },
    erpJournalLine: {
      create: async (args: any) => {
        calls.push({ op: "journalLine.create", args });
        const parent = journals.get(args.data.journalId);
        if (parent && parent.status !== "DRAFT") {
          // Models what the database trigger enforces: lines may only be written while DRAFT.
          throw new Error("journal line is immutable: parent journal is POSTED");
        }
        lines.push({ id: `l${lines.length + 1}`, ...args.data });
        return args.data;
      },
      findMany: async (args: any) => lines.filter((line) => line.journalId === args.where.journalId),
    },
    // `reverseJournal` takes a root client and owns its transaction, so the double must behave like
    // one: the callback gets the same handle, and a throw propagates (which is what rolls back in a
    // real database).
    $transaction: async (fn: any) => fn(tx),
  };
  return { tx, calls, journals, lines };
}

const balancedLines = [
  { accountCode: "1100", debitCents: 50_000, creditCents: 0, description: "Cash in" },
  { accountCode: "4100", debitCents: 0, creditCents: 50_000, description: "Sale" },
];

describe("mjengo: ledger lifecycle", () => {
  it("writes lines while DRAFT and seals POSTED only afterwards", async () => {
    const { tx, calls } = accountingTx();
    await postJournal(tx, { businessId: "bizA", actorId: "userA", entryDate: new Date(), description: "Sale of stock", lines: balancedLines });

    const order = calls.map((call) => call.op);
    const createIndex = order.indexOf("journal.create");
    const firstLineIndex = order.indexOf("journalLine.create");
    const sealIndex = order.indexOf("journal.update");
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(firstLineIndex).toBeGreaterThan(createIndex);
    expect(sealIndex).toBeGreaterThan(firstLineIndex);

    const created = calls[createIndex].args.data;
    expect(created.status).toBe("DRAFT");
    const sealed = calls[sealIndex].args.data;
    expect(sealed.status).toBe("POSTED");
    expect(sealed.postedAt).toBeInstanceOf(Date);
  });

  it("joins the caller's transaction instead of nesting a new one", async () => {
    const { tx, calls } = accountingTx();
    // A Prisma *transaction client* has no `$transaction` of its own; calling one would throw
    // `db.$transaction is not a function` (the regression this guards). With no `$transaction` in
    // the handle, the engine must call postJournalTx directly.
    const txOnly: any = { ...tx };
    delete txOnly.$transaction;
    const posted = await postJournal(txOnly, { businessId: "bizA", entryDate: new Date(), description: "Sale of stock", lines: balancedLines });
    expect(posted.status).toBe("POSTED");
    expect(calls.some((call) => call.op === "journal.create")).toBe(true);
  });

  it("never writes a line into a POSTED journal (the trigger's invariant)", async () => {
    const { tx, journals, calls } = accountingTx();
    const posted = await postJournal(tx, { businessId: "bizA", entryDate: new Date(), description: "Sale of stock", lines: balancedLines });
    const parent = journals.get(posted.id)!;
    expect(parent.status).toBe("POSTED");
    // A late line write against the sealed journal is refused, not silently appended.
    await expect(
      tx.erpJournalLine.create({ data: { businessId: "bizA", journalId: posted.id, accountCode: "1100", debitCents: 1, creditCents: 0 } }),
    ).rejects.toThrow(/immutable/);
    expect(calls.some((call) => call.op === "journal.update" && call.args.data.status === "DRAFT")).toBe(false);
  });

  it("reversal posts a mirrored journal then marks the original, in that order", async () => {
    const { tx, calls } = accountingTx();
    const original = await postJournal(tx, { businessId: "bizA", entryDate: new Date(), description: "Sale of stock", lines: balancedLines });
    calls.length = 0;

    const reversal = await reverseJournal(tx, {
      businessId: "bizA",
      journalId: original.id,
      actorId: "userA",
      reason: "Customer returned the goods",
    });

    const createIndex = calls.findIndex((call) => call.op === "journal.create");
    const markIndex = calls.findIndex((call) => call.op === "journal.update" && call.args.data.reversedById);
    expect(createIndex).toBeGreaterThanOrEqual(0);
    expect(markIndex).toBeGreaterThan(createIndex);
    // The mirror swaps debit and credit: the reversal's debit line is the original's credit line.
    const reversalLines = calls.filter((call) => call.op === "journalLine.create").map((call) => call.args.data);
    expect(reversalLines.some((line) => line.accountCode === "4100" && line.debitCents === 50_000)).toBe(true);
    expect(reversalLines.some((line) => line.accountCode === "1100" && line.creditCents === 50_000)).toBe(true);
    expect(reversal.status).toBe("POSTED");
  });

  it("refuses to reverse a journal twice, and refuses a reason that is too short", async () => {
    const { tx } = accountingTx();
    const original = await postJournal(tx, { businessId: "bizA", entryDate: new Date(), description: "Sale of stock", lines: balancedLines });
    await reverseJournal(tx, { businessId: "bizA", journalId: original.id, reason: "Customer returned the goods" });
    await expect(
      reverseJournal(tx, { businessId: "bizA", journalId: original.id, reason: "Customer returned the goods" }),
    ).rejects.toThrow(/already been reversed/i);
    await expect(reverseJournal(tx, { businessId: "bizA", journalId: original.id, reason: "oops" })).rejects.toThrow(/why/i);
  });

  it("refuses to reverse another tenant's journal", async () => {
    const { tx } = accountingTx();
    const original = await postJournal(tx, { businessId: "bizA", entryDate: new Date(), description: "Sale of stock", lines: balancedLines });
    await expect(
      reverseJournal(tx, { businessId: "bizB", journalId: original.id, reason: "Not my ledger at all" }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("mjengo: journal balance rules", () => {
  const accounts = [
    { id: "acc_cash", code: "1100", name: "Cash", type: "ASSET", isActive: true },
    { id: "acc_sales", code: "4100", name: "Sales", type: "INCOME", isActive: true },
  ] as any;

  it("accepts a balanced two-line entry", () => {
    expect(validateJournal(balancedLines as any, accounts).ok).toBe(true);
  });

  it("refuses an unbalanced entry", () => {
    const result = validateJournal(
      [
        { accountCode: "1100", debitCents: 50_000 },
        { accountCode: "4100", creditCents: 49_999 },
      ] as any,
      accounts,
    );
    expect(result.ok).toBe(false);
  });

  it("refuses an empty entry, an unknown account, and a both-sides line", () => {
    expect(validateJournal([] as any, accounts).ok).toBe(false);
    expect(
      validateJournal(
        [
          { accountCode: "9999", debitCents: 100 },
          { accountCode: "4100", creditCents: 100 },
        ] as any,
        accounts,
      ).ok,
    ).toBe(false);
    expect(
      validateJournal(
        [
          { accountCode: "1100", debitCents: 100, creditCents: 100 },
          { accountCode: "4100", creditCents: 0 },
        ] as any,
        accounts,
      ).ok,
    ).toBe(false);
  });
});
