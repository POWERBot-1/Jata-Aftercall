/**
 * POS / ERP - PRO against a real PostgreSQL database.
 *
 * Everything here runs the production code paths — bootstrap, access control, storefront orders,
 * double-entry accounting, invoicing, wallet and eTIMS state — against a migrated PostgreSQL
 * database, not the in-memory double. The in-memory double has no unique indexes, no row locks and
 * no real rollback, so it cannot demonstrate tenant isolation, duplicate prevention or that a
 * journal is immutable once posted.
 *
 * Environment:
 *   PRISMA_TEST_DATABASE_URL  an isolated, migrated PostgreSQL database (never production)
 *   PRISMA_WASM_HARNESS_DIR   optional: use the WASM query engine + @prisma/adapter-pg when the
 *                             native engine binary cannot be downloaded (see scripts/erp)
 * With neither variable the suite is skipped, exactly like the other `*-postgres` suites.
 *
 * The `@/lib/db` module is replaced with this suite's own client so that modules which read the
 * singleton (the access layer, audit log) hit the same real database as the injected ones.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ client: null as any }));

vi.mock("@/lib/db", () => ({
  get default() {
    return holder.client;
  },
  get prisma() {
    return holder.client;
  },
}));

import {
  bootstrapErpWorkspace,
  BOOTSTRAP_ACCOUNT_COUNT,
} from "@/lib/erp/bootstrap";
import { DEFAULT_KENYA_TAX_RULES } from "@/lib/erp/tax";
import { requireErpAccess, resolveErpRole, ERP_APPROVAL_LIMITS_CENTS } from "@/lib/erp/access";
import { setTeamRole } from "@/lib/erp/team";
import {
  placeStoreOrder,
  confirmStoreOrder,
  advanceStoreOrder,
  parseStorefrontSettings,
  orderTransitions,
  ORDER_STATUS_LABELS,
  publicProductRef,
} from "@/lib/erp/storefront";
import { balanceSheet, postJournal, closePeriod, reopenPeriod, reverseJournal, trialBalance } from "@/lib/erp/accounting";
import { createInvoice, issueInvoice, recordPayment } from "@/lib/erp/invoicing";
import { recordExpense } from "@/lib/erp/expenses";
import { creditWallet, reserveFunds, walletSummary } from "@/lib/messaging/billing";
import { commitImport, validateImportRows } from "@/lib/messaging/import";
import { submitInvoiceToEtims, etimsSubmissionPosture } from "@/lib/erp/etims";
import { makeRealPrisma, realPrismaConfigured } from "../helpers/prisma-client";

const enabled = realPrismaConfigured;
const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

let client: any;
const ids = {
  owner: "",
  manager: "",
  staff: "",
  outsider: "",
  business: "",
  otherBusiness: "",
};

const ownerSession = () => ({ userId: ids.owner, email: `erp-owner-${stamp}@example.test`, role: "OWNER", name: "ERP Owner" });
const staffSession = () => ({ userId: ids.staff, email: `erp-staff-${stamp}@example.test`, role: "CUSTOMER", name: "ERP Staff" });
const outsiderSession = () => ({ userId: ids.outsider, email: `erp-out-${stamp}@example.test`, role: "CUSTOMER", name: "Outsider" });

async function makeUser(label: string) {
  return client.user.create({
    data: { email: `erp-${label}-${stamp}@example.test`, name: `ERP ${label}`, passwordHash: "not-a-real-login" },
  });
}

async function freshBusiness(ownerId: string, label: string) {
  return client.business.create({
    data: { ownerId, slug: `erp-${label}-${stamp}`, name: `ERP ${label}`, category: "retail" },
  });
}

describe.skipIf(!enabled)("POS / ERP - PRO against real PostgreSQL", () => {
  beforeAll(async () => {
    client = makeRealPrisma();
    holder.client = client;

    const owner = await makeUser("owner");
    const manager = await makeUser("manager");
    const staff = await makeUser("staff");
    const outsider = await makeUser("outsider");
    ids.owner = owner.id;
    ids.manager = manager.id;
    ids.staff = staff.id;
    ids.outsider = outsider.id;

    const business = await freshBusiness(owner.id, "main");
    const otherBusiness = await freshBusiness(outsider.id, "other");
    ids.business = business.id;
    ids.otherBusiness = otherBusiness.id;

    await client.businessMember.createMany({
      data: [
        { userId: manager.id, businessId: business.id, role: "MANAGER" },
        { userId: staff.id, businessId: business.id, role: "STAFF" },
      ],
    });

    await bootstrapErpWorkspace(client, {
      businessId: business.id,
      actorId: owner.id,
      actorName: "ERP Owner",
      industryPackKey: "retail",
      storefrontSlug: `nyumbani-${stamp}`,
    });

    // A shop that is open around the clock, so the suite does not depend on the wall clock.
    const config = await client.erpConfiguration.findUnique({ where: { businessId: business.id } });
    await client.erpConfiguration.update({
      where: { id: config.id },
      data: {
        storefrontJson: JSON.stringify({
          ...parseStorefrontSettings(config.storefrontJson),
          enabled: true,
          openHour: 0,
          closeHour: 24,
          minimumOrderCents: 0,
        }),
      },
    });

    const product = await client.posProduct.create({
      data: {
        businessId: business.id,
        name: "Unga wa Sembe 2kg",
        priceKES: 250,
        taxable: true,
        trackInventory: true,
      },
    });
    await client.posInventoryItem.create({ data: { businessId: business.id, productId: product.id, quantity: 10 } });
  }, 60_000);

  afterAll(async () => {
    if (!client) return;
    try {
      await client.business.deleteMany({ where: { id: { in: [ids.business, ids.otherBusiness].filter(Boolean) } } });
      await client.user.deleteMany({ where: { id: { in: Object.values(ids).filter((value) => value && value.startsWith("c") && value.length > 20) } } });
    } finally {
      await client.$disconnect().catch(() => {});
    }
  }, 60_000);

  it("persists the onboarding workspace: configuration, chart of accounts, tax rules and wallet", async () => {
    const [config, accounts, taxRules, wallet] = await Promise.all([
      client.erpConfiguration.findUnique({ where: { businessId: ids.business } }),
      client.erpAccount.count({ where: { businessId: ids.business } }),
      client.erpTaxRule.count({ where: { businessId: ids.business } }),
      client.msgWallet.findUnique({ where: { businessId: ids.business } }),
    ]);
    expect(config).not.toBeNull();
    expect(config.storefrontSlug).toContain("nyumbani-");
    expect(accounts).toBe(BOOTSTRAP_ACCOUNT_COUNT);
    expect(taxRules).toBe(DEFAULT_KENYA_TAX_RULES.length);
    expect(wallet?.currencyCode).toBe("KES");
    expect(Number(wallet?.balanceCents)).toBe(0);
  });

  it("bootstraps once: a second call keeps one configuration and the same chart of accounts", async () => {
    const before = await client.erpAccount.count({ where: { businessId: ids.business } });
    const again = await bootstrapErpWorkspace(client, { businessId: ids.business, actorId: ids.owner });
    const configs = await client.erpConfiguration.count({ where: { businessId: ids.business } });
    const after = await client.erpAccount.count({ where: { businessId: ids.business } });
    expect(configs).toBe(1);
    expect(after).toBe(before);
    expect(again.configuration.storefrontSlug).toContain("nyumbani-");
  });

  it("enforces ERP roles from the database: staff cannot post journals, the owner can", async () => {
    await expect(requireErpAccess(ids.business, staffSession(), { permission: "POST_JOURNAL" })).rejects.toMatchObject({
      status: 403,
      code: "PERMISSION",
    });
    const context = await requireErpAccess(ids.business, ownerSession(), { permission: "POST_JOURNAL" });
    expect(context.role).toBe("OWNER");
    expect(context.business.id).toBe(ids.business);
    await expect(requireErpAccess(ids.business, null)).rejects.toMatchObject({ status: 401 });
  });

  it("persists a team role override that the access layer reads back", async () => {
    const before = await requireErpAccess(ids.business, staffSession(), { fast: true });
    expect(before.role).toBe("STAFF");

    await setTeamRole(client, {
      businessId: ids.business,
      actorId: ids.owner,
      actorName: "ERP Owner",
      actorRole: "OWNER",
      targetUserId: ids.staff,
      role: "FINANCE",
      ownerId: ids.owner,
    });

    const config = await client.erpConfiguration.findUnique({ where: { businessId: ids.business } });
    const stored = JSON.parse(config.teamRolesJson || "{}");
    expect(stored[ids.staff]).toBe("FINANCE");

    const after = await requireErpAccess(ids.business, staffSession(), { permission: "POST_JOURNAL" });
    expect(after.role).toBe("FINANCE");
    expect(resolveErpRole({ ownerId: ids.owner, userId: ids.staff, membershipRole: "STAFF", teamRolesJson: config.teamRolesJson })).toBe("FINANCE");

    // Restore STAFF so later tests keep their meaning.
    await client.erpConfiguration.update({ where: { id: config.id }, data: { teamRolesJson: "{}" } });
    expect(ERP_APPROVAL_LIMITS_CENTS.STAFF).toBe(0);
  });

  it("keeps tenants apart: a foreign owner sees 404, not another tenant's rows", async () => {
    await expect(requireErpAccess(ids.business, outsiderSession())).rejects.toMatchObject({ status: 403 });
    const order = await placeStoreOrder(client, {
      slug: (await client.erpConfiguration.findUnique({ where: { businessId: ids.business } })).storefrontSlug,
      customerName: "Amina Wanjiku",
      customerPhone: "0712111222",
      fulfilment: "PICKUP",
      items: [{ ref: publicProductRef(ids.business, (await client.posProduct.findFirst({ where: { businessId: ids.business } })).id), quantity: 1 }],
    });
    await expect(
      confirmStoreOrder(client, { businessId: ids.otherBusiness, orderId: order.order.id, actorId: ids.outsider }),
    ).rejects.toMatchObject({ status: 404 });
    expect(await client.erpStoreOrder.count({ where: { businessId: ids.otherBusiness } })).toBe(0);
  });

  it("places a store order, confirms it once, and moves stock only on confirmation", async () => {
    const config = await client.erpConfiguration.findUnique({ where: { businessId: ids.business } });
    const product = await client.posProduct.findFirst({ where: { businessId: ids.business } });
    const placed = await placeStoreOrder(client, {
      slug: config.storefrontSlug,
      customerName: "Brian Otieno",
      customerPhone: "0722333444",
      fulfilment: "PICKUP",
      items: [{ ref: publicProductRef(ids.business, product.id), quantity: 2 }],
      idempotencyKey: `order-${stamp}-1`,
    });
    expect(placed.replayed).toBe(false);
    expect(placed.order.status).toBe("PENDING");
    expect(Number(placed.order.subtotalCents)).toBe(50_000);
    expect(Number(placed.order.taxCents)).toBe(6_897); // 16% VAT extracted from an inclusive price
    expect(placed.items).toHaveLength(1);

    const stockBefore = await client.posInventoryItem.findFirst({ where: { businessId: ids.business, productId: product.id } });
    expect(Number(stockBefore.quantity)).toBe(10);

    const confirmed = await confirmStoreOrder(client, { businessId: ids.business, orderId: placed.order.id, actorId: ids.owner });
    const stockAfter = await client.posInventoryItem.findFirst({ where: { businessId: ids.business, productId: product.id } });
    expect(confirmed.order.status).toBe("CONFIRMED");
    expect(confirmed.alreadyConfirmed).toBe(false);
    expect(Number(stockAfter.quantity)).toBe(8);
    expect(await client.posInventoryMovement.count({ where: { businessId: ids.business, productId: product.id } })).toBeGreaterThan(0);

    // Confirming twice must not deduct twice.
    const replay = await confirmStoreOrder(client, { businessId: ids.business, orderId: placed.order.id, actorId: ids.owner });
    expect(replay.alreadyConfirmed).toBe(true);
    const stockAgain = await client.posInventoryItem.findFirst({ where: { businessId: ids.business, productId: product.id } });
    expect(Number(stockAgain.quantity)).toBe(8);
  });

  it("walks the order state machine and refuses a transition out of a terminal state", async () => {
    const order = await client.erpStoreOrder.findFirst({ where: { businessId: ids.business, status: "CONFIRMED" } });
    const ready = await advanceStoreOrder(client, { businessId: ids.business, orderId: order.id, status: "READY", actorId: ids.owner });
    const fulfilled = await advanceStoreOrder(client, { businessId: ids.business, orderId: order.id, status: "FULFILLED", actorId: ids.owner });
    expect(ready.status).toBe("READY");
    expect(fulfilled.status).toBe("FULFILLED");
    await expect(
      advanceStoreOrder(client, { businessId: ids.business, orderId: order.id, status: "CANCELLED", actorId: ids.owner }),
    ).rejects.toMatchObject({ status: 409, code: "INVALID_TRANSITION" });
    expect(orderTransitions("FULFILLED")).toEqual([]);
    expect(ORDER_STATUS_LABELS.FULFILLED).toBe("Fulfilled");
  });

  it("replays a duplicate order instead of creating a second one", async () => {
    const config = await client.erpConfiguration.findUnique({ where: { businessId: ids.business } });
    const product = await client.posProduct.findFirst({ where: { businessId: ids.business } });
    const key = `order-${stamp}-dup`;
    const first = await placeStoreOrder(client, {
      slug: config.storefrontSlug,
      customerName: "Cynthia Njeri",
      customerPhone: "0733444555",
      fulfilment: "PICKUP",
      items: [{ ref: publicProductRef(ids.business, product.id), quantity: 1 }],
      idempotencyKey: key,
    });
    const second = await placeStoreOrder(client, {
      slug: config.storefrontSlug,
      customerName: "Cynthia Njeri",
      customerPhone: "0733444555",
      fulfilment: "PICKUP",
      items: [{ ref: publicProductRef(ids.business, product.id), quantity: 1 }],
      idempotencyKey: key,
    });
    expect(second.replayed).toBe(true);
    expect(second.order.id).toBe(first.order.id);
    expect(await client.erpStoreOrder.count({ where: { businessId: ids.business, idempotencyKey: key } })).toBe(1);
  });

  it("refuses an unbalanced journal and posts a balanced one with one journal number", async () => {
    await expect(
      postJournal(client, {
        businessId: ids.business,
        actorId: ids.owner,
        entryDate: new Date(),
        description: "Unbalanced probe",
        lines: [
          { accountCode: "1000", debitCents: 10_000 },
          { accountCode: "4000", creditCents: 9_000 },
        ],
      }),
    ).rejects.toMatchObject({ status: 400 });

    const posted = await postJournal(client, {
      businessId: ids.business,
      actorId: ids.owner,
      entryDate: new Date(),
      description: "Owner capital injection",
      lines: [
        { accountCode: "1000", debitCents: 100_000 },
        { accountCode: "3000", creditCents: 100_000 },
      ],
    });
    expect(posted.journalNumber).toMatch(/^JV-\d{6}$/);
    const lines = await client.erpJournalLine.findMany({ where: { journalId: posted.id } });
    expect(lines).toHaveLength(2);
    expect(lines.reduce((total: number, line: any) => total + Number(line.debitCents), 0)).toBe(
      lines.reduce((total: number, line: any) => total + Number(line.creditCents), 0),
    );
    const report = await trialBalance(client, ids.business);
    expect(report.balanced).toBe(true);
  });

  it("closes a period, refuses new entries in it, and allows them again after reopening", async () => {
    const now = new Date();
    await closePeriod(client, { businessId: ids.business, fiscalYear: now.getUTCFullYear(), month: now.getUTCMonth() + 1, actorId: ids.owner });
    await expect(
      postJournal(client, {
        businessId: ids.business,
        entryDate: now,
        description: "Should not post into a closed month",
        lines: [
          { accountCode: "1000", debitCents: 1_000 },
          { accountCode: "3000", creditCents: 1_000 },
        ],
      }),
    ).rejects.toMatchObject({ status: 409, code: "PERIOD_CLOSED" });

    await reopenPeriod(client, {
      businessId: ids.business,
      fiscalYear: now.getUTCFullYear(),
      month: now.getUTCMonth() + 1,
      actorId: ids.owner,
      reason: "Integration test needs an open period",
    });
    const posted = await postJournal(client, {
      businessId: ids.business,
      entryDate: now,
      description: "Posted after the period reopened",
      lines: [
        { accountCode: "1000", debitCents: 2_000 },
        { accountCode: "3000", creditCents: 2_000 },
      ],
    });
    expect(posted.status).toBe("POSTED");
  });

  it("reverses a posted journal instead of editing it, and refuses to reverse twice", async () => {
    const journal = await client.erpJournal.findFirst({ where: { businessId: ids.business, status: "POSTED" }, orderBy: { createdAt: "asc" } });
    const reversal = await reverseJournal(client, {
      businessId: ids.business,
      journalId: journal.id,
      actorId: ids.owner,
      reason: "Entered twice",
    });
    expect(reversal.journalNumber).toMatch(/^RJV-/);
    const original = await client.erpJournal.findUnique({ where: { id: journal.id } });
    expect(original.reversedById).toBe(reversal.id);
    // A posted journal is never edited or deleted; the reversal is a second posted entry.
    expect(original.status).toBe("POSTED");
    await expect(
      reverseJournal(client, { businessId: ids.business, journalId: journal.id, actorId: ids.owner, reason: "Again" }),
    ).rejects.toBeTruthy();
  });

  it("issues an invoice, posts its ledger entry once and settles it with a payment", async () => {
    const created = await createInvoice(client, {
      businessId: ids.business,
      actorId: ids.owner,
      customerName: "Kamau Supplies",
      lines: [{ description: "Consulting", quantity: 1, unitAmountCents: 20_000, taxKey: "VAT_STANDARD" }],
      idempotencyKey: `invoice-${stamp}`,
    });
    expect(created.invoice.invoiceNumber).toMatch(/^INV-\d{6}$/);
    expect(Number(created.invoice.totalCents)).toBe(23_200);

    const duplicate = await createInvoice(client, {
      businessId: ids.business,
      customerName: "Kamau Supplies",
      lines: [{ description: "Consulting", quantity: 1, unitAmountCents: 20_000, taxKey: "VAT_STANDARD" }],
      idempotencyKey: `invoice-${stamp}`,
    });
    expect(duplicate.idempotent).toBe(true);
    expect(duplicate.invoice.id).toBe(created.invoice.id);

    const issued = await issueInvoice(client, { businessId: ids.business, invoiceId: created.invoice.id, actorId: ids.owner });
    expect(issued.invoice.journalId).toBeTruthy();
    const journal = await client.erpJournal.findUnique({ where: { id: issued.invoice.journalId } });
    expect(journal.journalNumber).toMatch(/^JV-\d{6}$/);

    const payment = await recordPayment(client, {
      businessId: ids.business,
      actorId: ids.owner,
      invoiceId: created.invoice.id,
      amountCents: 23_200,
      method: "MPESA",
      reference: `MPESA-${stamp}`,
      idempotencyKey: `payment-${stamp}`,
    });
    expect(payment.payment.amountCents).toBe(23_200);
    const settled = await client.erpInvoice.findUnique({ where: { id: created.invoice.id } });
    expect(settled.status).toBe("PAID");
    expect(Number(settled.balanceCents)).toBe(0);
  });

  it("lets the database reject a duplicate invoice number inside one tenant", async () => {
    const invoice = await client.erpInvoice.findFirst({ where: { businessId: ids.business } });
    await expect(
      client.erpInvoice.create({
        data: {
          businessId: ids.business,
          invoiceNumber: invoice.invoiceNumber,
          status: "DRAFT",
          customerName: "Duplicate probe",
          issuedAt: new Date(),
          dueAt: new Date(),
          subtotalCents: 0,
          taxCents: 0,
          totalCents: 0,
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });

  it("posts an expense once: balanced journal, stored row, and a replay that writes nothing", async () => {
    const requestKey = `expense-${stamp}`;
    const expense = {
      businessId: ids.business,
      category: "Utilities",
      accountCode: "5300",
      paidFromCode: "1000",
      description: "KPLC token",
      amountCents: 116_000,
      taxCents: 16_000,
      method: "mpesa",
      occurredAt: new Date("2026-03-04T09:00:00.000Z"),
      requestKey,
      actorId: ids.owner,
      actorName: "ERP Owner",
    };

    const first = await recordExpense(client, expense);
    expect(first.replayed).toBe(false);
    expect(first.expense.status).toBe("POSTED");
    expect(first.expense.amountCents).toBe(116_000);
    expect(first.expense.taxCents).toBe(16_000);
    expect(first.expense.journalId).toBe(first.journal!.id);

    // Net 100,000 to utilities, 16,000 recoverable VAT, 116,000 out of cash.
    expect(first.journal!.totalDebitCents).toBe(116_000);
    expect(first.journal!.totalCreditCents).toBe(116_000);
    const lines = await client.erpJournalLine.findMany({ where: { journalId: first.journal!.id } });
    const at = (code: string) => lines.find((line: any) => line.accountCode === code);
    expect(at("5300")).toMatchObject({ debitCents: 100_000, creditCents: 0 });
    expect(at("1150")).toMatchObject({ debitCents: 16_000, creditCents: 0 });
    expect(at("1000")).toMatchObject({ debitCents: 0, creditCents: 116_000 });

    // The same submission key must not post a second journal or a second expense.
    const replay = await recordExpense(client, expense);
    expect(replay.replayed).toBe(true);
    expect(replay.journal).toBeNull();
    expect(replay.expense.id).toBe(first.expense.id);

    const expenses = await client.erpExpense.findMany({ where: { businessId: ids.business } });
    expect(expenses.filter((row: any) => row.description === "KPLC token")).toHaveLength(1);
    const journals = await client.erpJournal.findMany({ where: { businessId: ids.business, description: "Expense: KPLC token" } });
    expect(journals).toHaveLength(1);
  });

  it("refuses an expense whose VAT exceeds the total, before writing anything", async () => {
    const before = await client.erpExpense.count({ where: { businessId: ids.business } });
    await expect(
      recordExpense(client, {
        businessId: ids.business,
        category: "Utilities",
        accountCode: "5300",
        paidFromCode: "1000",
        description: "Impossible VAT",
        amountCents: 10_000,
        taxCents: 20_000,
        occurredAt: new Date("2026-03-04T09:00:00.000Z"),
        requestKey: `expense-bad-${stamp}`,
        actorId: ids.owner,
      }),
    ).rejects.toThrow(/VAT cannot be more than the total/i);
    expect(await client.erpExpense.count({ where: { businessId: ids.business } })).toBe(before);
  });

  it("reports a balance sheet that reconciles, and moves by exactly the amount posted", async () => {
    const before = await balanceSheet(client, ids.business);
    expect(before.balanced).toBe(true);
    expect(before.totalAssetsCents).toBe(before.totalLiabilitiesCents + before.totalEquityCents + before.netIncomeCents);

    // Utilities paid from cash: assets down 50,000, expenses up 50,000, everything else unchanged.
    await recordExpense(client, {
      businessId: ids.business,
      category: "Utilities",
      accountCode: "5700",
      paidFromCode: "1000",
      description: "Water bill",
      amountCents: 50_000,
      taxCents: 0,
      occurredAt: new Date("2026-03-05T09:00:00.000Z"),
      requestKey: `expense-sheet-${stamp}`,
      actorId: ids.owner,
      actorName: "ERP Owner",
    });

    const after = await balanceSheet(client, ids.business);
    expect(after.balanced).toBe(true);
    expect(after.totalAssetsCents).toBe(before.totalAssetsCents - 50_000);
    expect(after.netIncomeCents).toBe(before.netIncomeCents - 50_000);
    expect(after.totalAssetsCents).toBe(after.totalLiabilitiesCents + after.totalEquityCents + after.netIncomeCents);
  });

  it("credits the messaging wallet exactly once per idempotency key and refuses to overspend", async () => {
    const first = await creditWallet(client, {
      businessId: ids.business,
      amountCents: 50_000,
      idempotencyKey: `topup-${stamp}`,
      reference: `MPESA-TOPUP-${stamp}`,
    });
    const replay = await creditWallet(client, {
      businessId: ids.business,
      amountCents: 50_000,
      idempotencyKey: `topup-${stamp}`,
      reference: `MPESA-TOPUP-${stamp}`,
    });
    expect(replay.idempotent).toBe(true);
    expect(Number(first.wallet.balanceCents)).toBe(50_000);
    expect(await client.msgLedgerEntry.count({ where: { businessId: ids.business, idempotencyKey: `topup-${stamp}` } })).toBe(1);

    const summary = await walletSummary(client, ids.business);
    expect(summary.availableCents).toBe(50_000);

    await expect(
      creditWallet(client, { businessId: ids.business, amountCents: -100, idempotencyKey: `bad-${stamp}`, reference: "MPESA-BAD" }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(
      reserveFunds(client, { businessId: ids.business, amountCents: 90_000, campaignId: `campaign-${stamp}`, idempotencyKey: `reserve-${stamp}` }),
    ).rejects.toBeTruthy();
  });

  it("imports contacts once: a second import of the same file skips the existing rows", async () => {
    const preview = validateImportRows({
      headers: ["Name", "Phone"],
      rows: [
        ["Alice Wambui", "0712000111"],
        ["Peter Mwangi", "0712000222"],
      ],
      mapping: { name: 0, phone: 1 },
      existingPhones: [],
    });
    const first = await commitImport(client, { businessId: ids.business, preview, actorId: ids.owner });
    expect(first.imported).toBe(2);

    const second = await commitImport(client, { businessId: ids.business, preview, actorId: ids.owner });
    expect(second.imported).toBe(0);
    expect(second.skipped).toBe(2);
    expect(await client.msgContact.count({ where: { businessId: ids.business, phoneNormalized: { in: ["254712000111", "254712000222"] } } })).toBe(2);
  });

  it("records an eTIMS timeout as UNCERTAIN, persists it, and never as accepted", async () => {
    const payload = {
      invoiceId: `etims-${stamp}`,
      invoiceNumber: "INV-000777",
      businessId: ids.business,
      issuedAt: new Date(),
      currencyCode: "KES",
      customerName: "Kamau Supplies",
      lines: [
        { description: "Consulting", quantity: 1, unitAmountCents: 20_000, lineTotalCents: 23_200, taxTypeCode: "B", taxRateBps: 1_600 },
      ],
      subtotalCents: 20_000,
      taxCents: 3_200,
      totalCents: 23_200,
    };
    const timeoutAdapter = {
      key: "timeout-probe",
      label: "Timeout probe",
      certified: true,
      configured: true,
      submit: async () => {
        throw new Error("socket hang up");
      },
      health: async () => ({ ok: true, state: "HEALTHY" as const, message: "ok" }),
    };

    const result = await submitInvoiceToEtims({ adapter: timeoutAdapter, payload });
    expect(result.status).toBe("UNCERTAIN");
    expect(result.controlNumber).toBeNull();

    const invoice = await client.erpInvoice.create({
      data: {
        businessId: ids.business,
        invoiceNumber: "INV-000777",
        status: "ISSUED",
        customerName: "Kamau Supplies",
        issuedAt: new Date(),
        dueAt: new Date(),
        subtotalCents: 20_000,
        taxCents: 3_200,
        totalCents: 23_200,
        etimsStatus: "UNCERTAIN",
      },
    });
    const reloaded = await client.erpInvoice.findUnique({ where: { id: invoice.id } });
    expect(reloaded.etimsStatus).toBe("UNCERTAIN");

    const claimingAcceptance = await submitInvoiceToEtims({
      adapter: {
        key: "unverified-probe",
        label: "Unverified probe",
        certified: true,
        configured: true,
        submit: async () => ({ outcome: "ACCEPTED", controlNumber: "", responseSource: "SELF_REPORTED", raw: {} }),
        health: async () => ({ ok: true, state: "HEALTHY" as const, message: "ok" }),
      },
      payload,
      currentStatus: "UNCERTAIN",
    });
    expect(claimingAcceptance.status).not.toBe("ACCEPTED");
    expect(etimsSubmissionPosture().canSubmit).toBe(false);
  });
});
