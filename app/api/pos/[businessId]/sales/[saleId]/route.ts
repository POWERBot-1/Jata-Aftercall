import { buildReceipt, receiptToText } from "@/lib/pos/receipt";
import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { refundSale } from "@/lib/pos/sales";
import { findSale } from "@/lib/pos/store";
import { bool, sanitizeRefundRequest } from "@/lib/pos/validation";

/**
 * One sale (§27, §32, §54).
 *
 * GET returns the sale with its receipt, resolved through the configuration so the words match
 * the business. POST records a refund or a void. Neither ever rewrites the original
 * transaction: money goes back as its own payment row and stock comes back as its own RETURN
 * movement, so the ledger still adds up months later.
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string; saleId: string }> };

export async function GET(_request: Request, context: RouteContext) {
  const { businessId, saleId } = await context.params;
  return handlePosRequest({
    businessId,
    options: { permission: "VIEW_SALES", fast: true },
    fallback: "We couldn't load that sale.",
    handler: async ({ ctx }) => {
      const sale = await findSale(businessId, saleId);
      if (!sale) return { status: 404, data: { error: "That sale was not found." } };
      const receipt = buildReceipt({
        config: ctx.configuration,
        business: {
          name: ctx.business.name,
          phone: ctx.business.phone,
          whatsapp: ctx.business.whatsapp,
          location: ctx.business.location,
          logoUrl: ctx.business.logoUrl,
        },
        sale: {
          receiptNumber: sale.receiptNumber,
          issuedAt: sale.createdAt,
          channel: sale.channel,
          cashierName: sale.staffName,
          customer: sale.customerName ? { name: sale.customerName } : null,
          lines: (sale.items ?? []).map((item: any) => ({
            name: item.name,
            quantity: item.quantity,
            unitKey: item.unitKey,
            unitPriceKES: item.unitPriceKES,
            discountKES: item.discountKES,
            taxKES: item.taxKES,
            totalKES: item.totalKES,
          })),
          subtotalKES: sale.subtotalKES,
          discountKES: sale.discountKES,
          taxKES: sale.taxKES,
          totalKES: sale.totalKES,
          payments: (sale.payments ?? []).map((payment: any) => ({
            method: payment.method,
            amountKES: payment.direction === "OUT" ? -payment.amountKES : payment.amountKES,
            reference: payment.reference,
          })),
          balanceKES: sale.balanceKES,
        },
      });
      return posOk({ sale, receipt, receiptText: receiptToText(receipt) });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId, saleId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    // A refund or a void is a live-money action (§44) and needs the matching permission (§36).
    options: { requireLive: true },
    fallback: "We couldn't refund that sale.",
    handler: async ({ ctx, actor, body }) => {
      const voiding = bool(body, "void");
      const outcome = await refundSale({
        businessId,
        configuration: ctx.configuration,
        actor,
        action: voiding ? "POS_SALE_VOIDED" : "POS_SALE_REFUNDED",
        request: { ...sanitizeRefundRequest(body), saleId },
      });
      return fromOutcome(outcome, {
        refundedKES: outcome.refundedKES ?? 0,
        returnedToStock: outcome.returnedToStock ?? 0,
        voided: voiding,
      });
    },
  });
}
