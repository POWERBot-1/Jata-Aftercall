/**
 * Invoicing, receipts and credit notes (POS / ERP - PRO).
 *
 * The invariants under test: an invoice is priced once and frozen on issue, a payment can never
 * allocate more than a document's balance, a credit note mirrors rather than edits, and every
 * document posts its own balanced journal in the same transaction.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "@/tests/helpers/posFakeDb";
import { erpSeed } from "@/tests/helpers/erpSeed";
import { createInvoice, issueCreditNote, issueInvoice, receivablesAgeing, recordPayment } from "@/lib/erp/invoicing";

let fake: FakeDb;

beforeEach(() => {
  fake = createFakeDb(erpSeed());
});

const may = new Date("2026-05-10T09:00:00Z");

async function draft(totalLines = [{ description: "Consulting", quantity: 2, unitAmountCents: 10_000, taxKey: "VAT_STANDARD" }]) {
  const created = await createInvoice(fake.db, {
    businessId: "bizA",
    customerId: "ct_a1",
    customerName: "Jane Wanjiku",
    customerPhone: "0712111111",
    issueDate: may,
    lines: totalLines,
  });
  return created;
}

describe("invoice creation", () => {
  it("prices lines with the effective VAT rule", async () => {
    const { invoice } = await draft();
    expect(invoice.subtotalCents).toBe(20_000);
    expect(invoice.taxCents).toBe(3_200);
    expect(invoice.totalCents).toBe(23_200);
    expect(invoice.status).toBe("DRAFT");
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{6}$/);
  });

  it("refuses a tax key with no rule in force on the invoice date", async () => {
    await expect(
      createInvoice(fake.db, {
        businessId: "bizA",
        customerName: "Jane Wanjiku",
        issueDate: "2019-01-01",
        lines: [{ description: "Old sale", quantity: 1, unitAmountCents: 1000, taxKey: "VAT_STANDARD" }],
      }),
    ).rejects.toMatchObject({ code: "TAX_RULE_MISSING" });
  });

  it("requires a customer name and at least one line", async () => {
    await expect(createInvoice(fake.db, { businessId: "bizA", customerName: " ", lines: [{ description: "x", quantity: 1, unitAmountCents: 1 }] })).rejects.toMatchObject({
      code: "CUSTOMER_REQUIRED",
    });
    await expect(createInvoice(fake.db, { businessId: "bizA", customerName: "Jane", lines: [] })).rejects.toMatchObject({ code: "LINES_REQUIRED" });
  });

  it("returns the same invoice for a repeated idempotency key", async () => {
    const input = {
      businessId: "bizA",
      customerName: "Jane Wanjiku",
      issueDate: may,
      idempotencyKey: "draft-1",
      lines: [{ description: "Consulting", quantity: 1, unitAmountCents: 5000 }],
    };
    const first = await createInvoice(fake.db, input);
    const second = await createInvoice(fake.db, input);
    expect(second.idempotent).toBe(true);
    expect(second.invoice.id).toBe(first.invoice.id);
    expect(fake.rows("erpInvoice")).toHaveLength(1);
  });
});

describe("issuing", () => {
  it("posts the receivable, revenue and VAT in one balanced journal", async () => {
    const { invoice } = await draft();
    const issued = await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, actorName: "Mary Manager", issueDate: may });
    expect(issued.invoice.status).toBe("ISSUED");
    expect(issued.invoice.journalId).toBeTruthy();

    const journal = fake.rows("erpJournal").find((row) => row.id === issued.invoice.journalId)!;
    expect(journal.status).toBe("POSTED");
    const lines = fake.rows("erpJournalLine").filter((row) => row.journalId === journal.id);
    const debits = lines.reduce((total, line) => total + line.debitCents, 0);
    const credits = lines.reduce((total, line) => total + line.creditCents, 0);
    expect(debits).toBe(23_200);
    expect(credits).toBe(23_200);
    expect(lines.find((line) => line.accountCode === "1100")?.debitCents).toBe(23_200);
    expect(lines.find((line) => line.accountCode === "2100")?.creditCents).toBe(3_200);
  });

  it("is idempotent: issuing twice does not post a second journal", async () => {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });
    const again = await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });
    expect(again.alreadyIssued).toBe(true);
    expect(fake.rows("erpJournal")).toHaveLength(1);
  });

  it("refuses to issue when the stored totals no longer match the lines", async () => {
    const { invoice } = await draft();
    const row = fake.rows("erpInvoice").find((entry) => entry.id === invoice.id)!;
    row.totalCents = 1;
    await expect(issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may })).rejects.toMatchObject({
      code: "TOTAL_MISMATCH",
    });
  });

  it("will not issue another tenant's invoice", async () => {
    const { invoice } = await draft();
    await expect(issueInvoice(fake.db, { businessId: "bizB", invoiceId: invoice.id, issueDate: may })).rejects.toMatchObject({ status: 404 });
  });
});

describe("receipts", () => {
  async function issued() {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });
    return invoice;
  }

  it("allocates a partial payment and leaves the remainder on the invoice", async () => {
    const invoice = await issued();
    const result = await recordPayment(fake.db, {
      businessId: "bizA",
      invoiceId: invoice.id,
      customerId: "ct_a1",
      customerName: "Jane Wanjiku",
      amountCents: 10_000,
      method: "cash",
      receivedAt: may,
    });
    expect(result.allocations[0].amountCents).toBe(10_000);
    expect(result.unallocatedCents).toBe(0);

    const updated = fake.rows("erpInvoice").find((row) => row.id === invoice.id)!;
    expect(updated.amountPaidCents).toBe(10_000);
    expect(updated.balanceCents).toBe(13_200);
    expect(updated.status).toBe("PARTIALLY_PAID");
  });

  it("never allocates more than the balance: the excess becomes a customer deposit", async () => {
    const invoice = await issued();
    const result = await recordPayment(fake.db, {
      businessId: "bizA",
      invoiceId: invoice.id,
      customerName: "Jane Wanjiku",
      amountCents: 30_000,
      method: "mpesa",
      receivedAt: may,
    });
    expect(result.allocations[0].amountCents).toBe(23_200);
    expect(result.unallocatedCents).toBe(6_800);

    const updated = fake.rows("erpInvoice").find((row) => row.id === invoice.id)!;
    expect(updated.balanceCents).toBe(0);
    expect(updated.status).toBe("PAID");

    const deposit = fake.rows("erpJournalLine").find((line) => line.accountCode === "2200");
    expect(deposit?.creditCents).toBe(6_800);
  });

  it("refuses to take money against a draft", async () => {
    const { invoice } = await draft();
    await expect(
      recordPayment(fake.db, { businessId: "bizA", invoiceId: invoice.id, amountCents: 100, method: "cash", receivedAt: may }),
    ).rejects.toMatchObject({ code: "NOT_ISSUED" });
  });

  it("rejects a zero or negative amount", async () => {
    await expect(recordPayment(fake.db, { businessId: "bizA", amountCents: 0, method: "cash" })).rejects.toMatchObject({ code: "AMOUNT_REQUIRED" });
  });

  it("is idempotent on the receipt key", async () => {
    const invoice = await issued();
    const input = {
      businessId: "bizA",
      invoiceId: invoice.id,
      amountCents: 1000,
      method: "cash",
      receivedAt: may,
      idempotencyKey: "receipt-1",
    };
    const first = await recordPayment(fake.db, input);
    const second = await recordPayment(fake.db, input);
    expect(second.idempotent).toBe(true);
    expect(fake.rows("erpPayment")).toHaveLength(1);
    expect(first.payment.id).toBe(second.payment.id);
  });
});

describe("credit notes", () => {
  it("mirrors the invoice and leaves the ledger net", async () => {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });

    const note = await issueCreditNote(fake.db, {
      businessId: "bizA",
      invoiceId: invoice.id,
      reason: "Service was not delivered",
      actorName: "Mary Manager",
    });
    expect(note.creditNote.totalCents).toBe(23_200);

    const updated = fake.rows("erpInvoice").find((row) => row.id === invoice.id)!;
    expect(updated.balanceCents).toBe(0);

    const credited = fake.rows("erpJournalLine").filter((line) => line.accountCode === "4000");
    const net = credited.reduce((total, line) => total + line.debitCents - line.creditCents, 0);
    expect(net).toBe(0);
  });

  it("refuses to credit more than the invoice allows", async () => {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });
    await expect(
      issueCreditNote(fake.db, { businessId: "bizA", invoiceId: invoice.id, reason: "Goodwill gesture", netCents: 999_999 }),
    ).rejects.toMatchObject({ code: "OVER_CREDIT" });
  });

  it("requires a reason", async () => {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });
    await expect(issueCreditNote(fake.db, { businessId: "bizA", invoiceId: invoice.id, reason: "no" })).rejects.toMatchObject({
      code: "REASON_REQUIRED",
    });
  });
});

describe("ageing", () => {
  it("buckets receivables by days past due", async () => {
    const { invoice } = await draft();
    await issueInvoice(fake.db, { businessId: "bizA", invoiceId: invoice.id, issueDate: may });
    const ageing = await receivablesAgeing(fake.db, "bizA", new Date("2026-05-12T00:00:00Z"));
    expect(ageing.totalCents).toBe(23_200);
    expect(ageing.totals.CURRENT).toBe(23_200);
    expect(ageing.rows.find((row: any) => row.invoiceId === invoice.id)).toBeTruthy();
  });
});
