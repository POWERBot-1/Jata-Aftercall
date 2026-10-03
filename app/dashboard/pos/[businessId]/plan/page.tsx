import Link from "next/link";
import { getCheckoutUrl } from "@/lib/subscriptionFlow";
import { configurationSummary, describeConfiguration } from "@/lib/pos/configuration";
import { loadPosWorkspaceCached, posPlanDetails } from "@/lib/pos/workspace";
import { PlanClient } from "@/components/pos/PlanClient";

/**
 * Choose plan (§4 step 6, §45, §67).
 *
 * This page is the only place the Business POS plan is offered. It is never advertised on a
 * business page, in a referral message or anywhere a customer could see it: PUBLIC means customer
 * interaction, PRIVATE means the owner's operating system.
 */

export const dynamic = "force-dynamic";

export const metadata = { title: "Choose your POS plan" };

type Props = { params: Promise<{ businessId: string }> };

export default async function PosPlanPage({ params }: Props) {
  const { businessId } = await params;
  const [workspace, plan] = await Promise.all([loadPosWorkspaceCached(businessId), posPlanDetails()]);
  const checkoutUrl = plan.id ? getCheckoutUrl(businessId, plan.id) : null;

  return (
    <div className="space-y-4">
      <div>
        <p className="jata-kicker">Step 5 of 5</p>
        <h2 className="text-xl font-bold">Choose your plan</h2>
        <p className="mt-1 max-w-2xl text-sm text-zinc-600">
          One plan, one price, everything your answers switched on. Your POS goes live as soon as
          Paystack confirms the payment — not before.
        </p>
      </div>

      <PlanClient
        businessId={businessId}
        checkoutUrl={checkoutUrl}
        priceKES={plan.priceKES}
        lifecycleLabel={workspace.lifecycleLabel}
        entitled={workspace.entitlement.entitled}
        expiresAt={workspace.entitlement.expiresAt ? new Date(workspace.entitlement.expiresAt).toISOString() : null}
      />

      {!plan.available ? (
        <p className="jata-error">The Business POS plan is not available right now. Please try again shortly.</p>
      ) : null}

      <section className="jata-card p-5">
        <p className="jata-kicker">What&apos;s included for {workspace.business.name}</p>
        <ul className="mt-2 grid gap-1.5">
          {describeConfiguration(workspace.configuration).map((line) => (
            <li key={line} className="flex gap-2 text-sm">
              <span aria-hidden="true">✓</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
        <div className="pos-summary mt-4">
          {configurationSummary(workspace.configuration).map((group) => (
            <div className="pos-summary-group" key={group.label}>
              <h3>{group.label}</h3>
              <dl><dd>{group.value}</dd></dl>
            </div>
          ))}
        </div>
      </section>

      <div className="pos-form-actions">
        <Link href={`${workspace.basePath}/preview`} className="jata-btn jata-btn-ghost">← Back to the preview</Link>
        <Link href={workspace.basePath} className="jata-btn jata-btn-secondary">Dashboard</Link>
      </div>

      <p className="pos-note">
        Paying for the Business POS does not change your JATA AFTERCALL page plan. They are separate
        products on the same business.
      </p>
    </div>
  );
}
