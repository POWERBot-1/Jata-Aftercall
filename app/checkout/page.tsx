import Link from "next/link";
import prisma from "@/lib/db";
import { getSession } from "@/lib/auth";
import { assertBusinessOwnership, TenantError } from "@/lib/tenant";
import CheckoutForm from "@/components/CheckoutForm";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Checkout" };

export const dynamic = "force-dynamic";
type Props = { searchParams: Promise<{ businessId?: string; planId?: string }> };

export default async function CheckoutPage({ searchParams }: Props) {
  const { businessId: requestedBusinessId, planId: requestedPlanId } = await searchParams;
  const businessId = requestedBusinessId || "";
  const planId = requestedPlanId || "";
  const session = await getSession();
  if (!session) return <main className="mx-auto max-w-md px-4 py-10">
    <h1 className="text-xl font-bold">Sign in to continue</h1>
    <p className="mt-2 text-sm text-zinc-600">Your business and plan selection will be checked before payment.</p>
    <Link href="/login" className="mt-5 inline-flex rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white">Go to sign in</Link>
  </main>;

  if (!businessId || !planId) return <main className="mx-auto max-w-md px-4 py-10">
    <h1 className="text-xl font-bold">Choose a business and plan</h1>
    <p className="mt-2 text-sm text-zinc-600">Checkout needs a business and an active subscription plan.</p>
    <Link href="/dashboard/subscription" className="mt-5 inline-flex rounded-full bg-zinc-900 px-6 py-3 text-sm font-semibold text-white">Go to subscription</Link>
  </main>;

  try { await assertBusinessOwnership(businessId, session); }
  catch (error) {
    const message = error instanceof TenantError && error.status === 404 ? "We couldn’t find that business." : "You are not authorized to pay for that business.";
    return <main className="mx-auto max-w-md px-4 py-10"><h1 className="text-xl font-bold">Checkout unavailable</h1><p className="mt-2 text-sm text-zinc-600">{message}</p><Link href="/dashboard/subscription" className="mt-5 inline-flex text-sm font-semibold underline">Back to subscription</Link></main>;
  }

  const [business, plan] = await Promise.all([
    prisma.business.findUnique({ where: { id: businessId }, select: { id: true, name: true } }),
    prisma.planConfig.findUnique({ where: { id: planId }, select: { id: true, name: true, priceKES: true, durationDays: true, isActive: true } }),
  ]);
  if (!business || !plan || !plan.isActive) return <main className="mx-auto max-w-md px-4 py-10">
    <h1 className="text-xl font-bold">Checkout unavailable</h1>
    <p className="mt-2 text-sm text-zinc-600">The business or plan is no longer available. Choose an active plan and try again.</p>
    <Link href={`/dashboard/subscription?businessId=${encodeURIComponent(businessId)}`} className="mt-5 inline-flex text-sm font-semibold underline">Back to subscription</Link>
  </main>;

  return <CheckoutForm businessId={business.id} planId={plan.id} businessName={business.name} planName={plan.name} priceKES={plan.priceKES} />;
}
