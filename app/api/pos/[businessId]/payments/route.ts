/**
 * The JATA Payment Wallet for a business (§10, §11, §40, §41).
 *
 * GET  — what the merchant's Payments screen needs: where they get paid, how each destination is
 *        verified, what JATA can honestly claim for it, recent payments and payment health.
 * POST — starts a payment request for a counter sale (or a direct amount). The money amount is
 *        priced by the same server-side engine that will record the sale (§20, §56), and the
 *        request is idempotent by the till's own request key (§33).
 *
 * Nothing here names a provider endpoint, a webhook, an API key or a payload. That is the whole
 * point of the wallet: the merchant says where they bank, JATA does everything else (§1, §3).
 */

import { fromOutcome, handlePosRequest, posOk } from "@/lib/pos/http";
import { sanitizeSaleRequest } from "@/lib/pos/validation";
import { createPaymentRequest } from "@/lib/payments/orchestrator";
import { loadWallet, paymentHealth } from "@/lib/payments/wallet";
import { listRecentPayments } from "@/lib/payments/store";
import { isOk } from "@/lib/payments/result";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ businessId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_PAYMENTS", fast: true },
    fallback: "We couldn't load your payments.",
    handler: async ({ url }) => {
      const take = Math.min(Math.max(Number(url.searchParams.get("take") ?? 25) || 25, 1), 100);
      const [wallet, health, recent] = await Promise.all([
        loadWallet(businessId),
        paymentHealth(businessId),
        listRecentPayments(businessId, { take }),
      ]);
      return posOk({ wallet, health, payments: recent });
    },
  });
}

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "CREATE_SALE", requireLive: true },
    fallback: "We couldn't start that payment.",
    handler: async ({ ctx, actor, body }) => {
      const sale = body?.sale && typeof body.sale === "object" ? (body.sale as Record<string, unknown>) : null;
      const outcome = await createPaymentRequest({
        businessId,
        requestKey: typeof body?.requestKey === "string" ? body.requestKey : "",
        method: typeof body?.method === "string" ? body.method : "mpesa",
        destinationId: typeof body?.destinationId === "string" ? body.destinationId : null,
        sale: sale
          ? {
              request: sanitizeSaleRequest((sale.request ?? {}) as Record<string, unknown>),
              business: {
                name: ctx.business.name,
                phone: ctx.business.phone,
                whatsapp: ctx.business.whatsapp,
                location: ctx.business.location,
                logoUrl: ctx.business.logoUrl,
                email: null,
              },
              configurationVersion: ctx.record?.publishedVersion ?? ctx.record?.draftVersion ?? 1,
              configurationFingerprint: (ctx.record as { fingerprint?: string | null } | null)?.fingerprint ?? null,
            }
          : null,
        amountKES: typeof body?.amountKES === "number" ? body.amountKES : null,
        currency: "KES",
        customer: body?.customer && typeof body.customer === "object" ? (body.customer as never) : undefined,
        orderId: typeof body?.orderId === "string" ? body.orderId : null,
        actor,
      });

      if (!isOk(outcome)) {
        return fromOutcome(
          { ok: false, code: outcome.code, message: outcome.message, warnings: [] },
          { instructions: outcome.instructions ?? null },
          outcome.code === "NOT_ALLOWED" ? 403 : 400,
        );
      }
      return posOk({ ...outcome, ok: true }, outcome.duplicate ? 200 : 201);
    },
  });
}
