import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import prisma from "@/lib/db";
import {
  fromOutcome,
  handlePosRequest,
  posOk,
} from "@/lib/pos/http";
import { createSale } from "@/lib/pos/sales";
import * as store from "@/lib/pos/store";
import { logPosAudit } from "@/lib/pos/audit";
import type { OfflineSaleRecord, OfflineSyncResult, OfflineSyncSummary } from "@/lib/pos/offline/types";

/**
 * Offline-first POS — server synchronization (§6, §25, §27).
 *
 * A till records sales while the network is down into a durable local queue. When connectivity
 * returns, this endpoint replays them through the *same* sale engine that serves online checkout,
 * so prices, stock, credit, receipts and audit all behave identically. The only thing that differs
 * is provenance: every replayed sale is marked offline-recorded, and an unconfirmed payment method
 * (M-Pesa, card, bank captured offline) is deliberately NOT treated as money received — the sale
 * lands PARTIALLY_PAID with the full balance outstanding until the provider confirms it.
 *
 * Duplicate prevention is the load-bearing part. Each offline record carries a stable idempotency
 * key (`offline:<offlineId>`) and the replay is claimed with a *stable actor override* rather than
 * the syncing user, so the same basket replayed by a different cashier after a shift handover — or
 * picked up by a second device — still collapses to the one sale that was recorded first. The claim
 * is written inside the sale's own transaction, so a duplicate rolls back with no second sale, no
 * second stock movement and no second charge.
 */

export const dynamic = "force-dynamic";

/** Stable identifier the offline replay key is scoped to (§6, §27). Not a real user id. */
export const OFFLINE_SYNC_ACTOR_ID = "offline-sync";

/** Hard cap on records per batch so a corrupted or hostile client cannot DoS the endpoint. */
const MAX_BATCH = 100;

function requestHashFor(record: OfflineSaleRecord): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        items: record.request.items,
        customerId: record.request.customerId ?? null,
        discountKES: record.request.discountKES ?? null,
        discountPercent: record.request.discountPercent ?? null,
        feeKES: record.request.feeKES ?? null,
        channel: record.request.channel ?? null,
        paymentKind: record.paymentKind,
        paymentReference: record.paymentReference ?? null,
      }),
    )
    .digest("hex")
    .slice(0, 64);
}

/**
 * Rebuild the sale request for server-side replay.
 *
 * When the offline payment is unconfirmed (`pending`), the payment lines the device captured are
 * stripped so the sale is recorded with the balance outstanding rather than marked paid. The manual
 * reference is preserved in the notes so it can be reconciled against the provider later. Either
 * way, an offline-provenance marker is appended so the sale is never mistaken for a live one.
 */
function replayRequest(record: OfflineSaleRecord): OfflineSaleRecord["request"] {
  const base = { ...record.request };
  const reference = record.paymentReference?.trim() || "";
  const marker = `[offline offlineId=${record.offlineId} recordedAt=${record.recordedAt} payment=${record.paymentKind}${reference ? ` ref=${reference}` : ""}]`;
  const existing = base.notes?.trim() ?? "";
  base.notes = [existing, marker].filter(Boolean).join(" ").slice(0, 500) || null;
  if (record.paymentKind === "pending") {
    // Never let an unconfirmed offline tender settle the sale.
    base.payments = [];
  }
  return base;
}

function parseRecords(body: Record<string, unknown>): OfflineSaleRecord[] {
  const raw = body?.records;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is OfflineSaleRecord => Boolean(entry) && typeof entry === "object")
    .slice(0, MAX_BATCH)
    .filter((entry) => typeof entry.offlineId === "string" && entry.offlineId.trim().length > 0);
}

type RouteContext = { params: Promise<{ businessId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "CREATE_SALE" },
    fallback: "We couldn't synchronize your offline sales.",
    handler: async ({ ctx, actor, body }) => {
      const records = parseRecords(body);
      const results: OfflineSyncResult[] = [];
      const summary: OfflineSyncSummary = { total: records.length, synced: 0, duplicate: 0, conflict: 0, rejected: 0 };

      for (const record of records) {
        const idempotencyKey = typeof record.idempotencyKey === "string" && record.idempotencyKey.trim()
          ? record.idempotencyKey.trim()
          : `offline:${record.offlineId}`;
        const requestHash = requestHashFor(record);
        const unconfirmedPayment = record.paymentKind === "pending";

        try {
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
            request: replayRequest(record),
            idempotency: { key: idempotencyKey, requestHash, actorIdOverride: OFFLINE_SYNC_ACTOR_ID },
          });

          if (outcome.ok) {
            summary.synced += 1;
            results.push({
              offlineId: record.offlineId,
              status: "synced",
              saleId: outcome.sale?.id,
              receiptNumber: outcome.sale?.receiptNumber,
              unconfirmedPayment,
            });
            await logPosAudit({
              businessId,
              actorId: actor.actorId,
              actorName: actor.actorName,
              action: "POS_OFFLINE_SYNC",
              targetType: "SALE",
              targetId: outcome.sale?.id ?? null,
              branchId: record.branchId,
              metadata: {
                offlineId: record.offlineId,
                recordedAt: record.recordedAt,
                paymentKind: record.paymentKind,
                paymentReference: record.paymentReference,
                unconfirmedPayment,
              },
            });
            continue;
          }

          if (outcome.code === "DUPLICATE_REQUEST") {
            // Another sync already recorded this basket. Distinguish a genuine replay of the same
            // request from a key that was reused for a different one.
            if (outcome.duplicateRequestHashMatches) {
              const replay = outcome.duplicateOfSaleId
                ? await store.findSale(businessId, outcome.duplicateOfSaleId)
                : null;
              summary.duplicate += 1;
              results.push({
                offlineId: record.offlineId,
                status: "duplicate",
                saleId: outcome.duplicateOfSaleId ?? undefined,
                receiptNumber: replay?.receiptNumber ?? undefined,
              });
            } else {
              summary.conflict += 1;
              results.push({
                offlineId: record.offlineId,
                status: "conflict",
                code: "IDEMPOTENCY_KEY_REUSED",
                error: "That offline sale key was already used for a different sale.",
              });
            }
            continue;
          }

          summary.rejected += 1;
          results.push({
            offlineId: record.offlineId,
            status: "rejected",
            code: outcome.code,
            error: outcome.message ?? "The offline sale could not be recorded.",
          });
        } catch (error) {
          summary.rejected += 1;
          results.push({
            offlineId: record.offlineId,
            status: "rejected",
            code: "SYNC_FAILED",
            error: error instanceof Error ? error.message : "The offline sale could not be recorded.",
          });
        }
      }

      return posOk({ results, summary });
    },
  });
}

/**
 * Report which offline sales this business has already recorded, so a second device can resolve a
 * conflict ("was this basket synced by the other till?"). Read-only and tenant-scoped by businessId.
 */
export async function GET(request: Request, context: RouteContext) {
  const { businessId } = await context.params;
  return handlePosRequest({
    businessId,
    request,
    options: { permission: "VIEW_SALES", fast: true },
    fallback: "We couldn't load offline sync status.",
    handler: async () => {
      const claims = await prisma.posIdempotencyRecord.findMany({
        where: { businessId, actorId: OFFLINE_SYNC_ACTOR_ID, scope: store.IDEMPOTENCY_SCOPES.saleCreate },
        select: { key: true, saleId: true },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return posOk({
        syncedOfflineIds: claims
          .map((claim) => claim.key.replace(/^offline:/, ""))
          .filter((id) => id.length > 0),
      });
    },
  });
}
