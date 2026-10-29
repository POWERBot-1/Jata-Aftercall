/**
 * Double-entry behaviour (POS / ERP - PRO).
 *
 * These tests use the in-memory Prisma stand-in, so they prove the *logic* — balances, effective
 * periods, idempotency and reversal semantics — not PostgreSQL's isolation. The database-backed
 * behaviour is labelled NOT TESTED in the evidence report.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { createFakeDb, type FakeDb } from "@/tests/helpers/posFakeDb";
import { erpSeed } from "@/tests/helpers/erpSeed";
import {
  AccountingError,
  closePeriod,
  postJournal,
  profitAndLoss,
  reopenPeriod,
  reverseJournal,
  trialBalance,
  validateJournal,
} from "@/lib/erp/accounting";

let fake: FakeDb;

beforeEach(() => {
  fake = createFakeDb(erpSeed());
});

const may = new Date("2026-05-10T09:00:00Z");

describe("validateJournal", () => {
  const accounts = [
    { id: "1", code: "1000", type: "ASSET", isActive: true },
    { id: "2", code: "4000", type: "INCOME", isActive: true },
    { id: "3", code: "5100", type: "EXPENSE", isActive: false },
  ];

  it("requires at least two lines", () => {
    const result = validateJournal([{ accountCode: "1000", debitCents: 100 }], accounts);
    expect(result.ok).toBe(false);
  });

  it("refuses a line with both a debit and a credit", () => {
    const result = validateJournal(
      [
        { accountCode: "1000", debitCents: 100, creditCents: 100 },
        { accountCode: "4000", creditCents: 100 },
      ],
      accounts,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/either a debit or a credit/i);
  });

  it("refuses an account that is not in this tenant's chart", () => {
    const result = validateJournal(
      [
        { accountCode: "1000", debitCents: 100 },
        { accountCode: "9999", creditCents: 100 },
      ],
      accounts,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/not in your chart/i);
  });

  it("refuses an inactive account", () => {
    const result = validateJournal(
      [
        { accountCode: "1000", debitCents: 100 },
        { accountCode: "5100", creditCents: 100 },
      ],
      accounts,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/inactive/i);
  });

  it("reports the difference when debits and credits do not match", () => {
    const result = validateJournal(
      [
        { accountCode: "1000", debitCents: 1500 },
        { accountCode: "4000", creditCents: 1000 },
      ],
      accounts,
    );
    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toMatch(/5\.00/);
  });
});

describe("posting and reporting", () => {
  it("posts a balanced journal and produces a balanced trial balance", async () => {
    const posted = await postJournal(fake.db, {
      businessId: "bizA",
      entryDate: may,
      description: "Cash sale of chapati",
      sourceType: "MANUAL",
      lines: [
        { accountCode: "1000", debitCents: 10_000, description: "Cash received" },
        { accountCode: "4000", creditCents: 10_000, description: "Sales" },
      ],
    });

    expect(posted.journalNumber).toMatch(/^JV-\d{6}$/);
    expect(posted.totalDebitCents).toBe(posted.totalCreditCents);

    const trial = await trialBalance(fake.db, "bizA");
    expect(trial.balanced).toBe(true);
    expect(trial.totalDebitCents).toBe(10_000);
    expect(trial.rows.find((row) => row.accountCode === "1000")?.balanceCents).toBe(10_000);
  });

  it("keeps another tenant's entries out of the report", async () => {
    await postJournal(fake.db, {
      businessId: "bizB",
      entryDate: may,
      description: "Hardware sale",
      lines: [
        { accountCode: "1000", debitCents: 900 },
        { accountCode: "4000", creditCents: 900 },
      ],
    });
    const trial = await trialBalance(fake.db, "bizA");
    expect(trial.rows).toHaveLength(0);
  });

  it("computes profit as income minus expenses", async () => {
    await postJournal(fake.db, {
      businessId: "bizA",
      entryDate: may,
      description: "Sale",
      lines: [
        { accountCode: "1000", debitCents: 16_000 },
        { accountCode: "4000", creditCents: 16_000 },
      ],
    });
    await postJournal(fake.db, {
      businessId: "bizA",
      entryDate: may,
      description: "Rent",
      lines: [
        { accountCode: "5100", debitCents: 6_000 },
        { accountCode: "1000", creditCents: 6_000 },
      ],
    });

    const pnl = await profitAndLoss(fake.db, "bizA", { from: "2026-05-01", to: "2026-05-31" });
    expect(pnl.totalIncomeCents).toBe(16_000);
    expect(pnl.totalExpenseCents).toBe(6_000);
    expect(pnl.netProfitCents).toBe(10_000);
  });
});

describe("idempotency and immutability", () => {
  it("returns the first journal for a repeated idempotency key instead of double-posting", async () => {
    const input = {
      businessId: "bizA",
      entryDate: may,
      description: "Cash sale",
      idempotencyKey: "sale-1",
      lines: [
        { accountCode: "1000", debitCents: 5000 },
        { accountCode: "4000", creditCents: 5000 },
      ],
    };
    const first = await postJournal(fake.db, input);
    const second = await postJournal(fake.db, input);
    expect(second.journalNumber).toBe(first.journalNumber);
    expect(fake.rows("erpJournal")).toHaveLength(1);
    expect(fake.rows("erpJournalLine")).toHaveLength(2);
  });

  it("reverses by mirroring the entry and never by editing it", async () => {
    const original = await postJournal(fake.db, {
      businessId: "bizA",
      entryDate: may,
      description: "Wrong sale",
      lines: [
        { accountCode: "1000", debitCents: 7000 },
        { accountCode: "4000", creditCents: 7000 },
      ],
    });
    const before = JSON.stringify(fake.rows("erpJournalLine"));

    const reversal = await reverseJournal(fake.db, {
      businessId: "bizA",
      journalId: original.id,
      reason: "Customer cancelled the order",
      entryDate: may,
    });

    expect(reversal.journalNumber).toMatch(/^RJV-/);
    const after = fake.rows("erpJournalLine");
    expect(after).toHaveLength(4);
    expect(JSON.stringify(after.slice(0, 2))).toBe(before);

    const updated = fake.rows("erpJournal").find((row) => row.id === original.id);
    expect(updated?.reversedById).toBe(reversal.id);

    const trial = await trialBalance(fake.db, "bizA");
    const cash = trial.rows.find((row) => row.accountCode === "1000");
    expect(cash?.balanceCents ?? 0).toBe(0);
  });

  it("refuses a second reversal of the same journal", async () => {
    const original = await postJournal(fake.db, {
      businessId: "bizA",
      entryDate: may,
      description: "Sale",
      lines: [
        { accountCode: "1000", debitCents: 100 },
        { accountCode: "4000", creditCents: 100 },
      ],
    });
    await reverseJournal(fake.db, { businessId: "bizA", journalId: original.id, reason: "Mistake found", entryDate: may });
    await expect(
      reverseJournal(fake.db, { businessId: "bizA", journalId: original.id, reason: "Mistake found again", entryDate: may }),
    ).rejects.toBeInstanceOf(AccountingError);
  });

  it("will not reverse another tenant's journal", async () => {
    const other = await postJournal(fake.db, {
      businessId: "bizB",
      entryDate: may,
      description: "Hardware sale",
      lines: [
        { accountCode: "1000", debitCents: 900 },
        { accountCode: "4000", creditCents: 900 },
      ],
    });
    await expect(
      reverseJournal(fake.db, { businessId: "bizA", journalId: other.id, reason: "Not mine at all", entryDate: may }),
    ).rejects.toMatchObject({ status: 404 });
  });
});

describe("period control", () => {
  it("blocks posting into a closed month and allows it after a written reopen", async () => {
    await postJournal(fake.db, {
      businessId: "bizA",
      entryDate: may,
      description: "Sale",
      lines: [
        { accountCode: "1000", debitCents: 1000 },
        { accountCode: "4000", creditCents: 1000 },
      ],
    });

    await closePeriod(fake.db, { businessId: "bizA", fiscalYear: 2026, month: 5 });

    await expect(
      postJournal(fake.db, {
        businessId: "bizA",
        entryDate: may,
        description: "Late sale",
        lines: [
          { accountCode: "1000", debitCents: 2000 },
          { accountCode: "4000", creditCents: 2000 },
        ],
      }),
    ).rejects.toMatchObject({ code: "PERIOD_CLOSED" });

    await reopenPeriod(fake.db, { businessId: "bizA", fiscalYear: 2026, month: 5, reason: "Auditor requested the May invoice" });

    const posted = await postJournal(fake.db, {
      businessId: "bizA",
      entryDate: may,
      description: "Late sale",
      lines: [
        { accountCode: "1000", debitCents: 2000 },
        { accountCode: "4000", creditCents: 2000 },
      ],
    });
    expect(posted.status).toBe("POSTED");
  });

  it("requires a written reason to reopen", async () => {
    await closePeriod(fake.db, { businessId: "bizA", fiscalYear: 2026, month: 5 });
    await expect(reopenPeriod(fake.db, { businessId: "bizA", fiscalYear: 2026, month: 5, reason: "fix" })).rejects.toMatchObject({
      code: "REASON_REQUIRED",
    });
  });
});
