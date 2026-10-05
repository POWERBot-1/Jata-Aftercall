/**
 * POS refund race, against a real PostgreSQL database (§30, §33, §54).
 *
 * Two cashiers tap "Refund" on the same sale at the same moment. Both read the sale, both see
 * KES 100 still refundable, and both set out to pay it. The till must pay once.
 *
 * This lives in its own file on purpose. The rest of the refund suite (`pos-refund-integrity`)
 * mocks `@/lib/db` with the in-memory double, and a `vi.mock` applies to the whole module — so a
 * race test declared in that file silently runs against the double no matter what DATABASE_URL
 * says. The double has no real row locks and no real rollback, so it cannot demonstrate the
 * property this test exists to prove, and its results do not transfer to production. This file
 * imports the real client instead.
 *
 * Skipped wherever DATABASE_URL is absent: there is no honest way to fake a two-connection race.
 */

import { describe, expect, it } from "vitest";

import prisma from "@/lib/db";
import { createSale, refundSale, type PosActor } from "@/lib/pos/sales";

const postgresEnabled = Boolean(process.env.DATABASE_URL?.trim());
const pgStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

describe.skipIf(!postgresEnabled)("POS refund race with real PostgreSQL", () => {
  it("two full refunds in the same moment: one commits, the other is refused, the till pays once", async () => {
    const { baselineConfiguration } = await import("@/lib/pos/configuration");
    // Refunds have to be switched on. The baseline ships with them off, and with them off
    // `refundSale` refuses on the configuration guard before it opens a transaction — so both
    // calls would come back refused and the test would never reach the race it exists to cover.
    const base = baselineConfiguration();
    const configuration = { ...base, sales: { ...base.sales, refunds: true } };

    const user = await prisma.user.create({
      data: { email: `refund-race-${pgStamp}@example.test`, name: "Race Owner", passwordHash: "not-a-real-login" },
    });
    const business = await prisma.business.create({
      data: { ownerId: user.id, slug: `refund-race-${pgStamp}`, name: "Refund Race", category: "retail" },
    });
    const productId = (
      await prisma.posProduct.create({
        data: { businessId: business.id, name: "Chapati", kind: "PRODUCT", priceKES: 50, costKES: 20, unitKey: "piece", trackInventory: true, isActive: true },
      })
    ).id;
    await prisma.posInventoryItem.create({
      data: { businessId: business.id, productId, branchId: "", quantity: 100 },
    });
    await prisma.posCustomer.create({
      data: { businessId: business.id, name: "Jane Wanjiku", phone: `+2547${pgStamp.slice(0, 8)}`, balanceKES: 0, creditEnabled: false, creditLimitKES: 0 },
    });

    const actor: PosActor = {
      actorId: user.id,
      actorName: "Race Owner",
      roleKey: "OWNER",
      permissions: ["CREATE_SALE", "REFUND_SALE", "VOID_SALE", "VIEW_SALES"],
      staffId: null,
      branchId: null,
    };

    const saleOutcome = await createSale({
      businessId: business.id,
      business: { name: "Refund Race", phone: null, whatsapp: null, location: null, logoUrl: null, email: null },
      configuration,
      actor,
      request: { items: [{ productId, quantity: 2 }], payments: [{ method: "cash", amountKES: 100 }] },
    });
    if (!saleOutcome.ok) throw new Error(`PG sale setup failed: ${saleOutcome.code}`);
    const saleId = (saleOutcome.sale as any).id;

    // The goods are named explicitly: a refund that only names an amount leaves the shelf alone,
    // and the last assertion here is that the units come back exactly once.
    const saleItems = await prisma.posSaleItem.findMany({ where: { businessId: business.id, saleId } });
    const returnItems = saleItems.map((item: any) => ({ saleItemId: item.id, quantity: Number(item.quantity) }));

    // ── The race ──
    const [first, second] = await Promise.all([
      refundSale({ businessId: business.id, configuration, actor, request: { saleId, amountKES: 100, method: "cash", items: returnItems } }),
      refundSale({ businessId: business.id, configuration, actor, request: { saleId, amountKES: 100, method: "cash", items: returnItems } }),
    ]);
    const accepted = [first, second].filter((result) => result.ok);
    const refused = [first, second].filter((result) => !result.ok);
    expect(accepted, JSON.stringify([first, second])).toHaveLength(1);
    expect(refused[0]!.code).toBeDefined();
    expect(accepted[0]!.refundedKES).toBe(100);

    // The ledger paid out exactly once: one refund row, the sale fully refunded, stock back once.
    const saleRow = await prisma.posSale.findUnique({ where: { id: saleId } });
    expect(Number(saleRow?.refundedKES ?? 0)).toBe(100);
    expect(await prisma.posPayment.count({ where: { businessId: business.id, saleId, direction: "OUT", purpose: "REFUND" } })).toBe(1);
    const movements = await prisma.posInventoryMovement.findMany({ where: { businessId: business.id, refType: "SALE", reason: "RETURN" } });
    expect(movements.reduce((total, row) => total + Number(row.delta ?? 0), 0)).toBe(2);

    // …and the line was claimed once, not twice: a rollback has to take the claim with it.
    const line = await prisma.posSaleItem.findFirst({ where: { businessId: business.id, saleId } });
    expect(Number(line?.returnedQty ?? 0)).toBe(2);

    await prisma.business.delete({ where: { id: business.id } }).catch(() => undefined);
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });
});
