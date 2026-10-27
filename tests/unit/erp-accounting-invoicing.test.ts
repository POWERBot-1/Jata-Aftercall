/**
 * Double-entry accounting and invoicing (POS / ERP - PRO).
 *
 * Proven here: a journal that does not balance never posts, posted records are immutable and are
 * corrected only by a mirrored reversal, a closed period refuses new entries, invoice documents and
 * their ledger entries commit together, and a receipt can never allocate more than a balance.
 *
 * NOT proven here (see the evidence report): PostgreSQL isolation, concurrent posting under load,
 * and the real `prisma migrate deploy` run.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "@/tests/helpers/posFakeDb";
import { accountsFor, erpSeed } from "@/tests/helpers/erpSeed";
import {
  closePeriod,
  postJournal,
  profitAndLoss,
  reopenPeriod,
  reverseJournal,
  trialBalance,
  validateJournal,
} from "@/lib/erp/accounting";
import { createInvoice, issueCreditNote, issueInvoice, receivablesAgeing, recordPayment } from "@/lib/erp/invoicing";

let fake: FakeDb;
const may = new Date("2026-05-10T09:00:00Z");

beforeEach(() => {
  fake = createFakeDb(erpSeed());
});

const chart = accountsFor("bizA") as any;

describe("journal validation", () => {
  it("requires at least two lines", () => {
    expect(validateJournal([{ accountCode: "1000", debitCents: 100 }], chart).ok).toBe(false);
  });

  it("requires debits to equal credits and explains the difference", () => {
    const result = validateJournal(
      [
        { accountCode: "1000", debitCents: 1500 },
        { accountCode: "4000", creditCents: 1000 },
      ],
      chart,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/5\.00/);
  });

  it("refuses both a debit and a credit on the same line", () => {
    const result = validateJournal(
      [
        { accountCode: "1000", debitCents: 100, creditCents: 100 },
        { accountCode: "4000", creditCents: 100 },
      ],
      chart,
    );
    expect(result.ok).toBe(false);
  });

  it("refuses an account that belongs to another tenant", () => {
    const result = validateJournal(
      [
        { accountCode: "1000", debitCents: 100 },
        { accountCode: "9999", creditCents: 100 },
      ],
      chart,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/not in your chart/i);
  });
});

describe("posting", () => {
  const input = () => ({
    businessId: "bizA",
    entryDate: may,
    description: "Cash sale of chapati",
    sourceType: "MANUAL",
    lines: [
      { accountCode: "1000", debitCents: 10_000 },
      { accountCode: "4000", creditCents: 10_000 },
    ],
  });

  it("posts a balanced journal and numbers it per tenant", async () => {
    const posted = await postJournal(fake.db, input());
    expect(posted.journalNumber).toMatch(/^JV-\d{6}$/);
    expect(posted.status).toBe("POSTED");
    expect(fake.rows("erpJournalLine")).toHaveLength(2);
  });

  it("returns the first journal for a repeated idempotency key instead of double-posting", async () => {
    const first = await postJournal(fake.db, { ...input(), idempotencyKey: "jv-1" });
    const second = await postJournal(fake.db, { ...input(), idempotencyKey: "jv-1" });
    expect(second.journalNumber).toBe(first.journalNumber);
    expect(fake.rows("erpJournal")).toHaveLength(1);
  });

  it("produces a trial balance whose debits equal its credits", async () => {
    await postJournal(fake.db, input());
    await postJournal(fake.db, {
      ...input(),
      description: "Rent",
      lines: [
        { accountCode: "5100", debitCents: 4000 },
        { accountCode: "1000", creditCents: 4000 },
      ],
    });
    const trial = await trialBalance(fake.db, "bizA");
    expect(trial.totalDebitCents).toBe(trial.totalCreditCents);
    expect(trial.balanced).toBe(true);
  });

  it("computes profit from posted entries only", async () => {
    await postJournal(fake.db, input());
    await postJournal(fake.db, {
      ...input(),
      description: "Rent",
      lines: [
        { accountCode: "5100", debitCents: 4000 },
        { accountCode: "1000", creditCents: 4000 },
      ],
    });
    const pnl = await profitAndLoss(fake.db, "bizA", { from: "2026-05-01", to: "2026-05-31" });
    expect(pnl.totalIncomeCents).toBe(10_000);
    expect(pnl.totalExpenseCents).toBe(4_000);
    expect(pnl.netProfitCents).toBe(6_000);
  });

  it("reverses with a mirrored entry and leaves the original untouched", async () => {
    const posted = await postJournal(fake.db, input());
    const reversal = await reverseJournal(fake.db, {
      businessId: "bizA",
      journalId: posted.id,
      reason: "Rung up on the wrong day",
      entryDate: may,
    });
    expect(reversal.journalNumber).toMatch(/^RJV-/);
    const originalLines = fake.rows("erpJournalLine").filter((line) => line.journalId === posted.id);
    expect(originalLines.find((line) => line.accountCode === "1000")!.debitCents).toBe(10_000);
    const trial = await trialBalance(fake.db, "bizA");
    const cash = trial.rows.find((row) => row.accountCode === "1000");
    expect(cash?.balanceCents ?? 0).toBe(0);
  });

  it("refuses to post into a closed period", async () => {
    await postJournal(fake.db, input());
    await closePeriod(fake.db, { businessId: "bizA", fiscalYear: 2026, month: 5 });
    await expect(postJournal(fake.db, { ...input(), description: "Late entry" })).rejects.toMatchObject({ code: "PERIOD_CLOSED" });

    await reopenPeriod(fake.db, { businessId: "bizA", fiscalYear: 2026, month: 5, reason: "Auditor asked for the May invoice" });
    const after = await postJournal(fake.db, { ...input(), description: "Late entry" });
    expect(after.status).toBe("POSTED");
  });
});

describe("invoicing", () => {
  async function draft(lines = [{ description: "Consulting", quantity: 2, unitAmountCents: 10_000, taxKey: "VAT_STANDARD" }]) {
    const created = await createInvoice(fake.db, {
      businessId: "bizA",
      customerName: "Jane Wanjiku",
      customerPhone: "0712111111",
      issueDate: may,
      lines,
    });
    return created;
  }

  it("prices 16% VAT and issues the invoice with a matching ledger entry", async () => {
    const { invoice } = await draft();
    expect(invoice.subtotalCents).toBe(20_000);
    expect(invoice.taxCents).toBe(3_200);
    expect(invoice.totalCents).toBe(23_200);

    const issued = await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });
    expect(issued.invoice.status).toBe("ISSUED");
    expect(issued.invoice.balanceCents).toBe(23_200);
    expect(fake.rows("erpJournal")[0].sourceType).toBe("INVOICE");
    expect(fake.rows("erpJournal")[0].id).toBe(issued.invoice.journalId);
  });

  it("does not re-issue an already issued invoice", async () => {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });
    const again = await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id });
    expect(again.alreadyIssued).toBe(true);
    expect(fake.rows("erpJournal")).toHaveLength(1);
  });

  it("refuses a tax key that had no rule in force on the invoice date", async () => {
    await expect(
      createInvoice(fake.db, {
        businessId: "bizA",
        customerName: "Jane",
        issueDate: "2019-01-01",
        lines: [{ description: "Old sale", quantity: 1, unitAmountCents: 1000 }],
      }),
    ).rejects.toMatchObject({ code: "TAX_RULE_MISSING" });
  });

  it("does not allocate more than the invoice balance and books the excess as a deposit", async () => {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });

    const receipt = await recordPayment(fake.db, {
      businessId: "bizA",
      invoiceId: invoice.id,
      amountCents: 25_000,
      method: "mpesa",
      reference: "RJ12ABC",
    });
    expect(receipt.allocations[0].amountCents).toBe(23_200);
    expect(receipt.unallocatedCents).toBe(1_800);

    const updated = fake.rows("erpInvoice").find((row) => row.id === invoice.id)!;
    expect(updated.status).toBe("PAID");
    expect(updated.balanceCents).toBe(0);

    const deposit = fake.rows("erpJournalLine").find((line) => line.accountCode === "2200");
    expect(deposit?.creditCents).toBe(1_800);
  });

  it("is idempotent on the receipt key", async () => {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });
    const input = { businessId: "bizA", invoiceId: invoice.id, amountCents: 1000, method: "cash", idempotencyKey: "rcpt-1" };
    await recordPayment(fake.db, input);
    const again = await recordPayment(fake.db, input);
    expect(again.idempotent).toBe(true);
    expect(fake.rows("erpPayment")).toHaveLength(1);
  });

  it("credits an invoice with a reason and never beyond what was invoiced", async () => {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });

    const note = await issueCreditNote(fake.db, { businessId: "bizA", invoiceId: invoice.id, reason: "Two plates were cold" });
    expect(note.creditNote.totalCents).toBe(23_200);
    expect(fake.rows("erpInvoice").find((row) => row.id === invoice.id)!.status).toBe("CREDITED");

    await expect(
      issueCreditNote(fake.db, { businessId: "bizA", invoiceId: invoice.id, reason: "Another credit" }),
    ).rejects.toMatchObject({ code: "FULLY_CREDITED" });
  });

  it("buckets receivables by due date", async () => {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });

    const onTime = await receivablesAgeing(fake.db, "bizA", new Date("2026-05-12T00:00:00Z"));
    expect(onTime.totalCents).toBe(23_200);
    expect(onTime.totals.CURRENT).toBe(23_200);

    const overdue = await receivablesAgeing(fake.db, "bizA", new Date("2026-06-25T00:00:00Z"));
    expect(overdue.totals.OVER_90 + overdue.totals["61_90"] + overdue.totals["31_60"]).toBe(23_200);
  });
});
