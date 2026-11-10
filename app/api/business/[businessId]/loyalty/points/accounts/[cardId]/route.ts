import { NextResponse } from "next/server";
import { authorizeOwner, hasDurableDatabase, readJsonBody } from "@/lib/business-hub/guard";
import prisma from "@/lib/db";
import { reconcileAccount, walletForCard } from "@/lib/business-hub/loyaltyPoints";
import { cleanText } from "@/lib/business-hub/shared";
import { logAudit } from "@/lib/audit";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "private, no-store" };
function reply(body: unknown, status: number) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** One customer's points wallet, with the ledger reconciliation the owner can hold us to. */
export async function GET(req: Request, { params }: { params: Promise<{ businessId: string; cardId: string }> }) {
  const { businessId, cardId } = await params;
  const auth = await authorizeOwner(businessId, "read");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);
  try {
    const wallet = await walletForCard(businessId, cardId);
    if (!wallet) return reply({ error: "That customer does not have a points wallet yet." }, 404);
    const ledger = (await prisma.loyaltyPointsLedger
      .findMany({ where: { businessId, accountId: wallet.account.id }, take: 1000 })
      .catch(() => [] as any[])) as any[];
    return reply(
      {
        account: wallet.account,
        card: { id: wallet.card.id, code: wallet.card.code, customerName: wallet.card.customerName },
        wallet: wallet.wallet,
        reconciliation: wallet.reconciliation,
        ledger: ledger
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, 50)
          .map((row) => ({
            id: row.id,
            type: row.type,
            direction: row.direction,
            points: row.points,
            balanceAfter: row.balanceAfter,
            reference: row.reference,
            source: row.source,
            sourceReference: row.sourceReference ?? null,
            explanation: row.explanation ?? null,
            actorLabel: row.actorLabel ?? null,
            expiresAt: row.expiresAt ? new Date(row.expiresAt).toISOString() : null,
            createdAt: new Date(row.createdAt).toISOString(),
          })),
      },
      200,
    );
  } catch {
    return reply({ error: "We couldn't load that wallet. Please try again." }, 503);
  }
}

/**
 * Block or unblock a wallet. Blocking stops earning and redeeming without deleting anything: the
 * ledger, and the points in it, stay exactly as they were.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ businessId: string; cardId: string }> }) {
  const { businessId, cardId } = await params;
  const auth = await authorizeOwner(businessId, "configure");
  if (!auth.ok) return reply({ error: auth.error }, auth.status);
  if (!hasDurableDatabase()) return reply({ error: "Your points programme is temporarily unavailable." }, 503);

  const body = await readJsonBody(req);
  if (!body) return reply({ error: "We couldn't read that change." }, 400);
  const status = cleanText(body.status, 20).toUpperCase() === "BLOCKED" ? "BLOCKED" : "ACTIVE";
  if (status === "BLOCKED" && cleanText(body.reason, 400).length < 5) {
    return reply({ error: "Record why this wallet is being blocked." }, 400);
  }

  try {
    const account = await prisma.loyaltyPointsAccount.findFirst({ where: { businessId, cardId } });
    if (!account) return reply({ error: "That customer does not have a points wallet yet." }, 404);
    const updated = await prisma.loyaltyPointsAccount.update({ where: { id: account.id }, data: { status } });
    await logAudit({
      actorId: auth.actor.userId,
      action: "BUSINESS_HUB_POINTS_ACCOUNT_STATUS",
      targetType: "LoyaltyPointsAccount",
      targetId: account.id,
      metadata: { businessId, status, reason: body.reason ?? null },
    }).catch(() => undefined);
    return reply(
      { account: updated, reconciliation: await reconcileAccount(businessId, account.id) },
      200,
    );
  } catch {
    return reply({ error: "We couldn't update that wallet. Please try again." }, 503);
  }
}
