/**
 * Prisma client singleton with offline fallback for E2B build verification.
 * In production (Vercel) `prisma generate` succeeds and the real client is used.
 * In offline E2B (binaries.prisma.sh blocked), we fall back to a no-op proxy
 * so that `next build` can complete. Dynamic routes handle DB errors gracefully
 * and are marked `force-dynamic` to avoid prerender-time DB access.
 */

import { allowStubPrismaClient } from "./prismaRuntime";
import { installInlineMediaPrismaWritePolicy } from "./media/prisma-write-policy";

declare global {
  // eslint-disable-next-line no-var
  var __prisma: any | undefined;
}

let prismaInstance: any;

function createFallbackPrisma(): any {
  // Reads return empty and writes refuse. A stub that invented successful writes would let the
  // ERP appear to save records that do not exist, so every mutating call fails loudly instead.
  const emptyModel = () => ({
    findUnique: async () => null,
    findUniqueOrThrow: async () => null,
    findFirst: async () => null,
    findMany: async () => [],
    count: async () => 0,
    aggregate: async () => ({}),
    groupBy: async () => [],
    create: async () => { throw new Error("DB not available (fallback)"); },
    createMany: async () => { throw new Error("DB not available (fallback)"); },
    update: async () => { throw new Error("DB not available (fallback)"); },
    updateMany: async () => { throw new Error("DB not available (fallback)"); },
    upsert: async () => { throw new Error("DB not available (fallback)"); },
    delete: async () => { throw new Error("DB not available (fallback)"); },
    deleteMany: async () => { throw new Error("DB not available (fallback)"); },
  });

  // Minimal stub that satisfies the Prisma API used in the app but returns empty data.
  // All methods return sensible defaults so build and unit tests pass without a DB.
  const stub = {
    $queryRaw: async () => [{ "?column?": 1 }],
    $disconnect: async () => {},
    user: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available (fallback)"); },
      upsert: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    business: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    businessMember: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
    },
    service: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      delete: async () => { throw new Error("DB not available"); },
    },
    offer: {
      findUnique: async () => null,
      upsert: async () => { throw new Error("DB not available"); },
      delete: async () => {},
    },
    analyticsEvent: {
      create: async () => ({ id: "mock" }),
      findMany: async () => [],
      groupBy: async () => [],
      count: async () => 0,
    },
    planConfig: {
      findMany: async () => [],
      findUnique: async () => null,
      findFirst: async () => null,
      upsert: async () => { throw new Error("DB not available"); },
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
    },
    // Read by app/admin/payments/wallet/page.tsx. Without an entry the offline build throws a
    // TypeError while rendering the admin wallet page instead of showing an empty history.
    paymentEvent: {
      findMany: async () => [],
      findUnique: async () => null,
      findFirst: async () => null,
      count: async () => 0,
      create: async () => { throw new Error("DB not available"); },
    },
    subscription: {
      findUnique: async () => null,
      findMany: async () => [],
      findFirst: async () => null,
      upsert: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    payment: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
      count: async () => 0,
      aggregate: async () => ({ _sum: { amount: 0 } }),
    },
    auditEvent: {
      create: async () => ({ id: "mock" }),
    },
    processedWebhook: {
      findUnique: async () => null,
      upsert: async () => ({ id: "mock" }),
      create: async () => ({ id: "mock" }),
    },
    pageTheme: {
      upsert: async () => ({ id: "mock" }),
      findMany: async () => [],
    },
    referral: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      updateMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    aIConfiguration: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
    },
    product: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      updateMany: async () => ({ count: 0 }),
      delete: async () => { throw new Error("DB not available"); },
      groupBy: async () => [],
      count: async () => 0,
    },
    productVariant: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      createMany: async () => ({ count: 0 }),
      update: async () => { throw new Error("DB not available"); },
      deleteMany: async () => ({ count: 0 }),
    },
    knowledgeDocument: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      delete: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    fAQ: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      delete: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    aIPackageEntitlement: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      updateMany: async () => ({ count: 0 }),
      upsert: async () => { throw new Error("DB not available"); },
    },
    cart: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
    },
    cartItem: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      deleteMany: async () => ({ count: 0 }),
    },
    order: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      updateMany: async () => ({ count: 0 }),
      count: async () => 0,
      aggregate: async () => ({ _sum: { totalKES: 0 } }),
    },
    orderItem: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
    },
    preOrder: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    merchantPaymentConfig: {
      findUnique: async () => null,
      findFirst: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
    },
    notification: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    notificationRecipient: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
    },
    unansweredQuestion: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    demandInsight: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    aIQualityEvent: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      deleteMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    booking: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      updateMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    businessExperience: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
    },
    experienceVersion: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
    },
    // Draft history (Undo/Redo): reads return empty, writes refuse — the same offline contract as
    // every other model, so `next build` still completes without a database.
    experienceDraftRevision: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      deleteMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    interactiveBusinessEntitlement: {
      findUnique: async () => null,
      findMany: async () => [],
      upsert: async () => { throw new Error("DB not available"); },
    },
    mediaAsset: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      delete: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    // ── Website Studio AI (additive): generation history + usage meter. Reads return empty,
    // writes refuse, so an offline `next build` behaves exactly like the other models. ──
    aiGeneration: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      delete: async () => { throw new Error("DB not available"); },
      deleteMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    // ── Business POS (additive product). Same offline contract as the models above: reads
    // return empty, writes refuse, so `next build` can complete without a database. ──
    posConfiguration: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      updateMany: async () => ({ count: 0 }),
      upsert: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    posConfigurationVersion: {
      findMany: async () => [],
      findFirst: async () => null,
      create: async () => { throw new Error("DB not available"); },
    },
    posSubscription: {
      findUnique: async () => null,
      findMany: async () => [],
      update: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
    },
    posEntitlement: {
      findUnique: async () => null,
      updateMany: async () => ({ count: 0 }),
      upsert: async () => { throw new Error("DB not available"); },
    },
    posTemplate: {
      findMany: async () => [],
      findFirst: async () => null,
      create: async () => { throw new Error("DB not available"); },
      delete: async () => { throw new Error("DB not available"); },
    },
    posBranch: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
    },
    posStaff: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    posProduct: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    posInventoryItem: {
      findMany: async () => [],
      findFirst: async () => null,
      upsert: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
    },
    posInventoryMovement: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      aggregate: async () => ({ _sum: { delta: 0 } }),
    },
    posCustomer: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    posCustomerAsset: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
    },
    posSupplier: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    posSale: {
      findMany: async () => [],
      findFirst: async () => null,
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
      aggregate: async () => ({ _sum: { totalKES: 0, paidKES: 0, balanceKES: 0 } }),
    },
    posSaleItem: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
    },
    // Per-business receipt sequence (§81): the row is bumped with an atomic increment in the
    // sale transaction, so the fallback answers the upsert shape without a database.
    posReceiptSequence: {
      // The row holds the number the next sale will take, so a business that has never sold
      // starts at 2 and its first sale takes number 1 (see `nextSaleSequence`).
      upsert: async ({ create }: any) => ({ ...(create ?? {}), nextValue: 2 }),
      findUnique: async () => null,
    },
    // Till replay guard (§27, §32): without a database nothing can be replayed, so the key is
    // never found and the claim is refused rather than silently swallowed.
    posIdempotencyRecord: {
      findFirst: async () => null,
      create: async () => { throw new Error("DB not available"); },
    },
    posPayment: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      aggregate: async () => ({ _sum: { amountKES: 0 } }),
    },
    posCreditEntry: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
    },
    posExpense: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    posPurchase: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
    },
    posPurchaseItem: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
    },
    posOrder: {
      findMany: async () => [],
      findUnique: async () => null,
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    posOrderItem: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
    },
    posOrderEvent: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
    },
    posPublicationResolution: {
      findMany: async () => [],
      findUnique: async () => null,
      upsert: async () => { throw new Error("DB not available"); },
      updateMany: async () => { throw new Error("DB not available"); },
    },
    posAuditEvent: {
      findMany: async () => [],
      create: async () => ({ id: "mock" }),
      count: async () => 0,
    },
    // ── JATA Autopilot (additive product). Reads return empty, writes refuse offline. ──
    autopilotSubscription: {
      findUnique: async () => null,
      findMany: async () => [],
      update: async () => { throw new Error("DB not available"); },
      updateMany: async () => ({ count: 0 }),
      upsert: async () => { throw new Error("DB not available"); },
    },
    autopilotEntitlement: {
      findUnique: async () => null,
      findMany: async () => [],
      updateMany: async () => ({ count: 0 }),
      upsert: async () => { throw new Error("DB not available"); },
    },
    autopilotConfiguration: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
    },
    autopilotUsageLedger: {
      findUnique: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      aggregate: async () => ({ _sum: { estimatedCostMinorKES: 0, unitsIn: 0, unitsOut: 0 } }),
      count: async () => 0,
    },
    autopilotCustomerProfile: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      upsert: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    autopilotConsentRecord: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      updateMany: async () => ({ count: 0 }),
      upsert: async () => { throw new Error("DB not available"); },
    },
    autopilotSession: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
    },
    autopilotMessage: {
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    autopilotIngestionRecord: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      count: async () => 0,
    },
    autopilotActionProposal: {
      findUnique: async () => null,
      findFirst: async () => null,
      findMany: async () => [],
      create: async () => { throw new Error("DB not available"); },
      update: async () => { throw new Error("DB not available"); },
      updateMany: async () => ({ count: 0 }),
      count: async () => 0,
    },
    autopilotAuditEvent: {
      findMany: async () => [],
      create: async () => ({ id: "mock" }),
      count: async () => 0,
    },
    // POS / ERP - PRO and messaging models (38). Same contract as the rest of the stub.
    erpConfiguration: emptyModel(),
    erpSubscription: emptyModel(),
    erpEntitlement: emptyModel(),
    erpSequence: emptyModel(),
    erpAuditEvent: emptyModel(),
    erpIdempotencyRecord: emptyModel(),
    erpAccount: emptyModel(),
    erpPeriod: emptyModel(),
    erpJournal: emptyModel(),
    erpJournalLine: emptyModel(),
    erpInvoice: emptyModel(),
    erpInvoiceLine: emptyModel(),
    erpPayment: emptyModel(),
    erpPaymentAllocation: emptyModel(),
    erpCreditNote: emptyModel(),
    erpExpense: emptyModel(),
    erpSupplierBill: emptyModel(),
    erpTaxRule: emptyModel(),
    erpComplianceProfile: emptyModel(),
    erpStoreOrder: emptyModel(),
    erpStoreOrderItem: emptyModel(),
    erpNotification: emptyModel(),
    erpAutomationRule: emptyModel(),
    erpAutomationRun: emptyModel(),
    erpKycDocument: emptyModel(),
    msgChannelConnection: emptyModel(),
    msgSenderId: emptyModel(),
    msgSenderIdEvent: emptyModel(),
    msgContact: emptyModel(),
    msgConsentRecord: emptyModel(),
    msgSuppression: emptyModel(),
    msgAudience: emptyModel(),
    msgTemplate: emptyModel(),
    msgCampaign: emptyModel(),
    msgCampaignRecipient: emptyModel(),
    msgMessageEvent: emptyModel(),
    msgWallet: emptyModel(),
    msgLedgerEntry: emptyModel(),
    $transaction: async () => {
      throw new Error("DB not available (fallback)");
    },
  };
  return stub;
}

function createRealPrisma(): any {
  const databaseUrl = process.env.DATABASE_URL;
  try {
    // eslint-disable-next-line
    const { PrismaClient } = require("@prisma/client");
    const client = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
    return installInlineMediaPrismaWritePolicy(client);
  } catch (e) {
    if (!allowStubPrismaClient(databaseUrl)) {
      console.error("[db] Prisma client unavailable while DATABASE_URL is configured. Refusing stub fallback.");
      throw e;
    }
    console.warn("PrismaClient not available (offline fallback active):", (e as Error).message);
    return createFallbackPrisma();
  }
}

if (globalThis.__prisma) {
  prismaInstance = installInlineMediaPrismaWritePolicy(globalThis.__prisma, {
    required: Boolean(process.env.DATABASE_URL),
  });
} else {
  prismaInstance = createRealPrisma();
  if (process.env.NODE_ENV !== "production") {
    globalThis.__prisma = prismaInstance;
  }
}

export const prisma = prismaInstance;
export default prisma;
