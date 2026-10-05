import { createHash } from "node:crypto";
import { fromOutcome, handlePosRequest, posOk, queryString, queryInt } from "@/lib/pos/http";
import { receiptToText } from "@/lib/pos/receipt";
import { createSale } from "@/lib/pos/sales";
import * as store from "@/lib/pos/store";
import {
  findIdempotencyRecord,
  IDEMPOTENCY_SCOPES,
  listSales,
  normalizeIdempotencyKey,
  paymentMix,
  readBranchId,
  salesTotals,
  topItems,
} from "@/lib/pos/store";
import { sanitizeRange, sanitizeSaleRequest } from "@/lib/pos/validation";
import { formatReceiptNumber, receiptPrefixFromBusinessName } from "@/lib/pos/receipt";

/**
 * The replay key a till may send with a sale (§27, §32, §54).
 *
 * A double tap, a retry after a stalled request or a refreshed page all POST the same basket
 * twice. The key lets the second one answer with the first one's receipt instead of ringing up a
 * second sale. It is read from the `Idempotency-Key` header when the caller sends one and from
 * the body otherwise, so a plain fetch and a form post are both covered.
 */
function idempotencyKeyFor(headers: Headers | null, body: Record<string, unknown>): string | null {
  return normalizeIdempotencyKey(headers?.get("idempotency-key")) ?? normalizeIdempotencyKey(body?.idempotencyKey);
}

/** A stable fingerprint of the basket, so the same key with a different sale is a conflict. */
function requestHashFor(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value ?? null)).digest("hex").slice(0, 64);
}

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
      // A bound staff member reads their own location; an unbound one may name a real one (§75).
      const branch = await readBranchId(businessId, ctx.branchId, queryString(url, "branch"));
      if (branch.error) return { status: 400, data: { error: branch.error.message, code: branch.error.code } };
      const filter = {
        range: { from: range.from, to: range.to },
        status: queryString(url, "status") ?? undefined,
        customerId: queryString(url, "customerId") ?? undefined,
        branchId: branch.branchId,
        take: Math.min(queryInt(url, "take", 50), 200),
      };
      const [sales, totals, mix, top] = await Promise.all([
        listSales(businessId, filter),
        salesTotals(businessId, filter.range, undefined, { branchId: branch.branchId }),
        paymentMix(businessId, filter.range, undefined, { branchId: branch.branchId }),
        topItems(businessId, filter.range, 8, undefined, { branchId: branch.branchId }),
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
    handler: async ({ ctx, actor, body, headers }) => {
      const request = sanitizeSaleRequest(body);
      const key = idempotencyKeyFor(headers, body ?? {});
      const requestHash = requestHashFor(request);
      const claim = { businessId, actorId: actor.actorId, scope: IDEMPOTENCY_SCOPES.saleCreate, key: key ?? "", requestHash };

      // ── Replay guard (§27, §32, §54) ──
      // Answer from the record before touching stock, money or the receipt sequence, so a
      // retried request is exactly as cheap as it is safe.
      if (key) {
        const existing = await findIdempotencyRecord(claim);
        if (existing) {
          if (existing.requestHash !== requestHash) {
            return {
              status: 409,
              data: { error: "That request key was already used for a different sale. Start a new sale to continue.", code: "IDEMPOTENCY_KEY_REUSED" },
            };
          }
          const replay = existing.saleId ? await store.findSale(businessId, existing.saleId) : null;
          return {
            status: 200,
            data: {
              ok: true,
              replayed: true,
              warnings: [] as string[],
              sale: replay
                ? { id: replay.id, receiptNumber: replay.receiptNumber, status: replay.status, createdAt: replay.createdAt }
                : { id: existing.saleId },
            },
          };
        }
      }

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
        request,
        idempotency: { key, requestHash },
      });

      // A concurrent request carrying the same key claimed it first. Nothing of ours was
      // written — its transaction was rolled back — so the honest answer is the winning sale.
      if (!outcome.ok && outcome.code === "DUPLICATE_REQUEST") {
        const existing = key ? await findIdempotencyRecord(claim) : null;
        if (existing && existing.requestHash === requestHash) {
          const replay = existing.saleId ? await store.findSale(businessId, existing.saleId) : null;
          return {
            status: 200,
            data: {
              ok: true,
              replayed: true,
              warnings: [] as string[],
              sale: replay
                ? { id: replay.id, receiptNumber: replay.receiptNumber, status: replay.status, createdAt: replay.createdAt }
                : { id: existing.saleId },
            },
          };
        }
        return {
          status: 409,
          data: { error: "That request key was already used for a different sale. Start a new sale to continue.", code: "IDEMPOTENCY_KEY_REUSED" },
        };
      }

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
