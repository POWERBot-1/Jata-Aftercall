/**
 * Shared fixtures for the POS / ERP - PRO suites.
 *
 * The seed is intentionally small: two tenants, one full chart of accounts for tenant A, the
 * reference tax rules, and a handful of messaging rows. Tests add the records they need, so a
 * failure points at the behaviour under test rather than at fixture sprawl.
 */
import { CHART_OF_ACCOUNTS } from "@/lib/erp/accounting";
import { DEFAULT_KENYA_TAX_RULES } from "@/lib/erp/tax";

export type Seed = Record<string, Record<string, any>[]>;

export function accountsFor(businessId: string, from = CHART_OF_ACCOUNTS): Record<string, any>[] {
  return from.map((account) => ({
    id: `acc_${businessId}_${account.code}`,
    businessId,
    code: account.code,
    name: account.name,
    type: account.type,
    systemKey: account.systemKey,
    parentCode: account.parentCode ?? null,
    isActive: true,
  }));
}

export function taxRulesFor(businessId: string): Record<string, any>[] {
  return DEFAULT_KENYA_TAX_RULES.map((rule) => ({
    id: `tax_${businessId}_${rule.key}`,
    businessId,
    key: rule.key,
    label: rule.label,
    rateBps: rule.rateBps,
    treatment: rule.treatment,
    inclusive: Boolean(rule.inclusive),
    effectiveFrom: new Date(rule.effectiveFrom),
    effectiveTo: rule.effectiveTo ? new Date(rule.effectiveTo) : null,
    sourceRef: rule.sourceRef ?? null,
    verified: Boolean(rule.verified),
  }));
}

export function erpSeed(): Seed {
  return {
    business: [
      { id: "bizA", ownerId: "userA", name: "Nyumbani Kitchen", slug: "nyumbani", phone: "0712000000", location: "Nairobi" },
      { id: "bizB", ownerId: "userB", name: "Mwangi Hardware", slug: "mwangi", phone: "0723000000", location: "Kisumu" },
    ],
    businessMember: [{ id: "mem_a", businessId: "bizA", userId: "cashierA", role: "MANAGER" }],
    user: [
      { id: "userA", name: "Owner A", email: "a@example.com", phone: "0712000000" },
      { id: "userB", name: "Owner B", email: "b@example.com", phone: "0723000000" },
      { id: "cashierA", name: "Mary Manager", email: "mary@example.com", phone: "0712999999" },
    ],
    erpConfiguration: [
      {
        id: "cfg_a",
        businessId: "bizA",
        industryPackKey: "retail",
        countryCode: "KE",
        currencyCode: "KES",
        timeZone: "Africa/Nairobi",
        featureFlagsJson: JSON.stringify({}),
        onboardingJson: null,
        storefrontEnabled: false,
        storefrontSlug: "nyumbani-shop",
        storefrontJson: null,
      },
      {
        id: "cfg_b",
        businessId: "bizB",
        industryPackKey: "retail",
        countryCode: "KE",
        currencyCode: "KES",
        timeZone: "Africa/Nairobi",
        featureFlagsJson: JSON.stringify({}),
        onboardingJson: null,
        storefrontEnabled: false,
        storefrontSlug: "mwangi-shop",
        storefrontJson: null,
      },
    ],
    erpAccount: [...accountsFor("bizA"), ...accountsFor("bizB")],
    erpTaxRule: [...taxRulesFor("bizA"), ...taxRulesFor("bizB")],
    posProduct: [
      { id: "p_a1", businessId: "bizA", name: "Chapati", kind: "PRODUCT", priceKES: 50, basePriceKES: 50, costKES: 20, trackInventory: true, isActive: true, unitKey: "piece", sortOrder: 0, taxable: true, description: "Fresh from the grill" },
      { id: "p_a2", businessId: "bizA", name: "Pilau", kind: "PRODUCT", priceKES: 250, basePriceKES: 250, costKES: 120, trackInventory: true, isActive: true, unitKey: "plate", sortOrder: 1, taxable: true },
      { id: "p_b1", businessId: "bizB", name: "Cement", kind: "PRODUCT", priceKES: 900, basePriceKES: 900, costKES: 700, trackInventory: true, isActive: true, unitKey: "bag", sortOrder: 0 },
    ],
    posInventoryItem: [
      { id: "inv_a1", businessId: "bizA", productId: "p_a1", branchId: "", quantity: 40, reorderLevel: 5 },
      { id: "inv_a2", businessId: "bizA", productId: "p_a2", branchId: "", quantity: 6, reorderLevel: 2 },
    ],
    msgContact: [
      {
        id: "ct_a1",
        businessId: "bizA",
        name: "Jane Wanjiku",
        phoneNormalized: "254712111111",
        phoneRaw: "0712 111 111",
        email: null,
        status: "ACTIVE",
        tagsJson: JSON.stringify(["vip"]),
        source: "POS_CUSTOMER",
        marketingConsent: true,
        transactionalConsent: true,
      },
      {
        id: "ct_a2",
        businessId: "bizA",
        name: "Tom Otieno",
        phoneNormalized: "254733222222",
        phoneRaw: "0733 222 222",
        email: null,
        status: "ACTIVE",
        tagsJson: JSON.stringify([]),
        source: "IMPORT",
        marketingConsent: false,
        transactionalConsent: true,
      },
      {
        id: "ct_b1",
        businessId: "bizB",
        name: "Peter Mwangi",
        phoneNormalized: "254722333333",
        phoneRaw: "0722 333 333",
        email: null,
        status: "ACTIVE",
        tagsJson: JSON.stringify([]),
        source: "IMPORT",
        marketingConsent: true,
        transactionalConsent: true,
      },
    ],
    msgConsentRecord: [
      { id: "cons_a1m", businessId: "bizA", contactId: "ct_a1", channel: "SMS", purpose: "MARKETING", granted: true, source: "WEB_FORM", wordingVersion: "2026-01", capturedAt: new Date("2026-09-01T09:00:00Z") },
      { id: "cons_a1t", businessId: "bizA", contactId: "ct_a1", channel: "SMS", purpose: "TRANSACTIONAL", granted: true, source: "TILL", wordingVersion: "2026-01", capturedAt: new Date("2026-09-01T09:00:00Z") },
      { id: "cons_a2t", businessId: "bizA", contactId: "ct_a2", channel: "SMS", purpose: "TRANSACTIONAL", granted: true, source: "TILL", wordingVersion: "2026-01", capturedAt: new Date("2026-09-02T09:00:00Z") },
      { id: "cons_b1m", businessId: "bizB", contactId: "ct_b1", channel: "SMS", purpose: "MARKETING", granted: true, source: "WEB_FORM", wordingVersion: "2026-01", capturedAt: new Date("2026-09-03T09:00:00Z") },
    ],
    msgSuppression: [],
    msgWallet: [{ id: "w_a", businessId: "bizA", balanceCents: 100_000, reservedCents: 0, currency: "KES" }],
    msgSenderId: [
      {
        id: "snd_a1",
        businessId: "bizA",
        requestedId: "NYUMBANI",
        channel: "SMS",
        status: "ACTIVE",
        replyCapable: false,
        provider: "mock",
        submittedAt: new Date("2026-10-01T09:00:00Z"),
        activatedAt: new Date("2026-10-03T09:00:00Z"),
      },
      {
        id: "snd_a2",
        businessId: "bizA",
        requestedId: "NYUMBANIWA",
        channel: "SMS",
        status: "SUBMITTED",
        replyCapable: false,
        provider: "mock",
        submittedAt: new Date("2026-10-20T09:00:00Z"),
      },
    ],
    msgChannelConnection: [
      { id: "chan_a1", businessId: "bizA", channel: "SMS", provider: "mock", status: "ACTIVE", configJson: null, lastCheckedAt: new Date("2026-10-26T09:00:00Z") },
      { id: "chan_a2", businessId: "bizA", channel: "WHATSAPP", provider: "mock", status: "NOT_CONNECTED", configJson: null, lastCheckedAt: null },
    ],
    msgTemplate: [
      {
        id: "tpl_a1",
        businessId: "bizA",
        key: "invoice_due",
        name: "Invoice reminder",
        channel: "SMS",
        category: "TRANSACTIONAL",
        body: "Hi {{first_name}}, invoice {{invoice_number}} for {{amount}} is due on {{due_date}}. — {{business}}",
        variablesJson: JSON.stringify(["first_name", "invoice_number", "amount", "due_date", "business"]),
        version: 1,
        status: "ACTIVE",
      },
    ],
    erpInvoice: [],
    erpInvoiceLine: [],
    erpPayment: [],
    erpPaymentAllocation: [],
    erpJournal: [],
    erpJournalLine: [],
    erpPeriod: [],
    erpSequence: [],
    erpIdempotencyRecord: [],
    erpAuditEvent: [],
    erpStoreOrder: [],
    erpStoreOrderItem: [],
    erpAutomationRule: [],
    erpAutomationRun: [],
    msgCampaign: [],
    msgCampaignRecipient: [],
    msgMessageEvent: [],
    msgLedgerEntry: [],
  };
}
