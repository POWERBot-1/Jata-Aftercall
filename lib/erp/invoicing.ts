/**
 * Invoicing, receipts, credit notes and receivables ageing (§2.2, §2.4)
 *
 * An invoice and its ledger entry are written in one transaction. A payment is allocated to
 * invoices with an explicit cap, so a receipt can never overpay a document. Credit notes reduce
 * a receivable through the ledger; nothing is deleted. Every posting path is idempotent: a
 * retried request returns the first result instead of creating a second invoice or receipt.
 */

import prisma from "../db";
import { logErpAudit } from "./audit";
import {
  AccountingError,
  buildCreditNoteJournal,
  buildInvoiceJournal,
  buildPaymentJournal,
  CHART_OF_ACCOUNTS,
  ensureChartOfAccounts,
  postJournalTx,
  type JournalLineInput,
} from "./accounting";
import { nextDocumentNumber } from "./sequences";
import { DEFAULT_KENYA_TAX_RULES, priceInvoiceLines, type InvoiceLineInput, type TaxRule } from "./tax";

export class InvoicingError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "INVOICE_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "InvoicingError";
  }
}

export type CreateInvoiceInput = {
  businessId: string;
  actorId?: string | null;
  actorName?: string | null;
  branchId?: string | null;
  customerId?: string | null;
  customerName: string;
  customerPhone?: string | null;
  customerPin?: string | null;
  dueAt?: Date | string | null;
  issueDate?: Date | string | null;
  lines: InvoiceLineInput[];
  notes?: string | null;
  idempotencyKey?: string | null;
  sourceType?: string | null;
  sourceId?: string | null;
  taxRules?: TaxRule[];
};

/** Tax rules for a business, falling back to the reference registry only when none were seeded. */
export async function loadTaxRules(client: any, businessId: string): Promise<TaxRule[]> {
  const rows = await client.erpTaxRule.findMany({ where: { businessId } });
  if (!rows.length) return DEFAULT_KENYA_TAX_RULES;
  return rows.map((row: any) => ({
    key: row.key,
    label: row.label,
    rateBps: Number(row.rateBps ?? 0),
    treatment: row.treatment,
    inclusive: Boolean(row.inclusive),
    effectiveFrom: new Date(row.effectiveFrom).toISOString().slice(0, 10),
    effectiveTo: row.effectiveTo ? new Date(row.effectiveTo).toISOString().slice(0, 10) : null,
    sourceRef: row.sourceRef ?? null,
    verified: Boolean(row.verified),
  }));
}

export async function createInvoice(client: any, input: CreateInvoiceInput) {
  const db = client ?? prisma;
  if (!input.customerName || input.customerName.trim().length < 2) {
    throw new InvoicingError("Add the customer's name so the invoice is addressed to someone.", 400, "CUSTOMER_REQUIRED");
  }
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new InvoicingError("Add at least one item to the invoice.", 400, "LINES_REQUIRED");
  }

  const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
  if (Number.isNaN(issueDate.getTime())) throw new InvoicingError("That invoice date is not valid.", 400, "BAD_DATE");
  const taxRules = input.taxRules ?? (await loadTaxRules(db, input.businessId));
  const priced = priceInvoiceLines(input.lines, taxRules, issueDate);
  if (priced.ok === false) throw new InvoicingError(priced.error, 400, "TAX_RULE_MISSING");

  return db.$transaction(async (tx: any) => {
    if (input.idempotencyKey) {
      const existing = await tx.erpInvoice.findUnique({
        where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: input.idempotencyKey } },
      }).catch(() => null);
      if (existing) {
        const lines = await tx.erpInvoiceLine.findMany({ where: { invoiceId: existing.id } });
        return { invoice: existing, lines, idempotent: true };
      }
    }

    await ensureChartOfAccounts(tx, input.businessId);
    const invoiceNumber = await nextDocumentNumber(tx, input.businessId, "invoice");
    const invoice = await tx.erpInvoice.create({
      data: {
        businessId: input.businessId,
        branchId: input.branchId ?? null,
        invoiceNumber,
        customerId: input.customerId ?? null,
        customerName: input.customerName.trim(),
        customerPhone: input.customerPhone ?? null,
        customerPin: input.customerPin ?? null,
        status: "DRAFT",
        currencyCode: "KES",
        subtotalCents: priced.totals.subtotalCents,
        discountCents: priced.totals.discountCents,
        taxCents: priced.totals.taxCents,
        totalCents: priced.totals.totalCents,
        amountPaidCents: 0,
        balanceCents: priced.totals.totalCents,
        notes: input.notes ?? null,
        etimsStatus: "NONE",
        sourceType: input.sourceType ?? "MANUAL",
        sourceId: input.sourceId ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdById: input.actorId ?? null,
        dueAt: input.dueAt ? new Date(input.dueAt) : null,
      },
    });

    const lines = [];
    for (const line of priced.totals.lines) {
      lines.push(
        await tx.erpInvoiceLine.create({
          data: {
            businessId: input.businessId,
            invoiceId: invoice.id,
            description: line.description,
            quantity: line.quantity,
            unitAmountCents: Math.round(line.unitAmountCents),
            discountCents: Math.round(line.discountCents ?? 0),
            taxRuleKey: line.taxKey ?? "VAT_STANDARD",
            taxRateBps: line.taxRateBps,
            taxTreatment: line.taxTreatment,
            lineNetCents: line.netCents,
            lineTaxCents: line.taxCents,
            lineTotalCents: line.totalCents,
          },
        }),
      );
    }

    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      action: "INVOICE_CREATED",
      targetType: "INVOICE",
      targetId: invoice.id,
      after: { invoiceNumber, totalCents: invoice.totalCents, status: "DRAFT" },
      client: tx,
    });

    return { invoice, lines, idempotent: false };
  });
}

/**
 * Issue a draft invoice: freeze the figures, post the receivable and revenue, and stamp the due
 * date. Calling it twice returns the issued invoice rather than posting a second time.
 */
export async function issueInvoice(
  client: any,
  input: { businessId: string; invoiceId: string; actorId?: string | null; actorName?: string | null; issueDate?: Date | string | null },
) {
  const db = client ?? prisma;
  return db.$transaction(async (tx: any) => {
    const invoice = await tx.erpInvoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice || invoice.businessId !== input.businessId) throw new InvoicingError("That invoice was not found.", 404, "NOT_FOUND");
    if (invoice.journalId) {
      const lines = await tx.erpInvoiceLine.findMany({ where: { invoiceId: invoice.id } });
      return { invoice, lines, alreadyIssued: true };
    }
    if (String(invoice.status).toUpperCase() !== "DRAFT") {
      throw new InvoicingError("Only a draft invoice can be issued.", 409, "NOT_DRAFT");
    }
    const lines = await tx.erpInvoiceLine.findMany({ where: { invoiceId: invoice.id } });
    if (!lines.length) throw new InvoicingError("This invoice has no items.", 400, "LINES_REQUIRED");

    const net = lines.reduce((total: number, line: any) => total + Number(line.lineNetCents), 0);
    const tax = lines.reduce((total: number, line: any) => total + Number(line.lineTaxCents), 0);
    const total = lines.reduce((total: number, line: any) => total + Number(line.lineTotalCents), 0);
    if (total !== Number(invoice.totalCents) || net !== Number(invoice.subtotalCents) || tax !== Number(invoice.taxCents)) {
      throw new InvoicingError("The invoice totals do not match its lines. Recalculate before issuing.", 409, "TOTAL_MISMATCH");
    }

    const issueDate = input.issueDate ? new Date(input.issueDate) : new Date();
    const dueAt = invoice.dueAt ? new Date(invoice.dueAt) : new Date(issueDate.getTime() + 7 * 86_400_000);
    await ensureChartOfAccounts(tx, input.businessId);

    const journalLines: JournalLineInput[] = buildInvoiceJournal({
      netCents: net,
      taxCents: tax,
      totalCents: total,
      description: `Invoice ${invoice.invoiceNumber} — ${invoice.customerName}`,
      branchId: invoice.branchId,
    });

    const journal = await postJournalTx(tx, {
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      entryDate: issueDate,
      description: `Invoice ${invoice.invoiceNumber} to ${invoice.customerName}`,
      sourceType: "INVOICE",
      sourceId: invoice.id,
      branchId: invoice.branchId,
      lines: journalLines,
      idempotencyKey: `invoice:${invoice.id}:issue`,
    });

    const updated = await tx.erpInvoice.update({
      where: { id: invoice.id },
      data: {
        status: "ISSUED",
        issuedAt: issueDate,
        dueAt,
        journalId: journal.id,
        balanceCents: total,
      },
    });

    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      action: "INVOICE_ISSUED",
      targetType: "INVOICE",
      targetId: invoice.id,
      after: { invoiceNumber: invoice.invoiceNumber, totalCents: total, journalId: journal.id },
      client: tx,
    });

    return { invoice: updated, lines, alreadyIssued: false };
  });
}

export type PaymentInput = {
  businessId: string;
  actorId?: string | null;
  actorName?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  invoiceId?: string | null;
  amountCents: number;
  method?: string;
  reference?: string | null;
  notes?: string | null;
  receivedAt?: Date | string | null;
  idempotencyKey?: string | null;
  cashAccountCode?: string;
};

function accountForMethod(method: string | undefined): string {
  const key = String(method ?? "cash").toLowerCase();
  if (key === "cash") return "1000";
  return "1010";
}

/**
 * Record a receipt and allocate it. Allocation never exceeds a document's balance; any excess
 * becomes a customer deposit (a liability), not revenue and not a negative receivable.
 */
export async function recordPayment(client: any, input: PaymentInput) {
  const db = client ?? prisma;
  const amount = Math.round(Number(input.amountCents ?? 0));
  if (!Number.isFinite(amount) || amount <= 0) throw new InvoicingError("Enter an amount greater than zero.", 400, "AMOUNT_REQUIRED");

  return db.$transaction(async (tx: any) => {
    if (input.idempotencyKey) {
      const existing = await tx.erpPayment.findUnique({
        where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: input.idempotencyKey } },
      }).catch(() => null);
      if (existing) {
        const allocations = await tx.erpPaymentAllocation.findMany({ where: { paymentId: existing.id } });
        return { payment: existing, allocations, idempotent: true };
      }
    }

    let invoices: any[] = [];
    if (input.invoiceId) {
      const invoice = await tx.erpInvoice.findUnique({ where: { id: input.invoiceId } });
      if (!invoice || invoice.businessId !== input.businessId) throw new InvoicingError("That invoice was not found.", 404, "NOT_FOUND");
      if (invoice.status === "DRAFT") throw new InvoicingError("Issue the invoice before recording a payment against it.", 409, "NOT_ISSUED");
      if (invoice.status === "VOIDED") throw new InvoicingError("That invoice was voided.", 409, "VOIDED");
      invoices = [invoice];
    } else if (input.customerId) {
      invoices = await tx.erpInvoice.findMany({
        where: { businessId: input.businessId, customerId: input.customerId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
      });
      invoices = invoices
        .filter((invoice: any) => Number(invoice.balanceCents) > 0)
        .sort((a: any, b: any) => new Date(a.dueAt ?? a.createdAt).getTime() - new Date(b.dueAt ?? b.createdAt).getTime());
    } else {
      throw new InvoicingError("Choose the invoice this payment settles.", 400, "INVOICE_REQUIRED");
    }

    let remaining = amount;
    const allocations: Array<{ invoiceId: string; amountCents: number }> = [];
    for (const invoice of invoices) {
      if (remaining <= 0) break;
      const balance = Math.max(0, Number(invoice.balanceCents));
      if (balance <= 0) continue;
      const allocated = Math.min(balance, remaining);
      allocations.push({ invoiceId: invoice.id, amountCents: allocated });
      remaining -= allocated;
    }

    await ensureChartOfAccounts(tx, input.businessId);
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date();
    const receiptNumber = await nextDocumentNumber(tx, input.businessId, "receipt");
    const allocatedTotal = allocations.reduce((total, allocation) => total + allocation.amountCents, 0);
    const unallocated = amount - allocatedTotal;

    const payment = await tx.erpPayment.create({
      data: {
        businessId: input.businessId,
        receiptNumber,
        customerId: input.customerId ?? null,
        customerName: input.customerName ?? null,
        amountCents: amount,
        method: input.method ?? "cash",
        reference: input.reference ?? null,
        receivedAt,
        status: "CONFIRMED",
        notes: input.notes ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdById: input.actorId ?? null,
      },
    });

    const journalLines: JournalLineInput[] = [
      { accountCode: input.cashAccountCode ?? accountForMethod(input.method), debitCents: amount, description: `Receipt ${receiptNumber}` },
    ];
    if (allocatedTotal > 0) journalLines.push({ accountCode: "1100", creditCents: allocatedTotal, description: `Receipt ${receiptNumber} allocated` });
    if (unallocated > 0) journalLines.push({ accountCode: "2200", creditCents: unallocated, description: `Receipt ${receiptNumber} customer deposit` });

    const journal = await postJournalTx(tx, {
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      entryDate: receivedAt,
      description: `Payment ${receiptNumber}${input.customerName ? ` from ${input.customerName}` : ""}`,
      sourceType: "PAYMENT",
      sourceId: payment.id,
      lines: journalLines,
      idempotencyKey: `payment:${payment.id}:post`,
    });

    for (const allocation of allocations) {
      await tx.erpPaymentAllocation.create({
        data: { businessId: input.businessId, paymentId: payment.id, invoiceId: allocation.invoiceId, amountCents: allocation.amountCents },
      });
      const invoice = invoices.find((entry) => entry.id === allocation.invoiceId);
      const paid = Number(invoice?.amountPaidCents ?? 0) + allocation.amountCents;
      const balance = Math.max(0, Number(invoice?.totalCents ?? 0) - paid);
      await tx.erpInvoice.update({
        where: { id: allocation.invoiceId },
        data: {
          amountPaidCents: paid,
          balanceCents: balance,
          status: balance === 0 ? "PAID" : "PARTIALLY_PAID",
        },
      });
    }

    await tx.erpPayment.update({ where: { id: payment.id }, data: { journalId: journal.id } });

    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      action: "PAYMENT_RECORDED",
      targetType: "PAYMENT",
      targetId: payment.id,
      after: { receiptNumber, amountCents: amount, allocatedTotal, unallocated, journalId: journal.id },
      client: tx,
    });

    return { payment: { ...payment, journalId: journal.id }, allocations, unallocatedCents: unallocated, idempotent: false };
  });
}

/**
 * Credit note: the legally permitted way to reduce an invoice after it was issued. It posts the
 * mirror of the invoice (revenue and VAT down, receivable down) and never exceeds what remains.
 */
export async function issueCreditNote(
  client: any,
  input: {
    businessId: string;
    invoiceId: string;
    reason: string;
    actorId?: string | null;
    actorName?: string | null;
    netCents?: number;
    taxCents?: number;
    idempotencyKey?: string | null;
  },
) {
  const db = client ?? prisma;
  if (!input.reason || input.reason.trim().length < 5) {
    throw new InvoicingError("Say why the credit note is being issued.", 400, "REASON_REQUIRED");
  }
  return db.$transaction(async (tx: any) => {
    const invoice = await tx.erpInvoice.findUnique({ where: { id: input.invoiceId } });
    if (!invoice || invoice.businessId !== input.businessId) throw new InvoicingError("That invoice was not found.", 404, "NOT_FOUND");
    if (invoice.status === "DRAFT" || invoice.status === "VOIDED") throw new InvoicingError("Only an issued invoice can be credited.", 409, "NOT_ISSUED");

    if (input.idempotencyKey) {
      const existing = await tx.erpCreditNote.findUnique({
        where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: input.idempotencyKey } },
      }).catch(() => null);
      if (existing) return { creditNote: existing, idempotent: true };
    }

    const previous = await tx.erpCreditNote.findMany({ where: { businessId: input.businessId, invoiceId: invoice.id, status: { not: "VOIDED" } } });
    const creditedNet = previous.reduce((total: number, note: any) => total + Number(note.netCents), 0);
    const creditedTax = previous.reduce((total: number, note: any) => total + Number(note.taxCents), 0);
    const remainingNet = Number(invoice.subtotalCents) - creditedNet;
    const remainingTax = Number(invoice.taxCents) - creditedTax;
    if (remainingNet <= 0 && remainingTax <= 0) throw new InvoicingError("This invoice has already been fully credited.", 409, "FULLY_CREDITED");

    const netCents = input.netCents === undefined ? remainingNet : Math.round(input.netCents);
    const taxCents = input.taxCents === undefined ? remainingTax : Math.round(input.taxCents);
    if (netCents < 0 || taxCents < 0) throw new InvoicingError("A credit note cannot be negative.", 400, "BAD_AMOUNT");
    if (netCents === 0 && taxCents === 0) throw new InvoicingError("Enter the amount to credit.", 400, "AMOUNT_REQUIRED");
    if (netCents > remainingNet || taxCents > remainingTax) {
      throw new InvoicingError("That credit is more than the invoice still allows. Check the amounts.", 409, "OVER_CREDIT");
    }
    if (netCents + taxCents > Math.max(0, Number(invoice.balanceCents))) {
      throw new InvoicingError("The invoice has already been paid to that extent. Refund the payment instead of crediting more.", 409, "EXCEEDS_BALANCE");
    }

    await ensureChartOfAccounts(tx, input.businessId);
    const creditNoteNumber = await nextDocumentNumber(tx, input.businessId, "credit_note");
    const note = await tx.erpCreditNote.create({
      data: {
        businessId: input.businessId,
        creditNoteNumber,
        invoiceId: invoice.id,
        reason: input.reason.trim(),
        netCents,
        taxCents,
        totalCents: netCents + taxCents,
        status: "ISSUED",
        idempotencyKey: input.idempotencyKey ?? null,
        createdById: input.actorId ?? null,
      },
    });

    const journal = await postJournalTx(tx, {
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      entryDate: new Date(),
      description: `Credit note ${creditNoteNumber} for invoice ${invoice.invoiceNumber}`,
      sourceType: "CREDIT_NOTE",
      sourceId: note.id,
      lines: buildCreditNoteJournal({
        netCents,
        taxCents,
        description: `Credit note ${creditNoteNumber}`,
        branchId: invoice.branchId,
      }),
      idempotencyKey: `credit-note:${note.id}:post`,
    });

    const newBalance = Math.max(0, Number(invoice.balanceCents) - (netCents + taxCents));
    await tx.erpInvoice.update({
      where: { id: invoice.id },
      data: {
        balanceCents: newBalance,
        status: newBalance === 0 ? "CREDITED" : invoice.status,
      },
    });
    await tx.erpCreditNote.update({ where: { id: note.id }, data: { journalId: journal.id, status: "APPLIED" } });

    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      action: "CREDIT_NOTE_ISSUED",
      targetType: "CREDIT_NOTE",
      targetId: note.id,
      reason: input.reason.trim(),
      after: { creditNoteNumber, netCents, taxCents, journalId: journal.id },
      client: tx,
    });

    return { creditNote: { ...note, journalId: journal.id, status: "APPLIED" }, idempotent: false };
  });
}

export type AgeingBucket = "CURRENT" | "1_30" | "31_60" | "61_90" | "OVER_90";

export const AGEING_BUCKETS: AgeingBucket[] = ["CURRENT", "1_30", "31_60", "61_90", "OVER_90"];

export function ageingBucket(dueAt: Date | string | null | undefined, asOf: Date = new Date()): AgeingBucket {
  if (!dueAt) return "CURRENT";
  const due = new Date(dueAt);
  if (Number.isNaN(due.getTime())) return "CURRENT";
  const days = Math.floor((asOf.getTime() - due.getTime()) / 86_400_000);
  if (days <= 0) return "CURRENT";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "OVER_90";
}

export async function receivablesAgeing(
  client: any,
  businessId: string,
  asOf: Date = new Date(),
) {
  const invoices = await client.erpInvoice.findMany({
    where: { businessId, status: { in: ["ISSUED", "PARTIALLY_PAID"] } },
  });
  const rows = invoices
    .filter((invoice: any) => Number(invoice.balanceCents) > 0)
    .map((invoice: any) => ({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      customerId: invoice.customerId ?? null,
      customerName: invoice.customerName,
      dueAt: invoice.dueAt ?? null,
      balanceCents: Number(invoice.balanceCents),
      bucket: ageingBucket(invoice.dueAt, asOf),
    }));

  const totals: Record<AgeingBucket, number> = { CURRENT: 0, "1_30": 0, "31_60": 0, "61_90": 0, OVER_90: 0 };
  for (const row of rows) totals[row.bucket as AgeingBucket] += row.balanceCents;
  return {
    rows: rows.sort((a: any, b: any) => b.balanceCents - a.balanceCents),
    totals,
    totalCents: Object.values(totals).reduce((total, value) => total + value, 0),
    asOf,
  };
}

/** A customer statement built from invoices, receipts and credit notes — not typed totals. */
export async function customerStatement(client: any, businessId: string, customerId: string) {
  const [invoices, payments, notes] = await Promise.all([
    client.erpInvoice.findMany({ where: { businessId, customerId } }),
    client.erpPayment.findMany({ where: { businessId, customerId } }),
    client.erpCreditNote.findMany({ where: { businessId } }),
  ]);
  const invoiceIds = new Set(invoices.map((invoice: any) => invoice.id));
  const relevantNotes = notes.filter((note: any) => invoiceIds.has(note.invoiceId));
  const entries = [
    ...invoices.map((invoice: any) => ({
      at: invoice.issuedAt ?? invoice.createdAt,
      type: "INVOICE" as const,
      reference: invoice.invoiceNumber,
      debitCents: Number(invoice.totalCents),
      creditCents: 0,
    })),
    ...payments.map((payment: any) => ({
      at: payment.receivedAt,
      type: "RECEIPT" as const,
      reference: payment.receiptNumber,
      debitCents: 0,
      creditCents: Number(payment.amountCents),
    })),
    ...relevantNotes.map((note: any) => ({
      at: note.createdAt,
      type: "CREDIT_NOTE" as const,
      reference: note.creditNoteNumber,
      debitCents: 0,
      creditCents: Number(note.totalCents),
    })),
  ].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  let running = 0;
  const lines = entries.map((entry) => {
    running += entry.debitCents - entry.creditCents;
    return { ...entry, balanceCents: running };
  });
  return { entries: lines, closingBalanceCents: running };
}

export function defaultAccountsPresent(accounts: Array<{ code: string }>): boolean {
  const codes = new Set(accounts.map((account) => account.code));
  return CHART_OF_ACCOUNTS.every((account) => codes.has(account.code));
}

export { AccountingError };
