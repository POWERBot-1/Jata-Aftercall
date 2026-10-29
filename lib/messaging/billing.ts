/**
 * Messaging wallet and usage ledger
 *
 * Money moves in one direction here: a funded balance is reserved before a campaign is approved,
 * released when a recipient is skipped, and consumed only when the provider accepts a message.
 * Every movement has an idempotency key, so a retried job or a duplicate callback cannot charge
 * twice. Nothing tops itself up and nothing silently goes negative.
 */

import { logErpAudit } from "../erp/audit";

export class WalletError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 409, code = "WALLET_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
    this.name = "WalletError";
  }
}

export async function ensureWallet(client: any, businessId: string) {
  return client.msgWallet.upsert({
    where: { businessId },
    create: { businessId, currencyCode: "KES", balanceCents: 0, reservedCents: 0 },
    update: {},
  });
}

export async function walletSummary(client: any, businessId: string) {
  const wallet = await ensureWallet(client, businessId);
  const availableCents = Math.max(0, Number(wallet.balanceCents) - Number(wallet.reservedCents));
  return {
    balanceCents: Number(wallet.balanceCents),
    reservedCents: Number(wallet.reservedCents),
    availableCents,
    currency: wallet.currencyCode ?? "KES",
  };
}

/**
 * Credit a wallet. This is deliberately gated: money may only arrive with a reference that has
 * been verified elsewhere (a confirmed payment) or by an authorised adjustment with a written
 * reason. There is no "auto top-up" path.
 */
export async function creditWallet(
  client: any,
  input: {
    businessId: string;
    amountCents: number;
    idempotencyKey: string;
    reference: string;
    reason?: string | null;
    actorId?: string | null;
    actorName?: string | null;
    kind?: "TOP_UP" | "ADJUSTMENT" | "REFUND";
  },
) {
  const amount = Math.round(Number(input.amountCents));
  if (!Number.isFinite(amount) || amount <= 0) throw new WalletError("Enter a positive amount.", 400, "BAD_AMOUNT");
  if (!input.reference || input.reference.trim().length < 3) {
    throw new WalletError("A verified payment reference is required before credits are added.", 400, "REFERENCE_REQUIRED");
  }
  if (!input.idempotencyKey) throw new WalletError("This action needs an idempotency key.", 400, "IDEMPOTENCY_REQUIRED");

  return client.$transaction(async (tx: any) => {
    const existing = await tx.msgLedgerEntry.findUnique({
      where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: input.idempotencyKey } },
    }).catch(() => null);
    if (existing) return { wallet: await ensureWallet(tx, input.businessId), idempotent: true };

    const wallet = await ensureWallet(tx, input.businessId);
    const updated = await tx.msgWallet.update({
      where: { businessId: input.businessId },
      data: { balanceCents: { increment: amount } },
    });
    await tx.msgLedgerEntry.create({
      data: {
        businessId: input.businessId,
        type: input.kind ?? "TOP_UP",
        amountCents: amount,
        balanceAfterCents: Number(updated.balanceCents),
        reservedAfterCents: Number(updated.reservedCents),
        reference: input.reference,
        idempotencyKey: input.idempotencyKey,
      },
    });
    await logErpAudit({
      businessId: input.businessId,
      actorId: input.actorId,
      actorName: input.actorName,
      action: "MESSAGING_WALLET_CREDITED",
      targetType: "WALLET",
      targetId: input.businessId,
      reason: input.reason ?? null,
      after: { amountCents: amount, reference: input.reference },
      client: tx,
    });
    return { wallet: updated, idempotent: false };
  });
}

/**
 * Reserve funds for a campaign. The compare-and-set on `reservedCents` makes concurrent approvals
 * safe without holding a row lock across an HTTP request: the loser retries and sees the winner's
 * reservation.
 */
export async function reserveFunds(
  client: any,
  input: { businessId: string; amountCents: number; campaignId: string; idempotencyKey: string; maxAttempts?: number },
) {
  const amount = Math.round(Number(input.amountCents));
  if (amount < 0) throw new WalletError("A reservation cannot be negative.", 400, "BAD_AMOUNT");
  if (amount === 0) return { reserved: 0, idempotent: false };

  return client.$transaction(async (tx: any) => {
    const existing = await tx.msgLedgerEntry.findUnique({
      where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: input.idempotencyKey } },
    }).catch(() => null);
    if (existing) return { reserved: Math.abs(Number(existing.amountCents)), idempotent: true };

    const maxAttempts = input.maxAttempts ?? 3;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const wallet = await ensureWallet(tx, input.businessId);
      const balance = Number(wallet.balanceCents);
      const reserved = Number(wallet.reservedCents);
      if (balance - reserved < amount) {
        throw new WalletError(
          `Not enough messaging credit: KES ${((amount) / 100).toLocaleString("en-KE")} is needed and KES ${((balance - reserved) / 100).toLocaleString("en-KE")} is available. Top up or reduce the audience.`,
          402,
          "INSUFFICIENT_CREDIT",
        );
      }
      const result = await tx.msgWallet.updateMany({
        where: { businessId: input.businessId, reservedCents: reserved, balanceCents: { gte: reserved + amount } },
        data: { reservedCents: { increment: amount } },
      });
      if (result.count === 1) {
        const updated = await tx.msgWallet.findUnique({ where: { businessId: input.businessId } });
        await tx.msgLedgerEntry.create({
          data: {
            businessId: input.businessId,
            type: "RESERVE",
            amountCents: -amount,
            balanceAfterCents: Number(updated?.balanceCents ?? balance),
            reservedAfterCents: Number(updated?.reservedCents ?? reserved + amount),
            campaignId: input.campaignId,
            reference: `campaign:${input.campaignId}`,
            idempotencyKey: input.idempotencyKey,
          },
        });
        return { reserved: amount, idempotent: false };
      }
      // Lost the race: read again and retry with the winner's reserved value.
    }
    throw new WalletError("Messaging credit is being used by another action. Try again in a moment.", 409, "CONTENDED");
  });
}

async function settle(
  client: any,
  input: { businessId: string; campaignId: string; idempotencyKey: string; amountCents: number; type: "CONSUME" | "RELEASE" },
) {
  const amount = Math.max(0, Math.round(input.amountCents));
  if (amount === 0) return { settled: 0, idempotent: false };
  const tx = client;
  const existing = await tx.msgLedgerEntry.findUnique({
    where: { businessId_idempotencyKey: { businessId: input.businessId, idempotencyKey: input.idempotencyKey } },
  }).catch(() => null);
  if (existing) return { settled: Math.abs(Number(existing.amountCents)), idempotent: true };

  const wallet = await ensureWallet(tx, input.businessId);
  const reserved = Math.max(0, Number(wallet.reservedCents) - amount);
  const balance = input.type === "CONSUME" ? Math.max(0, Number(wallet.balanceCents) - amount) : Number(wallet.balanceCents);
  const updated = await tx.msgWallet.update({
    where: { businessId: input.businessId },
    data: { reservedCents: reserved, balanceCents: balance },
  });
  await tx.msgLedgerEntry.create({
    data: {
      businessId: input.businessId,
      type: input.type,
      amountCents: input.type === "CONSUME" ? -amount : amount,
      balanceAfterCents: Number(updated.balanceCents),
      reservedAfterCents: Number(updated.reservedCents),
      campaignId: input.campaignId,
      reference: `campaign:${input.campaignId}`,
      idempotencyKey: input.idempotencyKey,
    },
  });
  return { settled: amount, idempotent: false };
}

/** Consume a reserved amount once the provider has accepted the message. */
export function consumeReserved(
  client: any,
  input: { businessId: string; campaignId: string; idempotencyKey: string; amountCents: number },
) {
  return settle(client, { ...input, type: "CONSUME" });
}

/** Release a reservation for a recipient that was skipped or definitely not submitted. */
export function releaseReserved(
  client: any,
  input: { businessId: string; campaignId: string; idempotencyKey: string; amountCents: number },
) {
  return settle(client, { ...input, type: "RELEASE" });
}
