import Link from "next/link";
import prisma from "@/lib/db";
import { requireAdminPage } from "@/lib/adminGuard";
import { RecheckPaymentButton } from "@/components/admin/RecheckPaymentButton";

/**
 * JATA internal: the payment wallet, as operations sees it (§73, §102).
 *
 * Admin-only and read-mostly: what provider events arrived, which payments did not line up, and
 * which connector is configured in this deployment. It never shows a credential — those live in
 * the environment and are reported only as configured / missing (§58).
 *
 * Where a payment needs a second look, the operator action asks the provider for the current truth
 * rather than re-running stored provider data: only the provider's own answer can move a payment,
 * so an operator cannot make money appear (§41, §102, §120).
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Payment wallet — JATA" };

export default async function AdminPaymentWalletPage() {
  await requireAdminPage();

  const [events, exceptions, transactions, destinations] = await Promise.all([
    prisma.paymentEvent.findMany({ orderBy: { receivedAt: "desc" }, take: 40 }).catch(() => []),
    prisma.paymentReconciliation
      .findMany({
        where: { result: { in: ["AMOUNT_MISMATCH", "UNKNOWN_PAYMENT", "DUPLICATE", "UNCONFIRMED"] }, resolvedAt: null },
        orderBy: { createdAt: "desc" },
        take: 40,
      })
      .catch(() => []),
    prisma.paymentTransaction
      .findMany({ orderBy: { createdAt: "desc" }, take: 40, select: { id: true, jataPaymentId: true, businessId: true, provider: true, status: true, amountMinor: true, providerReference: true, createdAt: true } })
      .catch(() => []),
    prisma.paymentDestination
      .findMany({ orderBy: { updatedAt: "desc" }, take: 25, select: { id: true, businessId: true, provider: true, kind: true, status: true, verificationSource: true, updatedAt: true } })
      .catch(() => []),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold">Payment wallet</h1>
        <p className="text-xs text-zinc-500">
          JATA&apos;s own view of the central payment pipeline. No provider secret, key or credential is rendered on this
          page; a connector is described only as configured or missing.
        </p>
      </div>

      {exceptions.length ? (
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-sm font-semibold">Needs a person ({exceptions.length})</h2>
          <ul className="mt-2 space-y-1 text-xs">
            {(exceptions as any[]).map((row) => (
              <li key={row.id} className="flex flex-wrap gap-2">
                <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700">{row.result}</span>
                <span>{row.provider}</span>
                <span className="text-zinc-500">{row.providerReference ?? "no reference"}</span>
                <span>expected {row.expectedAmountMinor ?? "—"} · received {row.receivedAmountMinor ?? "—"}</span>
                <span className="text-zinc-500">{new Date(row.createdAt).toLocaleString("en-KE")}</span>
                <span className="text-zinc-500">business {row.businessId ?? "—"}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <section className="rounded-2xl border bg-white p-4">
          <h2 className="text-sm font-semibold">Nothing needs a person</h2>
          <p className="text-xs text-zinc-500">Every confirmed payment matched. Exceptions appear here when they do not.</p>
        </section>
      )}

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-sm font-semibold">Recent provider events</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-2 py-1 text-left">Received</th>
                <th className="px-2 py-1 text-left">Provider</th>
                <th className="px-2 py-1 text-left">Event</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-left">Signed</th>
                <th className="px-2 py-1 text-left">Business</th>
                <th className="px-2 py-1 text-left">Payment</th>
              </tr>
            </thead>
            <tbody>
              {(events as any[]).map((event) => (
                <tr key={event.id} className="border-t">
                  <td className="px-2 py-1">{new Date(event.receivedAt ?? event.createdAt).toLocaleString("en-KE")}</td>
                  <td className="px-2 py-1">{event.provider}</td>
                  <td className="px-2 py-1 font-mono">{String(event.providerEventId).slice(0, 28)}</td>
                  <td className="px-2 py-1">{event.status}{event.errorCode ? ` · ${event.errorCode}` : ""}</td>
                  <td className="px-2 py-1">{event.signatureVerified ? "yes" : "no"}</td>
                  <td className="px-2 py-1">{event.businessId ?? "—"}</td>
                  <td className="px-2 py-1 font-mono">{event.transactionId ? String(event.transactionId).slice(0, 12) : "—"}</td>
                </tr>
              ))}
              {(events as any[]).length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-zinc-500" colSpan={7}>
                    No provider events have been received in this environment.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-sm font-semibold">Recent wallet payments</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-50 text-zinc-500">
              <tr>
                <th className="px-2 py-1 text-left">JATA payment id</th>
                <th className="px-2 py-1 text-left">Business</th>
                <th className="px-2 py-1 text-left">Provider</th>
                <th className="px-2 py-1 text-left">Status</th>
                <th className="px-2 py-1 text-right">Amount (minor)</th>
                <th className="px-2 py-1 text-left">Reference</th>
                <th className="px-2 py-1 text-left">Created</th>
                <th className="px-2 py-1 text-left">Provider check</th>
              </tr>
            </thead>
            <tbody>
              {(transactions as any[]).map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-2 py-1 font-mono">{row.jataPaymentId}</td>
                  <td className="px-2 py-1">{row.businessId}</td>
                  <td className="px-2 py-1">{row.provider}</td>
                  <td className="px-2 py-1">{row.status}</td>
                  <td className="px-2 py-1 text-right">{row.amountMinor}</td>
                  <td className="px-2 py-1 font-mono">{row.providerReference ?? "—"}</td>
                  <td className="px-2 py-1">{new Date(row.createdAt).toLocaleString("en-KE")}</td>
                  <td className="px-2 py-1">
                    {["CREATED", "PAYMENT_REQUESTED", "PENDING", "PROCESSING"].includes(String(row.status)) ? (
                      <RecheckPaymentButton transactionId={row.id} />
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </td>
                </tr>
              ))}
              {(transactions as any[]).length === 0 ? (
                <tr>
                  <td className="px-2 py-3 text-zinc-500" colSpan={8}>
                    No wallet payments yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rounded-2xl border bg-white p-4">
        <h2 className="text-sm font-semibold">Destinations across tenants</h2>
        <ul className="mt-2 space-y-1 text-xs">
          {(destinations as any[]).map((row) => (
            <li key={row.id} className="flex flex-wrap gap-2">
              <span>{row.businessId}</span>
              <span>{row.provider}</span>
              <span className="text-zinc-500">{row.kind}</span>
              <span>{row.status}</span>
              <span className="text-zinc-500">verified: {row.verificationSource ?? "none"}</span>
              <span className="text-zinc-500">{new Date(row.updatedAt).toLocaleString("en-KE")}</span>
            </li>
          ))}
          {(destinations as any[]).length === 0 ? <li className="text-zinc-500">No destinations configured.</li> : null}
        </ul>
      </section>

      <p className="text-xs text-zinc-500">
        Connector readiness is reported in the deployment environment, never here. <Link href="/admin/payments" className="underline">Platform payments</Link>
      </p>
    </div>
  );
}
