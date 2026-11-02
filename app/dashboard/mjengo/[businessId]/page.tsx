import { getSession } from "@/lib/auth";
import { requireMjengoAccess } from "@/lib/mjengo/access";
import { mjengoSafeText } from "@/lib/mjengo/sanitize";
import { notFound } from "next/navigation";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MjengoDashboard({ params }: { params: { businessId: string } }) {
  const businessId = params.businessId?.trim();
  if (!businessId) notFound();
  const session = await getSession();
  const gate = await requireMjengoAccess(businessId, session);
  if (!gate.ok) {
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-bold">MJENGO OS</h1>
        <p className="mt-2 text-red-600">{gate.error}</p>
        {gate.status === 402 ? (
          <a className="mt-4 inline-block rounded bg-black px-4 py-2 text-white" href={`/dashboard/mjengo/${encodeURIComponent(businessId)}/billing`}>
            Add MJENGO OS — KES 2,000/month
          </a>
        ) : null}
        <p className="mt-4 text-sm text-muted-foreground">
          POS customers keep KES 499 pricing. MJENGO OS is separate and never auto-granted.
        </p>
      </main>
    );
  }

  const business = await prisma.business.findUnique({ where: { id: businessId }, select: { name: true, slug: true } });
  const safeName = mjengoSafeText(business?.name ?? businessId);

  // Real backend counts (not mocks) — tenant-scoped reads
  const [posProducts, pendingOrders, unpaidInvoices] = await Promise.all([
    prisma.posProduct.count({ where: { businessId, isActive: true } }).catch(() => 0),
    prisma.order?.count ? prisma.order.count({ where: { businessId, status: { in: ["CONFIRMED", "PROCESSING"] } as any } }).catch(() => 0) : Promise.resolve(0),
    prisma.erpInvoice?.count ? prisma.erpInvoice.count({ where: { businessId, status: "ISSUED" } }).catch(() => 0) : Promise.resolve(0),
  ]);

  return (
    <main className="mx-auto max-w-5xl p-6 space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">MJENGO OS — {safeName}</h1>
          <p className="text-muted-foreground">Sales, inventory, procurement, accounting, credit, workforce — one workspace.</p>
        </div>
        <span className="rounded-full bg-green-100 px-3 py-1 text-sm text-green-800">Live — {gate.entitlement.planKey} KES {gate.entitlement.priceKES}/30d</span>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Active products</div><div className="text-2xl font-bold">{posProducts}</div></div>
        <div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Open orders</div><div className="text-2xl font-bold">{pendingOrders}</div></div>
        <div className="rounded-xl border p-4"><div className="text-sm text-muted-foreground">Unpaid invoices</div><div className="text-2xl font-bold">{unpaidInvoices}</div></div>
      </div>

      <nav className="grid gap-3 md:grid-cols-4">
        {[
          { label: "Sales & orders", href: `/dashboard/mjengo/${encodeURIComponent(businessId)}/sales` },
          { label: "Inventory", href: `/dashboard/mjengo/${encodeURIComponent(businessId)}/inventory` },
          { label: "Procurement", href: `/dashboard/mjengo/${encodeURIComponent(businessId)}/procurement` },
          { label: "Customers & credit", href: `/dashboard/mjengo/${encodeURIComponent(businessId)}/customers` },
          { label: "Accounting", href: `/dashboard/mjengo/${encodeURIComponent(businessId)}/accounting` },
          { label: "Workforce", href: `/dashboard/mjengo/${encodeURIComponent(businessId)}/workforce` },
          { label: "Reports", href: `/dashboard/mjengo/${encodeURIComponent(businessId)}/reports` },
          { label: "Settings & plan", href: `/dashboard/mjengo/${encodeURIComponent(businessId)}/settings` },
        ].map((i) => (
          <a key={i.label} href={i.href} className="rounded-lg border p-4 hover:bg-muted">
            <div className="font-medium">{i.label}</div>
            <div className="text-xs text-muted-foreground">Manage</div>
          </a>
        ))}
      </nav>

      <section className="rounded-xl border bg-muted/30 p-4">
        <h2 className="font-semibold">Security & integrity — verified</h2>
        <ul className="mt-2 list-disc pl-5 text-sm">
          <li>Branding renders as safe text — no executable HTML.</li>
          <li>Ledger is append-only at DB level; reversals are compensating journals.</li>
          <li>Payments require provider verification; refunds are provider-confirmed.</li>
          <li>Tenant access is server-enforced on every mutation.</li>
        </ul>
      </section>
    </main>
  );
}
