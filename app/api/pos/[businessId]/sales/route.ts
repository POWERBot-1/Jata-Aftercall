import { fromOutcome, handlePosRequest, posOk, queryString, queryInt } from "@/lib/pos/http";
import { receiptToText } from "@/lib/pos/receipt";
import { createSale } from "@/lib/pos/sales";
import { listSales, paymentMix, salesTotals, topItems } from "@/lib/pos/store";
import { sanitizeRange, sanitizeSaleRequest } from "@/lib/pos/validation";
import { formatReceiptNumber, receiptPrefixFromBusinessName } from "@/lib/pos/receipt";

/**
 * Selling (§27, §31, §62).
 *
 * GET lists this business's sales — and only this business's sales: the tenant filter is applied
 * server-side from the session, never from a query parameter (§5, §75).
 *
 * POST records a sale. It requires a live subscription (§44): no money moves through an unpaid
 * POS. Prices, tax, discounts and credit limits are all re-derived from the server's own
 * configuration and product records; the browser's arithmetic is never trusted (§56).
 */

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_SALES", fast: true },
    fallback: "We couldn't load your sales.",
    handler: async ({ ctx, url }) => {
      const range = sanitizeRange({ from: queryString(url, "from") ?? undefined, to: queryString(url, "to") ?? undefined }, 0);
      const filter = {
        range: { from: range.from, to: range.to },
        status: queryString(url, "status") ?? undefined,
        customerId: queryString(url, "customerId") ?? undefined,
        take: Math.min(queryInt(url, "take", 50), 200),
      };
      const [sales, totals, mix, top] = await Promise.all([
        listSales(businessId, filter),
        salesTotals(businessId, filter.range),
        paymentMix(businessId, filter.range),
        topItems(businessId, filter.range, 8),
      ]);
      return posOk({
        sales: sales.map((sale: any) => ({
          id: sale.id,
          receiptNumber: sale.receiptNumber,
          createdAt: sale.createdAt,
          status: sale.status,
          kind: sale.kind,
          channel: sale.channel,
          customerName: sale.customerName,
          staffName: sale.staffName,
          totalKES: sale.totalKES,
          paidKES: sale.paidKES,
          balanceKES: sale.balanceKES,
          refundedKES: sale.refundedKES,
          itemCount: (sale.items ?? []).length,
        })),
        totals,
        paymentMix: mix,
        topItems: top,
        nextReceiptNumber: formatReceiptNumber(
          receiptPrefixFromBusinessName(ctx.configuration.receipt.businessName || ctx.business.name),
          totals.count + 1,
        ),
      });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "CREATE_SALE", requireLive: true },
    fallback: "We couldn't record that sale.",
    handler: async ({ ctx, actor, body }) => {
      const outcome = await createSale({
        businessId,
        business: {
          name: ctx.business.name,
          phone: ctx.business.phone,
          whatsapp: ctx.business.whatsapp,
          location: ctx.business.location,
          logoUrl: ctx.business.logoUrl,
        },
        configuration: ctx.configuration,
        configurationVersion: ctx.record?.publishedVersion ?? ctx.record?.draftVersion ?? 1,
        actor,
        request: sanitizeSaleRequest(body),
      });

      if (!outcome.ok) {
        return {
          status: outcome.code === "NOT_ALLOWED" ? 403 : 400,
          data: {
            error: outcome.message,
            code: outcome.code,
            warnings: outcome.warnings,
            shortages: outcome.shortages ?? [],
          },
        };
      }

      return fromOutcome(outcome, {
        sale: {
          id: outcome.sale?.id,
          receiptNumber: outcome.sale?.receiptNumber,
          status: outcome.sale?.status,
          createdAt: outcome.sale?.createdAt,
        },
        totals: outcome.totals,
        receipt: outcome.receipt,
        receiptText: outcome.receiptText ?? (outcome.receipt ? receiptToText(outcome.receipt) : ""),
        creditKES: outcome.creditKES ?? 0,
        changeKES: outcome.changeKES ?? 0,
        balanceKES: outcome.balanceKES ?? 0,
      }, 201);
    },
  });
}
