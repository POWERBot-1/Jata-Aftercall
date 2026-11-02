/**
 * MJENGO OS workspace shell.
 *
 * The gate runs once, here, for every child route: a child page cannot render without an
 * authenticated session, tenant access and a live MJENGO OS entitlement. That is deliberate —
 * `requireMjengoAccess` is the only place that decides, and the shell does not trust a query
 * string, a cookie flag or a client-supplied business id.
 */
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { requireMjengoAccess } from "@/lib/mjengo/access";
import { MJENGO_MODULES, mjengoPath } from "@/lib/mjengo/navigation";
import { mjengoSafeText } from "@/lib/mjengo/sanitize";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MjengoLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ businessId: string }>;
}) {
  const { businessId: rawBusinessId } = await params;
  const businessId = String(rawBusinessId ?? "").trim();
  if (!businessId) notFound();

  const session = await getSession();
  const gate = await requireMjengoAccess(businessId, session);

  if (!gate.ok) {
    // No child content is rendered when the gate refuses: the refusal is the whole response.
    return (
      <main className="mx-auto max-w-3xl p-8">
        <h1 className="text-2xl font-bold">MJENGO OS</h1>
        <p className="mt-2 text-red-600">{gate.error}</p>
        {gate.status === 402 ? (
          <Link
            className="mt-4 inline-block rounded-sm bg-black px-4 py-2 text-white"
            href={mjengoPath(businessId, "/settings")}
          >
            Add MJENGO OS — KES 2,000/month
          </Link>
        ) : null}
        <p className="mt-4 text-sm text-muted-foreground">
          BUSINESS POS (KES 499) and MJENGO OS (KES 2,000) are separate products. Buying one never
          switches the other on, and existing POS access is unchanged.
        </p>
      </main>
    );
  }

  const business = await prisma.business
    .findUnique({ where: { id: businessId }, select: { name: true, slug: true } })
    .catch(() => null);
  // Branding is operator-editable text: it is escaped here and rendered as text, never as HTML.
  const safeName = mjengoSafeText(business?.name ?? businessId);

  const entitlement = gate.entitlement;
  const modules = MJENGO_MODULES.filter((module) => module.key !== "overview");

  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground">MJENGO OS</p>
          <h1 className="text-2xl font-bold tracking-tight">{safeName}</h1>
          <p className="text-sm text-muted-foreground">
            {entitlement.planKey} · KES {entitlement.priceKES.toLocaleString("en-KE")} / 30 days ·{" "}
            {entitlement.status}
            {entitlement.expiresAt ? ` · renews/ends ${new Date(entitlement.expiresAt).toISOString().slice(0, 10)}` : ""}
          </p>
        </div>
        <nav aria-label="MJENGO OS modules" className="flex flex-wrap gap-2">
          <Link className="rounded-sm border px-3 py-1 text-sm" href={mjengoPath(businessId)}>
            Overview
          </Link>
          {modules.map((module) => (
            <Link
              key={module.key}
              className="rounded-sm border px-3 py-1 text-sm"
              href={mjengoPath(businessId, module.path)}
              title={module.description}
            >
              {module.label}
            </Link>
          ))}
        </nav>
      </header>
      <div className="mt-6 space-y-6">{children}</div>
      <footer className="mt-8 border-t pt-4 text-xs text-muted-foreground">
        Ledger entries are append-only; a posted journal is corrected by a reversal, not an edit.
        Money movement only happens after provider verification — this workspace never marks a
        payment paid on its own.
      </footer>
    </div>
  );
}
