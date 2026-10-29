import prisma from "@/lib/db";
import { handleErpRequest } from "@/lib/erp/http";

export const dynamic = "force-dynamic";

/**
 * A complete, tenant-scoped JSON export.
 *
 * Personal data is included because it is the customer's own data; it is streamed as an attachment
 * and never emailed anywhere automatically. Audit events are included with secrets already redacted
 * when they were written.
 */
export async function GET(request: Request, context: { params: Promise<{ businessId: string }> }) {
  const { businessId } = await context.params;
  return handleErpRequest({
    businessId,
    request,
    permission: "EXPORT_DATA",
    rateLimit: { key: `erp-export:${businessId}`, max: 3, windowMs: 60_000 },
    fallback: "We couldn't build the export.",
    handler: async () => {
      const [configuration, contacts, consents, suppressions, campaigns, recipients, senders, templates, invoices, invoiceLines, payments, creditNotes, journals, journalLines, accounts, taxRules, expenses, orders, orderItems, rules, runs, auditEvents] = await Promise.all([
        prisma.erpConfiguration.findUnique({ where: { businessId } }),
        prisma.msgContact.findMany({ where: { businessId } }),
        prisma.msgConsentRecord.findMany({ where: { businessId } }),
        prisma.msgSuppression.findMany({ where: { businessId } }),
        prisma.msgCampaign.findMany({ where: { businessId } }),
        prisma.msgCampaignRecipient.findMany({ where: { businessId } }),
        prisma.msgSenderId.findMany({ where: { businessId } }),
        prisma.msgTemplate.findMany({ where: { businessId } }),
        prisma.erpInvoice.findMany({ where: { businessId } }),
        prisma.erpInvoiceLine.findMany({ where: { businessId } }),
        prisma.erpPayment.findMany({ where: { businessId } }),
        prisma.erpCreditNote.findMany({ where: { businessId } }),
        prisma.erpJournal.findMany({ where: { businessId } }),
        prisma.erpJournalLine.findMany({ where: { businessId } }),
        prisma.erpAccount.findMany({ where: { businessId } }),
        prisma.erpTaxRule.findMany({ where: { businessId } }),
        prisma.erpExpense.findMany({ where: { businessId } }),
        prisma.erpStoreOrder.findMany({ where: { businessId } }),
        prisma.erpStoreOrderItem.findMany({ where: { businessId } }),
        prisma.erpAutomationRule.findMany({ where: { businessId } }),
        prisma.erpAutomationRun.findMany({ where: { businessId } }),
        prisma.erpAuditEvent.findMany({ where: { businessId }, take: 2000, orderBy: { createdAt: "desc" } }),
      ]);

      const payload = {
        product: "JATA BOS PRO",
        businessId,
        exportedAt: new Date().toISOString(),
        schemaVersion: "2026-10-27",
        configuration,
        accounts,
        taxRules,
        journals,
        journalLines,
        invoices,
        invoiceLines,
        payments,
        creditNotes,
        expenses,
        contacts,
        consents,
        suppressions,
        campaigns,
        recipients,
        senders,
        templates,
        storeOrders: orders,
        storeOrderItems: orderItems,
        automationRules: rules,
        automationRuns: runs,
        auditEvents,
        notices: [
          "This export contains personal data. Store it securely and delete it when no longer needed.",
          "Financial records should be retained for the period your accountant advises.",
        ],
      };
      return {
        data: payload,
        headers: { "content-disposition": `attachment; filename="erp-export-${businessId.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json"` },
      };
    },
  });
}
