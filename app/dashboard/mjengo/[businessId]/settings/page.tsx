/**
 * MJENGO OS — plan & settings.
 *
 * Two jobs, both honest:
 *   • show the commercial terms actually stored on the server, and
 *   • hand the owner to the existing checkout flow for the MJENGO_OS plan row — or refuse, with a
 *     reason, when this deployment cannot activate the product.
 *
 * It does not implement payments. `/checkout` + `/api/paystack/*` already own provider
 * verification; this page only resolves the plan row server-side so the browser never supplies an
 * amount. The Paystack "pay" button is a POST to the same `/api/checkout` endpoint every other
 * product uses, with `planId` resolved here.
 */
import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { requireMjengoAccess } from "@/lib/mjengo/access";
import { mjengoCheckoutRefusal } from "@/lib/mjengo/settlement";
import { MJENGO_PLAN_DURATION_DAYS, MJENGO_PLAN_KEY, MJENGO_PLAN_PRICE_KES } from "@/lib/mjengo/entitlement";
import { getMjengoOsPlan } from "@/lib/pricing";
import { mjengoSafeText } from "@/lib/mjengo/sanitize";
import { formatKES, formatDate } from "@/lib/format";
import prisma from "@/lib/db";

export const dynamic = "force-dynamic";

export default async function MjengoPlanSettings({ params }: { params: Promise<{ businessId: string }> }) {
  const { businessId: raw } = await params;
  const businessId = String(raw ?? "").trim();
  if (!businessId) notFound();

  const session = await getSession();
  const gate = await requireMjengoAccess(businessId, session);

  const plan: any = await getMjengoOsPlan().catch(() => null);
  const refusal = plan ? mjengoCheckoutRefusal(plan) : "The MJENGO OS plan row could not be read from this database.";
  const business = await prisma.business
    .findUnique({ where: { id: businessId }, select: { name: true, slug: true } })
    .catch(() => null);
  const safeName = mjengoSafeText(business?.name ?? businessId);
  const storage: any = await (prisma as any).erpEntitlement
    ?.findUnique?.({ where: { businessId }, select: { packageKey: true, status: true } })
    .catch(() => null);

  return (
    <section aria-labelledby="mjengo-plan-heading">
      <h2 id="mjengo-plan-heading" className="text-lg font-semibold">
        Plan &amp; settings — {safeName}
      </h2>

      <dl className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="rounded-sm border p-4">
          <dt className="text-sm text-muted-foreground">Product</dt>
          <dd className="text-xl font-bold">MJENGO OS</dd>
          <dd className="text-sm text-muted-foreground">Business management workspace</dd>
        </div>
        <div className="rounded-sm border p-4">
          <dt className="text-sm text-muted-foreground">Stored terms on this server</dt>
          <dd className="text-xl font-bold">
            {plan ? `KES ${formatKES(Number(plan.priceKES)).replace("KES ", "")} / ${plan.durationDays} days` : "Plan row missing"}
          </dd>
          <dd className="text-sm text-muted-foreground">
            Expected: {formatKES(MJENGO_PLAN_PRICE_KES)} / {MJENGO_PLAN_DURATION_DAYS} days · key {MJENGO_PLAN_KEY}
          </dd>
        </div>
        <div className="rounded-sm border p-4">
          <dt className="text-sm text-muted-foreground">Current entitlement</dt>
          <dd className="text-xl font-bold">{gate.ok ? gate.entitlement.status : "Not active"}</dd>
          <dd className="text-sm text-muted-foreground">
            {gate.ok && gate.entitlement.expiresAt
              ? `Paid through ${formatDate(gate.entitlement.expiresAt)}`
              : gate.ok
                ? "No paid period recorded"
                : gate.error}
          </dd>
        </div>
        <div className="rounded-sm border p-4">
          <dt className="text-sm text-muted-foreground">Subscription storage row</dt>
          <dd className="text-xl font-bold">{storage?.packageKey ?? "none"}</dd>
          <dd className="text-sm text-muted-foreground">
            {storage && storage.packageKey !== MJENGO_PLAN_KEY
              ? `This row belongs to ${storage.packageKey}. MJENGO OS cannot be activated beside it until product storage is separated — checkout is refused rather than overwriting it.`
              : "Reserved for MJENGO OS."}
          </dd>
        </div>
      </dl>

      <div className="mt-6 rounded-sm border p-4">
        <h3 className="font-medium">Purchase or renew</h3>
        {refusal ? (
          <>
            <p className="mt-1 text-sm text-red-600">{refusal}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              No payment can be started while this is unresolved, so this page will not render a pay
              button that would charge for a workspace that cannot open.
            </p>
          </>
        ) : (
          <>
            <p className="mt-1 text-sm text-muted-foreground">
              Payment is taken by the same verified Paystack flow used by every other product. The
              amount comes from the stored plan row above; MJENGO OS activates only after the provider
              confirms the transaction and the amount matches.
            </p>
            <form action="/checkout" method="get" className="mt-3">
              <input type="hidden" name="businessId" value={businessId} />
              <input type="hidden" name="planId" value={String(plan.id)} />
              <button type="submit" className="rounded-sm bg-black px-4 py-2 text-white">
                Continue to checkout — {formatKES(Number(plan.priceKES))} / {plan.durationDays} days
              </button>
            </form>
          </>
        )}
      </div>

      <div className="mt-6 rounded-sm border border-amber-300 bg-amber-50 p-4">
        <h3 className="font-medium">Refunds — BLOCKED at workspace level</h3>
        <p className="mt-1 text-sm">
          Subscription refunds are handled by the existing provider-verified refund path
          (lib/payments/providers/*, M-PESA reversal / Paystack refund), not from this page. This
          workspace does not and will not mark a refund successful on its own; no refund is
          simulated here.
        </p>
      </div>

      <div className="mt-6 rounded-sm border p-4">
        <h3 className="font-medium">Branding</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Business name is stored as plain text and rendered as text. HTML, event handlers and
          javascript: URLs are rejected by <code>POST /api/mjengo/branding</code> before they reach the
          database.
        </p>
      </div>
    </section>
  );
}
